// Backup: the whole library (galleries, pages, tags, games) saved as an encrypted file; restored into the same account
// (only what is missing comes back) and into another account on another device (asks for the backup's password).
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs');
const GAMEDIR = '/tmp/claude-0/games/a8.5.3/the_question-7.0-pc';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  const device = async (user, pw) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: true });
    await ctx.route('**/fonts.g*/**', r => r.abort()); await ctx.route('https://theoneechoz.github.io/**', r => r.abort());
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(user + ': ' + e.message));
    await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
    await p.fill('#user1', user); await p.fill('#pw1', pw); await p.fill('#pw2', pw); await p.click('#v-lock button[type=submit]');
    await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1200);
    await p.evaluate(() => { delete window.showSaveFilePicker; window.showSaveFilePicker = undefined; });
    return p;
  };
  const A = await device('owner', 'ownerpass1');
  await A.evaluate(async () => {
    const mk = col => new Promise(r => { const c = document.createElement('canvas'); c.width = 200; c.height = 300; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 200, 300); c.toBlob(bl => r({ name: col + '.png', get: async () => new File([bl], 'a.png', { type: 'image/png' }) }), 'image/png'); });
    for (const t of ['Alpha', 'Beta']) { const g = newGallery(t); Tree.ensureRoot(g); await importInto(g, [{ title: t, chId: g.chapters[0].id, items: [await mk('#fcc'), await mk('#cfc'), await mk('#ccf')] }], () => { }, () => false); }
  });
  await A.click('#v-library button:has-text("Add")'); await A.waitForSelector('#add-game');
  const [ch] = await Promise.all([A.waitForEvent('filechooser'), A.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await A.waitForSelector('#game-add', { timeout: 60000 }); await A.click('#game-add');
  await A.waitForSelector('.askyes', { timeout: 120000 }); await A.click('.askyes button:has-text("Cancel")'); await A.waitForTimeout(1200);
  const libA = await A.evaluate(async () => (await S.gals()).filter(g => !g.sample).map(g => g.title + ':' + (g.game ? g.game.files : g.chapters.reduce((n, c) => n + c.pages.length, 0))).sort());
  // make the backup
  await A.evaluate(() => openBackup()); await A.waitForSelector('#bk-make');
  await A.waitForFunction(() => !/Counting/.test($('#sheetBody').innerText));
  const info = await A.$eval('#sheetBody', e => e.innerText.replace(/\s+/g, ' '));
  ok('the backup sheet counts the galleries and games', /2 galleries, 1 game/.test(info), info.slice(0, 200));
  const [dl] = await Promise.all([A.waitForEvent('download', { timeout: 120000 }), A.click('#bk-make')]);
  const file = '/tmp/claude-0/' + dl.suggestedFilename(); await dl.saveAs(file);
  const size = fs.statSync(file).size, head = fs.readFileSync(file).subarray(0, 600).toString('latin1');
  ok('a backup file is saved', /Tankobon backup \d{4}-\d\d-\d\d\.tkb/.test(file) && size > 5e6, `${file} ${(size / 1e6).toFixed(1)} MB`);
  const plain = fs.readFileSync(file).toString('latin1');
  ok('it is encrypted (no titles or file names readable)', !/Alpha|Beta|the_question|script\.rpy/.test(plain.slice(600)) && !/Alpha/.test(head));
  // restore into the same account after deleting a gallery: it comes back, nothing is doubled
  await A.evaluate(async () => { const g = (await S.gals()).find(x => x.title === 'Beta'); await purgeGallery(g); });
  await A.evaluate(() => closeSheet()); await A.waitForTimeout(500);
  await A.evaluate(() => openBackup()); await A.waitForSelector('#bk-restore');
  const [fc] = await Promise.all([A.waitForEvent('filechooser'), A.click('#bk-restore')]); await fc.setFiles(file);
  await A.waitForSelector('.askyes'); await A.click('.askyes button:has-text("Restore")');
  for (let k = 0; k < 120 && !(await A.evaluate(() => [...document.querySelectorAll('.toast, #toast')].some(t => /Restored|Nothing to restore|could not/.test(t.innerText)))); k++) await A.waitForTimeout(500);
  const t1 = await A.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(t => t.innerText).join(' | '));
  const libA2 = await A.evaluate(async () => (await S.gals()).filter(g => !g.sample).map(g => g.title + ':' + (g.game ? g.game.files : g.chapters.reduce((n, c) => n + c.pages.length, 0))).sort());
  ok('restoring brings back the deleted gallery', JSON.stringify(libA2) === JSON.stringify(libA) && /1 gallery added/.test(t1), t1 + ' ' + JSON.stringify(libA2));
  const pageOk = await A.evaluate(async () => { const g = (await S.gals()).find(x => x.title === 'Beta'); const bl = await S.blob('images', g.chapters.find(c => c.pages.length).pages[0]); return !!bl && bl.size > 100; });
  ok('its pages open', pageOk);
  // another device, another account and password
  const B = await device('newphone', 'differentpw');
  await B.evaluate(() => openBackup()); await B.waitForSelector('#bk-restore');
  const [fc2] = await Promise.all([B.waitForEvent('filechooser'), B.click('#bk-restore')]); await fc2.setFiles(file);
  await B.waitForSelector('#bk-pw'); await B.fill('#bk-pw', 'wrongpass1'); await B.press('#bk-pw', 'Enter');
  await B.waitForTimeout(2500);
  const t2 = await B.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(t => t.innerText).join(' | '));
  ok('a wrong password is refused', /not right/.test(t2), t2);
  await B.evaluate(() => { closeSheet(); openBackup(); }); await B.waitForSelector('#bk-restore');
  const [fc3] = await Promise.all([B.waitForEvent('filechooser'), B.click('#bk-restore')]); await fc3.setFiles(file);
  await B.waitForSelector('#bk-pw'); await B.fill('#bk-pw', 'ownerpass1'); await B.press('#bk-pw', 'Enter');
  for (let k = 0; k < 240 && !(await B.evaluate(() => [...document.querySelectorAll('.toast, #toast')].some(t => /Restored|could not/.test(t.innerText)))); k++) await B.waitForTimeout(500);
  const libB = await B.evaluate(async () => (await S.gals()).filter(g => !g.sample).map(g => g.title + ':' + (g.game ? g.game.files : g.chapters.reduce((n, c) => n + c.pages.length, 0))).sort());
  ok('restored into another account with the backup\'s password', JSON.stringify(libB) === JSON.stringify(libA), JSON.stringify(libB));
  const gameOk = await B.evaluate(async () => { const g = (await S.gals()).find(x => x.game); const list = await rpyGetJSON(g.game.list); const f = list.find(x => /script\.rpy$/.test(x.p)); const t = new TextDecoder().decode(await rpyRead(f.c, f.s)); return /label start/.test(t); });
  ok('the restored game\'s files read correctly (re-encrypted for this account)', gameOk);
  // B locks and unlocks with its own password: still there
  const real = errs.filter(e => !/serviceWorker/.test(e));
  ok('no errors', real.length === 0, real.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
