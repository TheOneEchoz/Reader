/* Tankōbon per-game virtual workspace. Original imported archives are immutable;
   only per-game overlay files and tombstones are persisted (storage encryption depends on the host app). */
const TKB_VFS = (() => {
  const queues = new Map(), requests = new Map();
  let qseq = 0;
  const MAX_FILE = 16 * 1024 * 1024;
  const deny = new Set(['lib','usr','home','tmp','proc','dev','etc','sys','bin','_placeholders','renpy','site-packages']);
  function path(raw, allowRoot = false) {
    let p = String(raw == null ? '' : raw).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!p && allowRoot) return '';
    if (!p || p.length > 1024 || /[\x00-\x1f\x7f]/.test(p) || p.split('/').some(x => !x || x === '.' || x === '..') || deny.has(p.split('/')[0].toLowerCase()) || /^game\/saves(?:\/|$)/i.test(p)) throw new Error('Invalid or protected virtual path.');
    return p;
  }
  function live(gid) { return !!(GAME.frame && GAME.g && GAME.g.id === gid && GAME.fsReady); }
  async function overlay(g) { return (await rpyGetJSON(g.game.vfs)) || { files: {}, dirs: {} }; }
  async function mutate(gid, entries) {
    const prev = queues.get(gid) || Promise.resolve();
    const job = prev.catch(() => {}).then(async () => {
      const g = await S.gal(gid); if (!isGame(g)) throw new Error('The game is no longer installed.');
      const o = await overlay(g), removed = [];
      for (const e of entries) {
        const p = path(e.p);
        if (/^game\/zzzz_tankobon_.*\.rpyc?$/i.test(p)) continue; // Never persist temporary editor scripts.
        if (e.dir) {
          if (e.deleted) delete o.dirs[p]; else o.dirs[p] = true;
          if (e.deleted) for (const k of Object.keys(o.dirs)) if (k.startsWith(p + '/')) delete o.dirs[k];
          continue;
        }
        const old = o.files[p]; if (old && old.c) removed.push(...old.c);
        if (e.deleted) o.files[p] = { deleted: true, t: Date.now() };
        else {
          const data = e.buf instanceof ArrayBuffer ? new Uint8Array(e.buf) : new Uint8Array(e.buf || []);
          if (data.byteLength > MAX_FILE) throw new Error('Virtual file exceeds the 16 MB editing limit.');
          const c = [];
          for (let i = 0; i < data.byteLength; i += RPY_CHUNK) c.push(await rpyPut(data.slice(i, i + RPY_CHUNK).buffer));
          // Empty files still need a valid descriptor, but no stored chunks.
          o.files[p] = { p, c, s: data.byteLength, t: Date.now() };
        }
      }
      if (!g.game.vfs) { g.game.vfs = await rpyPutJSON(o); await saveGallery(g); }
      else await rpyPutJSON(o, g.game.vfs);
      if (removed.length) await ST.delMany('images', removed).catch(() => {});
      return true;
    });
    queues.set(gid, job); return job;
  }
  async function entries(g) {
    g = (await S.gal(g.id)) || g;
    const list = await gameFileList(g, 'on'), o = await overlay(g);
    const files = list.map(f => ({ p: f.p, size: f.s, dir: false, changed: !!o.files[f.p] }));
    const dirs = new Set(Object.keys(o.dirs));
    for (const f of files) { const s = f.p.split('/'); while (s.length > 1) { s.pop(); dirs.add(s.join('/')); } }
    return [...[...dirs].map(p => ({ p, dir: true, size: 0 })), ...files];
  }
  async function readStored(g, raw) {
    g = (await S.gal(g.id)) || g;
    const p = path(raw), list = await gameFileList(g, 'on'), f = list.find(f => f.p.toLowerCase() === p.toLowerCase());
    if (!f) throw new Error('File not found in the virtual workspace.');
    if (f.s > MAX_FILE) throw new Error('File is too large to open here (16 MB limit).');
    return await rpyRead(f.c, f.s);
  }
  function request(gid, op, data = {}) {
    if (!live(gid)) return Promise.reject(new Error('The game runtime is not connected.'));
    const q = 'vf-' + (++qseq), frame = GAME.frame;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { requests.delete(q); reject(new Error('The runtime did not respond to the file request.')); }, 12000);
      requests.set(q, { resolve, reject, t, frame });
      frame.contentWindow.postMessage({ t: 'vfsreq', q, op, ...data }, '*', data.buf instanceof ArrayBuffer ? [data.buf] : []);
    });
  }
  function reply(m, frame) {
    const r = requests.get(m.q); if (!r || r.frame !== frame) return;
    clearTimeout(r.t); requests.delete(m.q);
    if (m.error) r.reject(new Error(m.error)); else r.resolve(m);
  }
  async function list(g) {
    if (live(g.id)) {
      try { return (await request(g.id, 'list')).entries || []; }
      catch (e) { console.warn('Live file listing failed; using stored view:', e); }
    }
    return entries(g);
  }
  async function read(g, raw) {
    const p = path(raw);
    if (live(g.id)) return (await request(g.id, 'read', { path: p })).buf;
    return readStored(g, p);
  }
  async function write(g, raw, input) {
    const p = path(raw), bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength > MAX_FILE) throw new Error('File exceeds the 16 MB editing limit.');
    if (live(g.id)) await request(g.id, 'write', { path: p, buf: bytes.slice().buffer });
    await mutate(g.id, [{ p, buf: bytes.slice().buffer }]);
  }
  async function remove(g, raw, dir = false) {
    const p = path(raw);
    const all = dir ? (await list(g)).filter(x => x.p === p || x.p.startsWith(p + '/')).sort((a,b)=>b.p.length-a.p.length) : [{ p, dir: false }];
    if (live(g.id)) await request(g.id, 'delete', { path: p, dir });
    await mutate(g.id, all.map(x => ({ p: x.p, deleted: true, dir: x.dir })));
  }
  async function mkdir(g, raw) {
    const p = path(raw);
    if (live(g.id)) await request(g.id, 'mkdir', { path: p });
    await mutate(g.id, [{ p, dir: true }]);
  }
  async function rename(g, fromRaw, toRaw, isDir) {
    const from = path(fromRaw), to = path(toRaw);
    if (from === to) return;
    if (isDir && (to.startsWith(from + '/') || from.startsWith(to + '/'))) throw new Error('Cannot move a folder into itself or its parent.');
    const items = isDir ? (await list(g)).filter(e => e.p === from || e.p.startsWith(from + '/')) : [{ p: from, dir: false }];
    const files = items.filter(x => !x.dir);
    if (files.length > 50 || files.reduce((n, f) => n + (f.size || 0), 0) > 32 * 1024 * 1024) throw new Error('Folder too large to rename in the live workspace.');
    const copies = [];
    for (const e of files) copies.push({ p: to + e.p.slice(from.length), buf: await read(g, e.p) });
    if (live(g.id)) await request(g.id, 'rename', { path: from, dest: to });
    await mutate(g.id, [...items.map(e => ({ p: e.p, deleted: true, dir: e.dir })), ...items.filter(e => e.dir).map(e => ({ p: to + e.p.slice(from.length), dir: true })), ...copies]);
  }
  // Reinstall uses the immutable game-file chunk list already kept in IndexedDB.
  // Only workspace changes (and optionally saves) are discarded. No original ZIP,
  // runtime download, or game asset has to be fetched again.
  async function settle(gid) {
    const job = queues.get(gid);
    if (job) await job;
  }
  async function reinstall(gid, { keepSaves = false } = {}) {
    if (live(gid)) throw new Error('Close the running game before reinstalling it.');
    await settle(gid); // do not race the last game-generated file changes
    if (typeof gameSaveChain !== 'undefined') await gameSaveChain;
    const g = await S.gal(gid);
    if (!isGame(g) || g.game.engine === 'html') throw new Error('Reinstall is available for Ren’Py games.');
    const base = await rpyGetJSON(g.game.list);
    if (!Array.isArray(base) || !base.length) throw new Error('The original imported files are missing. Restore the game from its ZIP instead.');
    const oldOverlayId = g.game.vfs || null;
    const oldOverlay = oldOverlayId ? (await rpyGetJSON(oldOverlayId)) : null;
    const oldSaveId = g.game.sv || null;
    const oldSaves = !keepSaves && oldSaveId ? (await rpyGetJSON(oldSaveId)) : null;
    let newSaveId = null;
    try {
      if (!keepSaves) newSaveId = await rpyPutJSON({});
      // Commit new references before collecting the unused data. A crash during
      // cleanup may leave unused chunks, but never lose original game content.
      g.game.vfs = null;
      if (!keepSaves) {
        g.game.sv = newSaveId;
        g.game.svGone = {};
      }
      await saveGallery(g);
    } catch (err) {
      if (newSaveId) await ST.del('images', newSaveId).catch(() => {});
      throw err;
    }
    const obsolete = [];
    if (oldOverlayId) obsolete.push(oldOverlayId);
    for (const f of Object.values((oldOverlay && oldOverlay.files) || {})) if (Array.isArray(f.c)) obsolete.push(...f.c);
    if (!keepSaves) {
      if (oldSaveId) obsolete.push(oldSaveId);
      for (const f of Object.values(oldSaves || {})) if (Array.isArray(f.c)) obsolete.push(...f.c);
      if (typeof Sync !== 'undefined' && Sync.savesChanged) Sync.savesChanged();
    }
    if (obsolete.length) await ST.delMany('images', [...new Set(obsolete)]).catch(e => console.warn('Reinstall cleanup:', e));
    // The baseline is never edited; it includes originally imported sidecar
    // files such as characters/monika.chr, even if DDLC deleted them later.
    queues.delete(gid);
    return {
      restored: base.length,
      cleared: Object.keys((oldOverlay && oldOverlay.files) || {}).length,
      savesCleared: !keepSaves,
      keptRuntime: g.game.rt
    };
  }
  function pendingReject() { for (const r of requests.values()) { clearTimeout(r.t); r.reject(new Error('Game closed.')); } requests.clear(); }
  return { path, live, overlay, mutate, entries, list, read, write, remove, mkdir, rename, request, reply, pendingReject, settle, reinstall, MAX_FILE };
})();
