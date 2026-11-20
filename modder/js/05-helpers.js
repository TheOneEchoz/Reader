/* Small helpers the engine uses (the app has them too): h(), icons, toast, game file list, ... */
//>> js/05-helpers.js#0
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
//<<

//>> js/05-helpers.js#1
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = c => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c.nodeType ? c : String(c)); };
  kids.forEach(add);
  return el;
}
//<<

//>> js/05-helpers.js#2
const ICONS = {
  restart: '<path d="M20 11a8 8 0 1 1-2.2-5.5M20 4v6h-6"/>',
  back: '<path d="M15 18l-6-6 6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  tune: '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1"/><circle cx="16" cy="6" r="2.2"/><circle cx="10" cy="12" r="2.2"/><circle cx="18" cy="18" r="2.2"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  play: '<path d="M7 4.5l12.5 7.5L7 19.5z" fill="currentColor"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  grip: '<g stroke-width="3"><path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"/></g>',
  folder: '<path d="M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  archive: '<path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12l5 5 9-10"/>',
  prevch: '<path d="M6 5v14M18 5l-9 7 9 7z"/>', nextch: '<path d="M18 5v14M6 5l9 7-9 7z"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  single: '<rect x="7" y="3" width="10" height="18" rx="1.5"/>',
  double: '<rect x="2.5" y="4" width="9" height="16" rx="1.5"/><rect x="12.5" y="4" width="9" height="16" rx="1.5"/>',
  vertical: '<rect x="6.5" y="2" width="11" height="9" rx="1.5"/><rect x="6.5" y="13" width="11" height="9" rx="1.5"/>',
  horizontal: '<rect x="1.5" y="6" width="6" height="12" rx="1.2"/><rect x="9" y="6" width="6" height="12" rx="1.2"/><rect x="16.5" y="6" width="6" height="12" rx="1.2"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>', down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>', move: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  zoomin: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.5-4.5M11 8v6M8 11h6"/>', zoomout: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.5-4.5M8 11h6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', devices: '<rect x="2.5" y="5" width="12" height="9" rx="1.5"/><rect x="16" y="8" width="5.5" height="11" rx="1.2"/><path d="M5 18h8"/>',
  more: '<g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></g>', chevr: '<path d="M9 6l6 6-6 6"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.5 6.6C4.4 8 2.9 10 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 004.2 4.2"/>', eye: '<path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z"/><circle cx="12" cy="12" r="3"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  tools: '<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  variants: '<rect x="3" y="3" width="11" height="14" rx="1.5"/><rect x="10" y="7" width="11" height="14" rx="1.5"/><path d="M13 12h5M15.5 9.5v5"/>',
  bookmark: '<path d="M6 3h12v18l-6-4.5L6 21z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5M3 16.5l9 5 9-5"/>',
  tag: '<path d="M3 12.2V4.5A1.5 1.5 0 014.5 3h7.7l8.9 8.9a1.5 1.5 0 010 2.1l-7.1 7.1a1.5 1.5 0 01-2.1 0z"/><circle cx="8" cy="8" r="1.6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
  brush: '<path d="M18.4 2.6a2 2 0 012.9 2.9L12 14.8 9.2 12z"/><path d="M8.5 13.2c-2 0-3.5 1.5-3.5 3.6 0 1.3-.8 2.3-2 2.7 1.2 1 2.8 1.5 4.3 1.5 2.7 0 4.5-2 4.5-4.4z"/>',
  bucket: '<path d="M5 11l7-7 7 7-7 7z"/><path d="M5 11h14"/><path d="M20 15.5c0 1.4-.9 2.5-2 2.5s-2-1.1-2-2.5 2-3.5 2-3.5 2 2.1 2 3.5z"/>',
  eraser: '<path d="M7 21h13M4.6 15.4l9.9-9.9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L11 19H7.4z"/><path d="M9 11l5 5"/>',
  pick: '<path d="M14.5 5.5l4 4M3 21l1.5-4.5L14 7l3 3-9.5 9.5z"/><path d="M13 4l2-2 7 7-2 2"/>',
  split: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1L20 20M8.1 15.9L20 4"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 013 0V11M11 10.5v-6a1.5 1.5 0 013 0V11M14 6.5a1.5 1.5 0 013 0V12M17 9.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1.5a6 6 0 01-4.6-2.2L4.4 15a1.5 1.5 0 012.3-1.9L8 14.5"/>',
  merge: '<path d="M6 3v4c0 4 6 5 6 9v5M18 3v4c0 4-6 5-6 9"/><path d="M9 18l3 3 3-3"/>',
  flow: '<rect x="3" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="15" width="8" height="6" rx="1.5"/><path d="M7 9v3a3 3 0 003 3h3"/>',
  folder: '<path d="M3 6.5a2 2 0 012-2h5l2 2h7a2 2 0 012 2V19a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'
};
const icon = (n, label) => h('span', { class: 'ic', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24">${ICONS[n]}</svg>` });
//<<

//>> js/05-helpers.js#3
function mb(n) { return n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.round(n / 1e6) + ' MB'; }
//<<

//>> js/05-helpers.js#4
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.style.opacity = 0, ms);
}
/* a message with an Undo button for a few seconds; onGone runs when it can no longer be undone */
let undoBox = null;
function undoToast(msg, onUndo, onGone, ms = 7000, label = 'Undo') {
  if (undoBox) undoBox.finish(false);
  let done = false;
  const el = h('div', { class: 'undobar', role: 'status' }, h('span', {}, msg), h('button', { class: 'btn small', onclick: () => finish(true) }, label));
  const finish = undo => { if (done) return; done = true; clearTimeout(tm); el.remove(); if (undoBox && undoBox.el === el) undoBox = null; if (undo) onUndo && onUndo(); else onGone && onGone(); };
  const tm = setTimeout(() => finish(false), ms);
  undoBox = { el, finish }; document.body.append(el);
}
window.addEventListener('pagehide', () => { if (undoBox) undoBox.finish(false); });
/* gallery changes that can be undone: keep a copy of how it was, put it back, and forget pictures made since */
//<<

