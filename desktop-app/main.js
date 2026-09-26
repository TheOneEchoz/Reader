// Tankōbon for Windows: an Electron window around the same web app.
// The library lives in Documents\Tankobon as encrypted files; screen updates are downloaded only when asked.
const { app, BrowserWindow, protocol, ipcMain, dialog, Notification, net, shell, session, Menu } = require('electron');
const path = require('path'), fs = require('fs'), fsp = fs.promises;

app.setAppUserModelId('io.github.theoneechoz.tankobon');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();

const LIB = path.join(app.getPath('documents'), 'Tankobon');
const USER = app.getPath('userData');
const CFG = path.join(USER, 'config.json');
const BUILT = path.join(__dirname, 'www');
let BUILT_VERSION = 0;
try { BUILT_VERSION = JSON.parse(fs.readFileSync(path.join(BUILT, 'version.json'), 'utf8')).version || 0; } catch (e) { }
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (e) { }
const saveCfg = () => fsp.writeFile(CFG, JSON.stringify(cfg, null, 1)).catch(() => { });
/* The screens come from a downloaded version only if it is newer than the one inside the app. */
function webDir() {
  if (cfg.web && cfg.web > BUILT_VERSION) {
    const d = path.join(USER, 'web', 'v' + cfg.web);
    if (fs.existsSync(path.join(d, 'index.html'))) return d;
  }
  return BUILT;
}
function inside(root, rel) {
  const p = path.resolve(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('bad path');
  return p;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };

let win = null;
/* ZIP / CBZ files opened with the app (double-click, Open with, dropped on the icon) */
const incoming = [];
function addIncoming(argv) {
  const found = argv.slice(1).filter(a => !a.startsWith('-') && /\.(zip|cbz|jpe?g|png|webp|gif|avif|bmp)$/i.test(a) && fs.existsSync(a));
  if (!found.length) return false;
  incoming.push(...found); return true;
}
addIncoming(process.argv);
function createWindow() {
  const b = cfg.win || { width: 1200, height: 860 };
  win = new BrowserWindow({
    ...b, minWidth: 360, minHeight: 480, backgroundColor: '#0f1012', autoHideMenuBar: true, show: false,
    title: 'Tankōbon', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, spellcheck: false },
  });
  if (cfg.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => { cfg.maximized = win.isMaximized(); if (!cfg.maximized && !win.isFullScreen()) cfg.win = win.getBounds(); saveCfg(); });
  // F11: full screen. Mouse back button and Alt+Left: go back inside the app.
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    if (i.key === 'F5' || (i.control && i.key.toLowerCase() === 'r')) { e.preventDefault(); win.webContents.reload(); }
    if (i.control && i.shift && i.key.toLowerCase() === 'i') { e.preventDefault(); win.webContents.toggleDevTools(); }
    if (i.alt && i.key === 'ArrowLeft') { e.preventDefault(); if (win.webContents.navigationHistory.canGoBack()) win.webContents.navigationHistory.goBack(); }
  });
  win.on('app-command', (e, cmd) => { if (cmd === 'browser-backward' && win.webContents.navigationHistory.canGoBack()) win.webContents.navigationHistory.goBack(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://tkb/')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
  win.loadURL('app://tkb/index.html');
}

app.on('second-instance', (e, argv) => {
  const got = addIncoming(argv);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (got) win.webContents.send('incoming'); }
});
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await fsp.mkdir(LIB, { recursive: true }).catch(() => { });
  protocol.handle('app', async req => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    try {
      if (p.startsWith('/_lib/')) {
        const data = await fsp.readFile(inside(LIB, p.slice(6)));
        return new Response(data, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } });
      }
      if (p === '/' || p === '') p = '/index.html';
      const f = inside(webDir(), p.slice(1));
      const data = await fsp.readFile(f);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
    } catch (e) {
      return new Response('', { status: 404 });
    }
  });
  const allowed = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'wakeLock', 'idle-detection']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => allowed.has(perm));
  createWindow();
});

