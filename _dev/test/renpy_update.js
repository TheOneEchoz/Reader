// Game updates: a newer copy of a game already in the library replaces its files, and keeps its saves, mods, cover,
// name and folder. Offered from the game page (Update the game), and when adding a game with the same name.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const V1 = '/tmp/claude-0/games/m8.5.3/the_question-7.0-pc', V2 = '/tmp/claude-0/games/u8.5.3/the_question-7.1-pc';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort()); await ctx.route('https://theoneechoz.github.io/**', r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'updater'); await p.fill('#pw1', 'updpass123'); await p.fill('#pw2', 'updpass123'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  const add = async dir => {
    await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
    const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(dir);
    await p.waitForSelector('#game-add', { timeout: 60000 });
  };
  await add(V1);
  ok('the first time, there is nothing to update', !(await p.$('#game-upd-0')));
  await p.click('#game-add'); await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Cancel")'); await p.waitForTimeout(1500);
  // give it a save, a custom cover, a name, and put it in a folder
  const before = await p.evaluate(async () => {
    const gm = (await S.gals()).find(x => x.game);
    const idx = (await rpyGetJSON(gm.game.sv)) || {}; const id = await rpyPut(new TextEncoder().encode('a save').buffer); idx['game/saves/1-1-LT1.save'] = { s: 6, c: [id] }; await rpyPutJSON(idx, gm.game.sv);
    gm.title = 'My Question'; await saveGallery(gm);
    const c = document.createElement('canvas'); c.width = 300; c.height = 400; c.getContext('2d').fillStyle = '#f0f'; c.getContext('2d').fillRect(0, 0, 300, 400);
    const bytes = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer()); await setGameCover(gm.id, bytes, 'mine.png', 'user');
    const g = newGallery('Shelf'); Tree.ensureRoot(g); const f = { id: uid(), title: 'VN', pages: [], d: 1, keep: true }; g.chapters.push(f); await saveGallery(g); await placeGame(gm.id, g.id, f.id);
    const cur = await S.gal(gm.id);
    return { id: gm.id, cover: cur.cover, mods: cur.game.mods.map(m => m.name + ':' + m.list), records: (await DB.keys('images')).length, files: cur.game.files, gals: (await S.gals()).length };
  });
  // Update the game, from its page
  await p.evaluate(id => go('detail', { id }), before.id); await p.waitForTimeout(1000);
  const [ch2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#game-update')]); await ch2.setFiles(V2);
  await p.waitForSelector('#game-add', { timeout: 60000 });
  const sheet = await p.$eval('#sheetBody', e => e.innerText.replace(/\s+/g, ' '));
  ok('the update sheet says what stays', /Update “My Question”/.test(sheet) && /saves, mods, cover, name and folder stay/.test(sheet), sheet.slice(0, 260));
  ok('the button says Update the game', (await p.$eval('#game-add', e => e.innerText.trim())) === 'Update the game');
  await p.click('#game-add');
  for (let k = 0; k < 60 && await p.$('#game-add'); k++) await p.waitForTimeout(500);
  await p.waitForTimeout(1500); // (a download question may follow: same Ren'Py here, so none)
  if (await p.$('.askyes')) await p.click('.askyes button:has-text("Cancel")');
  const after = await p.evaluate(async b4 => {
    const gs = await S.gals(), games = gs.filter(x => x.game), cur = await S.gal(b4.id), list = await rpyGetJSON(cur.game.list), sv = await rpyGetJSON(cur.game.sv);
    const shelf = gs.find(x => x.title === 'Shelf');
    return { games: games.length, gals: gs.length, title: cur.title, cover: cur.cover, coverBy: cur.game.coverBy, root: cur.game.root, hasV2: list.some(f => f.p === 'game/zz_v2.rpy'), modInList: list.some(f => /zz_cheatmod/.test(f.p)),
      mods: cur.game.mods.map(m => m.name + ':' + m.list), saves: Object.keys(sv), inFolder: shelf.chapters.some(c => (c.games || []).includes(b4.id)), records: (await DB.keys('images')).length, files: cur.game.files, view: CUR.view, prevVer: cur.game.prevVer };
  }, before);
  console.log(JSON.stringify(after));
  ok('still one game, with the same id (no copy left behind)', after.games === 1 && after.gals === before.gals);
  ok('the new files are in', after.hasV2 && after.files === before.files + 1 && after.root === 'the_question-7.1-pc', `${before.files} -> ${after.files}`);
  ok('the saves stay', JSON.stringify(after.saves) === '["game/saves/1-1-LT1.save"]', JSON.stringify(after.saves));
  ok('the mod stays (the copy of it in the new folder is not added twice)', JSON.stringify(after.mods) === JSON.stringify(before.mods) && !after.modInList, JSON.stringify(after.mods));
  ok('the cover and name stay', after.cover === before.cover && after.coverBy === 'user' && after.title === 'My Question');
  ok('it stays in its folder', after.inFolder);
  ok('the old files are removed (storage does not grow by a whole game)', after.records - before.records <= 3, `${before.records} -> ${after.records} records`);
  // adding the same game from the library offers to update it
  await p.evaluate(() => go('library')); await p.waitForTimeout(800);
  await add(V2);
  const seg = await p.$eval('#game-upd-0', e => [...e.querySelectorAll('button')].map(b => b.innerText + ':' + b.getAttribute('aria-pressed'))).catch(() => null);
  ok('adding a game that is already in the library offers to update it', seg && /Update “My Question”:true/.test(seg[0]), JSON.stringify(seg));
  await p.click('#game-upd-0 button:has-text("Add as another game")');
  ok('choosing Add as another game changes the button back', (await p.$eval('#game-add', e => e.innerText.trim())) === 'Add the game');
  await p.evaluate(() => closeSheet());
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
