/* Ren'Py games: what is a game, find its parts, pick a runtime version, keep pieces (chunks) in storage */
//>> js/10-basics.js#0
const RPY_BASE = SITE + 'renpy/';
const RPY_CHUNK = 4 << 20;
/* the Ren'Py versions on the website (renpy/versions.txt), newest first; mb: download size */
const RPY_RUNTIMES = [
  { v: '8.5.3', py: '3.12', mb: 41 }, { v: '8.4.1', py: '3.12', mb: 42 }, { v: '8.3.7', py: '3.11', mb: 41 }, { v: '8.2.3', py: '3.11', mb: 39 },
  { v: '8.1.3', py: '3.11', mb: 35 }, { v: '7.8.7', py: '2.7', mb: 22 }, { v: '7.7.3', py: '2.7', mb: 21 }, { v: '7.6.3', py: '2.7', mb: 20 },
  { v: '7.5.3', py: '2.7', mb: 19 }, { v: '7.4.11', py: '2.7', mb: 19 },
  // The official 7.3.5 web-support package exists, but the configured Tankōbon server
  // must host a compatible runtime.json + engine/web files before this can be downloaded.
  { v: '7.3.5', py: '2.7', mb: null, experimental: true }];
const rpyLoader = v => v.startsWith('7.') ? 'index.js' : 'renpy.js';
const RPY_FILES = {
  'renpy.js': ['web/index.html', 'web/renpy-pre.js', 'web/renpy.js', 'web/renpy.wasm', 'web/renpy.data', 'engine.zip'],
  'index.js': ['web/index.html', 'web/index.js', 'web/index.wasm', 'web/pythonhome-data.js', 'web/pythonhome.data', 'web/pyapp-data.js', 'web/pyapp.data', 'engine.zip'],
};
const vcmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const isGame = g => !!(g && g.game);

/* ---------- finding a game among dropped or picked files ----------
   items: [{path, size, blob()}] with / in paths. A game is a folder holding game/ with Ren'Py scripts or archives. */
function rpyFind(items) {
  let root = null;
  for (const it of items) {
    const p = it.path; if (!/\.(rpyc|rpy|rpa|rpymc)$/i.test(p)) continue;
    const k = /^game\//i.test(p) ? 0 : p.search(/\/game\//i) + 1; if (k < 0 || (k === 0 && !/^game\//i.test(p))) continue;
    const r = p.slice(0, k); if (root === null || r.length < root.length) root = r;
  }
  if (root === null) return null;
  return { root, items: items.filter(it => it.path.startsWith(root)) };
}
/* ---------- HTML games: RPG Maker MV and MZ, and other games made as a web page ----------
   Kept like a Ren'Py game (files encrypted in pieces), stored under "game/" + the path from the folder with index.html. */
//<<

