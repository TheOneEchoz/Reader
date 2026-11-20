/* Opening a game: the player screen, saves */
//>> js/90-open.js#0
let gameSaveChain = Promise.resolve();
const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
function persistSaves(gid, files, opts = {}) { gameSaveChain = gameSaveChain.then(() => doPersistSaves(gid, files, opts)).catch(e => console.error('saves', e)); return gameSaveChain; }
async function doPersistSaves(gid, files, opts = {}) {
  if (!files.length && !opts.allowEmpty) return; // never wipe the saves because nothing was listed (only an explicit delete may)
  const g = await S.gal(gid); if (!isGame(g)) return;
  const idx = (await rpyGetJSON(g.game.sv)) || {}, seen = new Set(); let changed = false;
  for (const f of files) {
    seen.add(f.p);
    const hsh = hex(await crypto.subtle.digest('SHA-256', f.buf)), old = idx[f.p];
    if (old && old.h === hsh) continue;
    const c = []; for (let off = 0; off < f.buf.byteLength || !c.length; off += RPY_CHUNK) { c.push(await rpyPut(f.buf.slice(off, off + RPY_CHUNK))); if (!f.buf.byteLength) break; }
    if (old) await ST.delMany('images', old.c).catch(() => { });
    idx[f.p] = { s: f.buf.byteLength, c, h: hsh, t: Date.now() }; changed = true;
  }
  const gone = [];
  for (const p of Object.keys(idx)) if (!seen.has(p)) { await ST.delMany('images', idx[p].c).catch(() => { }); delete idx[p]; changed = true; gone.push(p); }
  if (changed) await rpyPutJSON(idx, g.game.sv);
  if (gone.length) { const cur = await S.gal(gid); cur.game.svGone = cur.game.svGone || {}; gone.forEach(p => cur.game.svGone[p] = Date.now()); await saveGallery(cur); }
  if (changed) Sync.savesChanged();
}

/* ---------- a game's saves, shared with your other devices that have the same game ----------
   The same game has its own copy on each device, so it is found by its save folder name (or its name).
   Each save file carries the time it was written: the newer one wins; a save deleted later than it was written stays deleted. */
const gsvKey = g => g.game.saveDir ? 'sd:' + g.game.saveDir.toLowerCase() : 't:' + gameKey(g.game.root ? rpyTitle(g.game.root) : g.title);
const gsvB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const gsvSyncable = p => !/\/tokens\//.test(p); // the signing keys stay on each device
//<<

