// Mods: an .rpa mod in the game folder is spotted when adding the game (by its name and date) and kept as a mod;
// it is switched on and off before playing, and the game sees it only when it is on. Another mod is added by dropping a ZIP.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GAMEDIR = '/tmp/claude-0/games/m8.5.3/the_question-7.0-pc', RT = '/home/claude/reader/renpy/';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'modder'); await p.fill('#pw1', 'modpass123'); await p.fill('#pw2', 'modpass123'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 });
  const sheet = await p.$eval('#sheetBody', e => e.innerText.replace(/\s+/g, ' '));
  ok('adding the game spots the mod archive, by its name and date', /zz_cheatmod\.rpa Looks like a mod, by its name and its date/.test(sheet), sheet.slice(0, 300));
  await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Download")');
  for (let k = 0; k < 120; k++) { await p.waitForTimeout(1000); if (await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); return g && await RPY.has(g.game.rt); })) break; }
  await p.waitForTimeout(1500);
  const st = await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); const base = await rpyGetJSON(g.game.list); return { id: g.id, mods: (g.game.mods || []).map(m => m.name + ':' + m.on + ':' + m.files), inBase: base.some(f => /zz_cheatmod/.test(f.p)) }; });
  ok('it became a mod, separate from the game\'s own files', JSON.stringify(st.mods) === '["zz_cheatmod:true:1"]' && !st.inBase, JSON.stringify(st));
  const playTxt = await p.$eval('#game-play', e => e.innerText);
  ok('Play says which mods are on', /Play with zz_cheatmod/.test(playTxt), playTxt);
  const modValue = async () => {
    await p.click('#game-play');
    for (let k = 0; k < 120 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(1000);
    const fr = p.frames().find(f => f !== p.mainFrame());
    for (let k = 0; k < 40; k++) { await p.waitForTimeout(2000); if (await fr.evaluate(() => { const pre = document.getElementById('presplash'); return !pre || !pre.isConnected || pre.style.display === 'none'; }).catch(() => false)) break; }
    await p.waitForTimeout(2000);
    const v = await fr.evaluate(() => window.renpy_exec('result = [getattr(store, "tkb_mod", "off"), getattr(store, "tkb_mod2", "no")]')).catch(e => 'error ' + e);
    await p.click('#gamebox .gameexit'); await p.waitForFunction(() => !document.getElementById('gamebox'), null, { timeout: 15000 }).catch(() => { }); await p.waitForTimeout(1500);
    return JSON.stringify(v);
  };
  const v1 = await modValue();
  ok('with the mod on, the game sees it', /"on"/.test(v1), v1);
  // switch it off
  await p.click('#game-mods .modrow .switch'); await p.waitForTimeout(1200);
  ok('switched off, Play says just Play', (await p.$eval('#game-play', e => e.innerText)).trim() === 'Play');
  const v2 = await modValue();
  ok('with the mod off, the game does not see it', /"off"/.test(v2), v2);
  // a second mod, dropped on the game's page as a ZIP
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'moddrop'; i.style.display = 'none'; document.body.append(i); });
  await p.setInputFiles('#moddrop', '/tmp/claude-0/SecondMod.zip');
  await p.evaluate(() => handleDrop([...document.getElementById('moddrop').files])); await p.waitForTimeout(3000);
  const mods2 = await p.evaluate(async id => (await S.gal(id)).game.mods.map(m => m.name + ':' + m.on), st.id);
  ok('a ZIP dropped on the game\'s page becomes a mod (switched on)', JSON.stringify(mods2) === '["zz_cheatmod:false","SecondMod:true"]', JSON.stringify(mods2));
  const v3 = await modValue();
  ok('the game sees only the mods that are on', /"off"/.test(v3) && /"yes"/.test(v3), v3);
  await p.screenshot({ path: '/tmp/claude-0/shots/mods.png', fullPage: true });
  // delete a mod: its pieces go
  const before = await p.evaluate(async () => (await DB.keys('images')).length);
  await p.click('#game-mods button[aria-label="Delete the mod SecondMod"]'); await p.waitForSelector('.askyes'); await p.click('.askyes button:has-text("Delete")'); await p.waitForTimeout(1500);
  const after = await p.evaluate(async id => ({ n: (await DB.keys('images')).length, mods: (await S.gal(id)).game.mods.length }), st.id);
  ok('deleting a mod removes it and its files', after.mods === 1 && before - after.n >= 2, `${before} -> ${after.n}`);
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
