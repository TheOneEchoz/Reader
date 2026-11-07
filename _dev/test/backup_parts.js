// A backup too big for one file is split in parts; restoring takes all the parts.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const device = async (user, pw) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: true });
    await ctx.route('**/fonts.g*/**', r => r.abort());
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
    await p.fill('#user1', user); await p.fill('#pw1', pw); await p.fill('#pw2', pw); await p.click('#v-lock button[type=submit]');
    await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1200);
    await p.evaluate(() => { window.showSaveFilePicker = undefined; window.BK_PART_TEST = 300 * 1024; });
    return p;
  };
  const A = await device('parts', 'partspass1');
  await A.evaluate(async () => {
    const mk = i => new Promise(r => { const c = document.createElement('canvas'); c.width = 400; c.height = 600; const x = c.getContext('2d'); for (let k = 0; k < 3000; k++) { x.fillStyle = `hsl(${(k * 37 + i * 11) % 360},70%,50%)`; x.fillRect(Math.random() * 400, Math.random() * 600, 9, 9); } c.toBlob(bl => r({ name: i + '.png', get: async () => new File([bl], 'a.png', { type: 'image/png' }) }), 'image/png'); });
    const g = newGallery('Many'); Tree.ensureRoot(g); const items = []; for (let i = 0; i < 12; i++) items.push(await mk(i));
    await importInto(g, [{ title: 'Many', chId: g.chapters[0].id, items }], () => { }, () => false);
  });
  await A.evaluate(() => openBackup()); await A.waitForSelector('#bk-make'); await A.waitForFunction(() => !/Counting/.test($('#sheetBody').innerText));
  const files = []; A.on('download', async d => { const f = '/tmp/claude-0/bkparts/' + d.suggestedFilename(); await d.saveAs(f); files.push(f); });
  require('fs').rmSync('/tmp/claude-0/bkparts', { recursive: true, force: true }); require('fs').mkdirSync('/tmp/claude-0/bkparts');
  await A.click('#bk-make'); await A.waitForFunction(() => /Backup saved/.test($('#sheetBody').innerText), null, { timeout: 60000 }); await A.waitForTimeout(3000);
  console.log('SHEET', await A.$eval('#sheetBody .progress', e => e.innerText.replace(/\s+/g, ' ')));
  ok('it is split in parts', files.length >= 3 && files.every(f => / part \d+\.tkb$/.test(f)), files.map(f => f.split('/').pop()).join(', '));
  const B = await device('parts2', 'otherpass1');
  // only some of the parts: what is there comes back, with a warning
  await B.evaluate(() => openBackup()); await B.waitForSelector('#bk-restore');
  const [fc0] = await Promise.all([B.waitForEvent('filechooser'), B.click('#bk-restore')]); await fc0.setFiles(files.filter(f => !/ part 2\.tkb$/.test(f)));
  await B.waitForSelector('#bk-pw'); await B.fill('#bk-pw', 'partspass1'); await B.press('#bk-pw', 'Enter');
  for (let k = 0; k < 120 && !(await B.evaluate(() => [...document.querySelectorAll('.toast, #toast')].some(t => /parts|Restored|could not/.test(t.innerText)))); k++) await B.waitForTimeout(500);
  const warn = await B.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(t => t.innerText).join(' | '));
  ok('a missing part is noticed', /were not picked/.test(warn), warn);
  await B.evaluate(() => closeSheet()); await B.waitForTimeout(500);
  await B.evaluate(() => openBackup()); await B.waitForSelector('#bk-restore');
  const [fc] = await Promise.all([B.waitForEvent('filechooser'), B.click('#bk-restore')]); await fc.setFiles([...files].reverse());
  await B.waitForSelector('#bk-pw'); await B.fill('#bk-pw', 'partspass1'); await B.press('#bk-pw', 'Enter');
  for (let k = 0; k < 120 && !(await B.evaluate(() => [...document.querySelectorAll('.toast, #toast')].some(t => /Restored|could not/.test(t.innerText)))); k++) await B.waitForTimeout(500);
  const g = await B.evaluate(async () => { const g = (await S.gals()).find(x => x.title === 'Many'); if (!g) return null; let n = 0; for (const id of g.chapters.flatMap(c => c.pages)) if (await S.blob('images', id)) n++; return n; });
  ok('all parts are restored (picked in any order)', g === 12, String(g));
  ok('no errors', errs.filter(e => !/serviceWorker/.test(e)).length === 0, errs.slice(0, 2).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
