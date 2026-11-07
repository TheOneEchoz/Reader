// Taking a picture while playing (it goes to the game's screenshots gallery), and switching mods while playing:
// the game is saved, started again with the new mods and put back where it was.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GAMEDIR = '/tmp/claude-0/games/m8.5.3/the_question-7.0-pc', RT = '/home/claude/reader/renpy/';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'camera'); await p.fill('#pw1', 'campass123'); await p.fill('#pw2', 'campass123'); await p.click('#v-lock button[type=submit]');
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
  for (let k = 0; k < 4; k++) { await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); await p.waitForTimeout(3000); if (await fr.evaluate(() => window.renpy_exec('result = renpy.get_screen("main_menu") is None')).catch(() => false)) break; }
  for (let k = 0; k < 3; k++) { await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6); await p.waitForTimeout(1200); }
  await p.click('#gamebox .gamecam'); await p.waitForTimeout(2500);
  await p.click('#gamebox .gamecam'); await p.waitForTimeout(2500);
  const sg = await p.evaluate(async gid => { const s = (await S.gals()).find(x => x.shotsOf === gid); if (!s) return null; const pid = s.chapters[0].pages[0]; const bl = await S.blob('images', pid); const bm = await createImageBitmap(bl); return { title: s.title, n: s.chapters.reduce((a, c) => a + c.pages.length, 0), w: bm.width, h: bm.height, size: bl.size }; }, gid);
  ok('the camera saves pictures of the screen to the game\'s screenshots gallery', sg && sg.n === 2 && /screenshots/.test(sg.title) && sg.w >= 1280 && sg.size > 100000, JSON.stringify(sg));
  ok('the game keeps running', await p.evaluate(() => GAME.loaded && CUR.view === 'game'));
  const v1 = await fr.evaluate(() => window.renpy_exec('result = [getattr(store, "tkb_mod", "off"), str(renpy.game.context().current)]')).catch(e => String(e));
  // switch the mod off while playing
  await p.click('#gamebox .gamemods'); await p.waitForSelector('#livemods');
  ok('Restart is off until something changes', await p.$eval('#livemods-go', b => b.disabled));
  await p.click('#livemods .modrow .switch'); await p.click('#livemods-go');
  await p.waitForTimeout(3000);
  fr = await start();
  const v2 = await fr.evaluate(() => window.renpy_exec('result = [getattr(store, "tkb_mod", "off"), renpy.get_screen("main_menu") is None, str(renpy.game.context().current)]')).catch(e => String(e));
  console.log(JSON.stringify(v1), JSON.stringify(v2));
  ok('before: the mod was on', /"on"/.test(JSON.stringify(v1)));
  ok('after restarting: the mod is off and the game is back in the story, not at the main menu', Array.isArray(v2) && v2[0] === 'off' && v2[1] === true, JSON.stringify(v2));
  ok('the switch was remembered', await p.evaluate(async gid => (await S.gal(gid)).game.mods[0].on === false, gid));
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
