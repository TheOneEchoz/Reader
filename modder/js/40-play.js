/* Playing: the sealed frame (rpyDoc), what runs inside it (rpyBoot), autosave */
//>> js/40-play.js#0
const GAME = { box: null, frame: null, g: null, list: null, onMsg: null, loaded: false, loads: 0, lastGameId: null };
// The frame lives behind the editor even when its preview is closed. Audio should
// belong to the visible game, not to the lifetime of the embedded iframe.
function gameReallyShown() {
  if (!GAME.frame || !GAME.box || !GAME.box.isConnected || document.hidden) return false;
  const box = GAME.box;
  const style = getComputedStyle(box);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = box.getBoundingClientRect();
  if (rect.width < 30 || rect.height < 30 || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return false;
  // Modals or the editor can visually hide a game iframe even while it keeps
  // running. A docked preview counts as visible only if it really is docked.
  if (document.querySelector('#sheet:not([hidden])')) return false;
  if (document.getElementById('modder') && !box.classList.contains('preview-docked')) return false;
  const chart = !!document.getElementById('charts');
  if (chart && !(typeof SCENE_PREVIEW !== 'undefined' && SCENE_PREVIEW.active && box.classList.contains('preview-docked'))) return false;
  // Check actual stacking: a page overlay could hide the iframe without
  // setting any attribute on GAME.box. A few samples avoid blocked corners.
  for (const [px,py] of [[.5,.5],[.25,.5],[.75,.5],[.5,.25]]) {
    const x = Math.max(0,Math.min(innerWidth - 1, rect.left + rect.width*px));
    const y = Math.max(0,Math.min(innerHeight - 1, rect.top + rect.height*py));
    const top = document.elementFromPoint(x, y);
    if (top && box.contains(top)) return true;
  }
  return false;
}
function syncGameAudio(force = false) {
  if (!GAME.frame || !GAME.box) return;
  const on = gameReallyShown();
  if (!force && GAME.soundAllowed === on) return;
  GAME.soundAllowed = on;
  try { GAME.frame.contentWindow.postMessage({ t: 'gamesound', on }, '*'); } catch (_) { }
}
// Detect changes made by third-party overlays or panel transitions that do
// not explicitly signal their visibility to the audio controller.
setInterval(() => { if (GAME.frame) syncGameAudio(); }, 750);
document.addEventListener('visibilitychange', () => syncGameAudio(true));
window.addEventListener('pagehide', () => { if (GAME.frame) try { GAME.frame.contentWindow.postMessage({ t: 'gamesound', on: false }, '*'); } catch (_) { } });
function closeGame() {
  if (!GAME.box) return;
  if (typeof closeScenePreview === "function") closeScenePreview();
  try { GAME.frame?.contentWindow?.postMessage({ t: 'gamesound', on: false }, '*'); } catch (_) { }
  try { if (typeof TKB_VFS !== "undefined") TKB_VFS.pendingReject(); } catch (_) {}
  window.removeEventListener('message', GAME.onMsg);
  clearInterval(GAME.focusT); clearInterval(GAME.startWatch); GAME.startWatch = null;
  document.removeEventListener('visibilitychange', GAME.onHide); window.removeEventListener('pagehide', GAME.onHide); GAME.box.remove(); Object.assign(GAME, { box: null, frame: null, g: null, list: null, onMsg: null, loaded: false, loads: 0 });
  GAME.legacyNodesRequested = false;
  document.body.classList.remove('gaming');
  setTimeout(() => { try { Sync.gameClosed(); } catch (e) { } }, 3000); // (after its last saves are stored)
}
/* Ren'Py's own page, sealed: its scripts are loaded from memory by rpyBoot, and nothing may reach the network. */
function rpyDoc(html, loader) {
  const scripts = [];
  // (the page may be written with or without quotes around attributes)
  html = html.replace(/<script\b[^>]*?\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>\s*<\/script>/gi, (m, a, b, c) => { scripts.push((a || b || c).split('/').pop()); return ''; });
  html = html.replace(/<link\b[^>]*>/gi, '').replace(/navigator\.serviceWorker/g, '(void 0)').replace(/<img\b[^>]*\bid=["']?presplash\b[^>]*>/i, '<img id="presplash" alt="">');
  const csp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; connect-src blob: data:; img-src blob: data:; media-src blob: data:; style-src 'unsafe-inline'; font-src blob: data:; worker-src blob:; form-action 'none'";
  html = html.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><script>try{Object.defineProperty(Navigator.prototype,'serviceWorker',{get:function(){return undefined},configurable:true})}catch(e){}<\/script>`);
  html = html.replace(/<\/head>/i, '<style>#ContextContainer,#statusDiv,#statusbar_container,#presplash{display:none!important}html,body{background:#000}html,body,canvas,img,video,div{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}input,textarea,[contenteditable]{-webkit-user-select:text;user-select:text}::selection{background:transparent}canvas,img{outline:none}</style><script>document.addEventListener("selectstart",function(e){var t=e.target;if(!(t&&t.closest&&t.closest("input,textarea,[contenteditable]")))e.preventDefault()},true)<\/script></head>');
  html = html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `<script>(${rpyBoot.toString()})(${JSON.stringify(scripts)}, ${JSON.stringify(loader)});<\/script></body>`);
  return html;
}
/* Runs inside the sealed frame. Gets Ren'Py and the game from the app by messages; sends saves back. */
function rpyBoot(SCRIPTS, LOADER) {
  try { Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => undefined, configurable: true }); } catch (e) { } // sealed: it would only throw
  // the game's sound (Ren'Py plays through Web Audio): kept, so the app can pause it while you listen to one of its sounds
  const ACTX = []; let gameSoundOn = false; // silent until the parent confirms visibility
  const nativeResume = new WeakMap();
  // Gate resume() itself. Previously Ren'Py restarted an AudioContext every
  // ~second, and a watchdog suspended it afterwards, causing audible ticks.
  for (const k of ['AudioContext', 'webkitAudioContext']) {
    const C = window[k]; if (!C) continue;
    const W = function (...args) {
      const c = new C(...args);
      ACTX.push(c);
      const resume = c.resume.bind(c);
      nativeResume.set(c, resume);
      try { c.resume = function () { return gameSoundOn ? resume() : Promise.resolve(); }; } catch (_) { }
      if (!gameSoundOn) try { c.suspend(); } catch (_) { }
      return c;
    };
    W.prototype = C.prototype;
    try { Object.setPrototypeOf(W, C); } catch (_) { }
    window[k] = W;
  }
  const mediaEls = () => [...document.querySelectorAll('audio,video')];
  const mediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  const mediaPlay = mediaProto && mediaProto.play;
  if (mediaPlay) mediaProto.play = function (...args) {
    if (!gameSoundOn) { this.__tkbPaused = true; return Promise.resolve(); }
    this.__tkbPaused = false;
    return mediaPlay.apply(this,args);
  };
  // The watchdog is a fallback for contexts created before the hook / unusual
  // audio backends, not the primary muting strategy.
  setInterval(() => { if (gameSoundOn) return;
    for (const c of ACTX) { try { if (c.state === 'running') c.suspend(); } catch (_) {} }
    for (const el of mediaEls()) { try { if (!el.paused) { el.__tkbPaused = true; el.pause(); } } catch (_) {} }
  }, 1200);
  window.__tkbAudio = ACTX;
  const P = window.parent, post = (m, t) => P.postMessage(m, '*', t || []);
  let stepCaptureOn = false, stepGateWaiting = false, stepSwallowClick = false;
  const requestStep = e => {
    if (!stepCaptureOn) return;
    // Wheel is debugger input while stepping; never accidentally roll back.
    if (e.type === 'wheel') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (stepGateWaiting) { stepGateWaiting = false; post({ t: 'debugstepinput' }); }
      return;
    }
    if (e.type === 'mousedown' && stepGateWaiting) {
      stepGateWaiting = false;
      stepSwallowClick = true;
      e.preventDefault(); e.stopImmediatePropagation();
      post({ t: 'debugstepinput' });
    } else if (stepSwallowClick && (e.type === 'mouseup' || e.type === 'click')) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type === 'click') stepSwallowClick = false;
    }
  };
  window.addEventListener('wheel', requestStep, { capture: true, passive: false });
  for (const k of ['mousedown', 'mouseup', 'click']) window.addEventListener(k, requestStep, true);

  window.tkbSpin = on => post({ t: 'spin', on: !!on }); // called by Ren'Py (the hooks): a picture on screen is still on its way
  // Older (Ren'Py 7.4) web builds do not expose window.renpy_exec.
  // The read-only AST is serialized by a late init block into the VM's /tmp,
  // then copied out of Emscripten's FS via postMessage. This works without
  // touching the running game or enabling mutable tracing hooks.
  const LEGACY_GRAPH_FILE = '/tmp/tkb_legacy_graph.json';
  const URLS = {}, waiting = new Map(); let FILES = [], SAVES = [], EXTRACT = {}, MORE = [], LAZY = null, seq = 0;
  const ask = m => new Promise(res => { const q = ++seq; waiting.set(q, res); post(Object.assign({ q }, m)); });
  // the game cannot reach the internet, except Ren'Py Sync (moving saves between devices with a code): those requests go
  // through the app, and only to Ren'Py's sync server
  { const of = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = async (input, init) => {
      const url = String(input && input.url || input);
      if (!/^https:\/\/sync\.renpy\.org\/api\/sync\/v1\//.test(url)) { if (of) return of(input, init); throw new TypeError('offline'); }
      const body = init && init.body ? (init.body.buffer ? init.body.slice().buffer : init.body) : null;
      const r = await ask({ t: 'net', url, method: (init && init.method) || 'GET', ctype: init && init.headers && (init.headers['Content-Type'] || init.headers['content-type']) || null, body });
      if (r.err) throw new TypeError(r.err);
      return new Response(r.body || null, { status: r.status, statusText: r.statusText || '' });
    };
  }
  const mime = n => /\.wasm$/.test(n) ? 'application/wasm' : /\.js$/.test(n) ? 'text/javascript' : 'application/octet-stream';
  const load = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.body.appendChild(s); });
  const mkdirs = path => { let cur = ''; for (const p of path.split('/').filter(Boolean)) { cur += '/' + p; try { FS.mkdir(cur); } catch (e) { } } };
  // Experimental legacy compatibility: older desktop games can require fcntl,
  // which the Python 2 Emscripten web runtime does not provide. This is a
  // deliberately LIMITED lockf adapter (not a general Unix fcntl emulator).
  // The browser sandbox contains one game's interpreter, so the only useful
  // guarantee here is preventing duplicate locks *inside that interpreter*.
  // We never modify the imported game archive or write the shim to its overlay.
  let compatProfileId = '';
  const LEGACY_FCNTL = [
    '# Tankobon legacy browser adapter: in-process advisory locks only',
    'import errno',
    'LOCK_SH = 1',
    'LOCK_EX = 2',
    'LOCK_NB = 4',
    'LOCK_UN = 8',
    '_tkb_locks = {}',
    'def lockf(fp, operation, length=0, start=0, whence=0):',
    '    name = getattr(fp, "name", None)',
    '    if name is None:',
    '        name = "fd:%s" % (fp,)',
    '    if operation & LOCK_UN:',
    '        if _tkb_locks.get(name) is fp:',
    '            del _tkb_locks[name]',
    '        return',
    '    if not (operation & LOCK_EX):',
    '        raise IOError(errno.ENOSYS, "This browser adapter only supports exclusive lockf locks")',
    '    holder = _tkb_locks.get(name)',
    '    if holder is not None and holder is not fp:',
    '        raise IOError(errno.EAGAIN, "Another lock holder exists in this game")',
    '    _tkb_locks[name] = fp',
    '    return None',
    ''
  ].join('\n');
  function installLegacyModules() {
    if (compatProfileId !== 'legacy-6.99') return;
    // This directory is on Python 2's sys.path, as verified by Ren'Py's
    // own diagnostic import records (e.g. /lib/python2.7/site.pyo).
    const p = '/lib/python2.7/fcntl.py';
    try {
      try {
        const st = FS.stat(p);
        if (st && !FS.isDir(st.mode)) {
          post({ t: 'compatshim', name: 'fcntl.lockf', status: 'existing', path: p });
          return; // Never overwrite a genuine runtime-provided implementation.
        }
      } catch (_) { /* The runtime does not provide this module. */ }
      mkdirs('/lib/python2.7');
      FS.writeFile(p, LEGACY_FCNTL, { encoding: 'utf8' });
      post({ t: 'compatshim', name: 'fcntl.lockf', status: 'installed', path: p });
    } catch (e) {
      post({ t: 'compatshim', name: 'fcntl.lockf', status: 'failed', path: p, error: String(e && e.message || e) });
      throw e;
    }
  }

  const fail = e => post({ t: 'error', msg: String((e && e.message) || e) });
  // The 7.4.11 Python interpreter sends stdout through Module.print, but
  // cannot reliably deliver `emscripten.run_script` messages into the
  // Tankōbon parent. Treat framed Python stdout as private graph transport.
  const graphOutput = value => {
    const line = String(value == null ? '' : value);
    const part = 'TKB_LEGACY_GRAPH_PART|';
    const done = 'TKB_LEGACY_GRAPH_DONE|';
    const status = 'TKB_LEGACY_GRAPH_STATUS|';
    const error = 'TKB_LEGACY_GRAPH_ERROR|';
    if (line.startsWith(part)) {
      const sep = line.indexOf('|', part.length);
      if (sep < 0) return false;
      const i = Number(line.slice(part.length, sep));
      if (!Number.isSafeInteger(i) || i < 0 || i > 20000 || line.length > 6500) return false;
      post({ t: 'legacygraphpart', i, data: line.slice(sep + 1) });
      return true;
    }
    if (line.startsWith(done)) {
      const m = line.slice(done.length).split('|');
      post({ t: 'legacygraphdone', parts: Number(m[0]), bytes: Number(m[1]), scenes: Number(m[2]), rows: Number(m[3]), fs: m.slice(4).join('|') });
      return true;
    }
    if (line.startsWith(status)) { post({ t: 'legacygraphstatus', status: line.slice(status.length, status.length + 160) }); return true; }
    if (line.startsWith(error)) { post({ t: 'legacygrapherror', error: line.slice(error.length, error.length + 3600) }); return true; }
    return false;
  };
  // Errors that happen before renpy_exec is ready otherwise disappear into the
  // sealed iframe. Capture lightweight diagnostics, not full game scripts.
  const issue = (kind, value) => {
    const msg = String((value && value.stack) || (value && value.message) || value || '').slice(0, 1800);
    if (msg) post({ t: 'runtimeissue', kind, msg });
  };
  window.addEventListener('unhandledrejection', e => issue('promise', e.reason));
  // Save Ren'Py's own diagnostic files while the emulated filesystem still exists.
  // The last stdout/stderr lines after an interpreter exit are often just Python
  // cleanup, so they must not be our only record of the failure.
  const diagnosticPaths = [
    '/traceback.txt', '/log.txt', '/errors.txt',
    '/game/traceback.txt', '/game/log.txt', '/game/errors.txt',
    '/tmp/traceback.txt', '/tmp/log.txt',
    '/home/web_user/.renpy/traceback.txt', '/home/web_user/.renpy/log.txt'
  ];
  const sentDiagnosticFiles = new Map();
  const snapshotRuntimeFiles = reason => {
    const fs = typeof FS !== 'undefined' ? FS : null;
    if (!fs || typeof fs.readFile !== 'function') return;
    const files = [];
    for (const path of diagnosticPaths) {
      try {
        const raw = fs.readFile(path, { encoding: 'utf8' });
        const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        if (!content || !content.trim()) continue;
        const excerpt = content.length > 12000 ? content.slice(0, 3000) + '\n[...]\n' + content.slice(-9000) : content;
        if (sentDiagnosticFiles.get(path) === excerpt) continue;
        sentDiagnosticFiles.set(path, excerpt);
        files.push({ path, text: excerpt });
      } catch (_) { /* Most games do not create these files. */ }
    }
    if (files.length) post({ t: 'runtimelogs', reason, files });
  };
  function runtimeProbe() {
    snapshotRuntimeFiles('manual diagnostic probe');
    const m = window.Module || {};
    const fs = typeof FS !== 'undefined' && FS && typeof FS.stat === 'function' ? FS : null;
    const exists = path => {
      if (!fs) return null;
      try { const st = fs.stat(path); return { bytes: st.size, dir: !!fs.isDir(st.mode) }; }
      catch (_) { return false; }
    };
    let root = null;
    try { root = fs && fs.readdir('/').filter(n => n !== '.' && n !== '..').slice(0, 45); } catch (_) {}
    post({ t: 'runtimeprobe', status: {
      moduleStarted: !!m.calledRun, runtimeExited: exitReported,
      moduleAborted: !!m.ABORT, pythonBridge: typeof window.renpy_exec === 'function',
      filesystemAvailable: !!fs, canvasCount: document.querySelectorAll('canvas').length,
      memoryBytes: m.HEAP8 && m.HEAP8.byteLength || 0,
      gameArchive: exists('/game/scripts.rpa'), charactersFolder: exists('/characters'),
      characterFile: exists('/characters/monika.chr'), logFile: exists('/log.txt'),
      tracebackFile: exists('/traceback.txt'), rootFolders: root
    } });
  }
  let exitReported = false;
  const reportExit = (mode, status) => {
    if (exitReported) return;
    exitReported = true;
    // A game can delete its own files and quit in the same interpreter tick.
    // Flush pending filesystem changes BEFORE reporting exit to the host.
    try { flushFs(); } catch (e) { issue('filesystem', e); }
    try { sendSaves(); } catch (_) { /* save mounts may not exist on early exit */ }
    snapshotRuntimeFiles(mode);
    runtimeProbe();
    issue('exit', mode + (status === undefined ? '' : ': ' + String(status)));
    post({ t: 'exit', mode, status: status == null ? null : String(status) });
  };
  /* Virtual game file manager and change journal. Lives within the Ren'Py
     Emscripten filesystem, not the user's real OS filesystem. */
  let fsTracking = false, fsQuiet = false, fsFlushTimer = null;
  const fsRoots = new Set(['game']); // imported top-level paths + explicitly created folders
  const fsDirty = new Set(), fsDirsDirty = new Map(), FS_LIMIT = 16 * 1024 * 1024;
  const fsBlocked = new Set(['lib','usr','home','tmp','proc','dev','etc','sys','bin','_placeholders','renpy','site-packages']);
  function fsClean(v, rootOk = false) {
    const p = String(v == null ? '' : v).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!p && rootOk) return '';
    if (!p || p.length > 1024 || /[\x00-\x1f\x7f]/.test(p) || p.split('/').some(x => !x || x === '.' || x === '..') || fsBlocked.has(p.split('/')[0].toLowerCase()) || /^game\/saves(?:\/|$)/i.test(p)) throw new Error('Path is outside the virtual game workspace.');
    return p;
  }
  function fsPath(p) { return '/' + fsClean(p); }
  function fsRememberRoot(p) {
    try { fsRoots.add(fsClean(p).split('/')[0]); } catch (_) { /* not a game path */ }
  }
  function fsList() {
    if (typeof FS === 'undefined' || !FS.readdir) throw new Error('The virtual filesystem is not initialized.');
    const entries = [], visited = new Set(), cap = 14000;
    function walk(full, depth = 0) {
      if (depth > 30 || entries.length >= cap || visited.has(full)) return;
      visited.add(full);
      let p, st;
      try { p = fsClean(full); st = FS.stat(full); } catch (_) { return; }
      const isDir = FS.isDir(st.mode);
      if (/^game\/zzzz_tankobon_.*\.rpyc?$/i.test(p)) return;
      entries.push({ p, dir: isDir, size: isDir ? 0 : st.size });
      if (!isDir) return;
      let names; try { names = FS.readdir(full); } catch (_) { return; }
      for (const name of names) if (name !== '.' && name !== '..') walk(full + '/' + name, depth + 1);
    }
    // Never walk '/': it contains Ren'Py's bundled Python standard library and
    // Emscripten internals. Only show files that belong to the imported game.
    for (const root of fsRoots) walk('/' + root);
    return entries;
  }
  function fsMark(raw) {
    if (!fsTracking || fsQuiet) return;
    let p; try { p = fsClean(raw); } catch (_) { return; }
    if (/^game\/zzzz_tankobon_.*\.rpyc?$/i.test(p)) return;
    fsDirty.add(p); scheduleFsFlush();
  }
  function fsMarkDir(raw, gone = false) {
    if (!fsTracking || fsQuiet) return;
    let p; try { p = fsClean(raw); } catch (_) { return; }
    fsDirsDirty.set(p, !!gone); scheduleFsFlush();
  }
  function fsWalkAffected(raw) {
    const p = '/' + String(raw).replace(/^\/+/, '');
    try {
      const st = FS.stat(p);
      if (!FS.isDir(st.mode)) { fsMark(p); return; }
      fsMarkDir(p);
      let count = 0;
      const traverse = d => {
        if (count++ > 150) return;
        for (const n of FS.readdir(d)) {
          if (n === '.' || n === '..') continue;
          const f = d + '/' + n;
          try { FS.isDir(FS.stat(f).mode) ? (fsMarkDir(f), traverse(f)) : fsMark(f); } catch (_) { }
        }
      };
      traverse(p);
    } catch (_) { fsMark(p); }
  }
  function scheduleFsFlush() { clearTimeout(fsFlushTimer); fsFlushTimer = setTimeout(flushFs, 800); }
  function flushFs() {
    if (!fsDirty.size && !fsDirsDirty.size) return;
    const files = [];
    for (const [p, deleted] of fsDirsDirty) files.push({ p, dir: true, deleted });
    fsDirsDirty.clear();
    for (const p of fsDirty) {
      try {
        const st = FS.stat('/' + p);
        if (FS.isDir(st.mode)) continue;
        if (st.size > FS_LIMIT) { post({ t: 'fsnotice', msg: 'Changed file too large to preserve: ' + p }); continue; }
        const buf = FS.readFile('/' + p).slice().buffer;
        files.push({ p, buf });
      } catch (_) { files.push({ p, deleted: true }); }
    }
    fsDirty.clear();
    if (files.length) post({ t: 'fschange', files }, files.filter(f => f.buf).map(f => f.buf));
  }
  function startTrackedFS() {
    if (fsTracking || typeof FS === 'undefined') return;
    // Observe Emscripten's high-level and low-level writes, including Python's
    // open(...,'wb') / os.remove / os.rename operations.
    const wrap = (name, handler) => {
      const old = FS[name]; if (typeof old !== 'function') return;
      FS[name] = function (...args) { return handler(old, this, args); };
    };
    wrap('writeFile', (old, self, a) => { const r = old.apply(self, a); fsMark(a[0]); return r; });
    wrap('write', (old, self, a) => { const r = old.apply(self, a); fsMark(a[0] && a[0].path); return r; });
    wrap('truncate', (old, self, a) => { const r = old.apply(self, a); fsMark(a[0]); return r; });
    wrap('ftruncate', (old, self, a) => { const r = old.apply(self, a); fsMark(a[0] && a[0].path); return r; });
    wrap('unlink', (old, self, a) => { const r = old.apply(self, a); fsMark(a[0]); return r; });
    wrap('mkdir', (old, self, a) => { const r = old.apply(self, a); fsMarkDir(a[0]); return r; });
    wrap('rmdir', (old, self, a) => { const r = old.apply(self, a); fsMarkDir(a[0], true); return r; });
    wrap('rename', (old, self, a) => {
      const src = a[0], dst = a[1];
      // Mark each old child as removed, and every new child as materialized.
      const oldPaths = fsList().filter(e => e.p === String(src).replace(/^\/+/, '') || e.p.startsWith(String(src).replace(/^\/+/, '') + '/'));
      const r = old.apply(self, a);
      for (const e of oldPaths) e.dir ? fsMarkDir(e.p, true) : fsMark(e.p);
      fsWalkAffected(dst);
      return r;
    });
    fsTracking = true;
    post({ t: 'fsready' });
    // Periodically scan DDLC's special character folder, including mutations
    // done via mechanisms that bypass FS.writeFile (for example stream writes).
    const known = new Map();
    setInterval(() => {
      if (!fsTracking || fsQuiet || typeof FS === 'undefined') return;
      for (const folder of ['/characters', '/game/characters']) {
        let names; try { names = FS.readdir(folder); } catch (_) { names = []; }
        const present = new Set();
        for (const n of names) {
          if (n === '.' || n === '..') continue;
          const p = folder + '/' + n;
          try { const st = FS.stat(p); if (FS.isDir(st.mode)) continue; present.add(p);
            const signature = st.size + '/' + (st.mtime ? +st.mtime : 0);
            if (known.has(p) && known.get(p) !== signature) fsMark(p);
            known.set(p, signature);
          } catch (_) { }
        }
        for (const p of [...known.keys()]) if (p.startsWith(folder + '/') && !present.has(p)) { known.delete(p); fsMark(p); }
      }
    }, 3500);
  }
  async function fsRequest(m) {
    const send = (obj, transfer) => post({ t: 'vfsres', q: m.q, ...obj }, transfer || []);
    let quietStart = false;
    try {
      if (typeof FS === 'undefined' || !FS.readdir) throw new Error('Ren\'Py has not initialized its filesystem yet.');
      const op = String(m.op || '');
      if (op === 'list') { send({ entries: fsList() }); return; }
      const name = fsPath(m.path);
      if (op === 'read') {
        const st = FS.stat(name);
        if (st.size > FS_LIMIT) throw new Error('File exceeds the 16 MB manager limit.');
        const buf = FS.readFile(name).slice().buffer;
        send({ buf }, [buf]); return;
      }
      fsQuiet = true; quietStart = true;
      if (op === 'mkdir') { mkdirs(name); fsRememberRoot(name); send({ ok: true }); }
      else if (op === 'write') {
        const bytes = new Uint8Array(m.buf || []);
        if (bytes.byteLength > FS_LIMIT) throw new Error('File exceeds 16 MB.');
        mkdirs(name.slice(0, name.lastIndexOf('/'))); FS.writeFile(name, bytes); fsRememberRoot(name); send({ ok: true });
      } else if (op === 'delete') {
        if (name === '/game') throw new Error('Cannot remove the game root.');
        const del = p => { const st = FS.stat(p); if (!FS.isDir(st.mode)) { FS.unlink(p); return; }
          for (const n of FS.readdir(p)) if (n !== '.' && n !== '..') del(p + '/' + n);
          FS.rmdir(p);
        };
        del(name); send({ ok: true });
      } else if (op === 'rename') {
        if (name === '/game') throw new Error('Cannot rename the game root.');
        const dest = fsPath(m.dest);
        if (dest.startsWith(name + '/')) throw new Error('Cannot move a directory into itself.');
        mkdirs(dest.slice(0, dest.lastIndexOf('/'))); FS.rename(name, dest); fsRememberRoot(dest); send({ ok: true });
      } else throw new Error('Unknown file operation.');
    } catch (e) { send({ error: String(e.message || e) }); }
    finally { if (quietStart) fsQuiet = false; }
  }

  async function writeGame() {
    const total = FILES.reduce((n, f) => n + f.s, 0); let done = 0, last = 0;
    for (let j = 0; j < FILES.length; j++) {
      const f = FILES[j], i = f.i ?? j, arr = new Uint8Array(f.s); let off = 0;
      for (let k = 0; k < f.n; k++) { const r = await ask({ t: 'chunk', i, k }); const u = new Uint8Array(r.buf); arr.set(u, off); off += u.length; done += u.length; }
      const path = '/' + f.p; mkdirs(path.slice(0, path.lastIndexOf('/')));
      FS.writeFile(path, arr, { canOwn: true });
      for (const [name, o, l, p] of EXTRACT[i] || []) {
        try {
          const t = '/game/' + name; mkdirs(t.slice(0, t.lastIndexOf('/')));
          let data = arr.subarray(o, o + l);
          if (p) { const u = new Uint8Array(p.length + l); u.set(p); u.set(data, p.length); data = u; }
          FS.writeFile(t, data, { canOwn: true });
        } catch (e) { }
      }
      if (Date.now() - last > 150 || j === FILES.length - 1) { last = Date.now(); post({ t: 'progress', done, total }); }
    }
    if (LAZY) await writeLazy();
    for (const d of (window.__tkbWorkDirs || [])) { try { mkdirs('/' + d); } catch (_) {} }
    for (const f of MORE) { const path = '/' + f.p; mkdirs(path.slice(0, path.lastIndexOf('/'))); FS.writeFile(path, f.text); }
  }
  /* Big games: pictures and sounds are not put in memory at the start. Ren'Py is told they are "remote" (its web version's own
     on-demand loading): it shows a stand-in, asks for the file (also ahead of time, from what the story is about to show), and frees it
     after use. The asking is answered here, from the app, instead of from a web server. */
  const PART = (e) => ask({ t: 'part', i: e[1], o: e[2], l: e[3] }).then(r => { let u = new Uint8Array(r.buf); if (e[4]) { const w = new Uint8Array(e[4].length + u.length); w.set(e[4]); w.set(u, e[4].length); u = w; } return u; });
  async function writeLazy() {
    // the non-media files of the archives, as plain files (the archives themselves are not written)
    for (const e of LAZY.parts) { const u = await PART(e), path = '/game/' + e[0]; mkdirs(path.slice(0, path.lastIndexOf('/'))); FS.writeFile(path, u, { canOwn: true }); }
    const REM = new Map(LAZY.remote.map(e => [e[0], e]));
    let idx = '';
    for (const e of LAZY.remote) idx += e[0] + '\n' + e[5] + ' ' + (e[5] === 'image' ? e[6].join(',') : e[6]) + '\n';
    FS.writeFile('/game/renpyweb_remote_files.txt', idx);
    // a stand-in picture for each (Ren'Py stretches it to the real size until the real one is here): see-through, so a picture
    // still on its way shows nothing for a moment instead of a blue flash
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    for (const e of LAZY.remote) if (e[5] === 'image') { const p = '/_placeholders/' + e[0]; mkdirs(p.slice(0, p.lastIndexOf('/'))); FS.writeFile(p, png); }
    let rw = null;
    const hook = v => {
      v.dl_new = path => {
        const id = v.xhr_id++, x = { readyState: 1, status: 0, statusText: '' }; v.xhrs[id] = x;
        const name = String(path).replace(/^\/?game\//, ''), e = REM.get(name);
        if (!e) { x.readyState = 4; x.statusText = 'not in the game'; return id; }
        PART(e).then(u => { const t = '/game/' + name; const prevQuiet = fsQuiet; fsQuiet = true; try { FS.unlink(t); } catch (err) { } try { mkdirs(t.slice(0, t.lastIndexOf('/'))); FS.writeFile(t, u, { canOwn: true }); } finally { fsQuiet = prevQuiet; } x.status = 200; x.statusText = 'OK'; x.readyState = 4; post({ t: 'lazy', name }); },
          err => { x.readyState = 4; x.statusText = String(err); });
        return id;
      };
    };
    try { Object.defineProperty(window, 'RenPyWeb', { configurable: true, get: () => rw, set: v => { rw = v; try { hook(v); } catch (e) { } } }); } catch (e) { }
  }
  /* saves live in memory here; whenever Ren'Py saves (it calls syncfs), they are sent to the app */
  const ROOTS = ['/home/web_user/.renpy', '/game/saves'];
  let syncT = 0;
  const walk = (dir, out) => { for (const n of FS.readdir(dir)) { if (n === '.' || n === '..') continue; const p = dir + '/' + n; if (FS.isDir(FS.stat(p).mode)) walk(p, out); else out.push(p); } };
  function sendSaves() {
    const paths = []; for (const r of ROOTS) { try { walk(r, paths); } catch (e) { } }
    const files = paths.map(p => ({ p: p.slice(1), buf: FS.readFile(p).buffer }));
    post({ t: 'saves', files }, files.map(f => f.buf));
  }
  function initSaves() {
    const T = Object.assign({}, MEMFS, { mount: m => MEMFS.mount(m), syncfs: (mount, populate, cb) => { if (!populate) { clearTimeout(syncT); syncT = setTimeout(sendSaves, 300); } cb(null); } });
    for (const r of ROOTS) { mkdirs(r); try { FS.mount(T, {}, r); } catch (e) { fail(e); } }
    for (const s of SAVES) { const p = '/' + s.p; mkdirs(p.slice(0, p.lastIndexOf('/'))); FS.writeFile(p, new Uint8Array(s.buf)); }
  }
  function patchNew() { // Ren'Py 8.1 and newer (renpy.js), after renpy-pre.js ran
    const i = Module.preRun.findIndex(f => f && f.name === 'initFs');
    if (i >= 0) Module.preRun[i] = initSaves; else Module.preRun.push(initSaves);
    Module.preRun.push(function tkbGame() { Module.addRunDependency('tkbGame'); writeGame().then(() => { installLegacyModules(); startTrackedFS(); post({ t: 'loaded' }); Module.removeRunDependency('tkbGame'); }, fail); });
    const ae = window.atExit; window.atExit = () => { reportExit('atExit'); if (ae) ae(); };
  }
  function patchOld() { // Ren'Py 7 (index.js)
    const i = Module.preRun.findIndex(f => f && f.name === 'create_persistent');
    if (i >= 0) Module.preRun[i] = initSaves; else Module.preRun.push(initSaves);
    const orig = window.gameExtractAndRun;
    window.gameExtractAndRun = () => writeGame().then(() => { installLegacyModules(); startTrackedFS(); post({ t: 'loaded' }); orig(); }, fail);
    const iv = setInterval(() => { if (Module.quit && !Module.quit.tkb) { const o = Module.quit; Module.quit = function () { reportExit('Module.quit'); return o.apply(this, arguments); }; Module.quit.tkb = 1; clearInterval(iv); } }, 500);
  }
  async function start(m) {
    compatProfileId = String(m.compat || '');
    window.__tkbWorkDirs = m.dirs || [];
    fsRoots.clear(); fsRoots.add('game');
    for (const f of m.game || []) fsRememberRoot(f.p);
    for (const d of m.dirs || []) fsRememberRoot(d);
    for (const n of Object.keys(m.files)) {
      let data = m.files[n];
      // Ren'Py 8.1 and 8.2 ask for 'game.zip' by name: use the one handed over here
      if (n === 'renpy-pre.js') data = new TextDecoder().decode(data).replace(/fetch\((['"])game\.zip\1\)/g, 'fetch(window.gameZipURL)');
      URLS[n] = URL.createObjectURL(new Blob([data], { type: mime(n) }));
    }
    FILES = m.game; SAVES = m.saves || []; EXTRACT = m.extract || {}; MORE = m.more || []; LAZY = m.lazy || null;
    window.Module = window.Module || {};
    if (m.safeBoot) { // leave the proven modern runtime startup path untouched
      const previousPrintErr = Module.printErr;
      Module.printErr = function () {
        const line = Array.from(arguments).join(' ');
        if (graphOutput(line)) return;
        issue('stderr', line);
        if (/^\s*#\s*cleanup\s+sys\b/i.test(line)) {
          post({ t: 'shutdownhint', status: 'Python interpreter cleanup' });
          snapshotRuntimeFiles('Python cleanup');
        }
        if (typeof previousPrintErr === 'function') previousPrintErr.apply(this, arguments);
      };
      const previousPrint = Module.print;
      Module.print = function () {
        const line = Array.from(arguments).join(' ');
        if (graphOutput(line)) return;
        issue('stdout', line);
        if (typeof previousPrint === 'function') previousPrint.apply(this, arguments);
      };
      const previousAbort = Module.onAbort;
      Module.onAbort = function (reason) {
        issue('abort', reason);
        reportExit('abort', reason);
        if (typeof previousAbort === 'function') previousAbort.call(this, reason);
      };
      const previousExit = Module.onExit;
      Module.onExit = function (status) {
        reportExit('Module.onExit', status);
        if (typeof previousExit === 'function') previousExit.call(this, status);
      };
    }
    Module.locateFile = p => URLS[String(p).split('/').pop()] || p;
    if (LOADER === 'renpy.js') window.gameZipURL = URLS['engine.zip']; else window.DEFAULT_GAME_FILENAME = URLS['engine.zip'];
    try {
      for (const s of SCRIPTS) {
        if (!URLS[s]) continue;
        if (LOADER === 'renpy.js' && s === 'renpy.js') patchNew();
        if (LOADER === 'index.js' && s === 'index.js') patchOld();
        await load(URLS[s]);
      }
    } catch (e) { fail(e); }
  }
  window.addEventListener('message', e => {
    if (e.source !== P) return; const m = e.data || {};
    if (m.t === 'stepcapture') { stepCaptureOn = !!m.enabled; stepGateWaiting = !!m.waiting; if (!stepCaptureOn) stepSwallowClick = false; }
    else if (m.t === 'boot') start(m);
    else if (m.t === 'shot') shot(m.any);
    else if (m.t === 'autosave') autosave();
    else if (m.t === 'onscreen') onscreen();
    else if (m.t === 'compose') compose(m.picks || []);
    else if (m.t === 'pyq') { (async () => { let result = null, err = null; try { result = window.renpy_exec ? await window.renpy_exec(m.code) : null; } catch (e) { err = String(e); } post({ t: 'pyres', q: m.q, result, err }); })(); }
    else if (m.t === 'legacygraph') {
      try {
        const bytes = FS.readFile(LEGACY_GRAPH_FILE);
        const buf = bytes.buffer.byteLength === bytes.byteLength && bytes.byteOffset === 0 ? bytes.buffer : bytes.slice().buffer;
        post({ t: 'legacygraphres', q: m.q, buf }, [buf]);
      } catch (err) {
        let state = 'missing';
        try { state = FS.stat(LEGACY_GRAPH_FILE).size + ' bytes'; } catch (_) { }
        post({ t: 'legacygraphres', q: m.q, err: 'Snapshot ' + LEGACY_GRAPH_FILE + ' (' + state + '): ' + String(err.message || err) });
      }
    }
    else if (m.t === 'runtimeprobe') runtimeProbe();
    else if (m.t === 'vfsreq') fsRequest(m);
    else if (m.t === 'writefiles') { let ok = true; for (const f of m.files || []) { const path = '/' + f.p; try { if (f.text == null) FS.unlink(path); else { mkdirs(path.slice(0, path.lastIndexOf('/'))); try { FS.unlink(path); } catch (e) { } FS.writeFile(path, f.text); } } catch (e) { if (f.text != null) ok = false; } } post({ t: 'pyres', q: m.q, result: ok }); }
    else if (m.t === 'rpycmd') { try { window.renpy_exec && window.renpy_exec('store._tkb_cmd = ' + JSON.stringify(m.cmd).replace(/^\[/, '(').replace(/\]$/, ',)') + '\nresult = True'); } catch (e) { } }
    else if (m.t === 'gamesound') {
      const allow = !!m.on;
      if (allow === gameSoundOn) return;
      gameSoundOn = allow;
      for (const c of ACTX) { try { allow ? (nativeResume.get(c) || c.resume.bind(c))() : c.suspend(); } catch (_) {} }
      for (const el of mediaEls()) { try {
        if (allow) { if (el.__tkbPaused) { el.__tkbPaused = false; el.play(); } }
        else if (!el.paused) { el.__tkbPaused = true; el.pause(); }
      } catch (_) {} }
    }
    else if (m.q && waiting.has(m.q)) { const r = waiting.get(m.q); waiting.delete(m.q); r(m); }
  });
  window.addEventListener('error', e => { issue('javascript', e.error || e.message); fail(e.message); });
  /* Ren'Py's own loading steps go to the app's loading screen; it is ready when its stand-in picture (presplash) goes */
  { let seen = false, sent = false, last = '', shutdown = false, bootSafe = true, settleTimer = null;
    const hasDrawSurface = () => [...document.querySelectorAll('canvas')].some(c => c.width > 0 && c.height > 0);
    const ready = (force = false) => {
      if (!sent && !shutdown && !exitReported && (!bootSafe || force || hasDrawSurface())) {
        sent = true; post({ t: 'ready', visual: hasDrawSurface() });
      }
    };
    const maybeReady = () => {
      if (sent || shutdown || document.getElementById('presplash') || !seen) return;
      if (!bootSafe) { ready(); return; } // keep existing 7.x/8.x boot handling
      // In legacy safe boot, presplash also disappears on interpreter exit.
      // Require a live canvas and a short stable window before hiding diagnostics.
      if (!hasDrawSurface() || settleTimer) return;
      settleTimer = setTimeout(() => { settleTimer = null; if (!shutdown && !document.getElementById('presplash')) ready(); }, 1500);
    };
    const mo = new MutationObserver(() => {
      const pre = document.getElementById('presplash'); if (pre) seen = true;
      const st = document.getElementById('statusTextDiv') || document.getElementById('status');
      const t = st ? (st.innerText || st.textContent || '').trim().split('\n').filter(Boolean).pop() || '' : '';
      if (t && t !== last) {
        last = t; post({ t: 'status', text: t });
        if (/^bye!?$/i.test(t)) {
          shutdown = true; clearTimeout(settleTimer);
          try { flushFs(); } catch (_) { }
          try { sendSaves(); } catch (_) { }
          post({ t: 'shutdownhint', status: t });
          snapshotRuntimeFiles('status: ' + t);
          setTimeout(() => snapshotRuntimeFiles('after shutdown status'), 800);
        }
      }
      maybeReady();
    });
    const go = () => mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    window.addEventListener('message', e => {
      if (e.source !== P || !e.data || e.data.t !== 'boot') return;
      bootSafe = !!e.data.safeBoot;
      maybeReady();
      if (!bootSafe) setTimeout(() => ready(true), 90000);
    }); // never fake readiness in legacy safe boot
  }
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (e.key === 'Enter' && !e.isComposing && t && t.id === 'inputText') { e.preventDefault(); const f = document.getElementById('inputForm'); if (f) f.dispatchEvent(new Event('submit', { cancelable: true })); }
  }, true);
  /* a picture of the main menu, for the game's cover (only while the main menu is on screen) */
  async function shot(any) {
    let buf = null;
    try {
      if (window.renpy_exec) {
        try { FS.unlink('/tmp/tkbcover.png'); } catch (e) { }
        await window.renpy_exec(any ? 'result = renpy.screenshot("/tmp/tkbcover.png")' : 'result = renpy.get_screen("main_menu") is not None and renpy.screenshot("/tmp/tkbcover.png")');
        try { buf = FS.readFile('/tmp/tkbcover.png').buffer; FS.unlink('/tmp/tkbcover.png'); } catch (e) { buf = null; }
      }
    } catch (e) { buf = null; }
    post({ t: 'shotres', buf }, buf ? [buf] : []);
  }
  /* the picture files of what is on screen now, by layer (master: backgrounds and characters; screens: the interface) */
  async function onscreen() {
    // each thing on screen (in drawing order, back to front) with the picture files it is made of: [layer, index, files]
    let ents = null;
    const py = [
      '_tkb = []',
      '_tsl = renpy.game.context().scene_lists',
      'for _l in list(renpy.config.layers) + [x for x in _tsl.layers if x not in renpy.config.layers]:',
      '    for _i, _sle in enumerate(_tsl.layers.get(_l, [])):',
      '        _fs = []',
      '        def _cb(d, _fs=_fs):',
      '            _fn = getattr(d, "filename", None)',
      '            if _fn is not None and hasattr(_fn, "lower") and _fn not in _fs:',
      '                _fs.append(_fn)',
      '        try:',
      '            _sle.displayable.visit_all(_cb)',
      '        except Exception:',
      '            pass',
      '        if _fs:',
      '            _tkb.append([_l, _i, _fs])',
      'result = _tkb'].join('\n');
    const pyA = [
      '_tka = []',
      'for _c in getattr(renpy.audio.audio, "all_channels", []):',
      '    try:',
      '        _p = _c.get_playing()',
      '    except Exception:',
      '        _p = None',
      '    if _p:',
      '        _tka.append([_c.name, _p])',
      'result = _tka'].join('\n');
    let playing = [];
    try { if (window.renpy_exec) ents = await window.renpy_exec(py); } catch (e) { ents = null; }
    try { if (window.renpy_exec) playing = (await window.renpy_exec(pyA)) || []; } catch (e) { playing = []; }
    post({ t: 'onscreenres', ents, playing });
  }
  /* some of the things on screen drawn together into one picture, each where and as it is shown (picks: [[layer, index]]) */
  async function compose(picks) {
    let buf = null;
    const py = [
      '_tsl = renpy.game.context().scene_lists',
      '_tds = []',
      'for _l, _i in ' + JSON.stringify(picks) + ':',
      '    _es = _tsl.layers.get(_l, [])',
      '    if _i < len(_es):',
      '        _tds.append(_es[_i].displayable)',
      '_tf = renpy.display.layout.Fixed()',
      'for _d in _tds:',
      '    _tf.add(_d)',
      '_trv = renpy.render(_tf, renpy.config.screen_width, renpy.config.screen_height, 0, 0)',
      '_tsurf = renpy.display.draw.screenshot(_trv)',
      'import pygame_sdl2',
      'pygame_sdl2.image.save(_tsurf, "/tmp/tkbcomp.png")',
      'result = True'].join('\n');
    try {
      try { FS.unlink('/tmp/tkbcomp.png'); } catch (e) { }
      if (window.renpy_exec) await window.renpy_exec(py);
      buf = FS.readFile('/tmp/tkbcomp.png').buffer; FS.unlink('/tmp/tkbcomp.png');
    } catch (e) { buf = null; }
    post({ t: 'composeres', buf }, buf ? [buf] : []);
  }
  /* save to Ren'Py's newest auto-save slot now (the app is being hidden, closed or left), and hand the saves over at once */
  async function autosave() {
    let ok = false;
    try { if (window.renpy_exec) { await window.renpy_exec('renpy.force_autosave(True, True)'); ok = true; } } catch (e) { }
    clearTimeout(syncT); sendSaves(); post({ t: 'autosaved', ok });
  }
  post({ t: 'hello' });
}
/* ask the game to save to its auto-save now; resolves when the saves are stored (or after a few seconds) */
function gameAutosave() {
  if (!GAME.frame || !GAME.loaded || (GAME.g && GAME.g.game.engine === 'html')) return Promise.resolve(false);
  if (GAME.saving) return GAME.saving;
  GAME.saving = new Promise(res => {
    const t = setTimeout(() => done(false), 6000);
    const done = ok => { clearTimeout(t); GAME.onAutosaved = null; gameSaveChain.then(() => { GAME.saving = null; res(ok); }); };
    GAME.onAutosaved = ok => setTimeout(() => done(ok), 50); // its saves message comes just before this
    try { GAME.frame.contentWindow.postMessage({ t: 'autosave' }, '*'); } catch (e) { done(false); }
  });
  return GAME.saving;
}
/* switching mods while playing: Ren'Py reads its scripts once at the start, so the game is saved, started again with the new mods,
   and put back where it was (like Continue) */
//<<
