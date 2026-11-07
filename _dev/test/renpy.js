// Ren'Py games: add a normal PC download through Add -> "Add a Ren'Py game", download Ren'Py when asked, play it,
// make a save, leave, and check the save came back encrypted; then play again and see the save is there.
// GAME=8.5.3|8.1.3|7.8.7 picks the test game (Ren'Py's demo, built by the "Ren'Py runtimes" workflow).
const { chromium } = require('/home/claude/tankobon/test/node_modules/playwright');
const fs = require('fs'), path = require('path');
const GV = process.env.GAME || '8.5.3';
const GAMEDIR = process.env.GAMEDIR || `/tmp/claude-0/games/q${GV}/the_question-7.0-pc`;
const RT = '/home/claude/reader/renpy/';
const SHOT = n => `/tmp/claude-0/shots/renpy-${GV}${process.env.RT ? '-on-' + process.env.RT : ''}-${n}.png`;
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
(async () => {
  fs.mkdirSync('/tmp/claude-0/shots', { recursive: true });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'].concat(process.env.AUDIO ? ['--autoplay-policy=document-user-activation-required'] : ['--autoplay-policy=no-user-gesture-required']) });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const net = [];
  await ctx.route('https://theoneechoz.github.io/Reader/renpy/**', r => {
    const rel = decodeURIComponent(new URL(r.request().url()).pathname.replace('/Reader/renpy/', '')); net.push(rel);
    const f = path.join(RT, rel); if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'no' });
    r.fulfill({ status: 200, body: fs.readFileSync(f), contentType: f.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  });
  // anything else leaving the machine is noted (the game must not reach the network)
  const outside = []; ctx.on('request', rq => { const u = rq.url(); if (!/^(http:\/\/localhost|blob:|data:|about:)/.test(u) && !u.includes('/Reader/renpy/') && !u.includes('fonts.g')) outside.push(u); });
  const p = await ctx.newPage(); const errs = [];
  const allLog = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { allLog.push(m.text().slice(0, 300)); if (m.type() === 'error' || /game:/.test(m.text())) errs.push('console: ' + m.text().slice(0, 300)); });
  await p.goto('http://localhost:8768/?stay'); await p.waitForSelector('#user1');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'user1').catch(() => { });
  await p.fill('#user1', 'player'); await p.fill('#pw1', 'playpass12'); await p.fill('#pw2', 'playpass12'); await p.click('#v-lock button[type=submit]');
  await p.waitForSelector('#v-library:not([hidden])', { timeout: 30000 }); await p.waitForTimeout(1500);
  // Add -> Add a Ren'Py game -> folder picker
  await p.click('#v-library button:has-text("Add")');
  await p.waitForSelector('#add-game');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-game')]);
  await chooser.setFiles(path.dirname(GAMEDIR) + '/' + path.basename(GAMEDIR));
  await p.waitForSelector('#game-add', { timeout: 60000 });
  const sheet = await p.$eval('#sheetBody', e => e.innerText.replace(/\s+/g, ' '));
  ok('the game is recognised', /Add the game/.test(sheet), sheet.slice(0, 300));
  ok(`its Ren'Py version is found (${GV})`, sheet.includes(`Made with Ren'Py ${GV}`));
  ok('it says which Ren\'Py plays it, and that it asks before downloading', /It will play with Ren'Py [\d.]+ \(about \d+ MB, downloaded once after asking you\)/.test(sheet));
  ok('the name comes from the folder', (await p.inputValue('#game-name-0')) === 'the question', await p.inputValue('#game-name-0'));
  await p.screenshot({ path: SHOT('1-add') });
  ok('nothing downloaded before asking', net.length === 0, net.join(','));
  await p.click('#game-add');
  // after adding: the download question
  await p.waitForSelector('.askyes', { timeout: 120000 });
  const ask = await p.$eval('.askyes', e => e.innerText.replace(/\s+/g, ' '));
  ok('asks before downloading Ren\'Py', /Download Ren'Py [\d.]+\?/.test(ask) && /MB/.test(ask), ask.slice(0, 200));
  await p.screenshot({ path: SHOT('2-ask') });
  ok('still nothing downloaded while asking', net.length === 0);
  if (process.env.RT) { // play it with another Ren'Py: say no, pick the version on the game's page, then Play asks again
    await p.click('.askyes button:has-text("Cancel")'); await p.waitForSelector('#game-rt', { timeout: 30000 });
    await p.selectOption('#game-rt', process.env.RT); await p.waitForTimeout(1500);
    await p.click('#game-play'); await p.waitForSelector('.askyes', { timeout: 30000 });
    ok('Play asks before downloading too', /Download Ren'Py/.test(await p.$eval('.askyes', e => e.innerText)));
  }
  await p.click('.askyes button:has-text("Download")');
  await p.waitForFunction(() => !document.querySelector('#sheet.open, #sheet[open]') && /ready/.test(document.body.innerText), null, { timeout: 180000 }).catch(() => { });
  await p.waitForTimeout(1500);
  const st = await p.evaluate(async () => {
    const g = (await S.gals()).find(x => x.game); const reg = await RPY.reg();
    const raw = await ST.get('images', g.game.list);
    return { title: g.title, rt: g.game.rt, ver: g.game.ver, files: g.game.files, size: g.game.size, downloaded: Object.keys(reg).filter(v => reg[v].done), listEncrypted: !!(raw && raw.e && !raw.blob), id: g.id };
  });
  ok('the game is stored', st.files > 10 && st.size > 1e6, JSON.stringify(st));
  ok('its file list is encrypted', st.listEncrypted);
  ok('Ren\'Py is downloaded and kept', st.downloaded.includes(st.rt), st.downloaded.join(','));
  ok('only the website\'s Ren\'Py files were fetched', net.every(n => n.startsWith(st.rt + '/')), [...new Set(net)].join(', '));
  // no plain game files anywhere in this site's storage
  const plain = await p.evaluate(async () => {
    const all = []; for (const s of ['images', 'thumbs', 'galleries', 'meta']) for (const k of await DB.keys(s)) { const r = await DB.get(s, k); if (r && r.blob) all.push(s + ':' + k); else if (s === 'meta' && r && r.v && JSON.stringify(r.v).includes('the_question')) all.push('meta:' + k); }
    return all;
  });
  ok('nothing about the game is stored unencrypted', plain.length === 0, plain.join(','));
  await p.screenshot({ path: SHOT('3-detail') });
  if (!process.env.RT) ok('the game page shows Play', !!(await p.$('#game-play')));
  // play
  const t0 = Date.now();
  if (!process.env.RT) await p.click('#game-play');
  await p.waitForSelector('#gamebox iframe', { timeout: 60000 });
  await p.waitForFunction(() => GAME.loaded, null, { timeout: 180000 }).catch(() => { });
  if (process.env.DBG && !(await p.evaluate(() => GAME.loaded))) { console.log(allLog.slice(-60).join('\n')); process.exit(2); }
  ok('the game files reached the player', await p.evaluate(() => GAME.loaded), ((Date.now() - t0) / 1000).toFixed(1) + 's');
  const fr = p.frames().find(f => f !== p.mainFrame());
  // wait for Ren'Py to draw its main menu
  let drawn = false;
  for (let i = 0; i < (process.env.DBG ? 12 : 40) && !drawn; i++) {
    await p.waitForTimeout(3000);
    drawn = await fr.evaluate(() => { const c = document.getElementById('canvas'); const pre = document.getElementById('presplash'); return !!(c && c.width > 300 && (!pre || !pre.isConnected || pre.style.display === 'none')); }).catch(() => false);
  }
  if (process.env.DBG && !drawn) { console.log(allLog.slice(-50).join('\n')); }
  await p.waitForTimeout(4000);
  await p.screenshot({ path: SHOT('4-menu') });
  ok('Ren\'Py started and drew the game', drawn, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (process.env.AUDIO) { // sound: a real click in the game (like a person), then start the story, which plays music
    const st0 = await fr.evaluate(() => window.renpyAudio && renpyAudio.context ? renpyAudio.context.state : 'no webaudio');
    await fr.evaluate(() => { window.__q = []; if (window.renpyAudio) { const oq = renpyAudio.queue; renpyAudio.queue = function (ch, file, name, ...rest) { const arr = rest[rest.length - 1]; __q.push([ch, String(file).slice(0, 60), name, arr ? arr.length : null]); try { return oq.apply(this, arguments); } catch (e) { __q.push('ERR ' + e.message); throw e; } }; } });
    await fr.evaluate(() => { window.__aud = { dec: 0, fail: 0, start: 0 }; const od = BaseAudioContext.prototype.decodeAudioData; BaseAudioContext.prototype.decodeAudioData = function (buf, ok, bad) { return od.call(this, buf, x => { __aud.dec++; ok && ok(x); }, e => { __aud.fail++; bad && bad(e); }); }; const os = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function () { __aud.start++; return os.apply(this, arguments); }; });
    const box = await (await p.$('#gamebox iframe')).boundingBox();
    await p.mouse.click(box.x + box.width * 0.057, box.y + box.height * 0.40); // "Start" on the main menu
    await p.waitForTimeout(6000);
    const st1 = await fr.evaluate(() => window.renpyAudio && renpyAudio.context ? renpyAudio.context.state : (window.Module && Module.SDL2 && Module.SDL2.audioContext ? 'sdl ' + Module.SDL2.audioContext.state + ' ' + (Module.SDL2.audio && Module.SDL2.audio.scriptProcessorNode ? 'playing-node' : 'no-node') : 'no audio'));
    await p.screenshot({ path: SHOT('audio') });
    const aud = await fr.evaluate(() => window.__aud);
    console.log('QUEUE CALLS', JSON.stringify(await fr.evaluate(() => window.__q)));
    if (process.env.DBG) console.log('RENPY LOG:\n' + (await fr.evaluate(() => { try { return new TextDecoder().decode(FS.readFile('/log.txt')).split('\n').slice(-40).join('\n'); } catch (e) { return 'no log ' + e; } })));
    console.log('audio before click:', st0, '| after click:', st1, '| decoded', JSON.stringify(aud));
    ok('the story\'s music was decoded and started', aud && aud.dec > 0 && aud.start > 0, JSON.stringify(aud));
    console.log(allLog.filter(l => /audio|sound|decod|AudioContext|music/i.test(l)).slice(-15).join('\n'));
    ok('sound is allowed to play after a click in the game', st1 === 'running', st0 + ' -> ' + st1);
    await b.close(); process.exit(fails ? 1 : 0);
  }
  const sealed = await fr.evaluate(async () => {
    let fetchBlocked = false; try { await fetch('https://example.com/'); } catch (e) { fetchBlocked = true; }
    let storageBlocked = false; try { localStorage.setItem('x', '1'); } catch (e) { storageBlocked = true; }
    let idbBlocked = false; try { indexedDB.open('x'); } catch (e) { idbBlocked = true; }
    return { fetchBlocked, storageBlocked, idbBlocked, origin: String(location.origin) };
  });
  ok('the game cannot reach the network', sealed.fetchBlocked);
  ok('the game cannot keep its own storage', sealed.storageBlocked && sealed.idbBlocked, JSON.stringify(sealed));
  // make a save the way Ren'Py does (in its own Python), then let it sync
  const saved = await fr.evaluate(() => new Promise(res => { setTimeout(() => res('timeout'), 20000);
    const py = 'renpy.save("1-1", "test save"); renpy.persistent._tkb_test = 42; renpy.save_persistent()';
    if (window.renpy_exec) window.renpy_exec(py).then(() => res('exec'), e => res('error ' + e));
    else if (Module && Module.ccall) { try { Module.ccall('PyRun_SimpleString', 'number', ['string'], ['import renpy; ' + py.replace(/renpy\./g, 'renpy.exports.') ]); res('ccall'); } catch (e) { res('error ' + e); } }
    else res('no way');
  }));
  await p.waitForTimeout(4000);
  if (process.env.DBG) console.log(allLog.slice(-25).join('\n'));
  const sv = await p.evaluate(async id => { const g = await S.gal(id); const idx = await rpyGetJSON(g.game.sv); const raw = await ST.get('images', g.game.sv); return { files: Object.keys(idx || {}), enc: !!(raw && raw.e) }; }, st.id);
  // (with another Ren'Py than the game's own, saving from the main menu may be refused: then Ren'Py's persistent data is the save that must come back)
  const savedOK = sv.files.some(f => /1-1.*\.save$/.test(f)) || (!!process.env.RT && sv.files.some(f => /\/persistent$/.test(f)));
  ok('a save made in the game came back to the app', savedOK, saved + ' :: ' + sv.files.join(', '));
  const realSave = sv.files.some(f => /1-1.*\.save$/.test(f));
  ok('saves are kept encrypted', sv.enc);
  // leave (the button asks), then play again: the save must be there
  await p.click('#gamebox .gameexit'); await p.waitForFunction(() => !document.getElementById('gamebox'), null, { timeout: 15000 }).catch(() => { });
  await p.waitForFunction(() => !document.getElementById('gamebox'), null, { timeout: 10000 }).catch(() => { });
  ok('leaving closes the player', !(await p.$('#gamebox')));
  await p.waitForTimeout(800);
  const detail = await p.$eval('#v-detail', e => e.innerText.replace(/\s+/g, ' '));
  if (realSave) ok('the game page counts the save', /1 saved game/.test(detail), detail.slice(0, 400));
  await p.click('#game-play');
  await p.waitForFunction(() => GAME.loaded, null, { timeout: 180000 }).catch(() => { });
  const fr2 = p.frames().find(f => f !== p.mainFrame());
  let back = null;
  for (let i = 0; i < 30 && !back; i++) { await p.waitForTimeout(3000); back = await fr2.evaluate(() => { try { return FS.readdir('/home/web_user/.renpy').filter(n => n[0] !== '.').map(d => { try { return d + ':' + FS.readdir('/home/web_user/.renpy/' + d).join('|'); } catch (e) { return d; } }).join(' ; ') || null; } catch (e) { return null; } }).catch(() => null); }
  ok('the save is back in the game the next time', !!back && (realSave ? /1-1/ : /persistent/).test(back), String(back).slice(0, 300));
  await p.screenshot({ path: SHOT('5-again') });
  ok('no request left the machine', outside.length === 0, outside.slice(0, 5).join(', '));
  console.log('errors (first 12):\n' + errs.slice(0, 12).join('\n'));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); process.exit(fails ? 1 : 0);
})();
