// Picture imports still work in the experimental build now that games are detected first:
// a dropped comic ZIP and loose images become galleries, and the reader opens.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'smoke'); await p.fill('#pw1', 'smokepass1'); await p.fill('#pw2', 'smokepass1'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  // a comic ZIP with two chapter folders, and two loose images, made in the page and dropped
  await p.evaluate(async () => {
    const img = (col, n) => new Promise(r => { const c = document.createElement('canvas'); c.width = 300; c.height = 420; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 300, 420); x.fillStyle = '#000'; x.font = '60px sans-serif'; x.fillText(n, 100, 220); c.toBlob(r, 'image/png'); });
    const z = new JSZip(); for (let i = 1; i <= 3; i++) { z.file(`Ch1/${i}.png`, await img('#fdd', i)); z.file(`Ch2/${i}.png`, await img('#dfd', i)); }
    window.__comic = new File([await z.generateAsync({ type: 'blob' })], 'Comic.zip', { type: 'application/zip' });
    window.__imgs = [new File([await img('#ddf', 'A')], 'a.png', { type: 'image/png' }), new File([await img('#ffd', 'B')], 'b.png', { type: 'image/png' })];
  });
  await p.evaluate(() => handleDrop([window.__comic]));
  await p.waitForSelector('#sheet button:has-text("Make the gallery")', { timeout: 30000 });
  ok('a comic ZIP is not taken for a game', !(await p.$('#game-add')));
  await p.click('#sheet button:has-text("Make the gallery")');
  await p.waitForFunction(() => CUR.view === 'detail', null, { timeout: 60000 }).catch(() => { });
  const g1 = await p.evaluate(async () => { const g = await S.gal(CUR.params.id); return g && { title: g.title, pages: g.chapters.reduce((n, c) => n + c.pages.length, 0), chapters: g.chapters.length, game: !!g.game }; });
  ok('the comic ZIP became a gallery with its chapters', g1 && g1.pages === 6 && g1.chapters === 3 && !g1.game, JSON.stringify(g1));
  await p.evaluate(() => go('library')); await p.waitForTimeout(600);
  await p.evaluate(() => handleDrop(window.__imgs));
  await p.waitForSelector('#sheet button:has-text("Make the gallery")', { timeout: 30000 });
  await p.click('#sheet button:has-text("Make the gallery")');
  await p.waitForFunction(() => CUR.view === 'detail', null, { timeout: 60000 }).catch(() => { });
  const g2 = await p.evaluate(async () => { const g = await S.gal(CUR.params.id); return g && g.chapters.reduce((n, c) => n + c.pages.length, 0); });
  ok('loose images became a gallery', g2 === 2, g2);
  await p.click('#v-detail button:has-text("Start reading")'); await p.waitForTimeout(1500);
  ok('the reader opens', await p.evaluate(() => CUR.view === 'reader' && !document.getElementById('reader').hidden));
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e))); ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
