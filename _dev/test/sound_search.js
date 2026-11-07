// Searching every sound of the account when adding a sound to a page: sounds on other galleries' pages, and the
// music and sounds inside games (loose or in archives); the chosen one is copied into this gallery.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const GAMEDIR = '/tmp/claude-0/games/a8.5.3/the_question-7.0-pc';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort()); await ctx.route('https://theoneechoz.github.io/**', r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'sndsearch'); await p.fill('#pw1', 'searchpw12'); await p.fill('#pw2', 'searchpw12'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1200);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 }); await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Cancel")'); await p.waitForTimeout(1200);
  // two galleries: A has a sound on a page; B has none yet
  const ids = await p.evaluate(async () => {
    const mk = col => new Promise(r => { const c = document.createElement('canvas'); c.width = 100; c.height = 150; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 100, 150); c.toBlob(bl => r({ name: col + '.png', get: async () => new File([bl], 'a.png', { type: 'image/png' }) }), 'image/png'); });
    const out = {};
    for (const t of ['Alpha', 'Beta']) { const g = newGallery(t); Tree.ensureRoot(g); await importInto(g, [{ title: t, chId: g.chapters[0].id, items: [await mk('#c33'), await mk('#3c3')] }], () => { }, () => false); out[t] = g.id; }
    const A = await S.gal(out.Alpha);
    const aid = await Snd.add(A, 'birds.ogg', new Blob([new Uint8Array(5000)], { type: 'audio/ogg' })); A.audio = { [A.chapters[0].pages[0]]: [aid] }; await saveGallery(A);
    return out;
  });
  const B = await p.evaluate(async id => (await S.gal(id)).chapters[0].pages, ids.Beta);
  await p.evaluate(async ([id, pages]) => { const g = await S.gal(id); soundSheet(g, pages, null); }, [ids.Beta, B]);
  await p.click('#snd-search'); await p.waitForSelector('#sndlib-list .sndrow', { timeout: 60000 });
  const all = await p.$$eval('#sndlib-list .sndrow', a => a.map(e => e.innerText.replace(/\s+/g, ' ')));
  ok('it lists sounds from other galleries', all.some(t => /birds\.ogg.*gallery “Alpha”/.test(t)), all.slice(0, 3).join(' | '));
  ok('and the music and sounds inside games (from the archive too)', all.some(t => /illurock\.opus.*game “the question”/.test(t)), all.filter(t => /game/.test(t)).slice(0, 3).join(' | '));
  await p.fill('#sndlib-find', 'illuro'); await p.waitForTimeout(300);
  const f = await p.$$eval('#sndlib-list .sndrow', a => a.map(e => e.innerText.replace(/\s+/g, ' ')));
  ok('search narrows it down', f.length >= 1 && f.every(t => /illuro/i.test(t)), f.join(' | '));
  await p.click('#sndlib-list .sndrow button:has-text("Add")'); await p.waitForTimeout(2000);
  const st = await p.evaluate(async ([id, pages]) => { const g = await S.gal(id); return { sounds: Object.values(g.meta).filter(m => m[3] === 'a').map(m => m[2] + ':' + m[4]), on: pages.map(x => (g.audio && g.audio[x] || []).length) }; }, [ids.Beta, B]);
  ok('the chosen game sound is copied into this gallery and put on the pages', st.sounds.length === 1 && /^illurock\.opus:\d{4,}/.test(st.sounds[0]) && st.on.every(n => n === 1), JSON.stringify(st));
  ok('the sounds sheet shows it again', await p.$eval('#snd-sheet', e => /illurock\.opus/.test(e.innerText)).catch(() => false));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
