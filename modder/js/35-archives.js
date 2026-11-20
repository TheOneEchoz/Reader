/* Reading inside the game's files: pieces, .rpa archives, pictures and sounds on demand */
//>> js/35-archives.js#0
const rpyChunkCache = new Map(); // a few decrypted pieces, for reading many small things from the same archive
async function rpyChunk(id) {
  if (rpyChunkCache.has(id)) { const v = rpyChunkCache.get(id); rpyChunkCache.delete(id); rpyChunkCache.set(id, v); return v; }
  const u = new Uint8Array(await rpyGet(id)); rpyChunkCache.set(id, u);
  while (rpyChunkCache.size > 6) rpyChunkCache.delete(rpyChunkCache.keys().next().value);
  return u;
}
/* bytes off..off+len of a stored file (its pieces are RPY_CHUNK long) */
async function rpyRange(f, off, len) {
  len = Math.max(0, Math.min(len, f.s - off)); const out = new Uint8Array(len); let pos = 0;
  while (pos < len) {
    const at = off + pos, k = Math.floor(at / RPY_CHUNK), inside = at - k * RPY_CHUNK, u = await rpyChunk(f.c[k]);
    const n = Math.min(len - pos, u.length - inside); if (n <= 0) break;
    out.set(u.subarray(inside, inside + n), pos); pos += n;
  }
  return out;
}
/* A small reader for Python pickles, enough for Ren'Py's archive index (protocols 2 to 5).
   Python 2 byte strings and bytes come back as Uint8Array, dicts as Map. */
