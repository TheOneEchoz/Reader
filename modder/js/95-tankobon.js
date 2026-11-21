/* THE LINK WITH TANKŌBON (the reader app, same website). Not from the app.
   - Opened from Tankōbon's "Mod this game", the modder works on Tankōbon's own game (js/01-remote.js): nothing is copied,
     there is no library here, and the flowchart opens straight away. The Ren'Py runtime is Tankōbon's too.
   - Games copied here by nodes-5.10 keep "Send to Tankōbon", so edits made in such a copy can still go back.
   Messages for those copies: mod {gid, name, files[{p, buf}]} -> modres {ok, why}                                        */
const TKB_LINK = (() => {
  let bc = null; try { bc = new BroadcastChannel('tankobon-modder'); } catch (e) { }
  const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const wait = (match, ms) => new Promise(res => {
    if (!bc) return res(null);
    const t = setTimeout(() => { bc.removeEventListener('message', f); res(null); }, ms);
    const f = e => { const m = e.data || {}; if (match(m)) { clearTimeout(t); bc.removeEventListener('message', f); res(m); } };
    bc.addEventListener('message', f);
  });
  if (TKB_REMOTE && !TKB_REMOTE.broken) {
    // the runtime Tankōbon already has (and one downloaded here is kept there too)
    RPY.reg = () => TKB_REMOTE.ask({ op: 'reg' }).then(r => r || {});
    RPY.saveReg = o => TKB_REMOTE.ask({ op: 'saveReg', o });
  }
  /* a game copied here by nodes-5.10: its Story edits, back to Tankōbon */
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
      if (m.ok) return toast(`Sent to Tankōbon: “${g.title}” plays with your edits there.`, 5000);
      if (m.why === 'locked') { toast('Unlock Tankōbon in its tab; sending again…', 3000); await new Promise(z => setTimeout(z, 2000)); continue; }
      return toast('Tankōbon could not keep the edits: ' + m.why, 5000);
    }
    toast('Tankōbon did not answer. Open it (unlocked) in another tab and try again.', 5000);
  }
  /* the page while working on a Tankōbon game: no library, just this game, with the flowchart opened at once */
  async function panel(box, play) {
    if (TKB_REMOTE.broken) { box.replaceChildren(h('p', { class: 'hint' }, TKB_REMOTE.broken)); return; }
    box.replaceChildren(h('div', { class: 'gamecard', id: 'tkbpanel' }, h('div', { class: 'grow' }, h('b', {}, 'Opening the game from Tankōbon…'))));
    let g = null;
    try { g = await S.gal(TKB_REMOTE.gid); } catch (e) { box.replaceChildren(h('p', { class: 'hint' }, 'Tankōbon could not open the game: ' + (e.message || e))); return; }
    if (!g || !isGame(g)) { box.replaceChildren(h('p', { class: 'hint' }, 'Tankōbon does not have that game (any more).')); return; }
    const edits = (g.game.mods || []).find(m => m.flow);
    box.replaceChildren(h('div', { class: 'gamecard', id: 'tkbpanel', 'data-id': g.id },
      h('div', { class: 'grow' }, h('b', {}, g.title),
        h('span', { class: 'sub', style: 'white-space:normal' }, `Tankōbon's game · Ren'Py ${g.game.ver || 'unknown'}. Your changes are saved straight into Tankōbon, as the mod “${edits ? edits.name : 'Story edits'}” on this game${edits ? (edits.on ? '' : ' (switched off there)') : ''}.`)),
      h('button', { class: 'btn primary', id: 'tkb-flow', onclick: () => play(g, true) }, TKB_COMPAT.bootMode(g.game) === 'safe' ? 'Play + nodes' : 'Open the flowchart'),
      h('button', { class: 'btn', id: 'tkb-play', onclick: () => play(g) }, 'Play')));
    document.title = g.title + ' · Tankōbon Modder';
    if (!panel.started) { panel.started = true; play(g, true); }
  }
  return { send, panel };
})();
