// A game's saves: the list (with each save's picture and name, from a real save made in the game), export as a ZIP,
// undoing an import, deleting one save and undoing that.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path'), JSZip = require('/home/claude/tankobon/test/node_modules/jszip');
const GAMEDIR = '/tmp/claude-0/games/q8.5.3/the_question-7.0-pc', RT = '/home/claude/reader/renpy/';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message + ' @ ' + String(e.stack).slice(0, 600)));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'saver'); await p.fill('#pw1', 'saverpass1'); await p.fill('#pw2', 'saverpass1'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 }); await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Download")');
  for (let k = 0; k < 120; k++) { await p.waitForTimeout(1000); if (await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); return g && await RPY.has(g.game.rt); })) break; }
  await p.waitForTimeout(1500);
  const gid = await p.evaluate(async () => (await S.gals()).find(x => x.game).id);
  // play, save in the game (as Ren'Py does), leave
  await p.click('#game-play');
  for (let k = 0; k < 120 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(1000);
  const fr = p.frames().find(f => f !== p.mainFrame());
  for (let k = 0; k < 40; k++) { await p.waitForTimeout(2000); if (await fr.evaluate(() => { const pre = document.getElementById('presplash'); return !pre || !pre.isConnected || pre.style.display === 'none'; }).catch(() => false)) break; }
  await p.waitForTimeout(3000);
  await fr.evaluate(() => window.renpy_exec('renpy.save("1-1", "Chapter one")'));
  await p.waitForTimeout(4000);
  await p.click('#gamebox .gameexit'); await p.waitForFunction(() => !document.getElementById('gamebox'), null, { timeout: 15000 }).catch(() => { }); await p.waitForTimeout(1500);
  // the list
  await p.click('#game-show-saves'); await p.waitForSelector('#game-saves-list .saverow', { timeout: 10000 }); await p.waitForTimeout(1500);
  const row = await p.evaluate(() => { const r = document.querySelector('#game-saves-list .saverow'); return { text: r.innerText.replace(/\s+/g, ' '), pic: !!r.querySelector('img').src && r.querySelector('img').naturalWidth > 0, n: document.querySelectorAll('#game-saves-list .saverow').length }; });
  ok('the saves list shows the save with its name and picture', row.n === 1 && /Page 1, slot 1/.test(row.text) && /Chapter one/.test(row.text) && row.pic, JSON.stringify(row));
  await p.screenshot({ path: '/tmp/claude-0/shots/saves-list.png' });
  // export
  await p.click('#game-export-saves'); await p.waitForSelector('.askyes');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.askyes button:has-text("Export")')]);
  const zbuf = fs.readFileSync(await dl.path()); const z = await JSZip.loadAsync(zbuf); const names = Object.keys(z.files);
  ok('Export gives a ZIP laid out like Ren\'Py\'s save folder', names.includes('the_question-7/1-1-LT1.save') && names.includes('the_question-7/persistent') && !names.some(n => /sync\/|tokens/.test(n)), names.join(', '));
  // import, then undo it
  const idxOf = () => p.evaluate(async id => Object.keys((await rpyGetJSON((await S.gal(id)).game.sv)) || {}).sort(), gid);
  const before = await idxOf();
  const [ch2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#game-import-saves')]); await ch2.setFiles('/tmp/claude-0/RenPy');
  await p.waitForSelector('.askyes', { timeout: 30000 }); await p.click('.askyes button:has-text("Import")');
  await p.waitForSelector('.undobar button:has-text("Undo")', { timeout: 15000 });
  const mid = await idxOf();
  ok('the import added the save', mid.includes('home/web_user/.renpy/the_question-7/1-2-LT1.save'));
  await p.click('.undobar button:has-text("Undo")'); await p.waitForTimeout(2000);
  const after = await idxOf();
  ok('Undo puts the saves back as they were before the import', JSON.stringify(after) === JSON.stringify(before), after.join(', '));
  // delete one save, undo
  await p.click('#game-show-saves'); await p.waitForSelector('#game-saves-list .saverow');
  await p.click('#game-saves-list .saverow button[aria-label^="Delete"]'); await p.waitForTimeout(1500);
  const del = await idxOf();
  ok('deleting a save removes it (and its sync copy)', !del.some(f => /1-1-LT1\.save$/.test(f)) && del.some(f => /persistent$/.test(f)), del.join(', '));
  await p.click('.undobar button:has-text("Undo")'); await p.waitForTimeout(2000);
  ok('Undo brings the deleted save back', JSON.stringify(await idxOf()) === JSON.stringify(before));
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e))); ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
