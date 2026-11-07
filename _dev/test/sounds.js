// Sounds on pages: added in Edit (to several pages at once) and from the reader; while reading, a page's sounds loop;
// the same sound on the next page keeps playing without a restart; a different one fades in while the old fades out.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'sounds'); await p.fill('#pw1', 'soundpass1'); await p.fill('#pw2', 'soundpass1'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1200);
  const gid = await p.evaluate(async () => {
    const mk = col => new Promise(r => { const c = document.createElement('canvas'); c.width = 300; c.height = 450; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 300, 450); c.toBlob(bl => r({ name: col + '.png', get: async () => new File([bl], 'a.png', { type: 'image/png' }) }), 'image/png'); });
    const g = newGallery('Rainy day'); Tree.ensureRoot(g); g.prefs = { mode: 'single' };
    await importInto(g, [{ title: 'Rainy day', chId: g.chapters[0].id, items: [await mk('#a11'), await mk('#1a1'), await mk('#11a'), await mk('#aa1')] }], () => { }, () => false);
    return g.id;
  });
  const pages = await p.evaluate(async id => (await S.gal(id)).chapters[0].pages, gid);
  // Edit: select pages 1 and 2, Sound, add rain.ogg
  await p.evaluate(id => go('editor', { id, view: 'folders' }), gid); await p.waitForTimeout(1200);
  await p.click('#v-editor button:has-text("Select")');
  for (const id of pages.slice(0, 2)) await p.click(`#v-editor .pcell[data-id="${id}"]`);
  await p.click('#ed-sound'); await p.waitForSelector('#snd-add');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#snd-add')]); await fc.setFiles('/tmp/claude-0/snd/rain.ogg');
  await p.waitForTimeout(1500);
  let st = await p.evaluate(async id => { const g = await S.gal(id); return { audio: g.audio, sounds: Object.values(g.meta).filter(m => m[3] === 'a').map(m => m[2]) }; }, gid);
  ok('Edit → Sound puts a sound on the selected pages (kept once)', st.sounds.length === 1 && st.sounds[0] === 'rain.ogg' && pages.slice(0, 2).every(x => st.audio[x] && st.audio[x].length === 1), JSON.stringify(st));
  await p.evaluate(() => closeSheet());
  const marks = await p.$$eval('#v-editor .pcell .sndmark', a => a.length);
  ok('pages with sound are marked', marks === 2, String(marks));
  // the reader: page 3 gets theme.mp3 (a new file), page 4 gets rain.ogg (from the gallery) and theme
  await p.evaluate(id => go('reader', { id }), gid); await p.waitForTimeout(1500);
  const snap = () => p.evaluate(() => ({ pos: R.pos, on: [...Snd.on.entries()].map(([a, x]) => [(R.g.meta[a] || [])[2], x.leaving, +x.el.volume.toFixed(2), x.el.paused, +x.el.currentTime.toFixed(1)]) }));
  await p.waitForTimeout(1500);
  const s1 = await snap();
  ok('page 1: its sound plays and has faded in', s1.on.length === 1 && s1.on[0][0] === 'rain.ogg' && !s1.on[0][3] && s1.on[0][2] > 0.5, JSON.stringify(s1));
  const el1 = await p.evaluate(() => { window.__rainEl = [...Snd.on.values()][0].el; return true; });
  await p.evaluate(() => goToIdx(1)); await p.waitForTimeout(1200);
  const s2 = await snap();
  const same = await p.evaluate(() => [...Snd.on.values()][0].el === window.__rainEl);
  ok('page 2 has the same sound: it keeps playing, not restarted', same && s2.on.length === 1 && s2.on[0][4] >= s1.on[0][4], JSON.stringify([s1.on[0][4], s2.on[0][4]]));
  await p.evaluate(() => goToIdx(2)); await p.waitForTimeout(400);
  await p.evaluate(() => $('#rSound').click()); await p.waitForSelector('#snd-add');
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#snd-add')]); await fc2.setFiles('/tmp/claude-0/snd/theme.mp3');
  await p.waitForTimeout(300);
  const mid = await snap();
  await p.waitForTimeout(1500);
  const s3 = await snap();
  ok('page 3 has another sound: the old one fades out while the new one fades in', mid.on.some(x => x[0] === 'rain.ogg' && x[1]) && s3.on.length === 1 && s3.on[0][0] === 'theme.mp3' && s3.on[0][2] > 0.5, JSON.stringify([mid, s3]));
  await p.evaluate(() => closeSheet());
  await p.evaluate(() => goToIdx(3)); await p.waitForTimeout(300);
  await p.evaluate(() => $('#rSound').click()); await p.waitForSelector('#snd-pick');
  await p.selectOption('#snd-pick', { label: 'rain.ogg' }); await p.waitForTimeout(500);
  await p.selectOption('#snd-pick', { label: 'theme.mp3' }); await p.waitForTimeout(1500);
  const s4 = await snap();
  ok('one page can have several sounds', s4.on.filter(x => !x[1]).map(x => x[0]).sort().join() === 'rain.ogg,theme.mp3', JSON.stringify(s4));
  // volume and mute
  await p.evaluate(() => Snd.setMute(true)); const m = await snap(); await p.evaluate(() => Snd.setMute(false));
  ok('mute silences them', m.on.every(x => x[2] === 0));
  await p.evaluate(() => closeSheet());
  // leaving the reader stops everything
  await p.evaluate(id => go('detail', { id }), gid); await p.waitForTimeout(800);
  ok('leaving the reader stops the sounds', await p.evaluate(() => Snd.on.size === 0));
  // it survives a backup's view of the gallery: the sounds are among its stored records
  const rec = await p.evaluate(async id => { const g = await S.gal(id); const ids = Object.keys(g.meta).filter(k => g.meta[k][3] === 'a'); return (await Promise.all(ids.map(i => ST.get('images', i)))).every(r => r && r.e); }, gid);
  ok('the sounds are stored encrypted with the gallery', rec);
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
