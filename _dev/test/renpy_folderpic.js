// A folder's picture from the pictures of a game kept in that folder.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const GAMEDIR = '/tmp/claude-0/games/a8.5.3/the_question-7.0-pc';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort()); await ctx.route('https://theoneechoz.github.io/**', r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'folderpic'); await p.fill('#pw1', 'folderpic1'); await p.fill('#pw2', 'folderpic1'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 }); await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Cancel")'); await p.waitForTimeout(1500);
  // a gallery with a folder "VN"; the game goes in it
  const ids = await p.evaluate(async () => {
    const gm = (await S.gals()).find(x => x.game); const g = newGallery('Games shelf'); Tree.ensureRoot(g);
    const f = { id: uid(), title: 'VN', pages: [], d: 1, keep: true }; g.chapters.push(f); await saveGallery(g);
    await placeGame(gm.id, g.id, f.id); return { gal: g.id, f: f.id, gm: gm.id };
  });
  await p.evaluate(i => go('editor', { id: i.gal, folder: i.f }), ids); await p.waitForTimeout(1200);
  ok('a folder with a game offers its pictures for the folder picture', !!(await p.$('#folder-gamepic')));
  await p.click('#folder-gamepic'); await p.waitForSelector('#sheetBody .btile.asset', { timeout: 60000 });
  const pick = await p.$$eval('#sheetBody .btile.asset', a => { const t = a.find(e => /bg /.test(e.title)) || a[0]; t.click(); return t.title; });
  await p.click('#asset-cover'); await p.waitForSelector('.cropframe', { timeout: 15000 });
  await p.click('#sheetBody button:has-text("Whole picture")'); await p.waitForTimeout(2000);
  const st = await p.evaluate(async i => { const g = await S.gal(i.gal); const f = g.chapters.find(c => c.id === i.f); return { cover: f.cover, custom: f.customCover, meta: g.meta[f.cover], gameCoverBy: (await S.gal(i.gm)).game.coverBy, view: CUR.view, hint: $('#v-editor .coverrow').innerText }; }, ids);
  ok('the chosen picture becomes the folder\'s picture', st.cover && st.cover === st.custom && st.meta, JSON.stringify(st));
  ok('the game\'s own cover is left alone', st.gameCoverBy !== 'user', st.gameCoverBy);
  ok('the editor shows it as its own image', /Your own image/.test(st.hint) && st.view === 'editor', st.hint.replace(/\s+/g, ' '));
  console.log('picked', pick);
  // root of the gallery also offers it (the game is in one of its folders)
  await p.evaluate(i => go('editor', { id: i.gal }), ids); await p.waitForTimeout(1000);
  ok('the gallery (holding the folder) offers it too', !!(await p.$('#folder-gamepic')));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
