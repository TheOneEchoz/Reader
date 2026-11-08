// A picture that layered1 on conditions (ConditionSwitch) and chooses nothing: Fix the conditions shows its rows,
// a row's picture is changed, and Try it plays the scene with it.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GAMEDIR = '/tmp/claude-0/games/g8.3.7/the_question-7.0-pc', RT = '/home/claude/reader/renpy/';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (/fix values/.test(m.text())) console.log('CONSOLE', m.text()); }); p.on('console', m => { if (/fix reload/.test(m.text())) console.log('TIMING', m.text()); });
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', (process.env.SHOWERR ? 'value2' : 'value3')); await p.fill('#pw1', 'layeredpw12'); await p.fill('#pw2', 'layeredpw12'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 }); await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Download")');
  for (let k = 0; k < 120; k++) { await p.waitForTimeout(1000); if (await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); return g && await RPY.has(g.game.rt); })) break; }
  await p.waitForTimeout(1500);
  const gid = await p.evaluate(async () => (await S.gals()).find(x => x.game).id);
  if (process.env.SHOWERR) await p.evaluate(async id => { const x = await S.gal(id); x.game.errors = 'show'; await saveGallery(x); }, gid);
    const start = async () => {
    for (let k = 0; k < 120 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(1000);
    const fr = p.frames().find(f => f !== p.mainFrame());
    for (let k = 0; k < 40; k++) { await p.waitForTimeout(2000); if (await fr.evaluate(() => { const pre = document.getElementById('presplash'); return !pre || !pre.isConnected || pre.style.display === 'none'; }).catch(() => false)) break; }
    await p.waitForTimeout(2500); return fr;
  };
  await p.evaluate(async id => { await addFixBlock(id, 'picture tkbv b[tkb_db]', 'init 1999 python:\n    pass'); }, gid);
  await p.click('#game-play'); let fr = await start();
  const box = await (await p.$('#gamebox iframe')).boundingBox();
  for (let k = 0; k < 4; k++) { await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); await p.waitForTimeout(3000); if (await fr.evaluate(() => window.renpy_exec('result = renpy.get_screen("main_menu") is None')).catch(() => false)) break; }
  await fr.evaluate(() => window.renpy_exec(['def _tkbj9(d=[False], renpy=renpy):', '    if d[0]:', '        return', '    d[0] = True', '    renpy.jump("tkb_err_test9")', 'config.periodic_callbacks.append(_tkbj9)', 'result = True'].join('\n')));
  await p.waitForTimeout(3500);
  await p.click('#gamebox .gameerr'); await p.waitForSelector('#gameerrors');
  await p.click('#gameerrors .fixbtn:has-text("tkbv")'); await p.waitForSelector('#fix-sheet');
  await p.waitForSelector('#fix-values:not([hidden]) .swpick', { timeout: 30000 }).catch(() => { });
  await p.waitForFunction(() => [...document.querySelectorAll('#fix-values img.swthumb')].filter(i => i.naturalWidth > 0).length === 2, null, { timeout: 20000 }).catch(() => { });
  const vals = await p.$$eval('#fix-values .swpick', a => a.map(e => [e.innerText.trim(), (e.querySelector('img') || {}).naturalWidth || 0]));
  ok('it shows the values that have pictures, each with its picture', vals.length === 2 && vals[0][0] === 'tkb_db = 1' && vals[1][0] === 'tkb_db = 2' && vals[0][1] > 0 && vals[1][1] > 0, JSON.stringify([vals, await p.$eval('#fix-sheet', e => e.innerText.slice(0, 300))]));
  ok('and says the value it has now', /“tkb_db” is 0 now/.test(await p.$eval('#fix-values', e => e.innerText)));
  await p.click('#fix-values .swpick:nth-child(2)');
  const dropTxt = await p.$eval('#fix-values', e => e.innerText).catch(() => '');
  ok('choosing one offers removing the earlier fix it replaces', !!(await p.$('#fix-dropold:checked')) && /tkbv b\[tkb_db\]/.test(dropTxt), dropTxt);
  ok('the fix keeps the value, not following another variable', /not in \(1, 2,\)/.test(await p.$eval('#fix-preview', e => e.innerText)) && /"tkb_db", 2\)/.test(await p.$eval('#fix-preview', e => e.innerText)), await p.$eval('#fix-preview', e => e.innerText));
  const loads0 = await p.evaluate(() => GAME.loadCount || 0);
  const frame0 = await p.$('#gamebox iframe');
  await p.click('#fix-prev'); await p.waitForSelector('#fixprev img', { timeout: 30000 });
  await p.waitForTimeout(500);
  const green = await p.evaluate(() => { const im = $('#fixprev img'), c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 13) if (d[i + 1] > 140 && d[i] < 90 && d[i + 2] < 90) n++; return n; });
  await p.screenshot({ path: '/tmp/claude-0/shots/value-preview.png' });
  const same = await p.evaluate(el => el === document.querySelector('#gamebox iframe'), frame0);
  ok('Preview draws the scene with that value over the game, without restarting it', green > 200 && same && !(await p.$('#fix-sheet')), JSON.stringify([green, same]));
  const still0 = await fr.evaluate(() => window.renpy_exec('result = renpy.store.tkb_db')).catch(e => String(e));
  ok('the preview changes nothing in the game', still0 === 0, JSON.stringify(still0));
  await p.click('#fixprev-back'); await p.waitForSelector('#fix-sheet');
  ok('Back returns to the fix, with the value still chosen', /tkb_db = 2/.test(await p.$eval('#fix-values .swpick.on', e => e.innerText).catch(() => '')));
  await p.click('#fix-save'); await p.waitForTimeout(2500);
  const fx = await p.evaluate(async gid => { const g = await S.gal(gid), m = g.game.mods.find(x => x.fixes), l = await rpyGetJSON(m.list), f = l.find(x => /zzzz_tankobon_fixes/.test(x.p)); return new TextDecoder().decode(await rpyRead(f.c, f.s)); }, gid);
  ok('Save: the value fix is in the Fixes mod, and the earlier fix is gone', /# fix: value tkb_db/.test(fx) && !/picture tkbv/.test(fx), fx);
  const now = await fr.evaluate(() => window.renpy_exec('result = [renpy.store.tkb_db, renpy.showing("tv")]')).catch(e => String(e));
  ok('and the variable has the value in the game now', Array.isArray(now) && now[0] === 2 && now[1] === true, JSON.stringify(now));
  // a layered picture with a part named after a variable: the preview draws the whole picture
  await fr.evaluate(() => window.renpy_exec(['def _tkbj10(d=[False], renpy=renpy):', '    if d[0]:', '        return', '    d[0] = True', '    renpy.jump("tkb_err_test10")', 'config.periodic_callbacks.append(_tkbj10)', 'result = True'].join('\n')));
  await p.waitForTimeout(3500);
  await p.click('#gamebox .gameerr'); await p.waitForSelector('#gameerrors');
  await p.click('#gameerrors .fixbtn:has-text("tkbl b")'); await p.waitForSelector('#fix-sheet');
  await p.waitForSelector('#fix-values:not([hidden]) .swpick', { timeout: 30000 }).catch(() => { });
  await p.click('#fix-values .swpick:nth-child(2)');
  await p.click('#fix-prev'); await p.waitForSelector('#fixprev img', { timeout: 30000 }); await p.waitForTimeout(500);
  const green2 = await p.evaluate(() => { const im = $('#fixprev img'), c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 13) if (d[i + 1] > 140 && d[i] < 90 && d[i + 2] < 90) n++; return n; });
  await p.screenshot({ path: '/tmp/claude-0/shots/value-preview2.png' });
  ok('for a part of a layered picture, Preview draws the whole picture with that value', green2 > 200, String(green2));
  await p.click('#fixprev-back');
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
