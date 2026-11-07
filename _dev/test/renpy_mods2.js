// "Turn files into a mod": a game added with its mod archive inside (kept as part of the game) gets it split off;
// the archive that looks like a mod is ticked already.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort()); await ctx.route('https://theoneechoz.github.io/**', r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'modder2'); await p.fill('#pw1', 'modpass123'); await p.fill('#pw2', 'modpass123'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles('/tmp/claude-0/games/m8.5.3/the_question-7.0-pc');
  await p.waitForSelector('#game-add', { timeout: 60000 });
  await p.click('#sheetBody .switch[aria-label^="Keep zz_cheatmod"]'); // keep it in the game, as before mods existed
  await p.click('#game-add'); await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Cancel")'); await p.waitForTimeout(1500);
  const before = await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); return { mods: (g.game.mods || []).length, files: g.game.files }; });
  ok('switched off when adding: the archive stays part of the game', before.mods === 0, JSON.stringify(before));
  await p.click('#mod-from-game'); await p.waitForSelector('#mod-make');
  const ticked = await p.$$eval('#sheetBody .chrow', a => a.filter(r => r.querySelector('input').checked).map(r => r.querySelector('.t').innerText.replace(/\s+/g, ' ')));
  ok('the archive that looks like a mod is ticked already', ticked.length === 1 && /zz_cheatmod\.rpa Looks like a mod/.test(ticked[0]), ticked.join(' | '));
  await p.click('#mod-make'); await p.waitForTimeout(1500);
  const after = await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); const base = await rpyGetJSON(g.game.list); return { mods: g.game.mods.map(m => m.name + ':' + m.on + ':' + m.files), files: g.game.files, inBase: base.some(f => /zz_cheatmod/.test(f.p)) }; });
  ok('it is now a mod you can switch off, out of the game\'s own files', JSON.stringify(after.mods) === '["zz_cheatmod:true:1"]' && !after.inBase && after.files === before.files - 1, JSON.stringify(after));
  ok('no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
