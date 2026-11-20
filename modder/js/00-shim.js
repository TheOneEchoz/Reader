/* STAND-INS. Not from the app: the app has real versions of everything here (library, lock screen, encryption, routing, sync).
   The engine code in js/05-… to js/90-… only needs these names to exist. Leave this file out when copying the engine back. */

/* where Ren'Py (the runtime) comes from: a `renpy/` folder next to index.html if there is one, else any address you set in the page
   (localStorage 'engine.site'), else the app's website. RPY_BASE in js/10-basics.js is SITE + 'renpy/'. */
const SITE = (() => {
  try { const s = localStorage.getItem('engine.site'); if (s) return s.replace(/\/?$/, '/'); } catch (e) { }
  const here = new URL('./', location.href).href;
  // next to this page, or one folder up (the modder lives in modder/ on the Tankōbon website, beside its renpy/ folder)
  for (const base of [here, new URL('../', location.href).href]) {
    try { const x = new XMLHttpRequest(); x.open('HEAD', base + 'renpy/versions.txt', false); x.send(); if (x.status === 200) return base; } catch (e) { }
  }
  return 'https://theoneechoz.github.io/Reader/';
})();
const EXP = true, ANDROID = false, DESK = false, NATIVE = false;
let busy = 0;
const UI = { shield: false, lastAddTo: null };
let CUR = { view: 'game', params: {} };
const go = (view, params = {}) => { CUR = { view, params }; };
const back = go;
const render = (view, params) => { CUR = { view, params }; if (view === 'game') openGame(params.id, params.cont); };
const shield = { hidden: true };
const Sync = new Proxy({}, { get: () => () => { } });   // (cloud sync: every call does nothing)
const Tree = { ensureRoot() { } };
const mk = name => name;
const lockNow = () => closeGame();
const loadPicked = async f => f;
const isRenpy = g => isGame(g) && g.game.engine !== 'html';
const htmlFind = () => null, htmlTitle = (f, t) => t;
const openHtmlGame = async () => toast('Not in the engine: web-page games.');
const openAssets = () => toast('Not in the engine: the picture picker.');
const importInto = async () => { throw new Error('Not in the engine.'); };
const lastAddTarget = async () => null;
const sceneEditor = () => toast('Not in the engine: the scene editor.');
const savePicker = () => toast('Not in the engine: the saves list.');
const fixSheet = () => toast('Not in the engine: the fix sheet.');
const gameSaveDirName = async () => null;
/* the app saves a picture of the main menu as the game's cover; the engine has no covers, so this just does nothing */
const setGameCover = async () => { };
/* the app's "errors in the game" sheet: here, a plain list of what the game reported */
function gameErrors(errors, title) {
  const list = (errors || []).slice().reverse();
  openSheet('Errors in ' + (title || 'the game'), h('div', { class: 'stack' },
    ...(list.length ? list.map(e => h('pre', { class: 'engineinfo', style: 'white-space:pre-wrap;margin:0' }, e.full || e.short || '(no details)')) : [h('p', { class: 'hint' }, 'No errors.')])));
}
const coverId = g => g.cover;
const thumbImg = (id, alt) => h('div', { class: 'thumbstub', title: alt });
const newGallery = title => ({ id: uid(), title: title || 'Untitled', createdAt: Date.now(), updatedAt: Date.now(), lastReadAt: 0, cover: null, chapters: [], meta: {}, prefs: {}, progress: null, read: [] });
async function makeThumb(blob) {
  const bm = await createImageBitmap(blob), k = Math.min(1, 256 / Math.max(bm.width, bm.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bm.width * k)); c.height = Math.max(1, Math.round(bm.height * k)); c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
  return { w: bm.width, h: bm.height, thumb: await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8)) };
}
async function rpyAskDownload(v, why) {
  const check = await RPY.check(v);
  if (!check.available) {
    toast(check.reason, 6500);
    if (window.ENGINE && window.ENGINE.draw) window.ENGINE.draw();
    return false;
  }
  if (check.installed) return true;
  if (!confirm(`${why || `This game needs Ren'Py ${v}.`}\nDownload the browser runtime from the configured source?`)) return false;
  const out = document.getElementById('addstatus');
  try {
    if (out) out.textContent = `Downloading Ren'Py ${v}…`;
    await RPY.download(v, (done, total) => { if (out) out.textContent = `Downloading Ren'Py ${v}: ${mb(done)} / ${mb(total)}`; });
    if (out) out.textContent = `Ren'Py ${v} downloaded.`;
    return true;
  } catch (e) {
    const msg = String(e.message || e);
    if (out) out.textContent = msg;
    toast(msg, 6500);
    return false;
  }
}

/* ---- storage: one IndexedDB, nothing encrypted ---- */
const DB = (() => {
  let db = null;
  const open = () => db || (db = new Promise((res, rej) => {
    const r = indexedDB.open('tankobon-engine', 1);
    r.onupgradeneeded = () => { for (const s of ['galleries', 'images', 'thumbs', 'meta']) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (s, mode, f) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(s, mode), q = f(t.objectStore(s)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return {
    get: (s, id) => tx(s, 'readonly', o => o.get(id)),
    put: (s, rec) => tx(s, 'readwrite', o => o.put(rec)),
    del: (s, id) => tx(s, 'readwrite', o => o.delete(id)),
    delMany: (s, ids) => tx(s, 'readwrite', o => { for (const id of ids) o.delete(id); }),
    keys: s => tx(s, 'readonly', o => o.getAllKeys()),
  };
})();
const ST = DB;
/* The app's Crypt always hands back a plain ArrayBuffer. Keep that promise here: code in the engine passes what it gets straight to
   postMessage(..., [buf]), and that only accepts an ArrayBuffer, not a Uint8Array (the runtime download stores Uint8Arrays). */
const toAB = b => b instanceof ArrayBuffer ? b : ArrayBuffer.isView(b) ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b;
const Crypt = {   // (the app encrypts everything; here the "encrypted" form is just the data)
  ready: true, te: new TextEncoder(),
  enc: async buf => toAB(buf), dec: async buf => toAB(buf),
  encJSON: async o => JSON.stringify(o), decJSON: async s => JSON.parse(s),
};
const S = {
  async open(r) { if (!r || !r.e) return null; try { return await Crypt.decJSON(r.e); } catch (e) { return null; } },
  async gal(id) { return S.open(await ST.get('galleries', id)); },
  async gals() { const ids = await ST.keys('galleries'); return (await Promise.all(ids.map(S.gal))).filter(Boolean); },
  async putGal(g) { await ST.put('galleries', { id: g.id, e: await Crypt.encJSON(g) }); },
  async putBlob(store, id, blob) { await ST.put(store, { id, t: blob.type || 'image/jpeg', e: await Crypt.enc(await blob.arrayBuffer()) }); },
  async blob(store, id) { const r = await ST.get(store, id); return r ? new Blob([r.e], { type: r.t }) : null; },
};
const saveGallery = async g => { g.updatedAt = Date.now(); await S.putGal(g); };
/* ---- the sheet (a pop-up): plain version of the app's ---- */
let sheetOnClose = null;
function openSheet(title, body, onClose) { $('#sheetTitle').textContent = title; $('#sheetBody').replaceChildren(body); $('#sheet').hidden = false; sheetOnClose = onClose || null; if (typeof syncGameAudio === "function") syncGameAudio(true); }
function closeSheet() { if ($('#sheet').hidden) return; $('#sheet').hidden = true; $('#sheetBody').replaceChildren(); const f = sheetOnClose; sheetOnClose = null; f && f(); if (typeof syncGameAudio === "function") syncGameAudio(true); }
