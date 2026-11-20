/* Downloads one Ren'Py version (the runtime) and keeps it in storage */
//>> js/20-runtime.js#0
const RPY = {
  async reg() { const r = await DB.get('meta', mk('renpy')).catch(() => null); if (!r || !r.e) return {}; try { return await Crypt.decJSON(r.e); } catch (e) { return {}; } },
  async saveReg(o) { await DB.put('meta', { id: mk('renpy'), e: await Crypt.encJSON(o) }); },
  async has(v) { const r = await this.reg(); return !!(r[v] && r[v].done); },
  /* An official Ren'Py -web.zip is NOT a Tankōbon runtime manifest. The configured
     source must supply a compatible prepackaged runtime.json and the engine files. */
  async manifest(v) {
    if (!RPY_RUNTIMES.some(x => x.v === v)) throw new Error("Unknown Ren'Py runtime: " + v);
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8000);
    let info;
    try {
      const response = await fetch(RPY_BASE + encodeURIComponent(v) + '/runtime.json', { cache: 'no-store', signal: ctrl.signal });
      if (!response.ok) {
        if (response.status === 404) throw new Error(`Ren'Py ${v} isn't packaged on this runtime server (runtime.json was not found).`);
        throw new Error(`Runtime server returned HTTP ${response.status} for Ren'Py ${v}.`);
      }
      info = await response.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`Checking Ren'Py ${v} timed out. Try another runtime or source.`);
      if (e instanceof SyntaxError) throw new Error(`Ren'Py ${v} has an invalid runtime.json.`);
      if (/^(Ren.Py|Runtime server)/.test(e.message || '')) throw e;
      throw new Error(`Cannot check Ren'Py ${v} at the configured runtime server: ${e.message || e}`);
    } finally { clearTimeout(timer); }
    const loader = info && info.loader || rpyLoader(v);
    const need = RPY_FILES[loader];
    const files = Array.isArray(info && info.files) ? info.files : [];
    const names = new Set(files.map(f => f.path));
    if (!need || !need.every(path => names.has(path))) {
      throw new Error(`Ren'Py ${v} has no compatible packaged web runtime. Its official SDK/web-support ZIP alone cannot be used by this downloader.`);
    }
    return info;
  },
  async check(v) {
    if (await this.has(v)) return { available: true, installed: true, reason: 'Already downloaded' };
    try { await this.manifest(v); return { available: true, installed: false, reason: 'Available from configured runtime source' }; }
    catch (e) { return { available: false, installed: false, reason: String(e.message || e) }; }
  },
  /* download version v from the configured server, in encrypted pieces. */
  async download(v, onProg = () => { }, cancelled = () => false) {
    const base = RPY_BASE + v + '/';
    const info = await this.manifest(v);
    const need = RPY_FILES[info.loader || rpyLoader(v)], sizes = Object.fromEntries((info.files || []).map(f => [f.path, f.size]));
    const total = need.reduce((n, p) => n + (sizes[p] || 0), 0); let done = 0;
    const ent = { files: {}, size: total, loader: info.loader || rpyLoader(v), at: Date.now() }, made = [];
    try {
      for (const path of need) {
        const res = await fetch(base + path, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Could not download Ren'Py ${v} (${res.status}).`);
        const rd = res.body.getReader(); let buf = new Uint8Array(RPY_CHUNK), fill = 0, size = 0; const c = [];
        const flush = async () => { const id = await rpyPut(buf.slice(0, fill)); c.push(id); made.push(id); fill = 0; };
        for (; ;) {
          if (cancelled()) throw new Error('Stopped.');
          const { done: end, value } = await rd.read(); if (end) break;
          for (let off = 0; off < value.length;) { const n = Math.min(value.length - off, RPY_CHUNK - fill); buf.set(value.subarray(off, off + n), fill); fill += n; off += n; if (fill === RPY_CHUNK) await flush(); }
          size += value.length; done += value.length; onProg(done, total);
        }
        if (fill) await flush();
        ent.files[path] = { c, s: size };
      }
      ent.done = true;
      const reg = await this.reg(); if (reg[v]) await this.drop(reg[v]); reg[v] = ent; await this.saveReg(reg);
    } catch (e) { await ST.delMany('images', made).catch(() => { }); throw e; }
  },
  /* Portable runtime test pack: copies ONLY an already installed Ren'Py WEB
     runtime. No game files, saves, account data or virtual-workspace edits.
     Used to reproduce a game launch in an isolated browser without relying on
     the external runtime server. Runtime JS/WASM are executable: accept packs
     only from trusted sources. */
  async exportPack(v, onProg = () => {}) {
    const reg = await this.reg(), ent = reg[v];
    if (!ent || !ent.done) throw new Error(`Ren'Py ${v} is not installed in this browser.`);
    const loader = ent.loader || rpyLoader(v), paths = RPY_FILES[loader];
    if (!paths || paths.some(path => !ent.files[path])) throw new Error('The installed runtime has missing files.');
    const zip = new JSZip();
    const total = paths.reduce((n, path) => n + (ent.files[path].s || 0), 0);
    let done = 0;
    for (const path of paths) {
      const f = ent.files[path], bytes = await rpyRead(f.c, f.s);
      zip.file(path, bytes, { compression: 'STORE' });
      done += bytes.byteLength;
      onProg(done, total);
    }
    zip.file('runtime.json', JSON.stringify({
      version: v, loader, files: paths.map(path => ({ path, size: ent.files[path].s }))
    }, null, 2));
    zip.file('versions.txt', v + '\n');
    return await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
  },
  async installPack(v, file, onProg = () => {}) {
    if (!RPY_RUNTIMES.some(r => r.v === v)) throw new Error('Unknown Ren\'Py runtime version.');
    if (!file || file.size > 380 * 1024 * 1024) throw new Error('Choose a runtime pack ZIP smaller than 380 MB.');
    const zip = await JSZip.loadAsync(file, { checkCRC32: true });
    const mf = zip.file('runtime.json');
    if (!mf) throw new Error('This ZIP is not an exported Tankōbon runtime test pack.');
    const info = JSON.parse(await mf.async('string'));
    if (String(info.version) !== v) throw new Error(`The pack contains Ren'Py ${info.version || 'unknown'}, not ${v}.`);
    const paths = RPY_FILES[info.loader];
    if (!paths || paths.some(path => !zip.file(path))) throw new Error('The pack is missing a required browser-runtime file.');
    const total = paths.reduce((n, path) => n + Number((info.files || []).find(f => f.path === path)?.size || 0), 0);
    const ent = { files: {}, size: total, loader: info.loader, at: Date.now() }, made = [];
    let done = 0;
    try {
      for (const path of paths) {
        const bytes = await zip.file(path).async('uint8array');
        const expected = (info.files || []).find(f => f.path === path);
        if (expected && Number(expected.size) !== bytes.length) throw new Error('Runtime file size mismatch: ' + path);
        if (!bytes.length || bytes.length > 160 * 1024 * 1024) throw new Error('Invalid runtime file size: ' + path);
        const c = [];
        for (let off = 0; off < bytes.length; off += RPY_CHUNK) {
          const id = await rpyPut(bytes.slice(off, off + RPY_CHUNK).buffer);
          c.push(id); made.push(id);
        }
        ent.files[path] = { c, s: bytes.length };
        done += bytes.length; onProg(done, total);
      }
      ent.done = true;
      const reg = await this.reg(), old = reg[v]; reg[v] = ent;
      await this.saveReg(reg);
      if (old) await this.drop(old);
    } catch (e) {
      await ST.delMany('images', made).catch(() => {});
      throw e;
    }
  },
  async drop(ent) { const ids = []; for (const f of Object.values(ent.files || {})) ids.push(...f.c); await ST.delMany('images', ids).catch(() => { }); },
  async remove(v) { const reg = await this.reg(); if (reg[v]) { await this.drop(reg[v]); delete reg[v]; await this.saveReg(reg); } },
  /* all its files, decrypted: {name: ArrayBuffer} (names without folders) */
  async load(v) {
    const ent = (await this.reg())[v]; if (!ent || !ent.done) throw new Error(`Ren'Py ${v} is not downloaded.`);
    const out = {}; for (const [p, f] of Object.entries(ent.files)) out[p.split('/').pop()] = await rpyRead(f.c, f.s);
    return { files: out, loader: ent.loader };
  },
};
/* ask, then download (with a progress sheet). Resolves true when it is there. */
//<<