/* ---------- library files (paths relative to Documents\Tankobon) ---------- */
ipcMain.handle('lib:info', async () => ({ root: LIB }));
ipcMain.handle('lib:write', async (e, rel, data) => {
  const f = inside(LIB, rel);
  await fsp.mkdir(path.dirname(f), { recursive: true });
  const tmp = f + '.part';
  await fsp.writeFile(tmp, Buffer.from(data));
  await fsp.rename(tmp, f);
});
ipcMain.handle('lib:mkdir', async (e, rel) => { await fsp.mkdir(inside(LIB, rel), { recursive: true }); });
ipcMain.handle('lib:del', async (e, rel) => { await fsp.unlink(inside(LIB, rel)).catch(() => { }); });
ipcMain.handle('lib:list', async (e, rel) => (await fsp.readdir(inside(LIB, rel), { withFileTypes: true })).map(d => ({ name: d.name, dir: d.isDirectory() })));
ipcMain.handle('info:read', async () => { try { return JSON.parse(await fsp.readFile(path.join(LIB, 'tankobon.json'), 'utf8')); } catch (e) { return null; } });
ipcMain.handle('info:write', async (e, obj) => {
  const f = path.join(LIB, 'tankobon.json');
  await fsp.writeFile(f + '.part', JSON.stringify({ note: 'Encrypted Tankōbon library. Open it from the app with your password.', ...obj }, null, 1));
  await fsp.rename(f + '.part', f);
});

/* ---------- picking a folder of images to import ---------- */
const picked = new Set();
async function walk(root, dir, out, depth) {
  if (depth > 12) return;
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue;
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) await walk(root, abs, out, depth + 1);
    else if (d.isFile()) out.push({ path: path.relative(root, abs).split(path.sep).join('/'), name: d.name, uri: abs, size: (await fsp.stat(abs)).size, type: '' });
  }
}
ipcMain.handle('pick:folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a folder of images', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { files: [] };
  const root = r.filePaths[0]; picked.add(root);
  const files = []; await walk(root, root, files, 0);
  return { name: path.basename(root), files };
});
ipcMain.handle('incoming:take', async () => {
  const list = incoming.splice(0).map(p => { picked.add(p); return { path: p, name: path.basename(p) }; });
  return list;
});
ipcMain.handle('win:focus', async () => { if (win) { win.show(); win.focus(); } });
ipcMain.handle('pick:read', async (e, abs) => {
  const ok = [...picked].some(r => abs === r || abs.startsWith(r + path.sep));
  if (!ok) throw new Error('not a picked file');
  return fsp.readFile(abs);
});
ipcMain.handle('save:file', async (e, name, data) => {
  const r = await dialog.showSaveDialog(win, { title: 'Save', defaultPath: path.join(app.getPath('documents'), name) });
  if (r.canceled || !r.filePath) throw new Error('Saving was cancelled');
  await fsp.writeFile(r.filePath, Buffer.from(data));
  return r.filePath;
});

/* ---------- privacy ---------- */
ipcMain.handle('sec:set', async (e, on) => { if (win) win.setContentProtection(!!on); });

/* ---------- updates of the screens ---------- */
ipcMain.handle('net:json', async (e, url) => {
  const r = await net.fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
});
ipcMain.handle('upd:download', async (e, ver, files, site) => {
  const dir = path.join(USER, 'web', 'v' + Number(ver));
  await fsp.mkdir(dir, { recursive: true });
  let i = 0;
  for (const f of files) {
    const target = inside(dir, f);
    const r = await net.fetch(site + encodeURI(f) + '?v=' + ver, { cache: 'no-store' });
    if (!r.ok) throw new Error(`could not download ${f} (HTTP ${r.status})`);
    await fsp.writeFile(target, Buffer.from(await r.arrayBuffer()));
    e.sender.send('upd:progress', ++i, files.length);
  }
  const st = await fsp.stat(path.join(dir, 'index.html'));
  if (st.size < 1000) throw new Error('the download was incomplete');
});
ipcMain.handle('upd:use', async (e, ver) => { cfg.web = Number(ver); await saveCfg(); setTimeout(() => win && win.loadURL('app://tkb/index.html'), 50); });
ipcMain.handle('upd:builtin', async () => { cfg.web = 0; await saveCfg(); setTimeout(() => win && win.loadURL('app://tkb/index.html'), 50); });
ipcMain.handle('upd:cleanup', async (e, keep) => {
  const base = path.join(USER, 'web');
  for (const n of await fsp.readdir(base).catch(() => [])) if (!keep.includes(n) && n !== 'v' + cfg.web) await fsp.rm(path.join(base, n), { recursive: true, force: true }).catch(() => { });
});
ipcMain.handle('notify', async (e, title, body) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'icon.png') });
  n.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.webContents.send('open-updates'); } });
  n.show();
});
