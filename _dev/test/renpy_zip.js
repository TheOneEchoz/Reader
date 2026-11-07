// A Ren'Py game's ZIP dropped on the window is recognised as a game (not turned into a picture gallery),
// and saying "Cancel" to the download question keeps the game without downloading anything.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const ZIP = '/tmp/claude-0/games/q787loose.zip';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const net = []; await ctx.route('https://theoneechoz.github.io/**', r => { net.push(r.request().url()); r.abort(); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'zipper'); await p.fill('#pw1', 'zippass123'); await p.fill('#pw2', 'zippass123'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  // the dropped file goes through the same code as a real drop
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'zipdrop'; i.style.display = 'none'; document.body.append(i); });
  await p.setInputFiles('#zipdrop', ZIP);
  await p.evaluate(() => handleDrop([...document.getElementById('zipdrop').files]));
  await p.waitForSelector('#game-add', { timeout: 60000 });
  const sheet = await p.$eval('#sheetBody', e => e.innerText.replace(/\s+/g, ' '));
  ok('a dropped ZIP of a game opens the game sheet', /Made with Ren'Py 7\.8\.7/.test(sheet), sheet.slice(0, 200));
  ok('the name comes from the folder inside the ZIP', (await p.inputValue('#game-name-0')) === 'the question');
  await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 });
  await p.click('.askyes button:has-text("Cancel")');
  await p.waitForTimeout(1500);
  const st = await p.evaluate(async () => { const gs = await S.gals(); return { n: gs.length, games: gs.filter(g => g.game).map(g => g.game.files + ' files, rt ' + g.game.rt), view: CUR.view, reg: Object.keys(await RPY.reg()) }; });
  ok('the game was added, and no picture gallery was made from it', st.games.length === 1 && st.n === 2, JSON.stringify(st));
  ok('saying no downloads nothing', net.length === 0 && st.reg.length === 0, net.join(','));
  ok('it lands on the game page', st.view === 'detail');
  const txt = await p.$eval('#v-detail', e => e.innerText.replace(/\s+/g, ' '));
  ok('the page says Ren\'Py is not downloaded yet and that it will ask', /not downloaded yet .*asked before/.test(txt), txt.slice(0, 300));
  // library card
  await p.evaluate(() => go('library')); await p.waitForTimeout(800);
  const card = await p.$$eval('#v-library .card', a => a.map(e => e.innerText.replace(/\s+/g, ' ')).join(' | '));
  ok('the library shows it as a game', /GAME the question Ren'Py game · 14 MB/.test(card), card);
  // delete it: everything it stored goes
  const before = await p.evaluate(async () => (await DB.keys('images')).length);
  await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); go('detail', { id: g.id }); }); await p.waitForTimeout(800);
  await p.click('#v-detail button:has-text("Delete the game")'); await p.click('#v-detail button:has-text("Tap again")'); await p.waitForTimeout(2000);
  const after = await p.evaluate(async () => ({ images: (await DB.keys('images')).length, games: (await S.gals()).filter(g => g.game).length }));
  ok('deleting the game removes all its pieces', after.games === 0 && before - after.images >= 170, `${before} -> ${after.images} records`);
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e))); ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