//>> js/10-basics.js#1
function rpyTitle(root, fallback) {
  let t = (root.replace(/\/$/, '').split('/').pop() || fallback || 'Game').trim();
  t = t.replace(/([-_ ](v?\d+(\.\d+)*[a-z]?|pc|win|windows|linux|mac|market|all|dists?|web|android|apk|release|debug|universal|arm64(-v8a)?|armeabi(-v7a)?|x86(_64)?))+$/i, '') || t;
  if (!/\s/.test(t)) t = t.replace(/[_]+/g, ' ');
  return t;
}
/* Which Ren'Py made it: version files, logs from playing it, or at least which Python compiled its engine. */
async function rpyVersion(f) {
  const rel = it => it.path.slice(f.root.length);
  const text = async it => { const u = new Uint8Array(await (await it.blob()).slice(0, 2e6).arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return s; };
  const pick = s => { const m = s.match(/(?:^|[^\d.])([678])\.(\d{1,2})\.(\d{1,2})(?:\.\d+)?(?![\d])/); return m ? `${m[1]}.${m[2]}.${m[3]}` : null; };
  for (const it of f.items.filter(it => /^renpy\/(__pycache__\/)?vc_version\b[^/]*$/i.test(rel(it)))) { const v = pick(await text(it)); if (v) return { v, how: 'version' }; }
  { const it = f.items.find(x => /^game\/script_version\.txt$/i.test(rel(x))); if (it) { const m = (await text(it)).match(/\(\s*([678])\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})/); if (m) return { v: `${m[1]}.${m[2]}.${m[3]}`, how: 'version' }; } }
  for (const n of ['log.txt', 'traceback.txt', 'errors.txt']) {
    const it = f.items.find(x => rel(x).toLowerCase() === n); if (!it) continue;
    const m = (await text(it)).match(/Ren'Py ([678]\.\d+\.\d+)/); if (m) return { v: m[1], how: 'log' };
  }
  for (const it of f.items.filter(it => /^renpy\/(__pycache__\/)?__init__\b[^/]*$/i.test(rel(it)))) { const v = pick(await text(it)); if (v) return { v, how: 'version' }; }
  const tag = f.items.map(it => (rel(it).match(/^renpy\/.*\.cpython-3(\d+)\.pyc$/) || [])[1]).find(Boolean);
  if (tag) return { py: '3.' + tag, how: 'python' };
  if (f.items.some(it => /^renpy\/.*\.pyo$/i.test(rel(it)))) return { py: '2.7', how: 'python' };
  return {};
}
/* The Ren'Py to play it with: the same version line if the website has it, else the nearest newer one of the same major
   version (newer Ren'Py plays older games), else the newest. Ren'Py 8.0 games need 8.1: the 8.0 web version was Python 2. */
function rpyChoose(det) {
  const R = RPY_RUNTIMES, py3 = R.filter(r => r.py !== '2.7'), py2 = R.filter(r => r.py === '2.7');
  const near = (pool, v) => {
    const [M, m] = v.split('.').map(Number), mm = r => r.v.split('.').map(Number);
    return pool.find(r => mm(r)[0] === M && mm(r)[1] === m) || pool.filter(r => mm(r)[0] === M && mm(r)[1] > m).sort((a, b) => vcmp(a.v, b.v))[0] || pool[0];
  };
  if (det.v) {
    const M = +det.v.split('.')[0];
    if (M >= 8) return { rt: near(py3, det.v).v, sure: true };
    // 7.3 was the first web-capable 7.x release. For pre-web games retain
    // the existing 7.4.11 compatibility fallback until the user chooses otherwise.
    const old = vcmp(det.v, '7.3.0') < 0;
    return { rt: near(py2, old ? '7.4.0' : det.v).v, sure: !old, old };
  }
  if (det.py === '2.7') return { rt: py2[0].v };
  if (det.py) return { rt: (det.py === '3.9' ? py3.find(r => r.v.startsWith('8.1')) : py3.find(r => r.py === det.py) || py3[0]).v };
  return { rt: py3[0].v };
}
const rpyRuntime = v => RPY_RUNTIMES.find(r => r.v === v) || { v, mb: 40 };

/* ---------- encrypted pieces ---------- */
async function rpyPut(buf) { const id = uid(); await ST.put('images', { id, t: 'application/octet-stream', e: await Crypt.enc(buf) }); return id; }
async function rpyGet(id) { const r = await ST.get('images', id); if (!r || !r.e) throw new Error('A piece of the game is missing.'); return Crypt.dec(r.e); }
async function rpyRead(ids, size) {
  const out = new Uint8Array(size); let off = 0;
  for (const id of ids) { const u = new Uint8Array(await rpyGet(id)); out.set(u, off); off += u.length; }
  return out.buffer;
}
async function rpyPutJSON(o, id) { id = id || uid(); await ST.put('images', { id, t: 'application/json', e: await Crypt.encJSON(o) }); return id; }
async function rpyGetJSON(id) { if (!id) return null; const r = await ST.get('images', id).catch(() => null); if (!r || !r.e) return null; try { return await Crypt.decJSON(r.e); } catch (e) { return null; } }
/* every record a game uses (for deleting it) */
async function rpyIds(g) {
  if (!isGame(g)) return [];
  const out = [g.game.list, g.game.sv, g.game.coverOrig, g.game.ana, g.game.dims, g.game.vfs].filter(Boolean);
  for (const f of (await rpyGetJSON(g.game.list)) || []) out.push(...f.c);
  for (const m of g.game.mods || []) { out.push(m.list); for (const f of (await rpyGetJSON(m.list)) || []) out.push(...f.c); }
  for (const s of Object.values((await rpyGetJSON(g.game.sv)) || {})) out.push(...s.c);
  for (const f of Object.values(((await rpyGetJSON(g.game.vfs)) || {}).files || {})) if (f.c) out.push(...f.c);
  return out;
}

/* ---------- the downloaded parts of Ren'Py (one per version), kept with this account ---------- */
//<<
