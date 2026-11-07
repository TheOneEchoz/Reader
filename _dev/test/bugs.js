// The bugs found when the tests were refreshed: tag rename vs the library's tag search; the library's Tags box after
// tagging several galleries; the Install button once the page is in full screen.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'bugs'); await p.fill('#pw1', 'bugspass12'); await p.fill('#pw2', 'bugspass12'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(2000);
  const ids = await p.evaluate(async () => {
    const mk = col => new Promise(r => { const c = document.createElement('canvas'); c.width = 200; c.height = 300; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 200, 300); c.toBlob(bl => r({ name: col + '.png', get: async () => new File([bl], 'a.png', { type: 'image/png' }) }), 'image/png'); });
    const out = [];
    for (const t of ['One', 'Two']) { const g = newGallery(t); Tree.ensureRoot(g); await importInto(g, [{ title: t, chId: g.chapters[0].id, items: [await mk('#fcc'), await mk('#cfc')] }], () => { }, () => false); out.push(g.id); }
    return out;
  });
  await p.evaluate(() => renderLibrary()); await p.waitForTimeout(800);
  // tag both galleries at once; the Tags box must count them right away
  await p.click('#v-library button:has-text("Select")');
  for (const id of ids) await p.click(`#v-library .card[data-gid="${id}"]`);
  await p.click('.selbar:not([hidden]) button:has-text("Tags")'); await p.waitForSelector('#libtag-add');
  await p.fill('#libtag-add', 'red, blue'); await p.press('#libtag-add', 'Enter'); await p.waitForTimeout(800);
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(800);
  await p.click('.selbar:not([hidden]) button[aria-label="Stop selecting"]'); await p.waitForTimeout(500);
  const box = await p.evaluate(() => $('#v-library .tagsel').innerText.replace(/\s+/g, ' '));
  ok('after tagging several galleries, the library\'s Tags box counts the new tags', /2 tags/.test(box), box.slice(0, 120));
  // search the library for #red, then rename red to crimson: the search follows
  await p.evaluate(() => { LIBTAGS = tqSet(tqNew(), 'red', 'must'); renderLibrary(); }); await p.waitForTimeout(800);
  const n1 = await p.$$eval('#v-library .card', a => a.length);
  await p.evaluate(() => TagReg.rename('red', 'crimson')); await p.evaluate(() => renderLibrary()); await p.waitForTimeout(800);
  const st = await p.evaluate(() => ({ q: JSON.stringify({ must: LIBTAGS.must, any: LIBTAGS.any, not: LIBTAGS.not }), cards: document.querySelectorAll('#v-library .card').length }));
  ok('renaming a tag: the library search follows the new name', st.q === '{"must":["crimson"],"any":[],"not":[]}', st.q);
  ok('and still finds the galleries', st.cards === n1 && n1 === 2, `${n1} -> ${st.cards}`);
  // full screen (the app turns it on with the first touch) is still the website: Install stays
  await p.click('#v-library .wordmark');
  await p.evaluate(() => document.documentElement.requestFullscreen().catch(() => { })); await p.waitForTimeout(800);
  const fs = await p.evaluate(() => ({ full: !!document.fullscreenElement, standalone: isStandalone() }));
  ok('in full screen the website is not taken for the installed app', fs.full && !fs.standalone, JSON.stringify(fs));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