//>> js/05-helpers.js#5
const baseName = n => n.replace(/\.[^.]+$/, '');
const hiddenPath = p => p.split('/').some(s => s.startsWith('.') || s === '__MACOSX');
//<<

//>> js/05-helpers.js#6
const pyLit = v => v === null || v === undefined ? 'None' : v === true ? 'True' : v === false ? 'False' : typeof v === 'number' ? String(v) : typeof v === 'string' ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(pyLit).join(', ')}]` : `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${pyLit(x)}`).join(', ')}}`;
//<<

//>> js/05-helpers.js#7
async function gameFileList(g, which = 'on') {
  const base = (await rpyGetJSON(g.game.list)) || [], at = new Map(base.map((f, i) => [f.p.toLowerCase(), i])), out = base.slice();
  for (const m of g.game.mods || []) {
    if (which === 'on' && !m.on) continue;
    for (const f of (await rpyGetJSON(m.list)) || []) { const k = f.p.toLowerCase(); if (at.has(k)) out[at.get(k)] = f; else { at.set(k, out.length); out.push(f); } }
  }
  // Workspace edits supersede imported files and mods without changing them.
  if (g.game.vfs) {
    const vfs = (await rpyGetJSON(g.game.vfs)) || { files: {} };
    for (const [p, f] of Object.entries(vfs.files || {})) {
      // Compiled files from temporary Tankōbon hooks are not game data.
      // Old imports may contain these in the persistent overlay; never load them.
      if (/^game\/zzzz_tankobon_.*\.rpyc?$/i.test(p)) continue;
      const key = p.toLowerCase();
      if (f.deleted) { if (at.has(key)) { out[at.get(key)] = null; at.delete(key); } }
      else if (at.has(key)) out[at.get(key)] = f;
      else { at.set(key, out.length); out.push(f); }
    }
  }
  return out.filter(Boolean);
}
//<<

//>> js/05-helpers.js#8
async function setModOn(gid, mid, on) { const g = await S.gal(gid); const m = (g.game.mods || []).find(x => x.id === mid); if (!m) return; m.on = on; await saveGallery(g); }
//<<

//>> js/05-helpers.js#9
const errKey = e => { const t = (e.short || e.full || '').trim(), m = t.match(/^[A-Za-z_.]*(?:Error|Exception)\b.*$/m); return m ? m[0] : t.split('\n').filter(Boolean).slice(-1)[0] || t; };
//<<

//>> js/05-helpers.js#10
async function newestSlot(idx) {
  let best = null, bt = -1;
  for (const [p, s] of Object.entries(idx)) {
    if (!/^home\/web_user\/\.renpy\/[^/]+\/(sync\/)?[^/]+\.save$/i.test(p) || /\/tokens\//.test(p) || /\/_[^/]*$/.test(p)) continue; // (not Ren'Py's own error and reload saves; saves from Ren'Py Sync too)
    let t = s.t || 0;
    try { const z = await JSZip.loadAsync(await rpyRead(s.c, s.s)), j = z.file('json'); if (j) { const o = JSON.parse(await j.async('string')); if (o._ctime) t = o._ctime * 1000; } } catch (e) { }
    if (t > bt) { bt = t; best = p.split('/').pop(); }
  }
  return best ? best.replace(/-LT\d+\.save$/i, '').replace(/\.save$/i, '') : null;
}
//<<

//>> js/05-helpers.js#11
function askYes(title, text, yes) {
  return new Promise(res => {
    const done = v => { el.remove(); res(v); };
    const el = h('div', { class: 'askyes', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'askbox' }, h('h3', {}, title), h('p', { class: 'hint' }, text),
      h('div', { class: 'row', style: 'justify-content:flex-end;flex-wrap:wrap' }, h('button', { class: 'btn ghost', onclick: () => done(false) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => done(true) }, yes || 'Yes'))));
    document.body.append(el);
  });
}
//<<
