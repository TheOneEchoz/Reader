// Ren'Py games, second round: a game whose pictures and music are packed in an .rpa archive (like most real games).
// Music from the archive plays; Enter works in Ren'Py's text box; the main menu becomes the cover by itself;
// the cover can be picked from the game's pictures (archive included); games go into a gallery's folders and back.
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GV = process.env.GAME || '8.5.3';
const GAMEDIR = `/tmp/claude-0/games/a${GV}/the_question-7.0-pc`;
const ZIP7 = '/tmp/claude-0/games/q787.zip';
const RT = '/home/claude/reader/renpy/';
const SHOT = n => `/tmp/claude-0/shots/more-${GV}-${n}.png`;
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  fs.mkdirSync('/tmp/claude-0/shots', { recursive: true });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=document-user-activation-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => {
    const f = path.join(RT, decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', '')));
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'no' });
    r.fulfill({ status: 200, body: fs.readFileSync(f), contentType: f.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'player2'); await p.fill('#pw1', 'playpass12'); await p.fill('#pw2', 'playpass12'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(2000);
  // add the archived game, download Ren'Py
  await p.click('#v-library button:has-text("Add")'); await p.waitForSelector('#add-game');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]);
  await chooser.setFiles(GAMEDIR);
  await p.waitForSelector('#game-add', { timeout: 60000 }); await p.click('#game-add');
  await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Download")');
  await p.waitForFunction(async () => { const g = (await S.gals()).find(x => x.game); return g && (await RPY.has(g.game.rt)); }, null, { timeout: 180000, polling: 1000 }).catch(() => { });
  await p.waitForTimeout(1500);
  const gid = await p.evaluate(async () => (await S.gals()).find(x => x.game).id);
  const cov0 = await p.evaluate(async id => (await S.gal(id)).game.coverBy || 'none', gid);
  // the game's pictures (archive included): scroll down while previews load; the place must not jump back
  ok('the game page has no separate Cover button', !(await p.$('#game-cover')));
  await p.click('#game-assets'); await p.waitForSelector('#sheetBody .btile.asset', { timeout: 60000 });
  const pick = await p.evaluate(() => ({ note: $('#sheetBody .hint:not(button)') ? [...document.querySelectorAll('#sheetBody p.hint')].map(e => e.textContent).join(' ') : '', names: [...document.querySelectorAll('#sheetBody .btile')].slice(0, 3).map(e => e.title) }));
  ok('it lists the pictures inside the archive', /60 pictures in the game/.test(pick.note) && pick.names[0] === 'gui/main_menu.png', JSON.stringify(pick).slice(0, 300));
  await p.evaluate(() => { const sb = $('#sheetBody'); window.__sc = []; sb.addEventListener('scroll', () => __sc.push([Math.round(performance.now()), sb.scrollTop, sb.scrollHeight])); const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'); Object.defineProperty(sb, 'scrollTop', { get() { return d.get.call(this); }, set(v) { __sc.push(['SET', v, new Error().stack.split('\n').slice(2, 4).join(' | ')]); d.set.call(this, v); } }); sb.scrollTop = 900; });
  const y0 = await p.evaluate(() => $('#sheetBody').scrollTop);
  const m0 = await p.evaluate(() => ({ sh: $('#sheetBody').scrollHeight, ch: $('#sheetBody').clientHeight, grid: $('#sheetBody .bgrid').offsetHeight, tile: $('#sheetBody .btile.asset').offsetHeight, bar: $('#sheetBody .assetbar').offsetHeight }));
  await p.waitForTimeout(3500);
  const y1 = await p.evaluate(() => ({ top: $('#sheetBody').scrollTop, loaded: [...document.querySelectorAll('#sheetBody .btile img')].filter(i => i.src).length }));
  const m1 = await p.evaluate(() => ({ sh: $('#sheetBody').scrollHeight, ch: $('#sheetBody').clientHeight, grid: $('#sheetBody .bgrid').offsetHeight, tile: $('#sheetBody .btile.asset').offsetHeight, bar: $('#sheetBody .assetbar').offsetHeight }));
  console.log('MEASURE', JSON.stringify(m0), JSON.stringify(m1), JSON.stringify(await p.evaluate(() => window.__sc)).slice(0, 1500));
  ok('scrolling stays where it was while pictures load', y0 > 300 && Math.abs(y1.top - y0) < 5 && y1.loaded > 10, `${y0} -> ${JSON.stringify(y1)}`);
  await p.screenshot({ path: SHOT('assets') });
  const bar0 = await p.evaluate(() => ({ cover: $('#asset-cover').disabled, gal: $('#asset-gallery').disabled }));
  ok('nothing selected: no cover, no gallery', bar0.cover && bar0.gal);
  // going through them like a gallery
  await p.click('#sheetBody .aview >> nth=0'); await p.waitForSelector('#viewer.assetview'); await p.waitForTimeout(600);
  const v0 = await p.$eval('#viewer header', e => e.innerText.replace(/\s+/g, ' '));
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500);
  const v1 = await p.$eval('#viewer header', e => e.innerText.replace(/\s+/g, ' '));
  const shown = await p.$eval('#viewer img', i => i.naturalWidth > 0);
  ok('the viewer goes through the pictures', /1 of 60/.test(v0) && /2 of 60/.test(v1) && shown, v0 + ' -> ' + v1);
  await p.click('#av-select'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok('a picture can be selected from the viewer', !(await p.$('#viewer')) && /1 picture selected/.test(await p.$eval('#sheetBody .assetbar', e => e.innerText)));
  await p.evaluate(() => closeSheet());
  // play: Enter in Ren'Py's text box, music from the archive, the main menu as cover
  await p.click('#game-play');
  await p.waitForFunction(() => GAME.loaded, null, { timeout: 180000 }).catch(() => { });
  const fr = p.frames().find(f => f !== p.mainFrame());
  let drawn = false; for (let i = 0; i < 40 && !drawn; i++) { await p.waitForTimeout(2500); drawn = await fr.evaluate(() => { const pre = document.getElementById('presplash'); return !pre || !pre.isConnected || pre.style.display === 'none'; }).catch(() => false); }
  ok('the archived game starts', drawn);
  const extracted = await fr.evaluate(() => { try { return FS.readdir('/game').filter(n => /\.(opus|ogg)$/.test(n)); } catch (e) { return String(e); } });
  ok('its archived music is there as plain files for Ren\'Py', Array.isArray(extracted) && extracted.length > 0, JSON.stringify(extracted));
  // wait for the main menu cover (taken by itself)
  console.log('EXEC', JSON.stringify(await fr.evaluate(async () => { const out = {}; try { out.screen = await window.renpy_exec('result = renpy.get_screen("main_menu") is not None'); } catch (e) { out.screenErr = String(e); } try { out.shot = await window.renpy_exec('result = renpy.screenshot("/tmp/x.png")'); } catch (e) { out.shotErr = String(e); } try { out.file = FS.stat('/tmp/x.png').size; } catch (e) { out.fileErr = String(e); } return out; })));
  let menuCov = false; for (let k = 0; k < 40 && !menuCov; k++) { await p.waitForTimeout(1500); menuCov = await p.evaluate(async id => (await S.gal(id)).game.coverBy === 'menu', gid); }
  ok('the main menu became the cover by itself', menuCov, `before: ${cov0}`);
  console.log('COVER@menu', JSON.stringify(await p.evaluate(async id => { const g = await S.gal(id); return [g.game.coverBy, Object.values(g.meta)[0][2]]; }, gid)));
  // Enter in the text box (Ren'Py's own web text box, as renpy.input shows it)
  await fr.evaluate(() => window.startInput('What is your name?', '', '', '', false));
  await p.waitForTimeout(400);
  await p.keyboard.type('Sylvie'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  const inp = await fr.evaluate(() => ({ result: window.inputResult, hidden: document.getElementById('inputDiv').classList.contains('hidden') }));
  ok('Enter in the game\'s text box sends the name', inp.result === 'Sylvie', JSON.stringify(inp));
  try { await fr.evaluate(() => window.endInput && window.endInput()); } catch (e) { }
  // music: click Start like a person; the story plays music from the archive
  await fr.evaluate(() => { window.__aud = { dec: 0, start: 0 }; const od = BaseAudioContext.prototype.decodeAudioData; BaseAudioContext.prototype.decodeAudioData = function (buf, ok2, bad) { return od.call(this, buf, x => { __aud.dec++; ok2 && ok2(x); }, e => { bad && bad(e); }); }; const os = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function () { __aud.start++; return os.apply(this, arguments); }; });
  const box = await (await p.$('#gamebox iframe')).boundingBox();
  await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); await p.waitForTimeout(7000);
  const aud = await fr.evaluate(() => ({ ...window.__aud, state: window.renpyAudio && renpyAudio.context ? renpyAudio.context.state : 'none' }));
  ok('music from the archive is decoded and plays', aud.dec > 0 && aud.start > 0 && aud.state === 'running', JSON.stringify(aud));
  await p.screenshot({ path: SHOT('story') });
  console.log('COVER@beforeleave', JSON.stringify(await p.evaluate(async id => { const g = await S.gal(id); return [g.game.coverBy, Object.values(g.meta)[0][2]]; }, gid)));
  await p.click('#gamebox .gameexit'); await p.waitForSelector('.askyes'); await p.click('.askyes button:has-text("Leave")'); await p.waitForTimeout(1200);
  console.log('COVER@afterleave', JSON.stringify(await p.evaluate(async id => { const g = await S.gal(id); return [g.game.coverBy, Object.values(g.meta)[0][2]]; }, gid)));
  // one picture selected: it can be the cover
  await p.click('#game-assets'); await p.waitForSelector('#sheetBody .btile.asset', { timeout: 60000 }); await p.waitForTimeout(800);
  await p.fill('#sheetBody input.search', 'bg uni'); await p.waitForTimeout(800);
  await p.click('#sheetBody .btile.asset >> nth=0');
  ok('one selected: cover and gallery are both offered', await p.evaluate(() => !$('#asset-cover').disabled && !$('#asset-gallery').disabled));
  await p.click('#asset-cover'); await p.waitForSelector('#crop-use', { timeout: 30000 }); await p.waitForTimeout(500);
  const fb = await (await p.$('.cropframe')).boundingBox();
  await p.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await p.mouse.down(); await p.mouse.move(fb.x + fb.width / 2 - 80, fb.y + fb.height / 2, { steps: 5 }); await p.mouse.up();
  await p.screenshot({ path: SHOT('crop') });
  await p.click('#crop-use'); await p.waitForTimeout(2000);
  const c2 = await p.evaluate(async id => { const g = await S.gal(id); const m = Object.values(g.meta)[0]; return { by: g.game.coverBy, name: m[2], n: Object.keys(g.meta).length, ratio: +(m[0] / m[1]).toFixed(3), whole: !!g.game.coverOrig && g.game.coverOrig !== g.cover }; }, gid);
  ok('a picture from the archive can be the cover, showing the part chosen', c2.by === 'user' && /bg uni/.test(c2.name) && c2.n === 1 && Math.abs(c2.ratio - 0.667) < 0.01 && c2.whole, JSON.stringify(c2));
  await p.click('#game-adjust'); await p.waitForSelector('#crop-use', { timeout: 30000 }); await p.click('#sheetBody button:has-text("Whole picture")'); await p.waitForTimeout(2000);
  const c3 = await p.evaluate(async id => { const g = await S.gal(id); const m = Object.values(g.meta)[0]; return +(m[0] / m[1]).toFixed(3); }, gid);
  ok('Adjust the cover starts again from the whole picture', c3 > 1.5, c3);
  // saves from the computer: the whole RenPy folder, with another game's saves and the signing keys
  const [ch2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#game-import-saves')]);
  await ch2.setFiles('/tmp/claude-0/RenPy');
  await p.waitForSelector('.askyes', { timeout: 30000 });
  const askTxt = await p.$eval('.askyes', e => e.innerText.replace(/\s+/g, ' '));
  ok('it picks this game\'s saves out of the RenPy folder', /1 save will be added/.test(askTxt), askTxt);
  await p.click('.askyes button:has-text("Import")'); await p.waitForTimeout(2500);
  const sv2 = await p.evaluate(async id => { const g = await S.gal(id); const idx = await rpyGetJSON(g.game.sv); const k = idx['home/web_user/.renpy/tokens/security_keys.txt']; return { files: Object.keys(idx), keys: k ? new TextDecoder().decode(await rpyRead(k.c, k.s)) : '' }; }, gid);
  ok('the save goes where Ren\'Py looks for this game\'s saves', sv2.files.includes('home/web_user/.renpy/the_question-7/1-2-LT1.save') && !sv2.files.some(f => /OtherGame/.test(f)), sv2.files.join(', '));
  ok('the saves already in the app are kept', sv2.files.includes('home/web_user/.renpy/the_question-7/persistent'));
  ok('the computer\'s key is added, so Ren\'Py trusts the save', /verifying-key VKCOMPUTER/.test(sv2.keys) && /signing-key/.test(sv2.keys) && !/SKCOMPUTER/.test(sv2.keys), sv2.keys.slice(0, 200));
  // several selected: a gallery of them (only a gallery, not a cover)
  await p.click('#game-assets'); await p.waitForSelector('#sheetBody .btile.asset', { timeout: 60000 }); await p.waitForTimeout(800);
  await p.fill('#sheetBody input.search', 'images/'); await p.waitForTimeout(800);
  const nImg = await p.$$eval('#sheetBody .btile.asset', a => a.length);
  await p.click('#sheetBody .assetbar button:has-text("Select all")');
  ok('several selected: only a gallery is offered', await p.evaluate(() => $('#asset-cover').disabled && !$('#asset-gallery').disabled));
  await p.click('#asset-gallery'); await p.waitForSelector('#asset-name');
  await p.fill('#asset-name', 'Question art'); await p.click('#sheetBody .assetbar button:has-text("Make it")');
  await p.waitForFunction(() => CUR.view === 'detail' && !document.querySelector('#game-play'), null, { timeout: 120000 }).catch(() => { });
  const made = await p.evaluate(async () => { const g = await S.gal(CUR.params.id); return g && { title: g.title, pages: g.chapters.reduce((n, c) => n + c.pages.length, 0), folders: g.chapters.length - 1, game: !!g.game }; });
  ok('the selected pictures became a gallery', made && made.title === 'Question art' && made.pages === nImg && !made.game, JSON.stringify(made) + ' of ' + nImg);
  await p.evaluate(id => go('detail', { id }), gid); await p.waitForTimeout(800);
  // into a gallery's folder with Move
  await p.click('#game-move'); await p.waitForSelector('#sheetBody .chrow');
  await p.click('#sheetBody .chrow:has-text("Sample")'); await p.waitForTimeout(400);
  const folderName = await p.$$eval('#sheetBody .chrow .t', a => a.map(e => e.textContent)[1]);
  await p.click('#sheetBody .chrow >> nth=1'); await p.waitForTimeout(1500);
  const placed = await p.evaluate(async id => { const gs = await S.gals(); const sm = gs.find(x => x.sample); const c = sm.chapters.find(c => (c.games || []).includes(id)); return { inFolder: c ? c.title : null, at: (await S.gal(id)).game.at, sample: sm.id, ch: c && c.id }; }, gid);
  ok('Move puts the game in the chosen folder', placed.inFolder === folderName, JSON.stringify(placed));
  await p.evaluate(() => go('library')); await p.waitForTimeout(800);
  const lib = await p.$$eval('#v-library .card h3', a => a.map(e => e.textContent));
  ok('a game in a folder is not shown loose in the library', !lib.includes('the question'), lib.join(', '));
  await p.evaluate(pl => go('detail', { id: pl.sample, folder: pl.ch }), placed); await p.waitForTimeout(1200);
  const tile = await p.$('#v-detail .btile[aria-label="Game the question"]');
  ok('the folder shows the game', !!tile);
  await p.screenshot({ path: SHOT('folder') });
  await tile.click(); await p.waitForTimeout(800);
  ok('its tile opens the game', await p.evaluate(id => CUR.view === 'detail' && CUR.params.id === id && !!$('#game-play'), gid));
  await p.click('#v-detail button[aria-label="Back"]'); await p.waitForTimeout(800);
  ok('Back goes to the folder it is in', await p.evaluate(pl => CUR.params.id === pl.sample && CUR.params.folder === pl.ch, placed));
  // a game dropped while a folder is open goes there
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'zipdrop'; i.style.display = 'none'; document.body.append(i); });
  await p.setInputFiles('#zipdrop', ZIP7);
  await p.evaluate(() => handleDrop([...document.getElementById('zipdrop').files]));
  await p.waitForSelector('#game-add', { timeout: 60000 });
  const seg = await p.$eval('#sheetBody .seg', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  ok('dropping a game on an open folder offers that folder', /In “/.test(seg) && /on its own/.test(seg), seg);
  await p.click('#game-add'); await p.waitForSelector('.askyes', { timeout: 120000 }); await p.click('.askyes button:has-text("Cancel")'); await p.waitForTimeout(1500);
  const n = await p.evaluate(async pl => { const sm = await S.gal(pl.sample); return sm.chapters.find(c => c.id === pl.ch).games.length; }, placed);
  ok('the dropped game went into the folder', n === 2, n);
  // Move back to the library
  await p.evaluate(id => go('detail', { id }), gid); await p.waitForTimeout(800);
  await p.click('#game-move'); await p.waitForSelector('#sheetBody .chrow'); await p.click('#sheetBody .chrow:has-text("In the library")'); await p.waitForTimeout(1200);
  await p.evaluate(() => go('library')); await p.waitForTimeout(800);
  ok('moved back, it is in the library again', (await p.$$eval('#v-library .card h3', a => a.map(e => e.textContent))).includes('the question'));
  errs.splice(0, errs.length, ...errs.filter(e => !/serviceWorker/.test(e))); ok('no errors in the app', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
