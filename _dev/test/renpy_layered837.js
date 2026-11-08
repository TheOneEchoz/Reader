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
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (/fix reload/.test(m.text())) console.log('TIMING', m.text()); });
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', (process.env.SHOWERR ? 'layered2' : 'layered3')); await p.fill('#pw1', 'layeredpw12'); await p.fill('#pw2', 'layeredpw12'); await p.click('#v-lock button[type=submit]');
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
  await fr.evaluate(() => window.renpy_exec(['store._tkbjd8 = False', 'def _tkbj8(store=store, renpy=renpy):', '    if store._tkbjd8:', '        return', '    store._tkbjd8 = True', '    renpy.jump("tkb_err_test8")', 'config.periodic_callbacks.append(_tkbj8)', 'result = True'].join('\n')));
  await p.waitForTimeout(3500);
  await p.screenshot({ path: '/tmp/claude-0/shots/layered-err.png' });
  if (process.env.PROBE) { const q = c => p.evaluate(c => gamePy(c, 20000), c).catch(e => String(e));
    console.log('P1', JSON.stringify(await q('result = [[l, [str(s.tag) + ":" + type(s.displayable).__name__ for s in renpy.game.context().scene_lists.layers[l]]] for l in renpy.game.context().scene_lists.layers]')));
    console.log('P2', JSON.stringify(await q('result = len(renpy.game.contexts)')));
    console.log('P3', JSON.stringify(await q('result = [[l, [str(s.tag) + ":" + type(s.displayable).__name__ for s in renpy.game.contexts[0].scene_lists.layers[l]]] for l in renpy.game.contexts[0].scene_lists.layers]')));
    console.log('P4', JSON.stringify(await q('result = _tkb_broken_switches()')));
    console.log('P5', JSON.stringify(await p.evaluate(() => brokenPictures())));
    await b.close(); process.exit(0); }
  await p.click('#gamebox .gameerr'); await p.waitForSelector('#gameerrors');
  await p.click('#gameerrors .fixbtn:has-text("Fix this error")'); await p.waitForSelector('#fix-sheet');
  const btn = await p.$('#fix-conditions');
  ok('the error offers Fix the conditions', !!btn, await p.$eval('#fix-sheet', e => e.innerText.slice(0, 300)));
  if (btn) await btn.click(); else await p.evaluate(() => fixConditions(GAME.g.id, GAME.errors.slice(-1)[0]));
  await p.waitForSelector('#cond-rows .condrow', { timeout: 30000 });
  const rows = await p.$$eval('#cond-rows .condrow', a => a.map(e => [e.querySelector('input').value, e.innerText.replace(/\s+/g, ' '), e.className]));
  ok('it shows the rows: conditions, what each shows, which is true now', rows.length === 3 && rows[0][0] === 'tkb_outfit == 1' && rows[1][0] === 'tkb_outfit == 2' && /NOTHING/.test(rows[1][1]) && /now/.test(rows[1][2]), JSON.stringify(rows));
  await p.waitForFunction(() => /=/.test(($('#cond-vals') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => { });
  ok('and the variables in them, with their values', /tkb_outfit = 2/.test(await p.$eval('#cond-vals', e => e.innerText)));
  await p.click('#cond-rows .condrow:nth-child(2) button:has-text("Change")'); await p.waitForSelector('#sheetBody .btile.asset', { timeout: 30000 });
  await p.fill('#sheetBody input.search', 'club'); await p.waitForTimeout(400);
  await p.click('#sheetBody .btile.asset'); await p.click('#asset-use'); await p.waitForSelector('#cond-rows .condrow');
  const r2 = await p.$eval('#cond-rows .condrow:nth-child(2)', e => e.innerText.replace(/\s+/g, ' '));
  ok('a row\'s picture can be changed', /bg club\.jpg/.test(r2), r2);
  ok('only the picture of this error is offered (with its picture shown)', !(await p.$('#cond-which')) && await p.$eval('#cond-sheet img.swthumb', im => new Promise(r => { const t = Date.now(); (function w() { if (im.naturalWidth > 0) r(true); else if (Date.now() - t > 15000) r(false); else setTimeout(w, 300); })(); })));
  // Preview: drawn over the game, no restart
  const loads0 = await p.evaluate(() => GAME.loadCount || 0);
  await p.click('#cond-preview'); await p.waitForSelector('#fixprev img', { timeout: 30000 });
  const pv = await p.$eval('#fixprev img', im => new Promise(r => { const f = () => r([im.naturalWidth, im.naturalHeight]); im.complete ? f() : im.onload = f; }));
  await p.screenshot({ path: '/tmp/claude-0/shots/layered-preview.png' });
  const club = await p.evaluate(() => { const im = $('#fixprev img'), c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n; });
  ok('Preview draws the scene with the change over the game, without restarting it', pv[0] >= 800 && club > 50 && (await p.evaluate(() => GAME.loadCount || 0)) === loads0 && !(await p.$('#cond-sheet')), JSON.stringify([pv, club]));
  await p.click('#fixprev-back'); await p.waitForSelector('#cond-rows .condrow');
  ok('Back returns to the fix, with the change still there', /bg club\.jpg/.test(await p.$eval('#cond-rows .condrow:nth-child(2)', e => e.innerText)) && !(await p.$('#fixprev')));
  const e0 = await p.evaluate(() => (GAME.errors || []).length);
  await p.click('#cond-try');
  for (let k = 0; k < 60 && !(await p.$('.fixbar:not(.loading)')); k++) await p.waitForTimeout(500);
  await p.waitForTimeout(3000);
  fr = p.frames().find(f => f !== p.mainFrame());
  await p.screenshot({ path: '/tmp/claude-0/shots/layered-after.png' });
  const st = await fr.evaluate(() => window.renpy_exec('result = [renpy.showing("tl"), str(renpy.game.context().current)]')).catch(e => String(e));
  const ne = await p.evaluate(n => (GAME.errors || []).slice(n).filter(e => /NoneType/.test(e.short)).length, e0);
  ok('Try it: the scene plays with the changed row, no error', Array.isArray(st) && st[0] === true && ne === 0, JSON.stringify([st, ne]));
  const fx = await p.evaluate(async gid => { const g = await S.gal(gid), m = g.game.mods.find(x => x.fixes), l = await rpyGetJSON(m.list), f = l.find(x => /zzzz_tankobon_fixes/.test(x.p)); return new TextDecoder().decode(await rpyRead(f.c, f.s)); }, gid);
  ok('the fix is in the Fixes mod', /_tkb_condrule\(.*tkb_outfit == 2.*\[\["tkb_outfit == 1",\{"keep":0\}\],\["tkb_outfit == 2",\{"file":"images\/bg club.jpg"\}\],\["True",\{"keep":2\}\]\]\)/.test(fx), fx.slice(-300));
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
