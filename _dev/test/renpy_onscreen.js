// Pictures on screen: while playing, a button lists the pictures the game is showing right now (also from archives),
// with a preview; one can become the cover, or several go into a gallery, and the game keeps running.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GAMEDIR = '/tmp/claude-0/games/a8.5.3/the_question-7.0-pc', RT = '/home/claude/reader/renpy/';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'onscr'); await p.fill('#pw1', 'onscpass12'); await p.fill('#pw2', 'onscpass12'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 }); await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Download")');
  for (let k = 0; k < 120; k++) { await p.waitForTimeout(1000); if (await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); return g && await RPY.has(g.game.rt); })) break; }
  await p.waitForTimeout(1500);
  const gid = await p.evaluate(async () => (await S.gals()).find(x => x.game).id);
    const start = async () => {
    for (let k = 0; k < 120 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(1000);
    const fr = p.frames().find(f => f !== p.mainFrame());
    for (let k = 0; k < 40; k++) { await p.waitForTimeout(2000); if (await fr.evaluate(() => { const pre = document.getElementById('presplash'); return !pre || !pre.isConnected || pre.style.display === 'none'; }).catch(() => false)) break; }
    await p.waitForTimeout(2500); return fr;
  };
  await p.click('#game-play'); let fr = await start();
  const box = await (await p.$('#gamebox iframe')).boundingBox();
  await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); await p.waitForTimeout(3000); // Start
  for (let k = 0; k < 2; k++) { await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6); await p.waitForTimeout(1200); }
  const showing = await fr.evaluate(() => window.renpy_exec('result = [" ".join(t) for t in renpy.get_showing_tags("master", True)] if hasattr(renpy, "get_showing_tags") else []')).catch(e => String(e));
  await p.click('#gamebox .gamepics');
  await p.waitForSelector('#sheetBody .btile.asset', { timeout: 30000 });
  const names = await p.$$eval('#sheetBody .btile.asset', a => a.map(e => e.title));
  console.log('SHOWING', JSON.stringify(showing), 'PICKED', JSON.stringify(names));
  ok('the button lists the pictures on screen (from the archive)', names.some(n => /bg /.test(n)), names.join(', '));
  ok('only what is on screen, not every picture', names.length > 0 && names.length < 30, names.length + ' pictures');
  const z = await p.evaluate(() => [getComputedStyle($('#sheet')).zIndex, getComputedStyle($('#gamebox')).zIndex]);
  ok('the sheet shows above the game', +z[0] > +z[1], z.join(' > '));
  // preview
  await p.click('#sheetBody .btile.asset'); // select first
  const viewB = await p.$('#sheetBody button:has-text("View")');
  if (viewB) { await viewB.click(); await p.waitForTimeout(1200); ok('preview opens', await p.evaluate(() => !!document.querySelector('#viewer:not([hidden]), .viewer, #v-viewer:not([hidden])'))); await p.keyboard.press('Escape'); await p.waitForTimeout(800); }
  else ok('preview opens', false, 'no View button');
  // use it as cover: the game keeps running
  await p.evaluate(() => { const b = document.querySelector('#sheetBody .btile.asset.sel, #sheetBody .btile.asset[aria-pressed="true"]'); if (!b) document.querySelector('#sheetBody .btile.asset').click(); });
  const coverOk = await p.$('#sheetBody button:has-text("cover"):not([disabled]), #sheetBody button:has-text("Cover"):not([disabled])');
  if (coverOk) {
    await coverOk.click(); await p.waitForTimeout(1500);
    const cropDone = await p.$('#sheetBody button:has-text("Use"), #sheetBody button:has-text("Done"), #sheetBody button:has-text("Save")');
    if (cropDone) { await cropDone.click(); await p.waitForTimeout(2000); }
  }
  const after = await p.evaluate(async id => ({ by: (await S.gal(id)).game.coverBy, view: CUR.view, box: !!document.getElementById('gamebox'), loaded: GAME.loaded }), gid);
  ok('choosing the cover from the game keeps the game running', after.view === 'game' && after.box && after.loaded, JSON.stringify(after));
  ok('and the cover changed', after.by === 'user', JSON.stringify(after));
  // add to a gallery: the selected pictures go in as ONE picture, drawn as they are on screen
  await p.evaluate(async () => { const g = newGallery('Scenes'); Tree.ensureRoot(g); const mk = () => new Promise(r => { const c = document.createElement('canvas'); c.width = 50; c.height = 50; c.toBlob(bl => r({ name: 'x.png', get: async () => new File([bl], 'x.png', { type: 'image/png' }) })); }); await importInto(g, [{ title: 'Scenes', chId: g.chapters[0].id, items: [await mk()] }], () => { }, () => false); });
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(800);
  const pickAdd = async () => {
    await p.click('#asset-addto'); await p.waitForSelector('#asset-where');
    await p.evaluate(() => { const s = $('#asset-where'); s.value = [...s.options].find(o => /^Scenes/.test(o.textContent)).value; });
    await p.click('#sheetBody button:has-text("Add them")');
    for (let k = 0; k < 40 && await p.$('#asset-where'); k++) await p.waitForTimeout(500);
    await p.waitForTimeout(800);
  };
  const scenes = () => p.evaluate(async () => { const g = (await S.gals()).find(x => x.title === 'Scenes'); const pages = g.chapters.flatMap(c => c.pages); const last = pages[pages.length - 1]; const bm = await createImageBitmap(await S.blob('images', last)); return { n: pages.length, w: bm.width, h: bm.height, view: CUR.view, loaded: GAME.loaded }; });
  await p.click('#gamebox .gamepics'); await p.waitForSelector('#sheetBody .btile.asset', { timeout: 30000 });
  const playingNow = await p.$eval('#asset-sounds', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  ok('the sheet lists the music playing now', /Playing now/i.test(playingNow) && /\.(ogg|opus|mp3)/.test(playingNow), playingNow);
  // listen to one sound alone: the game's sound pauses meanwhile, and comes back after
  const ctxState = () => fr.evaluate(() => (window.__tkbAudio || []).map(c => c.state).join(','));
  const before0 = await ctxState();
  await p.click('#asset-sounds .sndlisten'); await p.waitForTimeout(1200);
  const during = await ctxState(), btnTxt = await p.$eval('#asset-sounds .sndlisten', b => b.innerText.trim());
  await p.click('#asset-sounds .sndlisten'); await p.waitForTimeout(800);
  const after0 = await ctxState();
  ok('Listen plays that sound alone: the game\'s sound pauses, then comes back', /running/.test(before0) && !/running/.test(during) && btnTxt === 'Stop' && /running/.test(after0), JSON.stringify([before0, during, btnTxt, after0]));
  ok('the sheet offers Together (chosen) or Each on its own', await p.$eval('#asset-together button[aria-pressed="true"]', b => /Together/.test(b.innerText)));
  // the background and the text box: one picture of the screen's size
  await p.$$eval('#sheetBody .btile.asset', a => a.filter(e => /bg |textbox/.test(e.title)).forEach(e => e.click()));
  await pickAdd();
  const one = await scenes();
  const snd = await p.evaluate(async () => { const g = (await S.gals()).find(x => x.title === 'Scenes'); const pages = g.chapters.flatMap(c => c.pages); const last = pages[pages.length - 1]; return (g.audio && g.audio[last] || []).map(a => g.meta[a][2]); });
  ok('the music playing in the game goes with the picture', snd.length >= 1, JSON.stringify(snd));
  ok('the selected pictures become one picture, the size of the screen', one.n === 2 && one.w === 1280 && one.h === 720 && one.view === 'game' && one.loaded, JSON.stringify(one));
  // Each on its own: one picture per file again
  await p.click('#gamebox .gamepics'); await p.waitForSelector('#sheetBody .btile.asset', { timeout: 30000 });
  await p.click('#asset-together button:has-text("Each on its own")');
  await p.click('#sheetBody button:has-text("Select all")');
  await pickAdd();
  const each = await scenes();
  ok('Each on its own adds them separately', each.n === 2 + names.length, JSON.stringify(each));
  await p.screenshot({ path: '/tmp/claude-0/shots/onscreen.png' });
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
