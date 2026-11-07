// HTML games (here a small one built like RPG Maker MZ): a Worker started from a game file works, and what it loads
// (importScripts, fetch of a file next to it) comes from the app; localforage saves are kept; FontFace with a game font loads.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const GAMEDIR = '/tmp/claude-0/games/html/Worker Test';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (/game:/.test(m.text())) console.log('console:', m.text().slice(0, 200)); });
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'htmlg'); await p.fill('#pw1', 'htmlgpass1'); await p.fill('#pw2', 'htmlgpass1'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1200);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 });
  ok('recognised as RPG Maker MZ', /Made with RPG Maker MZ/.test(await p.$eval('#sheetBody', e => e.innerText)));
  await p.click('#game-add'); await p.waitForTimeout(2000);
  const play = async () => {
    await p.click('#game-play');
    for (let k = 0; k < 40 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(300);
    const fr = p.frames().find(f => f !== p.mainFrame()); let r = {};
    for (let k = 0; k < 30; k++) { await p.waitForTimeout(300); r = await fr.evaluate(() => window.RESULT || {}).catch(() => ({})); if (r.worker && r.font && r.selfXhr) break; }
    return r;
  };
  const r1 = await play();
  console.log(JSON.stringify(r1));
  ok('a Worker started from a game file runs, with importScripts and a file fetched next to it', r1.worker && r1.worker.helper === 42 && r1.worker.wasm === 'WASMBYTES', JSON.stringify(r1.worker));
  ok('a game font loads with FontFace', r1.font === 'ok', r1.font);
  ok('a request for its own script works', r1.selfXhr === 200);
  ok('the page counts as loaded once', r1.load === 1, String(r1.load));
  await p.waitForTimeout(800);
  await p.click('#gamebox .gameexit'); await p.waitForTimeout(1500);
  const r2 = await play();
  ok('localforage saves come back next time', /^save-\d+$/.test(r2.before || ''), JSON.stringify(r2.before));
  const real = errs.filter(e => !/serviceWorker/.test(e));
  ok('no errors (the game\'s own localforage file never ran)', real.length === 0, real.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