//>> js/90-open.js#1
async function openGame(id, cont) {
  GAME.lastGameId = id;
  try { await flowRepair(id); } catch (e) { console.warn('flow repair', e); }
  const g = await S.gal(id);
  if (!isGame(g)) return go('library', {}, true);
  if (!EXP) { toast('Games can be played in the experimental version of the app for now.', 3500); return back('detail', { id }); }
  if (g.game.engine === 'html') return openHtmlGame(id, g, cont);
  GAME.legacyGraphReady = false; GAME.legacyGraphError = null;
  GAME.legacyGraphChunks = []; GAME.legacyGraphWire = null; GAME.legacyGraphTransport = null;
  GAME.legacyNodesCache = null; GAME.graphq = new Map();
  GAME.errors = []; GAME.errToastAt = 0;
  const v = g.game.rt;
  const compatProfile = TKB_COMPAT.profile(g.game);
  const bootMode = TKB_COMPAT.bootMode(g.game);
  const safeBoot = bootMode === 'safe';
  const runtimeIssues = [];
  const legacyShimEvents = [];
  const firstRuntimeIssues = [], firstUsefulRuntimeIssues = [], significantRuntimeIssues = [], capturedRuntimeLogs = new Map();
  let runtimeIssueCount = 0, runtimeExit = false, shutdownHint = false, exitMode = '';
  let latestRuntimeProbe = null, probeWaiter = null;
  const isCleanupOutput = value => /(?:^|:\s*)#?\s*(?:cleanup(?:\[|\s)|cleanup sys|cleanup __builtin__|cleanup ints|cleanup floats)/i.test(value);
  // Python -v emits hundreds of normal 'import ... errors' messages; these
  // are module names, not ImportError exceptions or actual game failures.
  const isImportChatter = value => /^(?:stdout|stderr):\s*(?:import\s+[\w.]+\s+#|#\s*(?:.*\.pyo has bad mtime|wrote\s+|installing |installed |clear\s+sys\.|cleanup\b))/i.test(value);
  const recordRuntimeIssue = (kind, message) => {
    const issue = `${String(kind || 'runtime')}: ${String(message || '').slice(0, 1800)}`;
    runtimeIssueCount++;
    if (firstRuntimeIssues.length < 24) firstRuntimeIssues.push(issue);
    runtimeIssues.push(issue); if (runtimeIssues.length > 30) runtimeIssues.shift();
    if (!isCleanupOutput(issue) && !isImportChatter(issue) && firstUsefulRuntimeIssues.length < 24) firstUsefulRuntimeIssues.push(issue);
    // '# clear sys.last_traceback', 'import traceback', and Python -v output
    // are normal interpreter chatter; they are NOT startup failures.
    if (!isCleanupOutput(issue) && !isImportChatter(issue) && (/(?:^|[\s:])(?:Traceback \(most recent call last\)|[\w.]+(?:Error|Exception):|abort\(|fatal\b|uncaught\b|cannot open\b|failed to\b)/i.test(issue) || !/^(?:stdout|stderr):/i.test(issue))) {
      significantRuntimeIssues.push(issue);
      if (significantRuntimeIssues.length > 32) significantRuntimeIssues.shift();
    }
    return issue;
  };
  if (!(await RPY.has(v)) && !(await rpyAskDownload(v, `To play “${g.title}”, the app needs Ren'Py ${v}.`))) return back('detail', { id });
  if (CUR.view !== 'game' || CUR.params.id !== id) return;
  const wantLegacySnapshot = !!GAME.legacyNodesRequested;
  closeGame();
  GAME.legacyNodesRequested = wantLegacySnapshot;

  const lbl = h('div', { class: 'num' }, 'Opening…'), bar = h('div', { class: 'bar' }, h('i', { style: 'width:0%' }));
  const cover = h('div', { class: 'gamecover' }, thumbImg(coverId(g), ''));
  // The stored build version may be older than our browser-runtime catalogue.
  // Show this explicitly instead of implying the substituted version is compatible.
  const builtWith = String(g.game.ver || '').trim();
  const unsupportedBuild = builtWith && vcmp(builtWith, '7.3.0') < 0;
  const compatibility = h('div', { class: 'tkb-startup-compat', hidden: !unsupportedBuild },
    unsupportedBuild ? `Experimental ${compatProfile.name}: game ${builtWith} using web runtime ${v}, ${bootMode} boot. There is no official 6.99 browser runtime; startup may fail. You can change boot behavior in Runtime / Compatibility.` : '');
  const stallDetails = h('div', { class: 'tkb-startup-detail' }, '');
  let startupStage = 'Waiting for the runtime';
  let startupAt = Date.now();
  let stallShown = false, startupStopped = false, startupReady = false, extraFrameLoads = 0;
  const startupPulse = stage => {
    startupStage = String(stage); startupAt = Date.now();
    // A subsequent progress/status event must NEVER erase a failure panel.
    // Only a genuine ready event or an explicit Retry/Back closes it.
  };
  const showStartupIssue = (details, terminal = false) => {
    if (terminal) startupStopped = true;
    stallShown = true;
    if (details) stallDetails.textContent = details;
    stall.hidden = false;
    if (terminal) bar.parentNode.classList.remove('busy');
  };
  // Game-directed quit is not a crash. The standalone shell's back() updates
  // routing state but does not dispose the canvas/iframe, so an already-quit
  // interpreter used to appear as a permanently frozen game. Close it here.
  let normalExitHandled = false, quitFallback = null;
  const returnAfterGameQuit = async reason => {
    if (normalExitHandled || GAME.frame !== frame) return;
    normalExitHandled = true;
    clearTimeout(quitFallback);
    clearInterval(GAME.startWatch); GAME.startWatch = null;
    // The Emscripten frame posts its final fschange/saves before its exit.
    // Wait for persistence before removing the iframe, with a bounded wait
    // so a broken storage backend can never trap the user in the game.
    const persisted = Promise.allSettled([TKB_VFS.settle(id), gameSaveChain]);
    await Promise.race([persisted, new Promise(resolve => setTimeout(resolve, 3500))]);
    if (GAME.frame !== frame) return;
    if (typeof closeSheet === 'function') closeSheet();
    closeGame();
    back('detail', { id });
    if (window.ENGINE && window.ENGINE.draw) await window.ENGINE.draw();
    toast(reason || 'The game ended. You can launch it again from the library.', 4200);
  };
  const retryStartup = h('button', { type: 'button', class: 'btn small', onclick: () => {
    if (!GAME.g || GAME.g.id !== id) return;
    openGame(id, false).catch(e => console.error('Startup retry', e));
  } }, 'Retry startup');
  const leaveStartup = h('button', { type: 'button', class: 'btn small', onclick: () => {
    closeGame();
    if (window.ENGINE && window.ENGINE.draw) window.ENGINE.draw();
  } }, 'Back to library');
  // Diagnostics remain available from the beginning of boot, even if the
  // runtime disappears, clipboard permission fails, or the startup UI blinks.
  const diagText = h('textarea', { class: 'tkb-startup-report-text', readonly: true, spellcheck: false, 'aria-label': 'Startup diagnostics text' });
  const diagCopy = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    try { await navigator.clipboard.writeText(diagText.value); toast('Startup diagnostics copied.', 2200); }
    catch (_) { diagText.focus(); diagText.select(); try { document.execCommand('copy'); } catch (_) { /* user can select manually */ } }
  } }, 'Copy text');
  const diagDownload = h('button', { type: 'button', class: 'btn small', onclick: () => {
    const url = URL.createObjectURL(new Blob([diagText.value], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'tankobon-startup-' + String(g.title || 'game').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 45) + '.txt';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  } }, 'Save .txt');
  const diagClose = h('button', { type: 'button', class: 'btn small', onclick: () => { diagPanel.hidden = true; } }, 'Close');
  const diagPanel = h('div', { class: 'tkb-startup-report', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Startup diagnostics' },
    h('div', { class: 'tkb-startup-report-inner' }, h('h2', {}, 'Startup diagnostics'),
      h('p', {}, 'This report stays available while the game is stuck. Copy it or save it as a text file.'),
      diagText, h('div', { class: 'tkb-startup-report-actions' }, diagCopy, diagDownload, diagClose)));
  const makeStartupReport = () => {
    const runtimeLogText = [...capturedRuntimeLogs].map(([path, value]) => `--- ${path} ---\n${value}`).join('\n');
    return `Tankōbon startup diagnostics\nGame: ${g.title}\nGame Ren'Py: ${builtWith || 'unknown'}\nRuntime: ${v}\nCompatibility profile: ${compatProfile.id} (${compatProfile.state})\nBoot mode: ${bootMode}\nLast stage: ${startupStage}\nExit callback received: ${runtimeExit}${exitMode ? ' (' + exitMode + ')' : ''}\nShutdown suspected (Bye!): ${shutdownHint}\nStartup failure observed: ${startupStopped}\nRecovery panel opened: ${stallShown}\nUnexpected frame reloads: ${extraFrameLoads}\nStage idle: ${Math.round((Date.now() - startupAt) / 1000)}s\nPage hidden: ${document.hidden}\nGame files loaded: ${!!GAME.loaded}\nRuntime messages: ${runtimeIssueCount}\nLegacy compatibility modules:\n${legacyShimEvents.join('\n') || '(none reported)'}\nFirst runtime messages:\n${firstRuntimeIssues.join('\n') || '(none captured)'}\nFirst non-chatter messages:\n${firstUsefulRuntimeIssues.join('\n') || '(none captured)'}\nSignificant messages (excluding Python cleanup):\n${significantRuntimeIssues.join('\n') || '(none captured)'}\nRecent messages:\n${runtimeIssues.slice(-10).join('\n') || '(none captured)'}\nRuntime health probe:\n${latestRuntimeProbe ? JSON.stringify(latestRuntimeProbe, null, 2) : '(no response from runtime)'}\nRuntime traceback and log files:\n${runtimeLogText || '(none captured)'}\nLegacy graph transfer: ${GAME.legacyGraphTransport || 'not completed'}
Legacy graph ready: ${!!GAME.legacyGraphReady}
Legacy graph error: ${GAME.legacyGraphError || '(none)'}
Engine: ${typeof ENGINE_VERSION === 'string' ? ENGINE_VERSION : 'unknown'}`;
  };
  const captureStartupReport = async () => {
    diagPanel.hidden = false;
    diagText.value = 'Gathering runtime state…';
    // The runtime may have already quit. Report generation never requires it.
    if (GAME.frame === frame && frame.contentWindow) {
      await new Promise(resolve => {
        const timer = setTimeout(() => { probeWaiter = null; resolve(); }, 900);
        probeWaiter = () => { clearTimeout(timer); probeWaiter = null; resolve(); };
        try { frame.contentWindow.postMessage({ t: 'runtimeprobe' }, '*'); }
        catch (_) { clearTimeout(timer); probeWaiter = null; resolve(); }
      });
    }
    diagText.value = makeStartupReport();
    diagText.focus(); diagText.select();
  };
  const copyStartup = h('button', { type: 'button', class: 'btn small', onclick: captureStartupReport }, 'View / copy diagnostics');
  const stall = h('div', { class: 'tkb-startup-stall', hidden: true },
    h('b', {}, 'The game may be stuck starting'),
    stallDetails,
    h('div', { class: 'tkb-startup-actions' }, retryStartup, leaveStartup, copyStartup));
  const diagAlways = h('button', { type: 'button', class: 'btn small tkb-startup-always', id: 'game-startup-diagnostics', onclick: captureStartupReport }, 'View startup diagnostics');
  const load = h('div', { class: 'gameload', role: 'status' }, cover, h('b', {}, g.title), compatibility,
    h('div', { class: 'progress' }, lbl, bar), diagAlways, stall);
  const frame = h('iframe', { title: g.title, sandbox: 'allow-scripts', allow: 'autoplay; gamepad', referrerpolicy: 'no-referrer' });
  // leaving or locking saves to the auto-save first
  const exit = h('button', { class: 'gameexit', 'aria-label': 'Leave the game (it is saved to the auto-save first)', title: 'Leave (saved to the auto-save)', onclick: async () => { exit.disabled = true; if (GAME.loaded && await gameAutosave()) toast('Saved to the auto-save.'); back('detail', { id }); } }, icon('x'));
  const lockB = h('button', { class: 'gameexit gamelock', 'aria-label': 'Lock the app (the game is saved to the auto-save first)', title: 'Lock (saved to the auto-save)', onclick: async () => { lockB.disabled = true; if (GAME.loaded) await gameAutosave(); lockNow(); } }, icon('lock'));
  /* what is on screen now: [layer, index, files] in drawing order, and what is playing */
  const onScreen = () => new Promise(res => { GAME.onScreen = (l, pl) => { GAME.onScreen = null; res(l ? { ents: l, playing: pl || [] } : null); }; frame.contentWindow.postMessage({ t: 'onscreen' }, '*'); setTimeout(() => { if (GAME.onScreen) { GAME.onScreen = null; res(null); } }, 8000); });
  // the chosen pictures, drawn together as they are on screen: everything on screen that uses one of them, in drawing order
  const composer = ents => sel => new Promise((res, rej) => {
    const want = new Set(sel.map(n => n.toLowerCase())), picks = ents.filter(e => e[2].some(f => want.has(f.toLowerCase()))).map(e => [e[0], e[1]]);
    GAME.onCompose = b => { GAME.onCompose = null; b ? res(new Uint8Array(b)) : rej(new Error('The game could not draw them.')); };
    frame.contentWindow.postMessage({ t: 'compose', picks }, '*'); setTimeout(() => { if (GAME.onCompose) { GAME.onCompose = null; rej(new Error('The game did not answer.')); } }, 10000);
  });
  // only the art: what is shown in the scene (backgrounds, characters, effects), not menus, text boxes or buttons
  const artOf = ents => [...new Set(ents.filter(e => !['screens', 'overlay', 'transient'].includes(e[0])).flatMap(e => e[2]).filter(f => !/^gui\//i.test(f)))];
  // the music and sounds playing now ("<loop 2.0>music.ogg" -> music.ogg), to go with the pictures
  const soundsOf = playing => [...new Map(playing.map(([ch, f]) => [String(f).replace(/^<[^>]*>/, ''), ch])).entries()].map(([name, ch]) => ({ name, ch }));
  const picsB = h('button', { class: 'gameexit gamepics', 'aria-label': 'Pictures on screen', title: 'Pictures on screen', onclick: async () => {
    if (!GAME.loaded) return;
    const os = await onScreen(); if (!os) return toast('The game could not say what is on screen.');
    const { ents } = os;
    // the scene first (backgrounds and characters), then the rest (the interface)
    const order = [...ents.filter(e => e[0] === 'master'), ...ents.filter(e => e[0] !== 'master')];
    const names = [...new Set(order.flatMap(e => e[2]))];
    if (!names.length) return toast('No pictures are on screen right now.');
    openAssets(id, { only: names, inGame: true, title: 'Pictures on screen', compose: composer(ents), sounds: soundsOf(os.playing), art: artOf(ents), onAdded: drawQuick });
  } }, icon('image'));
  /* one tap: the art on screen, as one picture, with the music playing, into the gallery you added to last */
  const quickB = h('button', { class: 'gameexit gamequick', hidden: true, onclick: async () => {
    if (!GAME.loaded || quickB.disabled) return; const to = await lastAddTarget(); if (!to) return drawQuick();
    quickB.disabled = true;
    try {
      const os = await onScreen(); if (!os) throw new Error('The game could not say what is on screen.');
      const art = artOf(os.ents); if (!art.length) throw new Error('No art is on screen right now.');
      const bytes = await composer(os.ents)(art), gf = await gameFileList(g, 'on');
      const sounds = soundsOf(os.playing).filter(x => x.ch !== 'voice').map(x => ({ name: x.name.split('/').pop(), get: async () => { const r = await gameFileReader(gf, x.name); if (!r) throw new Error('missing'); return new Blob([await r()]); } }));
      await importInto(to.g, [{ title: to.g.title, chId: to.ch, items: [{ name: 'scene.png', sounds, get: async () => new Blob([bytes], { type: 'image/png' }) }] }], () => { }, () => false);
      toast(`Scene added to “${to.label}”.`, 2500);
    } catch (e) { toast(e.message || 'The scene could not be added.', 3500); }
    finally { quickB.disabled = false; }
  } }, icon('plus'));
  const drawQuick = async () => { const to = await lastAddTarget(); quickB.hidden = !to; if (to) { quickB.title = `Add the scene to “${to.label}”`; quickB.setAttribute('aria-label', `Add the scene (art only, with its music) to “${to.label}”`); } };
  drawQuick();
  const modsB = (g.game.mods || []).length ? h('button', { class: 'gameexit gamemods', 'aria-label': 'Mods', title: 'Mods', onclick: () => GAME.loaded && liveMods(id) }, icon('layers')) : null;
  const editB = h('button', { class: 'gameexit gameedit', 'aria-label': 'Edit this scene', title: 'Edit this scene', onclick: () => GAME.loaded && sceneEditor(id) }, icon('brush'));
  const errB = h('button', { class: 'gameexit gameerr', hidden: true, 'aria-label': 'Errors in the game (and fixes)', title: 'Errors in the game', onclick: () => gameErrors(GAME.errors, g.title) }, icon('tools'));
  const vfsB = h('button', { class: 'gameexit gamefiles', type: 'button', 'aria-label': 'Virtual game files', title: 'Open and edit the running game’s virtual files', onclick: () => openVirtualFiles(id) }, icon('folder'));
  const savesB = h('button', { class: 'gameexit gamesaves', 'aria-label': 'Saves', title: 'Saves', onclick: async () => { if (!GAME.loaded) return; await gameAutosave(); savePicker(id); } }, icon('list'));
  const flowB = EXP ? h('button', { class: 'gameexit gameflow', id: 'game-flow', 'aria-label': 'Modding mode: the story as a flowchart', title: 'Modding mode (the story as a flowchart)', onclick: () => GAME.loaded && openModder(id) }, icon('flow')) : null;
  const traceB = traceBtn();
  const resetB = h('button', { class: 'gameexit gamerestart', type: 'button',
    'aria-label': 'Reset game', title: 'Reset game after an error (keeps saved games)',
    onclick: resetRunningGame }, icon('restart'));
  const box = h('div', { id: 'gamebox' }, load, exit, lockB, savesB, vfsB, picsB, quickB, modsB, editB, flowB, traceB, resetB, errB, diagPanel);
  Object.assign(GAME, { box, frame, g, fsReady: false, loaded: false, loads: 0 });
  clearInterval(GAME.startWatch);
  GAME.startWatch = setInterval(() => {
    if (GAME.frame !== frame || !GAME.box || load.hidden) return;
    const elapsed = Math.floor((Date.now() - startupAt) / 1000);
    if (elapsed < (shutdownHint ? 5 : 30)) return;
    if (!startupStopped) showStartupIssue(shutdownHint
      ? `Ren'Py reported “Bye!” but never displayed the game. The runtime may have shut down without an exit callback.`
      : `Last stage: ${startupStage}. No new progress for ${elapsed}s.` +
        (document.hidden ? ' This browser tab is hidden; return to it before retrying.' :
          ' The selected runtime may be incompatible, or the game may be taking a long time to initialize.'));
  }, 2000);
  clearInterval(GAME.focusT); GAME.focusT = setInterval(() => { if (!GAME.box) return clearInterval(GAME.focusT); if (UI.shield === false) return; const away = !document.hasFocus() || document.hidden; if (away) shield.hidden = false; else if (!shield.hidden && document.activeElement === GAME.frame) shield.hidden = true; }, 400);
  document.body.classList.add('gaming'); document.body.append(box);
  let rt, list, saves;
  try {
    lbl.textContent = `Opening Ren'Py ${v}…`;
    startupPulse(lbl.textContent);
    [rt, list, saves] = await Promise.all([RPY.load(v), gameFileList(g, 'on'), rpyGetJSON(g.game.sv)]);
    if (!list) throw new Error('The game\'s file list is missing.');
  } catch (e) { lbl.textContent = 'Could not open the game: ' + (e.message || e); startupPulse(lbl.textContent); showStartupIssue(lbl.textContent, true); return; }
  if (GAME.frame !== frame) return;
  GAME.list = list;
  g.lastReadAt = Date.now(); saveGallery(g).catch(() => { });
  const html = new TextDecoder().decode(rt.files['index.html']);
  GAME.onMsg = async e => {
    if (!GAME.frame || e.source !== GAME.frame.contentWindow) return;
    const m = e.data || {}, win = GAME.frame.contentWindow;
    try {
      if (m.t === 'hello') {
        startupPulse('Web runtime connected; preparing game archives');
        // The iframe audio bootstraps before the chart may appear.
        syncGameAudio(true);
        const files = { ...rt.files }; delete files['index.html'];
        const sv = []; for (const [p, s] of Object.entries(saves || {})) { try { sv.push({ p, buf: await rpyRead(s.c, s.s) }); } catch (x) { } }
        // sounds and videos in the game's archives, to be shown to Ren'Py as plain files
        const loose = new Set(list.map(f => f.p.toLowerCase())), extract = {};
        for (const [i, f] of list.entries()) {
          if (!/\.rpa$/i.test(f.p)) continue;
          const idx = await rpaIndex(f).catch(() => null); if (!idx) continue;
          for (const [name, mm] of idx) if (RPY_MEDIA.test(name) && !loose.has(('game/' + name).toLowerCase())) (extract[i] = extract[i] || []).push([name, mm.o, mm.l, mm.p]);
        }
        rpyChunkCache.clear();
        // big games: pictures and sounds on demand
        let lazy = null, game = list.map((f, i) => ({ p: f.p, s: f.s, n: f.c.length, i }));
        if (gameLazy(g, list)) {
          lbl.textContent = 'Getting the game\'s pictures ready…';
          startupPulse(lbl.textContent);
          try {
            lazy = await rpyLazyPlan(g, list, (d, t) => { lbl.textContent = `Measuring the game's pictures (only the first time) · ${d.toLocaleString()} of ${t.toLocaleString()}`; bar.firstChild.style.width = (100 * d / Math.max(1, t)) + '%'; startupPulse(lbl.textContent); });
            const skip = new Set(lazy.skip); game = game.filter(f => !skip.has(f.i)); for (const k of lazy.skip) delete extract[k];
          } catch (x) { console.warn('lazy', x); lazy = null; }
        }
        GAME.lazy = lazy ? lazy.remote.length : 0;
        // Continue: Ren'Py loads this save itself when it starts (its own auto_load setting)
        // Safe boot probes the original game's compatibility independently of
        // Tankōbon's editor hooks. Do not modify any files from the game itself.
        const vfsOverlay = await TKB_VFS.overlay(g);
        const more = safeBoot ? [] : [{ p: 'game/zzzz_tankobon_hooks.rpy', text: RPY_HOOKS }, { p: 'game/zzzz_tankobon_trace.rpy', text: RPY_TRACE }, { p: 'game/zzzz_tankobon_errors.rpy', text: `init 1998 python:\n    store._tkb_errors = ${JSON.stringify(g.game.errors === 'show' ? 'show' : 'skip')}\n` }];
        if (safeBoot && compatProfile.id === 'legacy-6.99' && wantLegacySnapshot) {
          // Safe, read-only AST capture; runs after Ren'Py has loaded the compiled
          // story, before the main menu, and does NOT add tracing/edit hooks.
          more.push({ p: 'game/zzzz_tankobon_legacy_graph.rpy', text: legacyGraphSnapshotRpy() });
        }
        // trying a fix: once the save is loaded, the scene plays again (Ren'Py runs this itself, right after loading)
        if (!safeBoot && GAME.nextScene) { more.push({ p: 'game/zzzz_tankobon_trial.rpy', text: `init 1999 python:\n    def _tkb_trial_after():\n        store._tkb_cmd = ("jump", ${JSON.stringify(GAME.nextScene)})\n    config.after_load_callbacks.append(_tkb_trial_after)\n` }); GAME.nextScene = null; }
        if (cont) { const slot = await newestSlot(saves || {}); if (slot) more.push({ p: 'game/zzzz_tankobon_continue.rpy', text: `init 1999 python:\n    config.auto_load = ${JSON.stringify(slot)}\n` }); }
        startupPulse('Sending game files to Ren\'Py');
        win.postMessage({ t: 'boot', files, game, saves: sv, extract, more, dirs: Object.keys(vfsOverlay.dirs || {}), compat: compatProfile.id, safeBoot, lazy: lazy && { parts: lazy.parts, remote: lazy.remote } }, '*', [...Object.values(files), ...sv.map(s => s.buf)]);
        rt = null; // handed over
      } else if (m.t === 'vfsres') {
        TKB_VFS.reply(m, frame);
      } else if (m.t === 'fsready') {
        GAME.fsReady = true;
      } else if (m.t === 'fschange') {
        // Game writes belong only to this game's persistent workspace, not the original files.
        TKB_VFS.mutate(id, m.files || []).then(() => window.dispatchEvent(new CustomEvent('tkb:vfs-changed', { detail: { gid: id } }))).catch(err => console.warn('Virtual filesystem persist:', err));
      } else if (m.t === 'fsnotice') {
        console.warn('Virtual filesystem:', m.msg);
      } else if (m.t === 'chunk') {
        const buf = await rpyGet(GAME.list[m.i].c[m.k]); win.postMessage({ q: m.q, buf }, '*', [buf]);
      } else if (m.t === 'net') {
        // Ren'Py Sync only: the sync server, its one address shape
        let res;
        try {
          const u = new URL(m.url); if (u.origin !== 'https://sync.renpy.org' || !/^\/api\/sync\/v1\/[0-9a-f]{64}$/.test(u.pathname)) throw new Error('not allowed');
          const r = await fetch(u.href, { method: m.method === 'PUT' ? 'PUT' : 'GET', body: m.method === 'PUT' ? m.body : undefined, headers: m.ctype ? { 'Content-Type': m.ctype } : undefined, credentials: 'omit', referrerPolicy: 'no-referrer' });
          const body = await r.arrayBuffer(); res = { q: m.q, status: r.status, statusText: r.statusText, body };
        } catch (e) { res = { q: m.q, err: String(e && e.message || e) }; }
        win.postMessage(res, '*', res.body ? [res.body] : []);
      } else if (m.t === 'part') {
        const u = await rpyRange(GAME.list[m.i], m.o, m.l), buf = u.buffer.byteLength === u.length ? u.buffer : u.slice().buffer; win.postMessage({ q: m.q, buf }, '*', [buf]);
      } else if (m.t === 'lazy') {
        GAME.lazyGot = (GAME.lazyGot || 0) + 1;
      } else if (m.t === 'spin') {
        // a picture on screen is still on its way: a loading wheel (after a moment, so quick ones show none)
        let sp = box.querySelector('.gamespin');
        if (!sp) { sp = h('div', { class: 'gamespin', role: 'status', 'aria-label': 'Loading a picture' }, h('span')); box.append(sp); }
        clearTimeout(GAME.spinT);
        if (m.on) GAME.spinT = setTimeout(() => sp.classList.add('on'), 150); else sp.classList.remove('on');
      } else if (m.t === 'progress') {
        lbl.textContent = `Opening the game · ${mb(m.done)} of ${mb(m.total)}`; bar.firstChild.style.width = (100 * m.done / Math.max(1, m.total)) + '%';
        startupPulse(lbl.textContent);
      } else if (m.t === 'loaded') {
        // the files are in; Ren'Py now starts (its own steps are shown here, in the app's style, until its first screen)
        GAME.loaded = true; lbl.textContent = 'Starting the game…'; bar.parentNode.classList.add('busy');
        startupPulse(lbl.textContent);
        if (!['user', 'menu'].includes(g.game.coverBy)) menuCover();
      } else if (m.t === 'status') {
        // (only Ren'Py's known steps, in the app's words)
        if (!load.hidden) {
          const raw = String(m.text || '').trim();
          const w = /script|story/i.test(raw) && !/extract/i.test(raw) ? 'Loading the story…' : /unpack|extract/i.test(raw) ? 'Unpacking the engine…' : null;
          if (w) lbl.textContent = w;
          if (raw) startupPulse(raw);
        }
      } else if (m.t === 'ready') {
        // A removed presplash is not enough to prove the game launched: DDLC
        // can remove it while its Python interpreter is shutting down.
        if (runtimeExit || shutdownHint || startupStopped || (safeBoot && !m.visual)) return;
        startupReady = true;
        syncGameAudio(true);
        load.hidden = true; clearInterval(GAME.startWatch); GAME.startWatch = null;
        frame.focus();
        if (GAME.afterReady) { const f = GAME.afterReady; GAME.afterReady = null; setTimeout(f, 600); }
      } else if (m.t === 'onscreenres') {
        if (GAME.onScreen) GAME.onScreen(m.ents, m.playing);
      } else if (m.t === 'composeres') {
        if (GAME.onCompose) GAME.onCompose(m.buf);
      } else if (m.t === 'legacygraphstatus') {
        GAME.legacyGraphTransport = 'Python stdout: ' + String(m.status || 'working');
      } else if (m.t === 'legacygraphpart') {
        // Chunked direct transfer from Ren'Py's Python interpreter: unlike the
        // old /tmp reader, this does not depend on Emscripten FS access from JS.
        if (Number.isInteger(m.i) && m.i >= 0 && m.i < 4000 && typeof m.data === 'string' && m.data.length <= 30000) {
          GAME.legacyGraphChunks = GAME.legacyGraphChunks || [];
          GAME.legacyGraphChunks[m.i] = m.data;
        }
      } else if (m.t === 'legacygraphdone') {
        const count = Number(m.parts), size = Number(m.bytes);
        const chunks = GAME.legacyGraphChunks || [];
        const complete = Number.isInteger(count) && count >= 1 && count <= 4000 &&
          chunks.length === count && chunks.every(x => typeof x === 'string');
        if (complete) {
          const text = chunks.join('');
          if (text.length === size) {
            GAME.legacyGraphWire = text;
            GAME.legacyGraphReady = true;
            GAME.legacyGraphError = null;
            GAME.legacyGraphSummary = { scenes: m.scenes, rows: m.rows };
            GAME.legacyGraphTransport = 'direct messages (' + count + ' parts; FS ' + String(m.fs || 'unknown') + ')';
          } else {
            GAME.legacyGraphTransport = 'direct transfer size mismatch (' + text.length + ' / ' + size + ')';
          }
        } else {
          GAME.legacyGraphTransport = 'incomplete direct transfer (' + chunks.filter(x => typeof x === 'string').length + ' / ' + count + ')';
        }
        GAME.legacyGraphChunks = [];
        if (!GAME.legacyGraphReady && m.fs === 'saved') {
          // The direct channel may be interrupted by a browser extension or
          // oversized messages. The original file may still be available.
          GAME.legacyGraphReady = true;
          GAME.legacyGraphTransport += '; trying filesystem fallback';
        }
        if (!GAME.legacyGraphWire) console.warn('Legacy snapshot transfer:', GAME.legacyGraphTransport);
      } else if (m.t === 'legacygraphready') {
        GAME.legacyGraphReady = true;
        GAME.legacyGraphError = null;
        GAME.legacyGraphSummary = { scenes: m.scenes, rows: m.rows };
      } else if (m.t === 'legacygrapherror') {
        GAME.legacyGraphError = String(m.error || 'Unknown snapshot error');
        GAME.legacyGraphTransport = 'Python stdout export error';
        console.warn('Legacy scene snapshot:', GAME.legacyGraphError);
      } else if (m.t === 'legacygraphres') {
        const done = GAME.graphq && GAME.graphq.get(m.q);
        if (done) { GAME.graphq.delete(m.q); done(m); }
      } else if (m.t === 'pyres') {
        const f = GAME.pyq && GAME.pyq.get(m.q); if (f) { GAME.pyq.delete(m.q); f(m); }
      } else if (m.t === 'gameerror') {
        // an error in the game itself (skipped, unless set to show Ren'Py's screen)
        window.dispatchEvent(new CustomEvent('tkb:preview-error', { detail: { short: String(m.short || ''), full: String(m.full || '') } }));
        GAME.errors = GAME.errors || []; GAME.errors.push({ short: String(m.short || ''), full: String(m.full || ''), t: Date.now(), broken: Array.isArray(m.broken) ? m.broken : [] }); if (GAME.errors.length > 30) GAME.errors.shift();
        errB.hidden = false; errB.dataset.n = String(new Set(GAME.errors.map(errKey)).size);
        if (g.game.errors !== 'show' && Date.now() - (GAME.errToastAt || 0) > 6000) { GAME.errToastAt = Date.now(); undoToast('The game had an error and it was skipped.', () => gameErrors(GAME.errors, g.title), null, 6000, 'Details'); }
      } else if (m.t === 'autosaved') {
        if (GAME.onAutosaved) GAME.onAutosaved(m.ok);
      } else if (m.t === 'shotres') {
        if (GAME.onShot) GAME.onShot(m.buf);
      } else if (m.t === 'saves') {
        persistSaves(id, m.files || []);
      } else if (m.t === 'runtimeissue') {
        const issue = recordRuntimeIssue(m.kind, m.msg);
        if (!isCleanupOutput(issue)) console.warn('Ren\'Py runtime:', issue);
        if (!load.hidden && significantRuntimeIssues.includes(issue)) {
          showStartupIssue(`Runtime diagnostic: ${issue.slice(0, 400)}. Last loading stage: ${startupStage}.`);
        }
      } else if (m.t === 'compatshim') {
        const result = `${m.name || 'module'}: ${m.status || 'unknown'}${m.path ? ' at ' + m.path : ''}${m.error ? ' — ' + m.error : ''}`;
        legacyShimEvents.push(result);
        if (m.status === 'failed') showStartupIssue('Compatibility module could not initialize: ' + result, true);
      } else if (m.t === 'runtimeprobe') {
        latestRuntimeProbe = m.status || {};
        if (probeWaiter) probeWaiter();
      } else if (m.t === 'runtimelogs') {
        for (const f of m.files || []) if (f && f.path && f.text) capturedRuntimeLogs.set(String(f.path), String(f.text).slice(0, 14000));
      } else if (m.t === 'shutdownhint') {
        shutdownHint = true;
        if (!startupReady) {
          lbl.textContent = 'Ren\'Py reported shutdown before the game appeared.';
          showStartupIssue('The runtime reported “Bye!” while starting. This may be an unsupported Ren\'Py version; open diagnostics for the exact stage and runtime status.', true);
        } else if (!normalExitHandled) {
          // Some old web runtimes reach Python cleanup without Module.onExit.
          // Give the exit callback a chance, then close the dead canvas anyway.
          clearTimeout(quitFallback);
          quitFallback = setTimeout(() => returnAfterGameQuit('The game closed itself.'), 1400);
        }
      } else if (m.t === 'exit') {
        runtimeExit = true; exitMode = String(m.mode || 'runtime exit');
        if (!startupReady) {
          clearInterval(GAME.startWatch); GAME.startWatch = null;
          lbl.textContent = 'The Ren\'Py runtime exited before the game opened.';
          showStartupIssue(`Runtime ${v} exited during startup (${bootMode} boot). Use View / copy diagnostics, retry, or choose another runtime in Runtime / Compatibility.`, true);
        } else {
          await returnAfterGameQuit('The game closed itself.');
        }
      } else if (m.t === 'error') {
        console.warn('game:', m.msg);
        if (!load.hidden) { lbl.textContent = 'The game could not start: ' + m.msg; startupPulse(lbl.textContent); showStartupIssue(lbl.textContent, true); }
      }
    } catch (x) { console.error(x); }
  };
  window.addEventListener('message', GAME.onMsg);
  GAME.onHide = () => { if (document.visibilityState === 'hidden' && GAME.loaded && GAME.frame === frame) gameAutosave(); };
  document.addEventListener('visibilitychange', GAME.onHide); window.addEventListener('pagehide', GAME.onHide);
  /* the cover: a picture of the main menu once it has been on screen for a moment (the first time a game is played) */
  async function menuCover() {
    const ask = () => new Promise(res => { GAME.onShot = b => { GAME.onShot = null; res(b); }; frame.contentWindow.postMessage({ t: 'shot' }, '*'); setTimeout(() => { if (GAME.onShot) { GAME.onShot = null; res(null); } }, 15000); });
    let seen = 0;
    for (let k = 0; k < 60 && GAME.frame === frame; k++) {
      await new Promise(r => setTimeout(r, seen ? 3000 : 2500));
      if (GAME.frame !== frame) return;
      const buf = await ask();
      if (!buf) { seen = 0; continue; }
      if (++seen < 2) continue; // the menu was there a moment ago too: take this one
      try { await setGameCover(id, new Uint8Array(buf), 'main menu.png', 'menu'); g.game.coverBy = 'menu'; } catch (e) { console.warn('cover', e); }
      return;
    }
  }
  // the frame may only ever show the page made here: if the game tries to go to a web page, it is stopped
  frame.addEventListener('load', () => {
    if (++GAME.loads > 1 && GAME.frame === frame) {
      if (startupReady) {
        // A running game may call quit or navigate its own frame rather than
        // sending an Emscripten exit event. Never leave an unusable black frame.
        returnAfterGameQuit('The game closed or restarted its player.');
        return;
      }
      // Keep the evidence visible. Previously an unexpected iframe navigation
      // threw the user back to the library and destroyed their diagnostics.
      extraFrameLoads++;
      recordRuntimeIssue('iframe', 'Unexpected embedded page navigation/reload');
      load.hidden = false;
      lbl.textContent = 'The game frame restarted or navigated during startup.';
      showStartupIssue('The embedded Ren\'Py page navigated unexpectedly. Tankōbon has kept the recovery panel and logs open instead of silently leaving the game.', true);
    }
  });
  frame.srcdoc = rpyDoc(html, rt.loader); box.prepend(frame);
}

/* ---------- playing an HTML game (RPG Maker MV/MZ, or any game made as a web page) ----------
   Sealed like Ren'Py: the page runs in a frame that cannot reach the network or this app's data. Every file it asks for
   (scripts, data, pictures, sounds) is answered from the encrypted copy; what it keeps in the browser (its saves) is kept
   here, encrypted with the game. */
//<<