function unpickle(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), td = new TextDecoder();
  const stack = [], marks = [], memo = []; let i = 0;
  const take = n => { const b = u8.subarray(i, i + n); i += n; return b; };
  const long = b => { let v = 0n; for (let k = b.length - 1; k >= 0; k--) v = (v << 8n) | BigInt(b[k]); if (b.length && b[b.length - 1] & 0x80) v -= 1n << BigInt(8 * b.length); return Number(v); };
  const sinceMark = () => stack.splice(marks.pop());
  const setItems = (d, items) => { for (let k = 0; k < items.length; k += 2) d.set(items[k] instanceof Uint8Array ? td.decode(items[k]) : items[k], items[k + 1]); };
  const line = () => { let j = i; while (u8[j] !== 10) j++; const s = td.decode(u8.subarray(i, j)); i = j + 1; return s; };
  for (; ;) {
    const op = u8[i++];
    switch (op) {
      case 0x80: i += 1; break;                                   // PROTO
      case 0x95: i += 8; break;                                   // FRAME
      case 0x7d: stack.push(new Map()); break;                    // } EMPTY_DICT
      case 0x5d: stack.push([]); break;                           // ] EMPTY_LIST
      case 0x29: stack.push([]); break;                           // ) EMPTY_TUPLE
      case 0x28: marks.push(stack.length); break;                 // ( MARK
      case 0x71: memo[u8[i++]] = stack[stack.length - 1]; break;  // q BINPUT
      case 0x72: memo[dv.getUint32(i, true)] = stack[stack.length - 1]; i += 4; break; // r LONG_BINPUT
      case 0x94: memo.push(stack[stack.length - 1]); break;       // MEMOIZE
      case 0x68: stack.push(memo[u8[i++]]); break;                // h BINGET
      case 0x6a: stack.push(memo[dv.getUint32(i, true)]); i += 4; break; // j LONG_BINGET
      case 0x58: { const n = dv.getUint32(i, true); i += 4; stack.push(td.decode(take(n))); break; } // X BINUNICODE
      case 0x8c: { const n = u8[i++]; stack.push(td.decode(take(n))); break; }                        // SHORT_BINUNICODE
      case 0x8d: { const n = Number(dv.getBigUint64(i, true)); i += 8; stack.push(td.decode(take(n))); break; }
      case 0x55: case 0x43: { const n = u8[i++]; stack.push(take(n).slice()); break; }                // U SHORT_BINSTRING, C SHORT_BINBYTES
      case 0x54: case 0x42: { const n = dv.getUint32(i, true); i += 4; stack.push(take(n).slice()); break; } // T BINSTRING, B BINBYTES
      case 0x8e: { const n = Number(dv.getBigUint64(i, true)); i += 8; stack.push(take(n).slice()); break; }
      case 0x4b: stack.push(u8[i++]); break;                                          // K BININT1
      case 0x4d: stack.push(dv.getUint16(i, true)); i += 2; break;                    // M BININT2
      case 0x4a: stack.push(dv.getInt32(i, true)); i += 4; break;                     // J BININT
      case 0x8a: { const n = u8[i++]; stack.push(long(take(n))); break; }             // LONG1
      case 0x8b: { const n = dv.getUint32(i, true); i += 4; stack.push(long(take(n))); break; } // LONG4
      case 0x47: stack.push(dv.getFloat64(i)); i += 8; break;                         // G BINFLOAT
      case 0x4e: stack.push(null); break;                                             // N NONE
      case 0x88: stack.push(true); break; case 0x89: stack.push(false); break;
      case 0x85: stack.push([stack.pop()]); break;                                    // TUPLE1
      case 0x86: { const b = stack.pop(), a = stack.pop(); stack.push([a, b]); break; }
      case 0x87: { const c = stack.pop(), b = stack.pop(), a = stack.pop(); stack.push([a, b, c]); break; }
      case 0x74: stack.push(sinceMark()); break;                                      // t TUPLE
      case 0x6c: stack.push(sinceMark()); break;                                      // l LIST
      case 0x64: { const d = new Map(); setItems(d, sinceMark()); stack.push(d); break; } // d DICT
      case 0x61: { const v = stack.pop(); stack[stack.length - 1].push(v); break; }   // a APPEND
      case 0x65: { const items = sinceMark(); stack[stack.length - 1].push(...items); break; } // e APPENDS
      case 0x73: { const v = stack.pop(), k = stack.pop(); setItems(stack[stack.length - 1], [k, v]); break; } // s SETITEM
      case 0x75: { const items = sinceMark(); setItems(stack[stack.length - 1], items); break; } // u SETITEMS
      case 0x63: stack.push({ global: line() + '.' + line() }); break;                // c GLOBAL
      case 0x93: { const n = stack.pop(), m = stack.pop(); stack.push({ global: m + '.' + n }); break; } // STACK_GLOBAL
      case 0x52: { const args = stack.pop(), fn = stack.pop();                        // R REDUCE (Python 3 writing bytes in protocol 2)
        if (fn && fn.global === '_codecs.encode' && typeof args[0] === 'string') stack.push(Uint8Array.from(args[0], c => c.charCodeAt(0) & 255));
        else stack.push(null); break; }
      case 0x2e: return stack.pop();                                                  // . STOP
      default: throw new Error('unknown pickle opcode ' + op);
    }
  }
}
async function inflate(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/* the files inside a stored .rpa: Map name -> {o, l, p} (offset, length, bytes that come first) */
const rpaCache = new Map();
async function rpaIndex(f) {
  const key0 = f.c[0] + ':' + f.s; if (rpaCache.has(key0)) return rpaCache.get(key0);
  let out = null;
  try {
    const head = await rpyRange(f, 0, 80); let s = ''; for (const b of head) { if (b === 10) break; s += String.fromCharCode(b); }
    const t = s.trim().split(/\s+/), ver = t[0];
    if (/^RPA-(2\.0|3\.0|3\.2)$/.test(ver)) {
      const off = parseInt(t[1], 16); let key = 0n;
      if (ver !== 'RPA-2.0') for (const x of t.slice(ver === 'RPA-3.2' ? 3 : 2)) key ^= BigInt(parseInt(x, 16));
      const idx = unpickle(await inflate(await rpyRange(f, off, f.s - off)));
      out = new Map();
      for (const [name, parts] of idx) {
        const p = parts && parts[0]; if (!p) continue;
        const o = Number(BigInt(p[0]) ^ key), l = Number(BigInt(p[1]) ^ key);
        out.set(name, { o, l, p: p[2] && p[2].length ? (p[2] instanceof Uint8Array ? p[2] : Crypt.te.encode(String(p[2]))) : null });
      }
    }
  } catch (e) { console.warn('rpa index', e); out = null; }
  rpaCache.set(key0, out); return out;
}
async function rpaRead(f, m) { const body = await rpyRange(f, m.o, m.l); if (!m.p) return body; const u = new Uint8Array(m.p.length + body.length); u.set(m.p); u.set(body, m.p.length); return u; }
const RPY_MEDIA = /\.(ogg|opus|mp3|wav|flac|m4a|aac|oga|webm|mp4|ogv|m4v|mkv|avi|mpg|mpeg)$/i;
const RPY_AUDIO = /\.(ogg|opus|mp3|wav|flac|m4a|aac|oga)$/i;
const RPY_LAZY_MB = 300; // games bigger than this load their pictures and sounds on demand (unless switched off)
const gameLazy = (g, list) => g.game.lazy === true || (g.game.lazy !== false && list.reduce((n, f) => n + f.s, 0) > RPY_LAZY_MB * 1e6);
/* the size of a picture from its first bytes (PNG, JPEG, WebP, GIF, BMP); null when it cannot be told */
function picSize(u) {
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), n = u.length;
  try {
    if (u[0] === 0x89 && u[1] === 0x50) return [dv.getUint32(16), dv.getUint32(20)];
    if (u[0] === 0x47 && u[1] === 0x49) return [dv.getUint16(6, true), dv.getUint16(8, true)];
    if (u[0] === 0x42 && u[1] === 0x4d) return [dv.getInt32(18, true), Math.abs(dv.getInt32(22, true))];
    if (u[0] === 0x52 && u[8] === 0x57 && u[12] === 0x56) { // RIFF....WEBPVP8
      const k = String.fromCharCode(u[12], u[13], u[14], u[15]);
      if (k === 'VP8 ') return [dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff];
      if (k === 'VP8L') { const b = dv.getUint32(21, true); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
      if (k === 'VP8X') return [1 + (u[24] | u[25] << 8 | u[26] << 16), 1 + (u[27] | u[28] << 8 | u[29] << 16)];
    }
    if (u[0] === 0xff && u[1] === 0xd8) {
      let o = 2;
      while (o + 9 < n) {
        if (u[o] !== 0xff) { o++; continue; }
        const mk = u[o + 1]; if (mk === 0xff) { o++; continue; }
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return [dv.getUint16(o + 7), dv.getUint16(o + 5)];
        if (mk === 0xd8 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0x01) { o += 2; continue; }
        o += 2 + dv.getUint16(o + 2);
      }
    }
  } catch (e) { }
  return null;
}
/* what a big game's player gets: the archives' other files to write (parts), the pictures and sounds to give on demand (remote),
   and which files are not written whole (skip). Picture sizes are measured once and kept with the game. */
async function rpyLazyPlan(g, list, onProg = () => { }) {
  const dims = (g.game.dims && await rpyGetJSON(g.game.dims).catch(() => null)) || {};
  const kind = n => RPY_PIC.test(n) ? 'image' : RPY_AUDIO.test(n) ? (/(^|\/)voices?(\/|$)/i.test(n) ? 'voice' : 'music') : null;
  const onDemand = (n, size) => { const k = kind(n); return k && size > 20000 && !(k === 'image' && /^gui\//i.test(n)) ? k : null; }; // (the interface is needed at once)
  const want = [], parts = [], skip = new Set(), seen = new Set();
  // loose files first: they win over archived files of the same name
  for (const [i, f] of list.entries()) {
    if (!/^game\//i.test(f.p) || /\.rpa$/i.test(f.p)) continue;
    const name = f.p.slice(5); seen.add(name.toLowerCase());
    const k = onDemand(name, f.s); if (k) { want.push([name, i, 0, f.s, null, k]); skip.add(i); }
  }
  for (const [i, f] of list.entries()) {
    if (!/^game\//i.test(f.p) || !/\.rpa$/i.test(f.p)) continue;
    const idx = await rpaIndex(f).catch(() => null); if (!idx) continue; // (an archive that cannot be read is written whole)
    skip.add(i);
    for (const [n, m] of idx) {
      const key = n.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
      const e = [n, i, m.o, m.l, m.p || null], k = onDemand(n, m.l);
      if (k) want.push([...e, k]); else parts.push(e);
    }
  }
  const remote = [], pics = want.filter(e => e[5] === 'image' && !dims[e[0] + '|' + e[3]]); let changed = false, d = 0;
  const withPrefix = (u, p) => { if (!p) return u; const w = new Uint8Array(p.length + u.length); w.set(p); w.set(u, p.length); return w; };
  for (const e of want) {
    if (e[5] !== 'image') { remote.push([...e, e[3]]); continue; }
    const dk = e[0] + '|' + e[3]; let sz = dims[dk];
    if (!sz) {
      const head = await rpyRange(list[e[1]], e[2], Math.min(e[3], 65536)).catch(() => null);
      sz = head && picSize(withPrefix(head, e[4]));
      if (!sz || !(sz[0] > 0 && sz[1] > 0)) { try { const bm = await createImageBitmap(new Blob([withPrefix(await rpyRange(list[e[1]], e[2], e[3]), e[4])])); sz = [bm.width, bm.height]; bm.close && bm.close(); } catch (x) { sz = null; } }
      d++; if (d % 20 === 0) onProg(d, pics.length);
      if (sz) { dims[dk] = sz; changed = true; }
    }
    if (sz) remote.push([...e, sz]);
    else if (/\.rpa$/i.test(list[e[1]].p)) parts.push(e.slice(0, 5)); // a picture that cannot be measured is written whole
    else skip.delete(e[1]);
  }
  if (changed) { const cur = await S.gal(g.id); if (cur.game.dims) await rpyPutJSON(dims, cur.game.dims); else { cur.game.dims = await rpyPutJSON(dims); await saveGallery(cur); } g.game.dims = cur.game.dims; }
  return { parts, remote, skip: [...skip] };
}
const RPY_PIC = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;
/* every picture of a game: loose ones and the ones in its archives. [{name, size, read()}] */
//<<

//>> js/35-archives.js#1
async function gameFileReader(list, name) {
  const want = String(name).replace(/^\/+/, '').toLowerCase();
  const f = list.find(x => x.p.toLowerCase() === 'game/' + want); if (f) return () => rpyRange(f, 0, f.s);
  for (const a of list) { if (!/\.rpa$/i.test(a.p)) continue; const idx = await rpaIndex(a).catch(() => null); if (!idx) continue; for (const [n, m] of idx) if (n.toLowerCase() === want) return () => rpaRead(a, m); }
  return null;
}
//<<
