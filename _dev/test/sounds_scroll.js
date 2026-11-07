// Sounds while scrolling (vertical / webtoon and horizontal modes): the page in the middle of the screen decides.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'scrolls'); await p.fill('#pw1', 'scrollpw12'); await p.fill('#pw2', 'scrollpw12'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1200);
  const gid = await p.evaluate(async () => {
    const mk = col => new Promise(r => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1600; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 1600, 1600); c.toBlob(bl => r({ name: col + '.png', get: async () => new File([bl], 'a.png', { type: 'image/png' }) }), 'image/png'); });
    const g = newGallery('Webtoon'); Tree.ensureRoot(g); g.prefs = { mode: 'vertical' };
    await importInto(g, [{ title: 'Webtoon', chId: g.chapters[0].id, items: [await mk('#a11'), await mk('#1a1'), await mk('#11a'), await mk('#aa1')] }], () => { }, () => false);
    const cur = await S.gal(g.id), [p1, p2, p3, p4] = cur.chapters[0].pages;
    const rain = await Snd.add(cur, 'rain.ogg', new Blob([await (await fetch('data:,')).arrayBuffer()]));
    return cur.id;
  });
  // real sound files
  await p.evaluate(async ([id, a, b]) => {
    const g = await S.gal(id), [p1, p2, p3, p4] = g.chapters[0].pages;
    Object.keys(g.meta).filter(k => g.meta[k][3] === 'a').forEach(k => delete g.meta[k]);
    const ra = await Snd.add(g, 'rain.ogg', new Blob([Uint8Array.from(atob(a), c => c.charCodeAt(0))], { type: 'audio/ogg' }));
    const th = await Snd.add(g, 'theme.mp3', new Blob([Uint8Array.from(atob(b), c => c.charCodeAt(0))], { type: 'audio/mpeg' }));
    g.audio = { [p1]: [ra], [p2]: [ra], [p3]: [th], [p4]: [th] }; await saveGallery(g);
  }, [gid, require('fs').readFileSync('/tmp/claude-0/snd/rain.ogg').toString('base64'), require('fs').readFileSync('/tmp/claude-0/snd/theme.mp3').toString('base64')]);
  const playing = () => p.evaluate(() => [...Snd.on.entries()].filter(([, x]) => !x.leaving && !x.el.paused).map(([a]) => R.g.meta[a][2]).join(','));
  for (const mode of ['vertical', 'horizontal']) {
    await p.evaluate(async ([id, mode]) => { const g = await S.gal(id); g.prefs = { mode }; g.progress = null; await saveGallery(g); go('reader', { id, start: 1 }); }, [gid, mode]);
    await p.waitForTimeout(2000);
    const s1 = await playing();
    // scroll by hand (wheel), a little at a time, to page 3
    const box = await p.$eval('#strip', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.move(box.x, box.y);
    for (let k = 0; k < 200; k++) { if (mode === 'vertical') await p.mouse.wheel(0, 400); else await p.evaluate(() => { strip.scrollLeft += 820; }); await p.waitForTimeout(60); if (await p.evaluate(() => R.pos) >= 2) break; }
    await p.waitForTimeout(200);
    const mid = await playing();
    await p.waitForTimeout(1500);
    const s3 = await playing(), pos = await p.evaluate(() => R.pos);
    ok(`${mode}: the first page's sound plays`, s1 === 'rain.ogg', s1);
    ok(`${mode}: scrolling to a page with another sound switches to it (after it settles, not while passing)`, pos >= 2 && mid === 'rain.ogg' && s3 === 'theme.mp3', `pos ${pos}, ${mid} -> ${s3}`);
    await p.evaluate(id => go('detail', { id }), gid); await p.waitForTimeout(800);
  }
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
