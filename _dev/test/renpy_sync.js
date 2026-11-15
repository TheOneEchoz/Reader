// Ren'Py Sync: saves from another device with its code (through the app, only to Ren'Py's sync server), shown in Saves and
// loadable; and saves sent the same way.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GAMEDIR = '/tmp/claude-0/games/g8.3.7/the_question-7.0-pc', RT = '/home/claude/reader/renpy/';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const STORE = new Map(), seen = [];
  await ctx.route('https://sync.renpy.org/**', async r => { const u = new URL(r.request().url()); seen.push(r.request().method() + ' ' + u.pathname);
    if (r.request().method() === 'PUT') { STORE.set(u.pathname, r.request().postDataBuffer()); return r.fulfill({ status: 200, body: 'ok', headers: { 'Access-Control-Allow-Origin': '*' } }); }
    const b = STORE.get(u.pathname); return b ? r.fulfill({ status: 200, body: b, headers: { 'Access-Control-Allow-Origin': '*' } }) : r.fulfill({ status: 404, body: 'Not found', headers: { 'Access-Control-Allow-Origin': '*' } }); });
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (/fix values/.test(m.text())) console.log('CONSOLE', m.text()); }); p.on('console', m => { if (/fix reload/.test(m.text())) console.log('TIMING', m.text()); });
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', (process.env.SHOWERR ? 'sync2' : 'sync3')); await p.fill('#pw1', 'layeredpw12'); await p.fill('#pw2', 'layeredpw12'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 }); await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Download")');
  for (let k = 0; k < 120; k++) { await p.waitForTimeout(1000); if (await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); return g && await RPY.has(g.game.rt); })) break; }
  await p.waitForTimeout(1500);
  const gid = await p.evaluate(async () => (await S.gals()).find(x => x.game).id);
  if (process.env.SHOWERR) await p.evaluate(async id => { const x = await S.gal(id); x.game.errors = 'show'; await saveGallery(x); }, gid);
    const start = async () => {
    for (let k = 0; k < 120 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(1000);
    const fr = p.frames().find(f => f !== p.mainFrame());
    for (let k = 0; k < 40; k++) { await p.waitForTimeout(2000); if (await fr.evaluate(() => { const pre = document.getElementById('presplash'); return !pre || !pre.isConnected || pre.style.display === 'none'; }).catch(() => false)) break; }
    await p.waitForTimeout(2500); return fr;
  };
  await p.click('#game-play'); let fr = await start();
  const box = await (await p.$('#gamebox iframe')).boundingBox();
  for (let k = 0; k < 4; k++) { await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); await p.waitForTimeout(3000); if (await fr.evaluate(() => window.renpy_exec('result = renpy.get_screen("main_menu") is None')).catch(() => false)) break; }
  await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6); await p.waitForTimeout(1500);
  const py = c => fr.evaluate(c => window.renpy_exec(c), c).catch(e => String(e));
  const send = cmd => p.evaluate(cmd => GAME.frame.contentWindow.postMessage({ t: 'rpycmd', cmd }, '*'), cmd);
  await send(['save', '2-1', 'here', 'Saved.']); await p.waitForTimeout(2500);
  // what the phone would upload: a save (as 7-1) in a sync, encrypted with the code
  const up = await py(['import io, zipfile, base64', 'loc = renpy.loadsave.location', 'path = loc.path("2-1-LT1.save")[1]', 'bio = io.BytesIO()', 'with zipfile.ZipFile(bio, "w") as zf:', '    zf.writestr("save_directory", config.save_directory)', '    zf.write(path, "7-1-LT1.save")', 'key, hashed = _sync.key_and_hash("ABCDE-12345")', 'result = [hashed, base64.b64encode(renpy.encryption.secretbox_encrypt(bio.getvalue(), key)).decode()]'].join('\n'));
  ok('(a sync made as the phone would)', Array.isArray(up) && up[0].length === 64, JSON.stringify(up).slice(0, 120));
  STORE.set('/api/sync/v1/' + up[0], Buffer.from(up[1], 'base64'));
  await p.click('#gamebox .gamesaves'); await p.waitForSelector('#savepick');
  await p.click('#sync-box summary'); await p.fill('#sync-code', 'abcde12345'); await p.click('#sync-get');
  await p.waitForTimeout(5000);
  const got = await py('import os\nresult = [renpy.can_load("7-1"), os.path.exists(config.savedir + "/sync/7-1-LT1.save")]');
  ok('Get the saves: the save from the other device is in the game', Array.isArray(got) && got[0] === true && got[1] === true, JSON.stringify([got, seen]));
  ok('asked only Ren\'Py\'s sync server, through the app', seen.length === 1 && seen[0] === 'GET /api/sync/v1/' + up[0], JSON.stringify(seen));
  await p.waitForTimeout(1500);
  await p.click('#gamebox .gamesaves'); await p.waitForSelector('#savepick');
  const cards = await p.$$eval('#savepick-list .savecard b', a => a.map(e => e.textContent));
  ok('it is in the app\'s Saves too (kept with the game), each save once', cards.some(c => /7/.test(c)) && new Set(cards).size === cards.length, JSON.stringify(cards));
  // sending: the game's own Upload Sync, through the app
  await py('_tkbcs = renpy.call_screen\nrenpy.call_screen = lambda n, *a, **k: True if n == "sync_confirm" else _tkbcs(n, *a, **k)\nresult = True');
  await p.click('#sync-box summary'); await p.click('#sync-send'); await p.waitForTimeout(5000);
  const put = seen.find(x => x.startsWith('PUT '));
  await p.screenshot({ path: '/tmp/claude-0/shots/sync-send.png' });
  ok('Send these saves: uploaded to Ren\'Py\'s sync server, the game shows the code', !!put && [...STORE.values()].some(b => b.length > 1000), JSON.stringify(seen));
  // the game still cannot reach anything else
  const other = await fr.evaluate(() => fetch('https://example.com/x').then(() => 'reached', e => 'blocked')).catch(e => 'blocked');
  ok('anything else is still out of reach', other === 'blocked', other);
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker|example\.com|Content Security Policy/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
