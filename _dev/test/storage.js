// What takes space: galleries, games and downloaded Ren'Py, biggest first, with what each is made of; open or delete from there.
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
  await p.fill('#user1', 'space'); await p.fill('#pw1', 'spacepass1'); await p.fill('#pw2', 'spacepass1'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1200);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 }); await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Cancel")'); await p.waitForTimeout(1200);
  await p.evaluate(async () => {
    const mk = i => new Promise(r => { const c = document.createElement('canvas'); c.width = 600; c.height = 900; const x = c.getContext('2d'); for (let k = 0; k < 4000; k++) { x.fillStyle = `hsl(${(k * 37 + i) % 360},70%,50%)`; x.fillRect(Math.random() * 600, Math.random() * 900, 12, 12); } c.toBlob(bl => r({ name: i + '.png', get: async () => new File([bl], 'a.png', { type: 'image/png' }) })); });
    const g = newGallery('Big pictures'); Tree.ensureRoot(g); const items = []; for (let i = 0; i < 6; i++) items.push(await mk(i));
    await importInto(g, [{ title: 'x', chId: g.chapters[0].id, items }], () => { }, () => false);
    const s = newGallery('Small one'); Tree.ensureRoot(s); await importInto(s, [{ title: 'x', chId: s.chapters[0].id, items: [await mk(9)] }], () => { }, () => false);
  });
  await p.evaluate(() => openStorage()); await p.waitForSelector('#storage-what'); await p.click('#storage-what');
  await p.waitForSelector('#storage-list .storerow', { timeout: 60000 });
  const rows = await p.$$eval('#storage-list .storerow', a => a.map(e => e.innerText.replace(/\s+/g, ' ')));
  console.log(rows.join('\n'));
  ok('it lists the game and the galleries, biggest first', rows.length >= 3 && /the question/.test(rows[0]) && /files/.test(rows[0]) && rows.some(r => /Big pictures.*pages/.test(r)), rows.slice(0, 3).join(' | '));
  ok('with a total', /in all: galleries .* games .* Ren'Py/.test(await p.$eval('#storage-overview .hint', e => e.innerText)));
  await p.click('#storage-list .storerow:has-text("Small one") button[aria-label^="Delete"]'); await p.waitForSelector('.askyes'); await p.click('.askyes button:has-text("Delete")'); await p.waitForTimeout(1500);
  const left = await p.evaluate(async () => (await S.gals()).map(g => g.title));
  ok('a gallery can be deleted from there', !left.includes('Small one') && !(await p.$('#storage-list .storerow:has-text("Small one")')), JSON.stringify(left));
  // measured once: opening again is instant
  await p.evaluate(() => closeSheet()); const t0 = Date.now();
  await p.evaluate(() => storageOverview()); await p.waitForSelector('#storage-list .storerow', { timeout: 60000 });
  ok('the second time it uses what was measured', Date.now() - t0 < 3000, (Date.now() - t0) + ' ms');
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
