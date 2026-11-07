// The saves while playing: a list with each save's picture; Save here (in a free slot); going to a save.
// The game's page shows the last thing seen (the newest save's picture) on Continue.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GAMEDIR = '/tmp/claude-0/games/q8.5.3/the_question-7.0-pc', RT = '/home/claude/reader/renpy/';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'picker'); await p.fill('#pw1', 'pickpass12'); await p.fill('#pw2', 'pickpass12'); await p.click('#v-lock button[type=submit]');
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
  const adv = async n => { for (let k = 0; k < n; k++) { await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6); await p.waitForTimeout(1200); } };
  await adv(2);
  const at1 = await fr.evaluate(() => window.renpy_exec('result = str(renpy.game.context().current)'));
  await p.click('#gamebox .gamesaves'); await p.waitForSelector('#savepick-save');
  await p.click('#savepick-save'); await p.waitForTimeout(3000);
  const sv = await p.evaluate(async gid => Object.keys((await rpyGetJSON((await S.gal(gid)).game.sv)) || {}).filter(k => /\.save$/.test(k)).map(k => k.split('/').pop()), gid);
  ok('Save here saves in the first free slot (also seen in the game\'s own menus)', sv.includes('1-1-LT1.save'), JSON.stringify(sv));
  await adv(4);
  const at2 = await fr.evaluate(() => window.renpy_exec('result = str(renpy.game.context().current)'));
  await p.click('#gamebox .gamesaves'); await p.waitForSelector('#savepick-list .savecard');
  const cards = await p.$$eval('#savepick-list .savecard', a => a.map(e => [e.innerText.replace(/\s+/g, ' '), !!(e.querySelector('img') && e.querySelector('img').src)]));
  ok('the list shows each save with its picture', cards.length >= 2 && cards.every(c => c[1]), JSON.stringify(cards));
  await p.click('#savepick-list .savecard:has-text("Page 1, slot 1")'); await p.waitForSelector('.askyes'); await p.click('.askyes button:has-text("Go")');
  await p.waitForTimeout(4000);
  const at3 = await fr.evaluate(() => window.renpy_exec('result = str(renpy.game.context().current)')).catch(e => String(e));
  console.log(at1, at2, at3);
  ok('tapping a save goes there', at3 === at1 && at2 !== at1, JSON.stringify([at1, at2, at3]));
  await p.click('#gamebox .gameexit'); await p.waitForTimeout(2500);
  await p.waitForSelector('#game-continue img.contshot', { timeout: 10000 }).catch(() => { });
  ok('the game\'s page shows where you left off on Continue', !!(await p.$('#game-continue img.contshot')));
  await p.screenshot({ path: '/tmp/claude-0/shots/continue-shot.png' });
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
