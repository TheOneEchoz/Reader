// Games inside a gallery's folders are shown in Edit with the pictures, and move like them: Select, Move into a folder,
// or to another gallery.
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
  await p.fill('#user1', 'mover'); await p.fill('#pw1', 'moverpass1'); await p.fill('#pw2', 'moverpass1'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1200);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 }); await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Cancel")'); await p.waitForTimeout(1200);
  const ids = await p.evaluate(async () => {
    const gm = (await S.gals()).find(x => x.game);
    const mk = col => new Promise(r => { const c = document.createElement('canvas'); c.width = 100; c.height = 150; c.getContext('2d').fillStyle = col; c.getContext('2d').fillRect(0, 0, 100, 150); c.toBlob(bl => r({ name: 'x.png', get: async () => new File([bl], 'a.png', { type: 'image/png' }) })); });
    const g = newGallery('Shelf'); Tree.ensureRoot(g);
    await importInto(g, [{ title: 'A', path: ['A'], items: [await mk('#c33')] }, { title: 'B', path: ['B'], items: [await mk('#3c3')] }], () => { }, () => false);
    const cur = await S.gal(g.id), A = cur.chapters.find(c => c.title === 'A'), B = cur.chapters.find(c => c.title === 'B');
    await placeGame(gm.id, cur.id, A.id);
    const other = newGallery('Other'); Tree.ensureRoot(other); await saveGallery(other);
    return { gm: gm.id, gal: cur.id, A: A.id, B: B.id, other: other.id };
  });
  await p.evaluate(i => go('editor', { id: i.gal, folder: i.A, view: 'folders' }), ids); await p.waitForTimeout(1500);
  ok('the game shows in Edit, in its folder, with the pictures', !!(await p.$(`#v-editor .pcell.game[data-gid="${ids.gm}"]`)));
  await p.click('#v-editor button:has-text("Select")');
  await p.click(`#v-editor .pcell.game[data-gid="${ids.gm}"]`);
  await p.click('#ed-move'); await p.waitForSelector('.chlist');
  await p.click('.chlist .chrow:has-text("B")'); await p.waitForTimeout(1500);
  const st = await p.evaluate(async i => { const g = await S.gal(i.gal), gm = await S.gal(i.gm); return { A: g.chapters.find(c => c.id === i.A).games || [], B: g.chapters.find(c => c.id === i.B).games || [], at: gm.game.at }; }, ids);
  ok('Move puts the game into the other folder', st.A.length === 0 && st.B.includes(ids.gm) && st.at && st.at.ch === ids.B, JSON.stringify(st));
  ok('it leaves the folder you are in', !(await p.$(`#v-editor .pcell.game[data-gid="${ids.gm}"]`)));
  // to another gallery
  await p.evaluate(i => go('editor', { id: i.gal, folder: i.B, view: 'folders' }), ids); await p.waitForTimeout(1500);
  await p.click('#v-editor button:has-text("Select")');
  await p.click(`#v-editor .pcell.game[data-gid="${ids.gm}"]`);
  await p.click('#ed-move'); await p.waitForSelector('.chlist');
  await p.click('#sheetBody button:has-text("Move to another gallery")'); await p.waitForTimeout(500);
  await p.click('.chlist .chrow:has-text("Other")'); await p.waitForTimeout(1500);
  const st2 = await p.evaluate(async i => { const g = await S.gal(i.gal), o = await S.gal(i.other), gm = await S.gal(i.gm); return { left: g.chapters.some(c => (c.games || []).includes(i.gm)), there: o.chapters[0].games || [], at: gm.game.at }; }, ids);
  ok('and to another gallery', !st2.left && st2.there.includes(ids.gm) && st2.at.gal === ids.other, JSON.stringify(st2));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
