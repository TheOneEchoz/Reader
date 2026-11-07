// RPG Maker MV games: a game folder (with index.html and js/rpg_core.js) is recognised, added, and plays sealed in the app:
// every file comes from the app; the game's browser saves are kept with it.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const GAMEDIR = process.env.GAMEDIR || '/tmp/claude-0/games/mv/Catch Gold';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const net = []; await ctx.route(u => !/localhost:8768/.test(String(u)) && !/fonts\.g/.test(String(u)), r => { net.push(r.request().url()); r.abort(); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (/game:|error/i.test(m.text())) console.log('console:', m.text().slice(0, 200)); });
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'rpgm'); await p.fill('#pw1', 'rpgmpass12'); await p.fill('#pw2', 'rpgmpass12'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]); await ch.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 });
  const sheet = await p.$eval('#sheetBody', e => e.innerText.replace(/\s+/g, ' '));
  ok('the folder is recognised as an RPG Maker MV game', /Made with RPG Maker MV/.test(sheet) && /nothing to download/.test(sheet), sheet.slice(0, 250));
  ok('its name comes from the folder', (await p.inputValue('#game-name-0')) === 'Catch Gold');
  await p.click('#game-add'); await p.waitForTimeout(3000);
  const st = await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); const list = await rpyGetJSON(g.game.list); return { kind: g.game.kind, engine: g.game.engine, files: list.length, exe: list.some(f => /\.exe$/i.test(f.p)), view: CUR.view, card: gameKind(g) }; });
  ok('added as an RPG Maker MV game, without the Windows player', st.engine === 'html' && st.kind === 'rmmv' && !st.exe && st.view === 'detail', JSON.stringify(st));
  const page = await p.$eval('#v-detail', e => e.innerText.replace(/\s+/g, ' '));
  ok('its page says what it is, with no Ren\'Py parts', /RPG Maker MV game/.test(page) && !/Ren'Py/.test(page), page.slice(0, 200));
  await p.click('#game-play');
  for (let k = 0; k < 60 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(500);
  const fr = p.frames().find(f => f !== p.mainFrame());
  let scene = '';
  for (let k = 0; k < 40; k++) { await p.waitForTimeout(1000); scene = await fr.evaluate(() => window.SceneManager && SceneManager._scene && SceneManager._scene.constructor.name).catch(() => ''); if (scene === 'Scene_Title') break; }
  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/claude-0/shots/rpgm-title.png' });
  console.log('BOOT', JSON.stringify(await fr.evaluate(() => ({ db: DataManager.isDatabaseLoaded(), img: ImageManager.isReady(), font: Graphics.isFontLoaded('GameFont'), err: Graphics._errorPrinter && Graphics._errorPrinter.innerText, fails: Object.keys(ImageManager._imageCache ? ImageManager._imageCache._items : ImageManager.cache._inner || {}).length })).catch(e => String(e))));
  ok('the game reaches its title screen', scene === 'Scene_Title', scene);
  // New Game: the map
  await fr.evaluate(() => { SceneManager._scene._commandWindow && SceneManager._scene.commandNewGame(); });
  for (let k = 0; k < 20; k++) { await p.waitForTimeout(1000); scene = await fr.evaluate(() => SceneManager._scene.constructor.name).catch(() => ''); if (scene === 'Scene_Map') break; }
  await p.waitForTimeout(2000);
  ok('New Game goes to the map', scene === 'Scene_Map', scene);
  // save in slot 1, as the game does
  const saved = await fr.evaluate(() => { $gameSystem.onBeforeSave(); return DataManager.saveGame(1); }).catch(e => 'error ' + e);
  await p.waitForTimeout(1500);
  const sv = await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); return Object.keys((await rpyGetJSON(g.game.sv)) || {}); });
  ok('a save made in the game is kept with it', saved === true && sv.includes('ls/RPG%20File1'), JSON.stringify([saved, sv]));
  await p.screenshot({ path: '/tmp/claude-0/shots/rpgm-map.png' });
  await p.click('#gamebox .gameexit'); await p.waitForTimeout(1500);
  // play again: the save is there
  await p.click('#game-play');
  for (let k = 0; k < 60 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(500);
  const fr2 = p.frames().find(f => f !== p.mainFrame());
  for (let k = 0; k < 40; k++) { await p.waitForTimeout(1000); scene = await fr2.evaluate(() => window.SceneManager && SceneManager._scene && SceneManager._scene.constructor.name).catch(() => ''); if (scene === 'Scene_Title') break; }
  const has = await fr2.evaluate(() => [DataManager.isAnySavefileExists(), DataManager.loadSavefileInfo(1) && DataManager.loadSavefileInfo(1).title]).catch(e => String(e));
  ok('playing again, the save is there (Continue)', Array.isArray(has) && has[0] === true, JSON.stringify(has));
  // leaving from the map saves to the app's own slot; Continue starts there
  await fr2.evaluate(() => SceneManager._scene.commandNewGame()); for (let k = 0; k < 20; k++) { await p.waitForTimeout(800); if (await fr2.evaluate(() => SceneManager._scene.constructor.name) === 'Scene_Map') break; }
  await p.waitForTimeout(1500);
  const pos0 = await fr2.evaluate(() => { $gamePlayer.locate(3, 4); $gameVariables.setValue(7, 1234); return [$gameMap.mapId(), $gamePlayer.x, $gamePlayer.y]; });
  await p.click('#gamebox .gameexit'); await p.waitForTimeout(2500);
  const sv2 = await p.evaluate(async () => { const g = (await S.gals()).find(x => x.game); return Object.keys((await rpyGetJSON(g.game.sv)) || {}); });
  const toastT = await p.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(t => t.innerText).join(' | '));
  ok('leaving from the map saves the game in the app\'s own slot', sv2.includes('ls/RPG%20File21') && /Saved/.test(toastT), JSON.stringify(sv2) + ' ' + toastT);
  ok('Continue appears on the game\'s page', !!(await p.$('#game-continue')));
  await p.click('#game-continue');
  for (let k = 0; k < 60 && !(await p.evaluate(() => GAME.loaded)); k++) await p.waitForTimeout(500);
  const fr3 = p.frames().find(f => f !== p.mainFrame()); let pos1 = null;
  for (let k = 0; k < 40; k++) { await p.waitForTimeout(800); pos1 = await fr3.evaluate(() => SceneManager._scene && SceneManager._scene.constructor.name === 'Scene_Map' && $gamePlayer ? [$gameMap.mapId(), $gamePlayer.x, $gamePlayer.y, $gameVariables.value(7)] : null).catch(() => null); if (pos1) break; }
  ok('Continue starts where you left (not at the title)', pos1 && pos1[0] === pos0[0] && pos1[1] === 3 && pos1[2] === 4 && pos1[3] === 1234, JSON.stringify([pos0, pos1]));
  const slots = await fr3.evaluate(() => { const out = []; for (let i = 1; i <= DataManager.maxSavefiles(); i++) if (DataManager.loadSavefileInfo(i)) out.push(i); return out; });
  ok('the game\'s own save slots are untouched (only the one you made)', JSON.stringify(slots) === '[1]', JSON.stringify(slots));
  ok('nothing was fetched from the internet', net.length === 0, net.slice(0, 3).join(', '));
  const real = errs.filter(e => !/serviceWorker/.test(e) && !/require is not a function/.test(e)); // (that test game has a plugin made only for the Windows player)
  ok('no errors', real.length === 0, real.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
