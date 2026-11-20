// Tankōbon and the modder (a separate app): Extra apps › Get, “Mod this game” hands the game over, the modder's edits come
// back as a mod and play in Tankōbon; handed over again, only what changed comes; a locked Tankōbon hands nothing over.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GAMEDIR = '/tmp/claude-0/games/g8.3.7/the_question-7.0-pc', RT = '/home/claude/reader/renpy/';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));  
  await p.goto('http://localhost:8769/beta/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'modlink'); await p.fill('#pw1', 'modlinkpw12'); await p.fill('#pw2', 'modlinkpw12'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 }); await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Download")');
  for (let k = 0; k < 120; k++) { await p.waitForTimeout(1000); if (await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); return g && await RPY.has(g.game.rt); })) break; }
  await p.waitForTimeout(1500);
  const gid = await p.evaluate(async () => (await S.gals()).find(x => x.game).id);
  const start = async () => {
    for (let k = 0; k < 120 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(1000);
    const fr = p.frames().find(f => f !== p.mainFrame());
    for (let k = 0; k < 40; k++) { await p.waitForTimeout(2000); if (await fr.evaluate(() => { const pre = document.getElementById('presplash'); return !pre || !pre.isConnected || pre.style.display === 'none'; }).catch(() => false)) break; }
    await p.waitForTimeout(2500); return fr;
  };


  ok('(the game is in Tankōbon)', !!gid);
  // Extra apps: get the modder
  await p.evaluate(() => openGlobalSettings()); await p.click('.setitem:has-text("Extra apps")'); await p.waitForSelector('#apps-list');
  const appTxt = await p.$eval('#apps-list', e => e.innerText);
  ok('Settings › Extra apps lists the modder, marked beta and not completely stable', /Modder/.test(appTxt) && /Beta/i.test(appTxt) && /not completely stable/.test(appTxt), appTxt.slice(0, 300));
  await p.click('#app-get-modder'); await p.waitForSelector('#app-open-modder');
  await p.evaluate(() => closeSheet());
  await p.evaluate(id => go('detail', { id }), gid); await p.waitForSelector('#game-mod', { timeout: 15000 });
  ok('with the modder got, the game page has “Mod this game”', true);
  // hand-over
  const [mp] = await Promise.all([ctx.waitForEvent('page'), p.click('#game-mod')]);
  const merrs = []; mp.on('pageerror', e => merrs.push(e.message));
  await mp.waitForLoadState();
  ok('it opens the modder, for this game', /\/modder\/\?tkb=/.test(mp.url()), mp.url());
  await mp.waitForFunction(() => /is here/.test((document.getElementById('tkbstatus') || {}).textContent || ''), null, { timeout: 120000 }).catch(() => { });
  const st1 = await mp.$eval('#tkbstatus', e => e.textContent).catch(() => '');
  const cmp = async () => {
    const a = await p.evaluate(async id => (await rpyIds(await S.gal(id))).length, gid);
    const m = await mp.evaluate(async id => { const g = await S.gal(id); const ids = await rpyIds(g); let present = 0; for (const x of ids) if (await ST.get('images', x)) present++; return [ids.length, present, !!g.fromTkb, g.title]; }, gid);
    return [a, m];
  };
  const c1 = await cmp();
  ok('the game comes over: every piece of it, kept in the modder', /is here/.test(st1) && c1[1][0] === c1[0] && c1[1][1] === c1[0] && c1[1][2] === true, JSON.stringify([st1, c1]));
  ok('the modder lists it as from Tankōbon, with Send to Tankōbon', await mp.$(`.gamecard[data-id="${gid}"] button:has-text("Send to Tankōbon")`) !== null);
  // a Story edits mod made in the modder (here: a line that sets a mark), sent back
  await mp.evaluate(async id => {
    await flowSave(id, []);
    const g = await S.gal(id), mod = g.game.mods.find(m => m.flow), list = await rpyGetJSON(mod.list), f = list.find(x => x.p === FLOW_FILE);
    const text = new TextDecoder().decode(await rpyRead(f.c, f.s)) + '\ninit python:\n    tkb_modder_mark = 42\n';
    const buf = new TextEncoder().encode(text).buffer; f.c = [await rpyPut(buf)]; f.s = buf.byteLength; await rpyPutJSON(list, mod.list);
  }, gid);
  await mp.click(`.gamecard[data-id="${gid}"] button:has-text("Send to Tankōbon")`);
  await mp.waitForTimeout(3000);
  const toastM = await mp.$eval('#toast', e => e.textContent).catch(() => '');
  const am = await p.evaluate(async id => { const g = await S.gal(id); const m = (g.game.mods || []).find(x => x.modder); if (!m) return null; const l = await rpyGetJSON(m.list); return [m.name, m.on, l.map(f => f.p)]; }, gid);
  ok('Send to Tankōbon: the edits are a mod on the game in Tankōbon, switched on', !!am && am[1] === true && am[2].includes('game/zzzz_tankobon_flow.rpy') && /Sent to Tankōbon/.test(toastM), JSON.stringify([am, toastM]));
  await p.waitForTimeout(800);
  const playTxt = await p.$eval('#game-play', e => e.textContent).catch(() => '');
  ok('the game page shows it plays with them', /from the modder/.test(playTxt), playTxt);
  // played in Tankōbon, with the mod
  await p.click('#game-play'); const fr = await start();
  const mark = await fr.evaluate(() => window.renpy_exec('result = getattr(renpy.store, "tkb_modder_mark", None)')).catch(e => String(e));
  ok('the game plays in Tankōbon with the modder\'s edits', mark === 42, JSON.stringify(mark));
  await p.click('#gamebox .gameexit'); await p.waitForFunction(() => !document.getElementById('gamebox'), null, { timeout: 20000 }).catch(() => { });
  // opened again: only what changed comes over, and the modder keeps its edits
  await p.evaluate(id => go('detail', { id }), gid); await p.waitForSelector('#game-mod');
  let sentN = 0; await mp.evaluate(() => { const bc = new BroadcastChannel('tankobon-modder'); window.__n = 0; bc.onmessage = e => { if (e.data && e.data.t === 'piece') window.__n++; }; });
  await mp.evaluate(id => TKB_LINK.receive(id), gid);
  sentN = await mp.evaluate(() => window.__n);
  const mods2 = await mp.evaluate(async id => (await S.gal(id)).game.mods.map(m => [m.name, !!m.flow, !!m.modder]), gid);
  ok('handed over again: only the small records that change, and the modder\'s own edits are kept (once)', sentN > 0 && sentN < 10 && mods2.filter(m => m[1]).length === 1 && !mods2.some(m => m[2]), JSON.stringify([sentN, mods2]));
  // locked Tankōbon: the modder waits
  await p.evaluate(() => lockNow()); await p.waitForTimeout(800);
  const r = await mp.evaluate(() => new Promise(res => { const bc = new BroadcastChannel('tankobon-modder'); bc.onmessage = e => { if (e.data && e.data.rid === 'x1' && e.data.t !== 'hello') res(e.data.t); }; bc.postMessage({ t: 'hello', rid: 'x1', gid: 'whatever', have: [] }); setTimeout(() => res('none'), 3000); }));
  ok('a locked Tankōbon hands nothing over', r === 'locked', r);
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0 && merrs.length === 0, [...errs, ...merrs].slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
