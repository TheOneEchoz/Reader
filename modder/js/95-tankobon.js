/* THE LINK WITH TANKŌBON (the reader app, same website). Not from the app.
   - Tankōbon's "Mod this game" opens this page as modder/?tkb=<game id>. The modder asks Tankōbon for that game on a
     BroadcastChannel; Tankōbon (open and unlocked in another tab) sends the game's record and its pieces, unencrypted, a
     few at a time, and the modder keeps them in its own storage under the same ids. A game already here only gets what
     is missing (its saves, new mods), so the modder's own edits stay.
   - "Send to Tankōbon" sends the mods made here (the Story edits) back; Tankōbon keeps them as one mod on that game.
   Messages: hello {gid, have[]} -> game {rec, ids[]} | locked | nogame;  piece {id, t, buf|json} ... done;  ack {n}
             mod {gid, name, files[{p, buf}]} -> modres {ok, why}                                                        */
const TKB_LINK = (() => {
  const CH = 'tankobon-modder';
  let bc = null; try { bc = new BroadcastChannel(CH); } catch (e) { }
  const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const wait = (match, ms) => new Promise(res => {
    if (!bc) return res(null);
    const t = setTimeout(() => { bc.removeEventListener('message', f); res(null); }, ms);
    const f = e => { const m = e.data || {}; if (match(m)) { clearTimeout(t); bc.removeEventListener('message', f); res(m); } };
    bc.addEventListener('message', f);
  });
  const status = (text, bad) => {
    let el = document.getElementById('tkbstatus');
    if (!el) { el = h('div', { id: 'tkbstatus', class: 'gamecard', role: 'status', style: 'white-space:normal' }); const box = document.getElementById('games'); box && box.prepend(el); }
    el.replaceChildren(h('div', { class: 'grow', style: 'white-space:normal' }, h('b', {}, 'From Tankōbon'), h('span', { class: 'sub', style: 'white-space:normal' + (bad ? ';color:#edab72' : '') }, text)));
    return el;
  };
  /* a game from Tankōbon */
  async function receive(gid) {
    if (!bc) { status('This browser cannot talk to Tankōbon (no BroadcastChannel). Add the game here instead.', true); return; }
    const mine = await S.gal(gid).catch(() => null);
    const have = mine ? await rpyIds(mine).catch(() => []) : [];
    let head = null;
    for (let k = 0; k < 90 && !head; k++) {
      const r = rid();
      bc.postMessage({ t: 'hello', rid: r, gid, have });
      const m = await wait(x => x.rid === r && ['game', 'locked', 'nogame'].includes(x.t), 1500);
      if (!m) { status('Waiting for Tankōbon… Keep it open in another tab, with the game\'s page.'); continue; }
      if (m.t === 'nogame') { status('Tankōbon does not have that game (any more).', true); return; }
      if (m.t === 'locked') { status('Tankōbon is locked. Unlock it in its tab, and the game comes over by itself.'); await new Promise(z => setTimeout(z, 1500)); continue; }
      head = m;
    }
    if (!head) { status('Tankōbon did not answer. Open the game in Tankōbon and press “Mod this game” again.', true); return; }
    const total = head.ids.length; let got = 0, size = 0;
    status(total ? `Getting “${head.rec.title}”: 0 of ${total} pieces…` : `Updating “${head.rec.title}”…`);
    await new Promise((res, rej) => {
      if (!total) return res();
      let n = 0;
      const f = async e => {
        const m = e.data || {}; if (m.rid !== head.rid) return;
        if (m.t === 'piece') {
          try {
            await ST.put('images', m.json !== undefined ? { id: m.id, t: 'application/json', e: JSON.stringify(m.json) } : { id: m.id, t: m.mime || 'application/octet-stream', e: m.buf });
          } catch (err) { bc.removeEventListener('message', f); return rej(err); }
          got++; n++; size += m.buf ? m.buf.byteLength : 0;
          if (got % 20 === 0 || got === total) status(`Getting “${head.rec.title}”: ${got} of ${total} pieces (${mb(size)})…`);
          if (n >= 8) { n = 0; bc.postMessage({ t: 'ack', rid: head.rid, got }); }
          if (got >= total) { bc.removeEventListener('message', f); res(); }
        } else if (m.t === 'fail') { bc.removeEventListener('message', f); rej(new Error(m.why || 'Tankōbon stopped sending.')); }
      };
      bc.addEventListener('message', f);
      bc.postMessage({ t: 'ack', rid: head.rid, got: 0 });
    }).catch(e => { status('The game did not come over completely: ' + (e.message || e), true); throw e; });
    // the record: Tankōbon's, with the mods made here kept (Tankōbon's copy of them is left out: it came from here)
    const rec = head.rec, own = mine ? (mine.game.mods || []).filter(m => m.flow) : [];
    // (Tankōbon's own old Story edits, from when it had Modding mode, were taken over here the first time)
    rec.game.mods = [...(rec.game.mods || []).filter(m => !m.modder && !(mine && m.flow)), ...own];
    rec.fromTkb = true; rec.tkbAt = Date.now();
    await saveGallery(rec);
    if (window.ENGINE && window.ENGINE.draw) await window.ENGINE.draw();
    status(`“${rec.title}” is here${mine ? ' (updated from Tankōbon; your edits are kept)' : ''}. Press Play + flowchart to mod it, then Send to Tankōbon.`);
    const card = document.querySelector(`.gamecard[data-id="${gid}"]`); card && card.scrollIntoView({ block: 'center' });
    try { history.replaceState(null, '', location.pathname); } catch (e) { }
  }
  /* the mods made here, back to Tankōbon */
  async function send(gid) {
    const g = await S.gal(gid); if (!g) return;
    const mods = (g.game.mods || []).filter(m => m.flow);
    if (!mods.length) return toast('Nothing to send yet: make changes in the flowchart first (they are kept as Story edits).', 4500);
    const files = [];
    for (const m of mods) for (const f of (await rpyGetJSON(m.list)) || []) files.push({ p: f.p, buf: await rpyRead(f.c, f.s) });
    if (!bc) return toast('This browser cannot talk to Tankōbon.', 4000);
    for (let k = 0; k < 20; k++) {
      const r = rid();
      bc.postMessage({ t: 'mod', rid: r, gid, name: 'Story edits (from the modder)', on: mods.some(m => m.on), files });
      const m = await wait(x => x.rid === r && x.t === 'modres', 2000);
      if (!m) { if (k === 0) toast('Waiting for Tankōbon… keep it open in another tab.', 3000); continue; }
      if (m.ok) return toast(`Sent to Tankōbon: “${g.title}” plays with your edits there (switch the mod off on its page to play the original).`, 5500);
      if (m.why === 'locked') { toast('Unlock Tankōbon in its tab; sending again…', 3000); await new Promise(z => setTimeout(z, 2000)); continue; }
      return toast('Tankōbon could not keep the edits: ' + m.why, 5000);
    }
    toast('Tankōbon did not answer. Open it (unlocked) in another tab and try again.', 5000);
  }
  const q = new URLSearchParams(location.search).get('tkb');
  if (q) (async () => { for (let k = 0; k < 50 && !(window.ENGINE && window.ENGINE.draw); k++) await new Promise(z => setTimeout(z, 100)); receive(q).catch(e => console.error('tkb', e)); })();
  return { receive, send };
})();
