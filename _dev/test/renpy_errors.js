// Mistakes in the game itself: skipped (like Ren'Py's Ignore) with a note and the details; or Ren'Py's own error screen.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GAMEDIR = '/tmp/claude-0/games/e8.5.3/the_question-7.0-pc', RT = '/home/claude/reader/renpy/';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'errors'); await p.fill('#pw1', 'errorpass1'); await p.fill('#pw2', 'errorpass1'); await p.click('#v-lock button[type=submit]');
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
  ok('the game page has the Game errors setting (Skip them by default)', await p.$eval('#game-errors button[aria-pressed="true"]', b => b.innerText) === 'Skip them');
  // a scene with a typo in a variable (the test game has it in zz_errtest.rpy), reached as the game would
  const boom = fr => fr.evaluate(() => window.renpy_exec(['store._tkbjd = False', 'def _tkbj(store=store, renpy=renpy):', '    if store._tkbjd:', '        return', '    store._tkbjd = True', '    renpy.jump("tkb_err_test")', 'config.periodic_callbacks.append(_tkbj)', 'result = True'].join('\n')));
  await p.click('#game-play'); let fr = await start();
  const box = await (await p.$('#gamebox iframe')).boundingBox();
  for (let k = 0; k < 4; k++) { await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); await p.waitForTimeout(3000); if (await fr.evaluate(() => window.renpy_exec('result = renpy.get_screen("main_menu") is None')).catch(() => false)) break; }
  await boom(fr); await p.waitForTimeout(2500);
  const note = await p.evaluate(() => [...document.querySelectorAll('.undobar')].map(e => e.innerText).join(' | '));
  const still = await fr.evaluate(() => window.renpy_exec('result = [getattr(store, "tkb_after", None), renpy.get_screen("_exception") is not None]')).catch(e => String(e));
  ok('an error in the game is skipped and the game goes on', /Details/.test(note) && /skipped/.test(note) && Array.isArray(still) && still[0] === 'reached' && still[1] === false, JSON.stringify([note, still]));
  await p.click('.undobar button:has-text("Details")'); await p.waitForSelector('#gameerrors');
  ok('Details shows the error', /tkb_affection_sylive/.test(await p.$eval('#gameerrors', e => e.innerText)));
  // fix it: the right name is offered first; the line is shown before and after
  ok('the error has a Fix button', !!(await p.$('#gameerrors .fixbtn')));
  await p.click('#gameerrors .fixbtn'); await p.waitForSelector('#fix-sheet');
  const picks = await p.$$eval('#fix-picks code', a => a.map(e => e.innerText));
  const prev = await p.$eval('#fix-preview', e => e.innerText);
  ok('the closest name the game has comes first', picks[0] === 'tkb_affection_sylvie', JSON.stringify(picks));
  ok('the broken line is shown, before and after', /- .*tkb_affection_sylive/.test(prev) && /\+ .*tkb_affection_sylvie \+ 1/.test(prev), prev);
  await p.screenshot({ path: '/tmp/claude-0/shots/fix-sheet.png' });
  await p.click('#fix-try');
  for (let k = 0; k < 60 && !(await p.$('.fixbar')); k++) await p.waitForTimeout(500);
  await p.waitForTimeout(2500);
  fr = p.frames().find(f => f !== p.mainFrame());
  const after = await fr.evaluate(() => window.renpy_exec('result = [getattr(store, "tkb_result", None), str(renpy.game.context().current)]')).catch(e => String(e));
  ok('Try it plays the scene again with the fix: no error this time', Array.isArray(after) && after[0] === 4, JSON.stringify(after));
  ok('with Keep and Undo', !!(await p.$('.fixbar button:has-text("Keep the fix")')) && !!(await p.$('.fixbar button:has-text("Undo")')));
  await p.screenshot({ path: '/tmp/claude-0/shots/fix-trial.png' });
  await p.click('.fixbar button:has-text("Keep the fix")');
  const mods = await p.evaluate(async gid => { const g = await S.gal(gid); const m = g.game.mods.find(x => x.fixes); return m && { name: m.name, on: m.on, files: (await rpyGetJSON(m.list)).map(f => f.p) }; }, gid);
  ok('the fix is in the game\'s Fixes mod', mods && mods.name === 'Fixes' && mods.on && JSON.stringify(mods.files) === '["game/zz_errtest.rpy"]', JSON.stringify(mods));

  await p.screenshot({ path: '/tmp/claude-0/shots/err-skipped.png' });
  await p.click('#gamebox .gameexit'); await p.waitForTimeout(2500);
  // Show the game's error screen (with the fix switched off, so the error happens again)
  await p.evaluate(async gid => { const g = await S.gal(gid); g.game.mods.forEach(m => m.on = false); await saveGallery(g); renderDetail(gid); }, gid); await p.waitForTimeout(800);
  await p.click('#game-errors button:has-text("Show")'); await p.waitForTimeout(800);
  await p.click('#game-play'); fr = await start();
  for (let k = 0; k < 4; k++) { await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); await p.waitForTimeout(3000); if (await fr.evaluate(() => window.renpy_exec('result = renpy.get_screen("main_menu") is None')).catch(() => false)) break; }
  await boom(fr); await p.waitForTimeout(2500);
  await p.screenshot({ path: '/tmp/claude-0/shots/err-shown.png' });
  const shown = await fr.evaluate(() => window.renpy_exec('result = getattr(store, "tkb_after", None)')).catch(e => String(e));
  ok('set to show the game\'s error screen, it stops there (as before)', shown !== 'reached', JSON.stringify(shown));
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
