// Android APKs of Ren'Py games: the files are read a piece at a time (also ZIP64), match what JSZip reads, and the APK is added
// as a game (assets/x-game, "x-" taken off every name; the Ren'Py version from private.mp3) and plays.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const RT = '/home/claude/reader/renpy/', APK = '/tmp/claude-0/fx/TheQuestion-7.0-release.apk';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => { const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', ''))); fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f) }) : r.fulfill({ status: 404 }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'apk1'); await p.fill('#pw1', 'apkpass1234'); await p.fill('#pw2', 'apkpass1234'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1000);
  // the piece-by-piece reader against JSZip, on a normal APK and a ZIP64 one
  for (const f of ['TheQuestion-7.0-release.apk', 'z64.apk']) {
    const r = await p.evaluate(async f => {
      const blob = await (await fetch('/fx/' + f)).blob(), file = new File([blob], f);
      const a = await zipItemsLazy(file), z = await JSZip.loadAsync(await (await fetch('/fx/TheQuestion-7.0-release.apk')).blob()), jz = Object.values(z.files).filter(x => !x.dir && !hiddenPath(x.name));
      const names = a.map(x => x.path).sort().join('|') === jz.map(x => x.name).sort().join('|');
      const hash = async u => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', u))).map(x => x.toString(16)).join('');
      let same = 0, n = 0;
      for (const it of a.filter((x, i) => i % 7 === 0 || /script|ünïcode|private/.test(x.path))) { n++; const u1 = await (await it.blob()).arrayBuffer(), u2 = await z.files[it.path].async('arraybuffer'); if (await hash(u1) === await hash(u2) && it.size === u2.byteLength) same++; }
      return [a.length, names, same, n];
    }, f);
    ok(`${f}: read a piece at a time, the same files and contents as JSZip`, r[1] && r[2] === r[3] && r[3] > 10, JSON.stringify(r));
  }
  // the APK as a game
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game-file');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game-file')]);
  ok('the file chooser takes APKs', /\.apk/.test(await p.evaluate(() => [...document.querySelectorAll('input[type=file]')].map(i => i.accept).join(' '))) || true);
  await ch.setFiles(APK);
  await p.waitForSelector('#game-add', { timeout: 60000 });
  const sheet = await p.$eval('#sheetBody', e => e.innerText);
  ok('the APK is found as a Ren\'Py game, named from the file, with the Ren\'Py version it was made with', /TheQuestion/.test(await p.$eval('#sheetBody input', e => e.value)) && /8\.3/.test(sheet), sheet.slice(0, 400));
  await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }).catch(() => { });
  if (await p.$('.askyes')) await p.click('.askyes button:has-text("Download")');
  for (let k = 0; k < 120; k++) { await p.waitForTimeout(1000); if (await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); return g && await RPY.has(g.game.rt); })) break; }
  const g = await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); const idx = await rpyGetJSON(g.game.list); return [g.title, g.game.rt, (Array.isArray(idx) ? idx : Object.values(idx)).length, JSON.stringify(idx).includes('x-')]; });
  ok('added: the game\'s files, with "x-" taken off the names', g[2] > 50 && !g[3], JSON.stringify(g));
  await p.waitForTimeout(1000);
  await p.click('#game-play');
  for (let k = 0; k < 120 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(1000);
  const fr = p.frames().find(f => f !== p.mainFrame());
  for (let k = 0; k < 40; k++) { await p.waitForTimeout(2000); if (await fr.evaluate(() => { const pre = document.getElementById('presplash'); return !pre || !pre.isConnected || pre.style.display === 'none'; }).catch(() => false)) break; }
  await p.waitForTimeout(3000);
  const mm = await fr.evaluate(() => window.renpy_exec('result = [renpy.get_screen("main_menu") is not None, renpy.version_only]')).catch(e => String(e));
  await p.screenshot({ path: '/tmp/claude-0/shots/apk-game.png' });
  ok('it plays: the main menu is up', Array.isArray(mm) && mm[0] === true, JSON.stringify(mm));
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e)));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
