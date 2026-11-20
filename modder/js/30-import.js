/* Adds a game: reads a folder or zip, finds the game, stores it in pieces */
//>> js/30-import.js#0
const fileItem = f => ({ path: (f.relPath || f.webkitRelativePath || f.name).replace(/\\/g, '/'), size: f.size || 0, mtime: f.lastModified || 0, blob: async () => loadPicked(f) });
/* the files in a ZIP (or an Android APK, which is a ZIP): read from the file a piece at a time, so a game of several gigabytes
   never has to fit in memory (a phone could not hold it); each file is unpacked only when it is needed */
async function zipItemsLazy(file) {
  const u8 = async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());
  const n = file.size, tailLen = Math.min(n, 65557 + 20), tail = await u8(n - tailLen, n), dv = new DataView(tail.buffer);
  let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a ZIP');
  let count = dv.getUint16(e + 10, true), cdSize = dv.getUint32(e + 12, true), cdOff = dv.getUint32(e + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) { // ZIP64 (over 4 GB, or very many files)
    const L = e - 20; if (L < 0 || dv.getUint32(L, true) !== 0x07064b50) throw new Error('ZIP64 locator missing');
    const z64 = Number(dv.getBigUint64(L + 8, true)), h = new DataView((await u8(z64, z64 + 56)).buffer);
    if (h.getUint32(0, true) !== 0x06064b50) throw new Error('ZIP64 record missing');
    count = Number(h.getBigUint64(32, true)); cdSize = Number(h.getBigUint64(40, true)); cdOff = Number(h.getBigUint64(48, true));
  }
  const cd = await u8(cdOff, cdOff + cdSize), c = new DataView(cd.buffer), utf8 = new TextDecoder('utf-8'), out = [];
  let p = 0;
  for (let k = 0; k < count && p + 46 <= cd.length; k++) {
    if (c.getUint32(p, true) !== 0x02014b50) break;
    const flags = c.getUint16(p + 8, true), method = c.getUint16(p + 10, true), tm = c.getUint16(p + 12, true), dt = c.getUint16(p + 14, true);
    let comp = c.getUint32(p + 20, true), size = c.getUint32(p + 24, true), off = c.getUint32(p + 42, true);
    const nl = c.getUint16(p + 28, true), xl = c.getUint16(p + 30, true), cl = c.getUint16(p + 32, true);
    const name = utf8.decode(cd.subarray(p + 46, p + 46 + nl));
    for (let q = p + 46 + nl, end = q + xl; q + 4 <= end;) { // ZIP64 sizes and offset
      const id = c.getUint16(q, true), len = c.getUint16(q + 2, true);
      if (id === 1) { let r = q + 4; if (size === 0xffffffff) { size = Number(c.getBigUint64(r, true)); r += 8; } if (comp === 0xffffffff) { comp = Number(c.getBigUint64(r, true)); r += 8; } if (off === 0xffffffff) { off = Number(c.getBigUint64(r, true)); } }
      q += 4 + len;
    }
    p += 46 + nl + xl + cl;
    if (name.endsWith('/') || hiddenPath(name)) continue;
    const mtime = new Date(1980 + (dt >> 9), ((dt >> 5) & 15) - 1, dt & 31, tm >> 11, (tm >> 5) & 63, (tm & 31) * 2).getTime();
    out.push({ path: name.replace(/\\/g, '/'), size, mtime, blob: async () => {
      if (flags & 1) throw new Error('This ZIP is password-protected.');
      const lh = new DataView((await u8(off, off + 30)).buffer);
      if (lh.getUint32(0, true) !== 0x04034b50) throw new Error('Broken ZIP entry: ' + name);
      const start = off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true), data = file.slice(start, start + comp);
      if (method === 0) return data;
      if (method !== 8) throw new Error('Unsupported ZIP packing in ' + name);
      return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    } });
  }
  return out;
}
async function zipItems(file) {
  if (typeof DecompressionStream !== 'undefined' && file.slice) { try { new DecompressionStream('deflate-raw'); return await zipItemsLazy(file); } catch (e) { } }
  if (typeof JSZip === 'undefined') throw new Error('The ZIP reader could not load.');
  const zip = await JSZip.loadAsync(file);
  return Object.values(zip.files).filter(z => !z.dir && !hiddenPath(z.name)).map(z => ({ path: z.name.replace(/\\/g, '/'), size: (z._data && z._data.uncompressedSize) || 0, mtime: z.date ? z.date.getTime() : 0, blob: () => z.async('blob') }));
}
/* a file inside a .tar.gz (read as it unpacks, stopping at the file): {size, blob} or null */
async function tarFind(blob, re) {
  const rd = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader(), td = new TextDecoder();
  let buf = new Uint8Array(0);
  const more = async () => { const { value, done } = await rd.read(); if (done) return false; const b = new Uint8Array(buf.length + value.length); b.set(buf); b.set(value, buf.length); buf = b; return true; };
  const need = async n => { while (buf.length < n) if (!await more()) return false; return true; };
  try {
    for (;;) {
      if (!await need(512)) return null;
      const h = buf.subarray(0, 512); if (h.every(x => x === 0)) return null;
      const str = (a, l) => td.decode(h.subarray(a, a + l)).split('\0')[0];
      let name = str(0, 100); const prefix = str(345, 155); if (prefix) name = prefix + '/' + name;
      const size = parseInt(str(124, 12).trim() || '0', 8) || 0, padded = Math.ceil(size / 512) * 512;
      buf = buf.subarray(512);
      if (re.test(name.replace(/^\.\//, '')) && size < 8e6) { if (!await need(size)) return null; const data = buf.slice(0, size); rd.cancel().catch(() => { }); return { size, blob: new Blob([data]) }; }
      let left = padded; while (left > 0) { if (!buf.length && !await more()) return null; const k = Math.min(left, buf.length); buf = buf.subarray(k); left -= k; }
    }
  } catch (e) { return null; }
}
/* a Ren'Py game made for Android (an .apk): its files are in assets/x-game/, every name with "x-" in front (Android cannot
   keep some of Ren'Py's names as they are). Read as the game folder; the Ren'Py version comes from private.mp3, the
   package of Ren'Py's own files. Returns the game's files as if from a folder, or null. */
async function apkGame(file) {
  const its = await zipItems(file);
  const strip = p => p.split('/').map(c => c.startsWith('x-') ? c.slice(2) : c).join('/');
  const root = (baseName(file.name).replace(/[\/]+/g, '_') || 'Game') + '/';
  const game = its.filter(it => /^assets\/x-game\//.test(it.path)).map(it => ({ ...it, path: root + strip(it.path.slice(7)) }));
  if (!game.length) return null;
  const priv = its.find(it => it.path === 'assets/private.mp3');
  if (priv && typeof DecompressionStream !== 'undefined') {
    const v = await tarFind(await priv.blob(), /^renpy\/(__pycache__\/)?vc_version\b/);
    if (v) game.push({ path: root + 'renpy/vc_version.py', size: v.size, mtime: 0, blob: async () => v.blob, extra: true });
  }
  return game;
}
/* Ren'Py games among dropped/picked files: [{found, title}] and the files that are not part of a game */
async function rpyGamesIn(files) {
  const games = [], rest = [];
  const tops = new Map();
  for (const f of files) { const p = (f.relPath || f.webkitRelativePath || '').replace(/\\/g, '/'); if (p.includes('/')) { const t = p.split('/')[0]; if (!tops.has(t)) tops.set(t, []); tops.get(t).push(f); } else rest.push(f); }
  for (const [t, list] of tops) { const its = list.map(fileItem), found = rpyFind(its); if (found) { games.push({ found, title: rpyTitle(found.root, t) }); continue; } const hf = htmlFind(its); if (hf) games.push({ found: hf, html: hf.kind, title: htmlTitle(hf, t) }); else rest.push(...list); }
  for (const f of rest.slice()) {
    if (/\.apk$/i.test(f.name)) {
      try { const its = await apkGame(f), found = its && rpyFind(its); if (found) { games.push({ found, title: rpyTitle(found.root, baseName(f.name)), apk: true }); rest.splice(rest.indexOf(f), 1); } } catch (e) { }
      continue;
    }
    if (!/\.zip$/i.test(f.name)) continue;
    try {
      const its = await zipItems(f), found = rpyFind(its);
      if (found) { games.push({ found, title: rpyTitle(found.root, baseName(f.name)) }); rest.splice(rest.indexOf(f), 1); }
      else { const hf = htmlFind(its); if (hf) { games.push({ found: hf, html: hf.kind, title: htmlTitle(hf, baseName(f.name)) }); rest.splice(rest.indexOf(f), 1); } }
    } catch (e) { }
  }
  return { games, rest };
}
async function rpyCover(found) {
  const rel = it => it.path.slice(found.root.length).toLowerCase();
  const imgs = found.items.filter(it => /^game\//.test(rel(it)) && /\.(png|jpe?g|webp)$/i.test(it.path) && it.size < 30e6);
  const rank = it => { const r = rel(it); return /^game\/gui\/main_menu\./.test(r) ? 0 : /\/(title|cover|main_?menu|splash|key_?art)[^/]*$/.test(r) ? 1 : /^game\/gui\/game_menu\./.test(r) ? 2 : /window_icon|\/gui\//.test(r) ? 5 : 3; };
  const list = imgs.sort((a, b) => rank(a) - rank(b) || b.size - a.size).slice(0, 6);
  for (const it of list) { try { const blob = await it.blob(), t = await makeThumb(blob); if (t.w >= 64) return { blob, t, name: it.path.split('/').pop() }; } catch (e) { } }
  return null;
}
async function drawnCover(title, kindLabel) {
  const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 800); gr.addColorStop(0, '#2a2140'); gr.addColorStop(1, '#0f1012'); x.fillStyle = gr; x.fillRect(0, 0, 600, 800);
  x.fillStyle = '#fff'; x.font = 'bold 54px sans-serif'; x.textAlign = 'center';
  const words = title.split(/\s+/), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > 520 && line) { lines.push(line); line = w; } else line = t; } lines.push(line);
  lines.slice(0, 5).forEach((l, i) => x.fillText(l, 300, 360 + i * 66 - (lines.length - 1) * 33));
  x.fillStyle = 'rgba(255,255,255,.55)'; x.font = '28px sans-serif'; x.fillText(kindLabel || "Ren'Py game", 300, 720);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
  return { blob, t: await makeThumb(blob), name: 'cover.jpg' };
}
/* These paths belong to the game, even if they live alongside game/ rather than inside it.
   Do not include packaged Python, native libraries, executables, or the host filesystem. */
const rpyVirtualSidecar = p => /^(?:characters|persistent|scripts|data|saves-external)\//i.test(p) || /^(?:readme|copyright|log|traceback|errors|firstrun)\.(?:txt|json|chr|dat|ini|log)$/i.test(p);
const rpyImportablePath = p => !!p && !hiddenPath(p) && !/^game\/saves\//i.test(p) && (/^game\//i.test(p) || rpyVirtualSidecar(p));

/* Restore missing original game files (such as DDLC's characters/*.chr) from the
   user's original archive. Keep saves, mods, per-game edits, and existing imported
   files unchanged. No runtime or Python library files are copied. */
async function rpyRestoreMissing(gid, archive, onProgress = () => {}) {
  const g = await S.gal(gid);
  if (!isGame(g) || g.game.engine === 'html') throw new Error('Choose a Ren\'Py game.');
  if (!archive || !/\.zip$/i.test(archive.name)) throw new Error('Choose the original game ZIP.');
  const found = rpyFind(await zipItems(archive));
  if (!found) throw new Error('The ZIP does not contain a Ren\'Py game.');
  if (g.game.root && gameKey(rpyTitle(found.root)) !== gameKey(rpyTitle(g.game.root))) throw new Error('The ZIP appears to contain a different game.');
  const det = await rpyVersion(found).catch(() => ({}));
  if (g.game.ver && det.v && g.game.ver !== det.v) throw new Error(`The archive uses Ren'Py ${det.v}, but this import uses ${g.game.ver}. Choose the matching game ZIP.`);
  const list = (await rpyGetJSON(g.game.list)) || [];
  const present = new Set(list.map(f => f.p.toLowerCase()));
  const missing = found.items.filter(it => {
    const p = it.path.slice(found.root.length);
    return rpyImportablePath(p) && !present.has(p.toLowerCase());
  });
  const added = [], chunks = [], total = missing.reduce((n,it) => n + it.size,0);
  let done = 0, committed = false;
  try {
    for (const it of missing) {
      const blob = await it.blob(), c = [];
      for (let off = 0; off < blob.size || (off === 0 && !c.length); off += RPY_CHUNK) {
        const id = await rpyPut(await blob.slice(off, off + RPY_CHUNK).arrayBuffer());
        chunks.push(id); c.push(id);
        done += Math.min(RPY_CHUNK, Math.max(0, blob.size - off)); onProgress(done, total, it.path);
        if (!blob.size) break;
      }
      added.push({ p: it.path.slice(found.root.length), s: blob.size, c, t: it.mtime || 0 });
    }
    if (added.length) {
      await rpyPutJSON([...list, ...added], g.game.list);
      committed = true; // Original list now references the restored chunks.
      g.game.files = list.length + added.length;
      g.game.size = list.reduce((n,f)=>n+f.s,0) + added.reduce((n,f)=>n+f.s,0);
      await saveGallery(g);
    }
    return { count: added.length, names: added.map(f => f.p), bytes: added.reduce((n,f)=>n+f.s,0) };
  } catch (e) { if (!committed) await ST.delMany('images',chunks).catch(()=>{}); throw e; }
}

/* store a found game as a new gallery-like record. onProg(done, total) */
async function rpyImport(found, title, det, rt, onProg = () => { }, cancelled = () => false, withSaves = true) {
  const rel = it => it.path.slice(found.root.length);
  // Include narrative-critical mutable sidecars such as DDLC's characters/.
  const files = found.items.filter(it => rpyImportablePath(rel(it)));
  const saves = withSaves ? found.items.filter(it => /^game\/saves\/[^/]+/i.test(rel(it)) && !hiddenPath(rel(it))) : [];
  const total = files.reduce((n, it) => n + it.size, 0) || 1; let done = 0;
  const g = newGallery(title); Tree.ensureRoot(g);
  const list = [], made = [];
  try {
    for (const it of files) {
      if (cancelled()) throw new Error('Stopped.');
      const blob = await it.blob(), c = [];
      for (let off = 0; off < blob.size || (off === 0 && !c.length); off += RPY_CHUNK) {
        const part = await blob.slice(off, off + RPY_CHUNK).arrayBuffer(); const id = await rpyPut(part); c.push(id); made.push(id);
        done += part.byteLength; onProg(done, total);
        if (!blob.size) break;
      }
      list.push({ p: rel(it), s: blob.size, c, t: it.mtime || 0 });
    }
    const sv = {};
    for (const it of saves) { const buf = await (await it.blob()).arrayBuffer(); const id = await rpyPut(buf); made.push(id); sv[rel(it)] = { s: buf.byteLength, c: [id] }; }
    const cov = (await rpyCover(found)) || (await drawnCover(title));
    const cid = uid(); await S.putBlob('images', cid, cov.blob); await S.putBlob('thumbs', cid, cov.t.thumb); made.push(cid);
    g.meta[cid] = [cov.t.w, cov.t.h, cov.name]; g.cover = cid; g.customCover = cid;
    const listId = await rpyPutJSON(list), svId = await rpyPutJSON(sv); made.push(listId, svId);
    g.game = { engine: 'renpy', ver: det.v || null, py: det.py || null, how: det.how || null, rt,
      bootMode: TKB_COMPAT.profile({ver:det.v}).defaultBoot, list: listId, sv: svId, files: list.length, size: list.reduce((n, f) => n + f.s, 0), addedAt: Date.now(),
      root: found.root.replace(/\/$/, '').split('/').pop() || null, saveDir: await gameSaveDirName(list).catch(() => null) };
    await saveGallery(g);
    return g;
  } catch (e) { await ST.delMany('images', made).catch(() => { }); await ST.delMany('thumbs', made).catch(() => { }); throw e; }
}
/* the sheet for adding one or more found games */
/* a new version of a game already in the library: the new files take the place of the old ones;
   the saves, mods, cover, name, tags and folder stay. ng is the new copy just read by rpyImport (it is folded in and removed). */
const gameKey = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
//<<
