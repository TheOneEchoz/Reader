// Sounds: how many times a sound plays (loops forever by default), and sounds set on a folder or the whole gallery
// (every page inside plays them, together with its own).
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs');
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'sndmore'); await p.fill('#pw1', 'sndmorepw1'); await p.fill('#pw2', 'sndmorepw1'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1200);
  const b64 = f => fs.readFileSync('/tmp/claude-0/snd/' + f).toString('base64');
  // a gallery: 2 pages at the top, then a folder "Night" with 2 pages
  const ids = await p.evaluate(async ([ra, di]) => {
    const mk = col => new Promise(r => { const c = document.createElement('canvas'); c.width = 300; c.height = 450; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 300, 450); c.toBlob(bl => r({ name: col + '.png', get: async () => new File([bl], 'a.png', { type: 'image/png' }) }), 'image/png'); });
    const g = newGallery('Story'); Tree.ensureRoot(g); g.prefs = { mode: 'single' };
    await importInto(g, [{ title: 'Story', chId: g.chapters[0].id, items: [await mk('#a11'), await mk('#1a1')] }, { title: 'Night', path: ['Night'], items: [await mk('#11a'), await mk('#aa1')] }], () => { }, () => false);
    const cur = await S.gal(g.id);
    const rain = await Snd.add(cur, 'rain.ogg', new Blob([Uint8Array.from(atob(ra), c => c.charCodeAt(0))], { type: 'audio/ogg' }));
    const ding = await Snd.add(cur, 'ding.ogg', new Blob([Uint8Array.from(atob(di), c => c.charCodeAt(0))], { type: 'audio/ogg' }));
    const p1 = cur.chapters[0].pages[0], p2 = cur.chapters[0].pages[1]; cur.audio = { [p1]: [ding], [p2]: [ding] }; await saveGallery(cur);
    return { id: cur.id, night: cur.chapters.find(c => c.title === 'Night').id, chapters: cur.chapters.map(c => c.title + ':' + c.pages.length) };
  }, [b64('rain.ogg'), b64('ding.ogg')]);
  console.log(JSON.stringify(ids.chapters));
  const st = () => p.evaluate(() => [...Snd.on.entries()].map(([a, x]) => [R.g.meta[a][2], x.leaving, x.done, x.plays, x.el.loop]));
  await p.evaluate(id => go('reader', { id, start: 1 }), ids.id); await p.waitForTimeout(1200);
  // the ding loops by default; set it to play 2 times
  await p.evaluate(() => $('#rSound').click()); await p.waitForSelector('#snd-sheet .sndloops');
  ok('each sound has a choice of how many times it plays (Loops by default)', await p.$eval('#snd-sheet .sndloops', e => e.selectedOptions[0].textContent) === 'Loops');
  await p.selectOption('#snd-sheet .sndloops', '2'); await p.waitForTimeout(300);
  await p.evaluate(() => closeSheet());
  await p.evaluate(() => { Snd.stop(); Snd.follow(true); }); await p.waitForTimeout(3500);
  const d1 = await st();
  ok('set to 2 times, it plays twice and then stays quiet', d1.length === 1 && d1[0][2] === true && d1[0][3] === 2 && d1[0][4] === false, JSON.stringify(d1));
  await p.evaluate(() => goToIdx(1)); await p.waitForTimeout(1200);
  const d2 = await st();
  ok('the next page has the same sound: it does not start over', d2.length === 1 && d2[0][2] === true, JSON.stringify(d2));
  // the whole gallery: rain on every page (with the pages' own sounds)
  await p.evaluate(() => $('#rSound').click()); await p.waitForSelector('#snd-scope');
  const scopes = await p.$$eval('#snd-scope button', a => a.map(e => e.innerText));
  await p.click('#snd-scope button:has-text("Whole gallery")'); await p.waitForSelector('#snd-pick');
  await p.selectOption('#snd-pick', { label: 'rain.ogg' }); await p.waitForTimeout(1500);
  const g1 = await st();
  ok('a sound for the whole gallery plays with the page\'s own', g1.some(x => x[0] === 'rain.ogg' && !x[1]) && g1.some(x => x[0] === 'ding.ogg' && !x[1]), JSON.stringify([scopes, g1]));
  await p.evaluate(() => closeSheet());
  // in the folder "Night": rain goes on (no restart), and a folder sound is added there
  await p.evaluate(() => { window.__rain = [...Snd.on.entries()].find(([a]) => R.g.meta[a][2] === 'rain.ogg')[1].el; goToIdx(2); }); await p.waitForTimeout(1500);
  const n1 = await st(), same = await p.evaluate(() => { const e = [...Snd.on.entries()].find(([a, x]) => R.g.meta[a][2] === 'rain.ogg' && !x.leaving); return !!e && e[1].el === window.__rain; });
  ok('moving into a folder, the gallery\'s sound goes on without a break', same && n1.filter(x => !x[1]).map(x => x[0]).join() === 'rain.ogg', JSON.stringify(n1));
  await p.evaluate(() => $('#rSound').click()); await p.waitForSelector('#snd-scope');
  await p.click('#snd-scope button:has-text("Folder")'); await p.waitForSelector('#snd-pick');
  const ft = await p.$eval('#sheetTitle', e => e.innerText);
  await p.selectOption('#snd-pick', { label: 'ding.ogg' }); await p.waitForTimeout(1200);
  await p.evaluate(() => closeSheet());
  await p.evaluate(() => goToIdx(3)); await p.waitForTimeout(1200);
  const fa = await p.evaluate(async id => { const g = await S.gal(id); return g.folderAudio; }, ids.id);
  const n2 = await st();
  ok('a folder\'s sound is set on the folder, for the pages inside', /Night/.test(ft) && fa && fa[ids.night] && fa[ids.night].length === 1, JSON.stringify([ft, fa]));
  ok('pages inside the folder play it, with the gallery\'s', n2.filter(x => !x[1]).map(x => x[0]).sort().join() === 'ding.ogg,rain.ogg', JSON.stringify(n2));
  await p.evaluate(() => goToIdx(1)); await p.waitForTimeout(1500);
  // Edit: select the folder, Sound
  await p.evaluate(id => go('editor', { id, view: 'folders' }), ids.id); await p.waitForTimeout(1000);
  await p.click('#v-editor button:has-text("Select")');
  await p.click(`#v-editor .pcell.folder[data-cid="${ids.night}"]`);
  const edBtn = await p.$('#ed-sound');
  if (edBtn) { await edBtn.click(); await p.waitForSelector('#snd-sheet'); ok('in Edit, a selected folder gets its own sounds', /folder “Night”/.test(await p.$eval('#sheetTitle', e => e.innerText)) && /ding\.ogg/.test(await p.$eval('#snd-sheet', e => e.innerText))); }
  else ok('in Edit, a selected folder gets its own sounds', false, 'no Sound button');
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
