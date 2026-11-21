/* WORKING ON A TANKŌBON GAME, IN PLACE. Not from the app.
   Opened from Tankōbon's "Mod this game" (modder/?tkb=<game id>, or inside Tankōbon's desktop window with window.TKB_GAME),
   the modder keeps no copy of the game: its storage of games ("galleries") and of their pieces ("images") is Tankōbon's,
   asked for on a BroadcastChannel as they are needed. Tankōbon (open and unlocked, in another tab or around this page)
   answers, decrypting and encrypting on its side. So the Story edits the flowchart makes are a mod on Tankōbon's game at once,
   and the game plays from Tankōbon's own files. The modder's own notes (drafts, snapshots: the "meta" store) stay here.
   Messages: st {rid, op: get|put|del|delMany|reg|saveReg, s, id, rec, ids, o} -> stres {rid, ok, v} | {rid, ok:false, err}  */
const TKB_REMOTE = (() => {
  const gid = new URLSearchParams(location.search).get('tkb') || window.TKB_GAME || null;
  if (!gid) return null;
  let bc = null; try { bc = new BroadcastChannel('tankobon-modder'); } catch (e) { }
  if (!bc) return { gid, broken: 'This browser cannot talk to Tankōbon (no BroadcastChannel).' };
  const waiting = new Map();
  bc.addEventListener('message', e => { const m = e.data || {}; if (m.t === 'stres' && waiting.has(m.rid)) { const f = waiting.get(m.rid); waiting.delete(m.rid); f(m); } });
  let seq = 0;
  const banner = text => {
    let el = document.getElementById('tkbwait');
    if (!text) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'tkbwait'; el.setAttribute('role', 'status'); el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99;background:#1b1a17;color:#f3efe6;padding:10px 16px;border-radius:12px;font:14px system-ui;box-shadow:0 6px 24px #0006;max-width:calc(100% - 32px)'; document.body && document.body.append(el); }
    el.textContent = text;
  };
  // one request, answered by Tankōbon; while Tankōbon is locked or away, it waits (and says so) instead of failing
  async function ask(msg) {
    for (let k = 0; ; k++) {
      const rid = 'r' + (++seq) + '.' + Math.random().toString(36).slice(2, 7);
      const m = await new Promise(res => {
        const t = setTimeout(() => { waiting.delete(rid); res(null); }, k ? 4000 : 15000);
        waiting.set(rid, x => { clearTimeout(t); res(x); });
        bc.postMessage({ t: 'st', rid, gid, ...msg });
      });
      if (m && m.ok) { if (k) banner(null); return m.v; }
      if (m && m.err !== 'locked') throw new Error(m.err || 'Tankōbon refused.');
      banner(m ? 'Tankōbon is locked: unlock it in its tab, and the modder goes on.' : 'Waiting for Tankōbon… keep it open (in another tab, or the desktop app).');
      await new Promise(z => setTimeout(z, 1200));
    }
  }
  // the stores that are Tankōbon's; everything else stays in the modder's own storage
  const theirs = s => s === 'galleries' || s === 'images';
  const local = { get: DB.get, put: DB.put, del: DB.del, delMany: DB.delMany, keys: DB.keys };
  DB.get = (s, id) => theirs(s) ? ask({ op: 'get', s, id }) : local.get(s, id);
  DB.put = (s, rec) => theirs(s) ? ask({ op: 'put', s, rec }) : local.put(s, rec);
  DB.del = (s, id) => theirs(s) ? ask({ op: 'del', s, id }) : local.del(s, id);
  DB.delMany = (s, ids) => theirs(s) ? ask({ op: 'delMany', s, ids }) : local.delMany(s, ids);
  DB.keys = s => s === 'galleries' ? Promise.resolve([gid]) : theirs(s) ? Promise.resolve([]) : local.keys(s);
  return { gid, ask, banner };
})();
