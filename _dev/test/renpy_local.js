// Saves already on the computer (Windows app): the app looks in Ren'Py's save folder by itself and asks.
// The Windows app's two read-only functions are stood in for by a mock over a folder laid out like %APPDATA%\RenPy.
// The game has only compiled scripts (like real releases): its save folder name must come from options.rpyc.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GAMEDIR = '/tmp/claude-0/games/b8.5.3/the_question-7.0-pc';
const RENPY = '/tmp/claude-0/RenPy', RT = '/home/claude/reader/renpy/';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const listing = () => ({ root: 'C:\\Users\\me\\AppData\\Roaming\\RenPy', dirs: fs.readdirSync(RENPY).filter(d => fs.statSync(path.join(RENPY, d)).isDirectory()).map(d => ({ dir: d, files: fs.readdirSync(path.join(RENPY, d)).map(n => { const st = fs.statSync(path.join(RENPY, d, n)); return { name: n, size: st.size, mtime: st.mtimeMs }; }) })) });
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  await ctx.exposeFunction('__mockList', () => listing());
  await ctx.exposeFunction('__mockRead', (dir, name) => Array.from(fs.readFileSync(path.join(RENPY, dir, name))));
  await ctx.addInitScript(() => { window.__tkbLocalSaves = { renpySaves: () => window.__mockList(), renpyRead: async (d, n) => new Uint8Array(await window.__mockRead(d, n)) }; });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'local'); await p.fill('#pw1', 'localpass1'); await p.fill('#pw2', 'localpass1'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 });
  const sw = await p.$('#game-saves-0'); const swTxt = await p.$eval('#sheetBody', e => e.innerText.replace(/\s+/g, ' '));
  ok('the add sheet asks about the save in the game\'s folder', !!sw && /Include the 1 save found in the game's folder/.test(swTxt), swTxt.slice(0, 200));
  await p.click('#game-saves-0'); // leave it out
  await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); // download Ren'Py? (no, not needed here)
  await p.click('.askyes button:has-text("Cancel")');
  await p.waitForFunction(() => /Import saves from before/.test((document.querySelector('.askyes') || {}).innerText || ''), null, { timeout: 30000 }).catch(() => { });
  const ask = await p.$eval('.askyes', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  ok('after adding, it found the game\'s saves on the computer and asks', ask.includes('1 save of “the question” was found on this computer, in %APPDATA%\\RenPy\\the_question-7'), ask);
  await p.click('.askyes button:has-text("Import")'); await p.waitForTimeout(2500);
  const st = await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); const idx = await rpyGetJSON(g.game.sv); return { saveDir: g.game.saveDir, root: g.game.root, files: Object.keys(idx), id: g.id }; });
  ok('the save folder name was read from the compiled options script', st.saveDir === 'the_question-7', st.saveDir);
  ok('the computer\'s save was imported where Ren\'Py looks for it', st.files.includes('home/web_user/.renpy/the_question-7/1-2-LT1.save'), st.files.join(', '));
  ok('the computer\'s save keys came too', st.files.includes('home/web_user/.renpy/tokens/security_keys.txt'));
  ok('the game folder\'s save was left out, as chosen', !st.files.some(f => /1-3-LT1/.test(f)));
  // the game's page: nothing to offer now
  await p.evaluate(id => go('detail', { id }), st.id); await p.waitForTimeout(1500);
  ok('nothing is offered once they are imported', !(await p.$('#game-local-saves')));
  // a new save appears on the computer: the page offers it; "Not now" stops it
  fs.writeFileSync(path.join(RENPY, 'the_question-7', '2-1-LT1.save'), 'a newer save');
  await p.evaluate(() => render(CUR.view, CUR.params)); await p.waitForSelector('#game-local-saves', { timeout: 10000 }).catch(() => { });
  const note = await p.$eval('#game-local-saves', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  ok('a new save on the computer is offered on the game\'s page', /1 save from before was found on this computer: the_question-7/.test(note), note);
  await p.click('#game-local-saves button:has-text("Not now")'); await p.waitForTimeout(800);
  await p.evaluate(() => render(CUR.view, CUR.params)); await p.waitForTimeout(1500);
  ok('“Not now” is remembered', !(await p.$('#game-local-saves:not([hidden])')) || await p.$eval('#game-local-saves', e => e.closest('[hidden]') !== null));
  fs.unlinkSync(path.join(RENPY, 'the_question-7', '2-1-LT1.save'));
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e))); ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
