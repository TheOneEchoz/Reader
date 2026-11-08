// Big games: pictures and sounds are given to Ren'Py on demand (its own web loading, answered by the app),
// so the archives are not put in memory; the story still shows its pictures and plays its music.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GAMEDIR = process.env.GAMEDIR || '/tmp/claude-0/games/a8.5.3/the_question-7.0-pc', RT = '/home/claude/reader/renpy/';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', process.env.U || 'lazy1'); await p.fill('#pw1', 'lazypass12'); await p.fill('#pw2', 'lazypass12'); await p.click('#v-lock button[type=submit]');
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
  await p.evaluate(async id => { const g = await S.gal(id); g.game.lazy = true; await saveGallery(g); }, gid);
  await p.click('#game-play'); let fr = await start();
  const st0 = await fr.evaluate(() => ({ arc: FS.analyzePath('/game/archive.rpa').exists, idx: FS.analyzePath('/game/renpyweb_remote_files.txt').exists, rem: FS.analyzePath('/game/renpyweb_remote_files.txt').exists ? FS.readFile('/game/renpyweb_remote_files.txt', { encoding: 'utf8' }).split('\n').length / 2 | 0 : 0, scripts: FS.readdir('/game').filter(n => /\.rpyc$/.test(n)).length }));
  const lazyN = await p.evaluate(() => GAME.lazy);
  console.log('START', JSON.stringify(st0), 'remote', lazyN);
  ok('the archive is not put in memory; its pictures and sounds are listed as on demand', !st0.arc && st0.idx && lazyN > 5, JSON.stringify(st0));
  ok('the scripts are there (from the archive or loose)', st0.scripts > 3, st0.scripts);
  await p.screenshot({ path: '/tmp/claude-0/shots/lazy-menu.png' });
  const box = await (await p.$('#gamebox iframe')).boundingBox();
  for (let k = 0; k < 4; k++) { // Start (again if the menu was not ready)
    await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); await p.waitForTimeout(4000);
    if (await fr.evaluate(() => window.renpy_exec('result = renpy.get_screen("main_menu") is None')).catch(() => false)) break;
  }
  for (let k = 0; k < 2; k++) { await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6); await p.waitForTimeout(2500); }
  await p.screenshot({ path: '/tmp/claude-0/shots/lazy-story.png' });
  const got = await p.evaluate(() => GAME.lazyGot || 0);
  const pix = Math.round(require('fs').statSync('/tmp/claude-0/shots/lazy-story.png').size / 1000); // a real background makes a big picture; a flat stand-in a tiny one
  const bg = await fr.evaluate(() => window.renpy_exec('result = [renpy.loader.loadable("images/bg lecturehall.jpg"), "images/bg lecturehall.jpg" in renpy.loader.remote_files]')).catch(e => String(e));
  console.log('GOT', got, 'colours', pix, JSON.stringify(bg));
  ok('pictures are asked for and given as the story goes', got >= 2, String(got));
  ok('the background shows (not a blank stand-in)', pix > 300, pix + ' kB screenshot');
  // pictures that arrived are kept (Ren'Py would free them after a minute and load them again when they come back)
  await p.waitForTimeout(1000);
  const keep = await fr.evaluate(() => window.renpy_exec('import os\nresult = [len(renpy.webloader.to_unlink), len(_tkb_keep), all(os.path.exists(x) for x in _tkb_keep), _tkb_keep_budget // 1048576]')).catch(e => String(e));
  ok('pictures that arrived are kept, not freed a minute later', Array.isArray(keep) && keep[0] === 0 && keep[1] >= 1 && keep[2] === true && keep[3] >= 128, JSON.stringify(keep));
  const err = await fr.evaluate(() => { const t = document.body.innerText; return /Download error|Traceback|Exception/.test(t) ? t.slice(0, 300) : ''; });
  ok('no Ren\'Py errors', !err, err);
  // play on: more lines, more pictures, all fine
  for (let k = 0; k < 6; k++) { await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6); await p.waitForTimeout(1500); }
  const where = await fr.evaluate(() => window.renpy_exec('result = str(renpy.game.context().current)')).catch(e => String(e));
  ok('the story goes on', !/error/i.test(String(where)), String(where));
  await p.click('#gamebox .gameexit'); await p.waitForTimeout(2000);
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
