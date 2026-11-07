// Continue and the auto-save: hiding the app (switching away or closing it) saves to the game's auto-save,
// so does leaving with the x button and the lock button; Continue starts the game straight in the newest save.
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
  await p.fill('#user1', 'cont'); await p.fill('#pw1', 'contpass12'); await p.fill('#pw2', 'contpass12'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 }); await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Download")');
  for (let k = 0; k < 120; k++) { await p.waitForTimeout(1000); if (await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); return g && await RPY.has(g.game.rt); })) break; }
  await p.waitForTimeout(1500);
  const gid = await p.evaluate(async () => (await S.gals()).find(x => x.game).id);
  ok('no Continue before there are saves', !(await p.$('#game-continue')));
  const start = async () => {
    for (let k = 0; k < 120 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(1000);
    const fr = p.frames().find(f => f !== p.mainFrame());
    for (let k = 0; k < 40; k++) { await p.waitForTimeout(2000); if (await fr.evaluate(() => { const pre = document.getElementById('presplash'); return !pre || !pre.isConnected || pre.style.display === 'none'; }).catch(() => false)) break; }
    await p.waitForTimeout(2500); return fr;
  };
  await p.click('#game-play'); let fr = await start();
  const box = await (await p.$('#gamebox iframe')).boundingBox();
  await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); await p.waitForTimeout(3000); // Start
  for (let k = 0; k < 4; k++) { await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6); await p.waitForTimeout(1200); } // a few lines on
  const where0 = await fr.evaluate(() => window.renpy_exec('result = renpy.game.context().current')).catch(e => String(e));
  // the app is hidden (switched away from, or closed)
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(5000);
  await p.evaluate(() => { delete document.visibilityState; });
  const sv1 = await p.evaluate(async id => Object.keys((await rpyGetJSON((await S.gal(id)).game.sv)) || {}), gid);
  ok('hiding the app saves to the auto-save', sv1.some(f => /\/auto-1-LT1\.save$/.test(f)), sv1.join(', '));
  // a few more lines, then leave with x: saved again, no question asked
  for (let k = 0; k < 3; k++) { await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6); await p.waitForTimeout(1200); }
  const where1 = await fr.evaluate(() => window.renpy_exec('result = str(renpy.game.context().current)')).catch(e => String(e));
  await p.click('#gamebox .gameexit');
  await p.waitForFunction(() => !document.getElementById('gamebox'), null, { timeout: 15000 }).catch(() => { });
  const toastTxt = await p.evaluate(() => document.getElementById('toast').textContent);
  ok('leaving with x saves to the auto-save first', /Saved to the auto-save/.test(toastTxt), toastTxt);
  await p.waitForTimeout(800);
  ok('the game page now has Continue', !!(await p.$('#game-continue')));
  // Continue: straight back into the story, where it was left
  await p.click('#game-continue'); fr = await start(); await p.waitForTimeout(2000);
  const st = await fr.evaluate(() => window.renpy_exec('result = [renpy.get_screen("main_menu") is None, str(renpy.game.context().current)]')).catch(e => String(e));
  await p.screenshot({ path: '/tmp/claude-0/shots/continue.png' });
  ok('Continue starts in the newest save, not at the main menu', Array.isArray(st) && st[0] === true, JSON.stringify(st) + ' (left at ' + JSON.stringify(where1) + ')');
  ok('and at the place it was left', Array.isArray(st) && st[1] === where1, JSON.stringify(st[1]) + ' vs ' + JSON.stringify(where1));
  // the lock button: saves, then locks the app
  await p.click('#gamebox .gamelock');
  await p.waitForSelector('#user', { timeout: 30000 }).catch(() => { });
  ok('the lock button locks the app', !!(await p.$('#user')));
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
