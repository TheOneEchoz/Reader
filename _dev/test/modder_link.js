// Tankōbon and the modder (a separate app): Add-ons › Get; “Mod this game” opens the modder straight into the flowchart,
// working on Tankōbon's own game (no copy, no library there); its edits are a mod on the game in Tankōbon at once and play
// there; a locked Tankōbon makes the modder wait; inside the desktop window the same.
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
  await p.evaluate(() => openGlobalSettings()); await p.click('.setitem:has-text("Add-ons")'); await p.waitForSelector('#apps-list');
  const appTxt = await p.$eval('#apps-list', e => e.innerText);
  ok('Settings › Add-ons lists the modder, marked beta and not completely stable', /Modder/.test(appTxt) && /Beta/i.test(appTxt) && /not completely stable/.test(appTxt), appTxt.slice(0, 300));
  await p.click('#app-get-modder'); await p.waitForSelector('#app-open-modder');
  await p.evaluate(() => closeSheet());
  await p.evaluate(id => go('detail', { id }), gid); await p.waitForSelector('#game-mod', { timeout: 15000 });
  ok('with the modder got, the game page has “Mod this game”', true);
  // straight into the flowchart
  const [mp] = await Promise.all([ctx.waitForEvent('page'), p.click('#game-mod')]);
  const merrs = []; mp.on('pageerror', e => merrs.push(e.message));
  await mp.waitForLoadState();
  ok('it opens the modder, for this game', /\/modder\/\?tkb=/.test(mp.url()), mp.url());
  await mp.waitForSelector('#modder #modcanvas', { timeout: 180000 }).catch(() => { });
  await mp.waitForTimeout(1500);
  await mp.screenshot({ path: '/tmp/claude-0/shots/modder-direct.png' });
  ok('the flowchart opens straight away (the game started in the modder)', !!(await mp.$('#modder #modcanvas')) && await mp.evaluate(() => !!GAME.loaded));
  const local = await mp.evaluate(() => new Promise(res => { const r = indexedDB.open('tankobon-engine', 1); r.onsuccess = () => { const d = r.result, out = {}; let n = 0; for (const s of ['galleries', 'images']) { const q = d.transaction(s).objectStore(s).count(); q.onsuccess = () => { out[s] = q.result; if (++n === 2) res(out); }; } }; r.onerror = () => res('none'); }));
  ok('nothing is copied into the modder: no game and no pieces in its own storage', local && local.galleries === 0 && local.images === 0, JSON.stringify(local));
  // an edit (a Story edits mod made by the flowchart; here a line that sets a mark): it is in Tankōbon at once
  await mp.evaluate(async id => {
    await flowSave(id, []);
    const g = await S.gal(id), mod = g.game.mods.find(m => m.flow), list = await rpyGetJSON(mod.list), f = list.find(x => x.p === FLOW_FILE);
    const text = new TextDecoder().decode(await rpyRead(f.c, f.s)) + '\ninit python:\n    tkb_modder_mark = 42\n';
    const buf = new TextEncoder().encode(text).buffer; f.c = [await rpyPut(buf)]; f.s = buf.byteLength; await rpyPutJSON(list, mod.list);
  }, gid);
  const am = await p.evaluate(async id => { const g = await S.gal(id); const m = (g.game.mods || []).find(x => x.flow); if (!m) return null; const l = await rpyGetJSON(m.list); return [m.name, m.on, l.map(f => f.p)]; }, gid);
  ok('edits made in the modder are a mod on the game in Tankōbon at once (nothing to send)', !!am && am[1] === true && am[2].includes('game/zzzz_tankobon_flow.rpy'), JSON.stringify(am));
  await mp.close();
  await p.evaluate(id => go('detail', { id }), gid); await p.waitForSelector('#game-play');
  ok('the game page shows it plays with them', /Story edits/.test(await p.$eval('#game-play', e => e.textContent)));
  await p.click('#game-play'); const fr = await start();
  const mark = await fr.evaluate(() => window.renpy_exec('result = getattr(renpy.store, "tkb_modder_mark", None)')).catch(e => String(e));
  ok('the game plays in Tankōbon with the modder\'s edits', mark === 42, JSON.stringify(mark));
  await p.click('#gamebox .gameexit'); await p.waitForFunction(() => !document.getElementById('gamebox'), null, { timeout: 20000 }).catch(() => { });
  // locked Tankōbon: the modder waits, and goes on once it is unlocked
  const mq = await ctx.newPage(); await mq.goto('http://localhost:8769/modder/?tkb=' + gid + '&probe=1');
  await mq.waitForTimeout(1500);
  await p.evaluate(() => lockNow()); await p.waitForSelector('#user', { timeout: 20000 });
  const pending = mq.evaluate(id => S.gal(id).then(g => g && g.title), gid);
  await mq.waitForSelector('#tkbwait', { timeout: 15000 }).catch(() => { });
  const waitTxt = await mq.$eval('#tkbwait', e => e.textContent).catch(() => '');
  ok('while Tankōbon is locked, the modder waits and says so', /locked/.test(waitTxt), waitTxt);
  await p.fill('#user', 'modlink'); await p.fill('#pw', 'modlinkpw12'); await p.press('#pw', 'Enter');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }).catch(() => { });
  const title = await Promise.race([pending, new Promise(r => setTimeout(() => r('timeout'), 20000))]);
  ok('once unlocked, it goes on', title === 'the question', String(title));
  await mq.close();
  // the desktop app's way: inside Tankōbon's window
  await p.evaluate(() => { window.TKB_MODDER_INSIDE = true; window.TKB_MODDER_SITE = location.origin + '/modder/'; });
  await p.evaluate(id => go('detail', { id }), gid); await p.waitForSelector('#game-mod');
  await p.click('#game-mod'); await p.waitForSelector('#modderlayer iframe');
  let fi = null; for (let k = 0; k < 60 && !fi; k++) { await p.waitForTimeout(500); fi = p.frames().find(f => f.url() === 'about:srcdoc' && f.name() === 'modderframe'); }
  await fi.waitForSelector('#modder #modcanvas', { timeout: 180000 }).catch(() => { });
  await p.screenshot({ path: '/tmp/claude-0/shots/modder-inside.png' });
  ok('inside Tankōbon\'s window (desktop app): straight into the flowchart', !!(await fi.$('#modder #modcanvas')));
  await p.click('#modder-close'); ok('Close comes back to Tankōbon', !(await p.$('#modderlayer')));
  await ctx.route('**/modder/**', r => r.abort());
  await p.click('#game-mod'); await p.waitForSelector('#modderlayer iframe'); await p.waitForTimeout(2500);
  ok('offline, the last copy of the modder opens', /Offline/.test(await p.$eval('#toast', e => e.textContent)) && (await p.$eval('#modderframe', f => (f.srcdoc || '').length)) > 10000);
  await p.click('#modder-close'); await ctx.unroute('**/modder/**');
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker|modder/i.test(e)));
  ok('no errors', errs.length === 0 && merrs.length === 0, [...errs, ...merrs].slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
