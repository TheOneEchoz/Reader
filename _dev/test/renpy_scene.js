// Scene edits: a part of a layered picture removed at one line, a picture added at that line (gone at the next), a step added
// after a line (plays, then the game goes on), a line skipped, an edit for everywhere taken back; all in the "Scene edits" mod.
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
  await p.fill('#user1', (process.env.SHOWERR ? 'scene2' : 'scene3')); await p.fill('#pw1', 'layeredpw12'); await p.fill('#pw2', 'layeredpw12'); await p.click('#v-lock button[type=submit]');
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
  await p.click('#game-play'); let fr = await start();
  const box = await (await p.$('#gamebox iframe')).boundingBox();
  for (let k = 0; k < 4; k++) { await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); await p.waitForTimeout(3000); if (await fr.evaluate(() => window.renpy_exec('result = renpy.get_screen("main_menu") is None')).catch(() => false)) break; }
  const jumpTo = n => fr.evaluate(n => window.renpy_exec([`def _tkbjs${n}(d=[False], renpy=renpy):`, '    if d[0]:', '        return', '    d[0] = True', '    renpy.jump("tkb_scene_test")', `config.periodic_callbacks.append(_tkbjs${n})`, 'result = True'].join('\n')), n);
  await jumpTo(1); await p.waitForTimeout(3500);
  const py = c => fr.evaluate(c => window.renpy_exec(c), c).catch(e => String(e));
  const click = async () => { await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6); await p.waitForTimeout(1800); };
  const editsFile = () => p.evaluate(async gid => { const g = await S.gal(gid), m = g.game.mods.find(x => x.edits), l = await rpyGetJSON(m.list), f = l.find(x => /zzzz_tankobon_edits/.test(x.p)); return new TextDecoder().decode(await rpyRead(f.c, f.s)); }, gid);
  ok('the story is at the test scene', /Scene line one/.test(await py('result = store._last_raw_what')));
  await p.click('#gamebox .gameedit'); await p.waitForSelector('#se-sheet', { timeout: 20000 });
  await p.waitForSelector('.se-pic[data-tag="sc"] .layerrow');
  const parts = await p.$$eval('.se-pic[data-tag="sc"] .layerrow b', a => a.map(e => e.textContent));
  ok('Edit this scene lists the pictures on screen, and the parts of a layered one', parts.length === 2 && parts[0] === 'always' && parts[1] === 'face: calm', JSON.stringify(parts));
  ok('it says which line it is at', /Scene line one/.test(await p.$eval('#se-sheet', e => e.innerText)));
  await p.screenshot({ path: '/tmp/claude-0/shots/scene-editor.png' });
  // remove a part, only at this line
  await p.click('.se-pic[data-tag="sc"] [data-part="1"] button:has-text("Remove")');
  await p.waitForTimeout(2500); await p.waitForSelector('#se-sheet');
  const rem = await py('result = [x.get("removed", False) for x in _tkb_layers("sc")["layers"]]');
  ok('Remove: the part is gone in the game at once', Array.isArray(rem) && rem[1] === true && rem[0] === false, JSON.stringify(rem));
  // add a picture of the game at this line
  await p.click('#se-pos button:has-text("Right")');
  await p.click('#se-add'); await p.waitForSelector('#gp-sheet');
  await p.fill('#gp-q', 'tkbv b2'); await p.waitForTimeout(1500);
  await p.click('#gp-list .swpick:has-text("tkbv b2")');
  await p.waitForTimeout(2500);
  ok('Add a picture: it shows at this line', (await py('result = bool(renpy.showing("tkbadd0"))')) === true);
  const ed1 = await p.$$eval('#se-edits > .row > span:first-child', a => a.map(e => e.textContent)).catch(() => []);
  ok('the edits at this line are listed', ed1.length === 2, JSON.stringify(ed1));
  await p.evaluate(() => closeSheet());
  // the next line: the added picture goes, the part comes back
  await click();
  const at2 = await py('result = [store._last_raw_what, bool(renpy.showing("tkbadd0")), [x.get("removed", False) for x in _tkb_layers("sc")["layers"]]]');
  ok('at the next line, the added picture is gone and the part is back', Array.isArray(at2) && /line two/.test(at2[0]) && at2[1] === false && at2[2][1] === false, JSON.stringify(at2));
  // a step after this line (line two)
  await p.click('#gamebox .gameedit'); await p.waitForSelector('#se-sheet', { timeout: 20000 });
  await p.click('#se-after'); await p.waitForSelector('#st-sheet');
  await p.click('#st-addpic'); await p.waitForSelector('#gp-sheet');
  await p.fill('#gp-q', 'tkbv b1'); await p.waitForTimeout(1500);
  await p.click('#gp-list .swpick:has-text("tkbv b1")'); await p.waitForSelector('#st-sheet');
  await p.fill('#st-text', 'An inserted line.');
  await p.click('#st-preview'); await p.waitForSelector('#fixprev img', { timeout: 30000 });
  const red = await p.evaluate(() => new Promise(r => { const im = $('#fixprev img'); const f = () => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 13) if (d[i] > 140 && d[i + 1] < 90 && d[i + 2] < 90) n++; r(n); }; im.complete ? f() : im.onload = f; }));
  await p.screenshot({ path: '/tmp/claude-0/shots/step-preview.png' });
  ok('the step can be previewed (drawn over the scene)', red > 200, String(red));
  await p.click('#fixprev-back'); await p.waitForSelector('#st-sheet');
  await p.click('#st-save'); await p.waitForTimeout(2500);
  await p.evaluate(() => closeSheet());
  await click(); await p.waitForTimeout(800);
  const st = await py('result = [len(renpy.game.contexts), (lambda w: w and "".join(str(x) for x in w.text))(renpy.get_widget("say", "what")), bool(renpy.showing("tkbbeat0"))]');
  await p.screenshot({ path: '/tmp/claude-0/shots/step-play.png' });
  ok('the step plays after that line', Array.isArray(st) && st[0] === 2 && st[1] === 'An inserted line.' && st[2] === true, JSON.stringify(st));
  await click();
  const st2 = await py('result = [len(renpy.game.contexts), store._last_raw_what, bool(renpy.showing("tkbbeat0"))]');
  ok('then the game goes on as normal', Array.isArray(st2) && st2[0] === 1 && /line three/.test(st2[1]) && st2[2] === false, JSON.stringify(st2));
  // an edit for everywhere, taken back; and this line (three) skipped
  await p.click('#gamebox .gameedit'); await p.waitForSelector('#se-sheet', { timeout: 20000 });
  await p.click('#se-scope button:has-text("Everywhere")');
  await p.click('.se-pic[data-tag="sc"] [data-part="0"] button:has-text("Change")'); await p.waitForSelector('#gp-sheet');
  await p.fill('#gp-q', 'tkbv b2'); await p.waitForTimeout(1500);
  await p.click('#gp-list .swpick:has-text("tkbv b2")'); await p.waitForTimeout(2500); await p.waitForSelector('#se-sheet');
  const chg = await py('result = _tkb_layers("sc")["layers"][0].get("edits")');
  ok('Change (everywhere): the part shows the new picture', Array.isArray(chg) && chg[0].mode === 'change' && chg[0].here === false, JSON.stringify(chg));
  await p.click('#se-edits .row:has-text("always") button:has-text("Take back")');
  await p.waitForTimeout(2500); await p.waitForSelector('#se-sheet');
  const chg2 = await py('result = _tkb_layers("sc")["layers"][0].get("edits")');
  ok('Take back: the edit is undone in the game', chg2 == null, JSON.stringify(chg2));
  await p.click('#se-skip'); await p.waitForTimeout(2500);
  const fx = await editsFile();
  ok('all edits are in the “Scene edits” mod (the one taken back is gone)', (fx.match(/# edit: /g) || []).length === 4 && /_tkb_add_step\("after"/.test(fx) && /_tkb_add_here\(/.test(fx) && /"remove", 1/.test(fx) && /"zz_errtest.rpy:56"/.test(fx) && /_tkb_add_skip\(/.test(fx) && !/"change"/.test(fx), fx);
  await p.evaluate(() => closeSheet());
  // the scene again from the start: removal and picture at line one, the step after line two, line three skipped
  await jumpTo(2); await p.waitForTimeout(3500);
  const r1 = await py('result = [store._last_raw_what, bool(renpy.showing("tkbadd0")), [x.get("removed", False) for x in _tkb_layers("sc")["layers"]]]');
  ok('played again: line one has its edits', Array.isArray(r1) && /line one/.test(r1[0]) && r1[1] === true && r1[2][1] === true, JSON.stringify(r1));
  await click(); await click();
  const ag = await py('result = (lambda w: w and "".join(str(x) for x in w.text))(renpy.get_widget("say", "what"))'); ok('the step plays again after line two', ag === 'An inserted line.', JSON.stringify(ag));
  await click();
  const r4 = await py('result = store._last_raw_what');
  ok('Skip this line: line three is skipped, the game goes on with line four', /line four/.test(r4), JSON.stringify(r4));
  // the next start: the edits come from the mod
  await p.click('#gamebox .gameexit'); await p.waitForFunction(() => !document.getElementById('gamebox'), null, { timeout: 20000 }).catch(() => { });
  await p.waitForTimeout(1000); await p.click('#game-play'); fr = await start();
  for (let k = 0; k < 4; k++) { await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); await p.waitForTimeout(3000); if (await fr.evaluate(() => window.renpy_exec('result = renpy.get_screen("main_menu") is None')).catch(() => false)) break; }
  await fr.evaluate(() => window.renpy_exec(['def _tkbjs9(d=[False], renpy=renpy):', '    if d[0]:', '        return', '    d[0] = True', '    renpy.jump("tkb_scene_test")', 'config.periodic_callbacks.append(_tkbjs9)', 'result = True'].join('\n')));
  await p.waitForTimeout(3500);
  const n1 = await fr.evaluate(() => window.renpy_exec('result = [store._last_raw_what, bool(renpy.showing("tkbadd0")), [x.get("removed", False) for x in _tkb_layers("sc")["layers"]]]')).catch(e => String(e));
  ok('after starting the game again, the edits are there (from the mod)', Array.isArray(n1) && /line one/.test(n1[0]) && n1[1] === true && n1[2][1] === true, JSON.stringify(n1));
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
