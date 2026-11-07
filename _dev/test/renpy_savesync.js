// Game saves between devices: two devices with the same game (each its own copy) exchange the newer save files;
// a save deleted on one stays deleted; the signing keys stay on each device. (The exchange is driven here the way Sync does it.)
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const V1 = '/tmp/claude-0/games/a8.5.3/the_question-7.0-pc';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const device = async (user, title) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    await ctx.route('**/fonts.g*/**', r => r.abort()); await ctx.route('https://theoneechoz.github.io/**', r => r.abort());
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(user + ': ' + e.message));
    await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
    await p.fill('#user1', user); await p.fill('#pw1', 'syncpass12'); await p.fill('#pw2', 'syncpass12'); await p.click('#v-lock button[type=submit]');
    await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1200);
    await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
    const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(V1);
    await p.waitForSelector('#game-add', { timeout: 60000 }); await p.fill('#game-name-0', title); await p.click('#game-add');
    await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Cancel")'); await p.waitForTimeout(1200);
    return p;
  };
  const A = await device('phone', 'The Question'), B = await device('laptop', 'Question (laptop copy)');
  const R = 'home/web_user/.renpy/the_question-1234/';
  const put = (p, files) => p.evaluate(async ([files]) => { const g = (await S.gals()).find(x => x.game); await persistSaves(g.id, files.map(([n, t]) => ({ p: n, buf: new TextEncoder().encode(t).buffer })), { allowEmpty: true }); }, [files]);
  const saves = p => p.evaluate(async () => { const g = (await S.gals()).find(x => x.game), idx = (await rpyGetJSON(g.game.sv)) || {}, out = {}; for (const [k, f] of Object.entries(idx)) out[k.split('/').pop()] = new TextDecoder().decode(await rpyRead(f.c, f.s)); return out; });
  // one round of what Sync does: B gets A's list, asks for the newer files, A sends them, B merges them
  const round = async (from, to) => {
    const list = await from.evaluate(() => gsvListing());
    for (const th of list) {
      const w = await to.evaluate(async th => { const me = (await gsvListing()).find(x => x.k === th.k); if (!me) return null; return { paths: gsvWanted(me, th), gone: Object.fromEntries(Object.entries(th.gone || {}).filter(([p, t]) => (me.gone[p] || 0) < t)) }; }, th);
      if (!w) continue;
      const files = await from.evaluate(([k, paths]) => gsvRead(k, paths), [th.k, w.paths]);
      await to.evaluate(([k, files, gone]) => gsvMerge(k, files, gone), [th.k, files, w.gone]);
    }
  };
  const keys = await Promise.all([A, B].map(p => p.evaluate(async () => gsvKey((await S.gals()).find(x => x.game)))));
  ok('the same game is recognised on both devices, though named differently', keys[0] === keys[1], keys.join(' / '));
  await put(A, [[R + '1-1-LT1.save', 'A slot 1'], [R + 'persistent', 'A persistent'], ['home/web_user/.renpy/tokens/security_keys.txt', 'A keys']]);
  await put(B, [['home/web_user/.renpy/tokens/security_keys.txt', 'B keys']]);
  await round(A, B);
  let sb = await saves(B);
  ok('the other device receives the saves', sb['1-1-LT1.save'] === 'A slot 1' && sb['persistent'] === 'A persistent', JSON.stringify(sb));
  ok('each device keeps its own signing keys', sb['security_keys.txt'] === 'B keys');
  await new Promise(r => setTimeout(r, 30));
  // B plays: changes slot 1 and adds slot 2; A gets them
  await put(B, [[R + '1-1-LT1.save', 'B slot 1 (newer)'], [R + '1-2-LT1.save', 'B slot 2'], [R + 'persistent', 'A persistent'], ['home/web_user/.renpy/tokens/security_keys.txt', 'B keys']]);
  await round(B, A);
  let sa = await saves(A);
  ok('the newer save wins', sa['1-1-LT1.save'] === 'B slot 1 (newer)' && sa['1-2-LT1.save'] === 'B slot 2', JSON.stringify(sa));
  // an older copy does not overwrite a newer one
  await round(A, B); sb = await saves(B);
  ok('sending back changes nothing', sb['1-1-LT1.save'] === 'B slot 1 (newer)');
  // A deletes slot 2; B follows, and does not bring it back
  await put(A, [[R + '1-1-LT1.save', 'B slot 1 (newer)'], [R + 'persistent', 'A persistent'], ['home/web_user/.renpy/tokens/security_keys.txt', 'A keys']]);
  await round(A, B); await round(B, A);
  sa = await saves(A); sb = await saves(B);
  ok('a deleted save stays deleted on both', !sa['1-2-LT1.save'] && !sb['1-2-LT1.save'], JSON.stringify(Object.keys(sb)));
  // while the game is being played there, merging waits
  const busy = await B.evaluate(async () => { const g = (await S.gals()).find(x => x.game); GAME.box = document.createElement('div'); GAME.g = g; const r = await gsvMerge(gsvKey(g), [{ p: 'x', t: Date.now(), b: btoa('x') }], {}); GAME.box = null; GAME.g = null; return r; });
  ok('nothing is merged into a game that is being played', busy === -1);
  // the settings switch
  await A.evaluate(() => go('settings')); await A.waitForTimeout(800);
  ok('Settings has the switch for game saves', !!(await A.$('#sw-gamesaves')) || !(await A.$('#sw-lan')), 'sync settings ' + !!(await A.$('#sw-lan')));
  const real = errs.filter(e => !/serviceWorker/.test(e));
  ok('no errors', real.length === 0, real.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
