/* Transition Containers: presentation grouping around existing, individually-wired nodes.
   They change where explicit `with` statements are emitted; they never change
   graph edges or execution order. One mode = after each contiguous run through
   the container; each mode = after every contained compatible statement. */
//>> js/75-transition-frames.js#0
const TKB_TRANSITION_ELIGIBLE = new Set(['say', 'show', 'hide', 'scene', 'camera', 'screen', 'audio', 'set', 'get', 'python', 'raw', 'call', 'chart']);
const tkbCanTransition = n => !!n && TKB_TRANSITION_ELIGIBLE.has(n.k) && !n.arms;
const tkbFrameNodes = (g, frame) => (g.nodes || []).filter(n => n.transitionFrame === frame.id);
const tkbTransitionFrame = (g, n) => (g.transitionFrames || []).find(f => f.id === n.transitionFrame);
const tkbFrameTransitions = (g, n) => {
  const f = tkbTransitionFrame(g, n);
  if (!f || !tkbCanTransition(n)) return [];
  // In group mode emit once at the end of each contiguous execution run.
  // In each mode emit after every participating command.
  if (f.mode === 'each' || !(g.nodes || []).some(m => m.id === n.next && m.transitionFrame === f.id && tkbCanTransition(m))) return [f];
  return [];
};
const tkbNewFrame = (g, x = 0, y = 0, trans = 'dissolve', mode = 'group') => {
  if (!Array.isArray(g.transitionFrames)) g.transitionFrames = [];
  let id; do { id = 'tf' + Math.random().toString(36).slice(2, 10); } while (g.transitionFrames.some(f => f.id === id));
  const f = { id, trans, mode, x, y };
  g.transitionFrames.push(f);
  return f;
};
/* Diagnose the active graph before changing it. Using an index of incoming
   wires avoids the quadratic scan that could stall on very long story scenes.
   A transition with exactly one ordinary incoming wire can be absorbed by its
   predecessor; other cases are kept verbatim to protect execution order. */
const tkbCompactAnalysis = g => {
  const nodes = Array.isArray(g?.nodes) ? g.nodes : [];
  const incoming = new Map(nodes.map(n => [n.id, []]));
  for (const n of nodes) {
    if (n.next && incoming.has(n.next)) incoming.get(n.next).push({ from: n, edge: 'next' });
    for (const a of n.arms || []) if (a.to && incoming.has(a.to)) incoming.get(a.to).push({ from: n, edge: 'arm' });
  }
  const reasons = {}, candidates = [];
  let total = 0;
  for (const w of nodes) {
    if (w.k !== 'with') continue;
    total++;
    let why = '';
    const links = incoming.get(w.id) || [];
    const pred = links.length === 1 && links[0].edge === 'next' ? links[0].from : null;
    if (w.id === g.entry) why = 'Scene begins with this transition';
    else if (!String(w.trans ?? '').trim()) why = 'Transition has no value';
    else if (!pred) why = links.length > 1 ? 'Multiple incoming connections' : links.some(l => l.edge === 'arm') ? 'Branch connects to transition' : 'No single preceding command';
    else if (!tkbCanTransition(pred)) why = 'Preceding ' + (pred.k || 'unknown') + ' cannot contain a transition';
    else if (pred.transitionFrame) why = 'Preceding command is already inside a container';
    else if (w.next === w.id || pred.id === w.id) why = 'Self-referencing transition';
    if (why) { reasons[why] = (reasons[why] || 0) + 1; continue; }
    candidates.push({ w, pred });
  }
  return { total, eligible: candidates.length, skipped: total - candidates.length, reasons, candidates };
};
const tkbCompactTransitions = g => {
  if (!g || !Array.isArray(g.nodes)) return 0;
  // Recompute after each conversion so even unusual graphs with adjacent
  // transitions are checked against their updated incoming connections.
  // A finite loop bound prevents malformed cyclic graphs from hanging the UI.
  let changed = 0;
  const bound = g.nodes.filter(n => n.k === 'with').length;
  for (let i = 0; i < bound; i++) {
    const check = tkbCompactAnalysis(g);
    if (!check.candidates.length) break;
    const { w, pred } = check.candidates[0];
    const f = tkbNewFrame(g, pred.x ?? w.x ?? 0, pred.y ?? w.y ?? 0, w.trans, 'group');
    f.sourceKey = w.sourceKey || null;
    pred.transitionFrame = f.id;
    pred.next = w.next || null;
    g.nodes = g.nodes.filter(n => n !== w);
    changed++;
  }
  return changed;
};
/* Turn a frame back into ordinary `with` nodes; this is reversible visually and
   retains the group/each semantics rather than just deleting the transition. */
const tkbUnwrapFrame = (g, frame) => {
  const members = tkbFrameNodes(g, frame);
  const exits = members.filter(n => tkbFrameTransitions(g, n).length);
  const last = exits[exits.length - 1];
  for (const n of exits) {
    const w = nodeNew('with');
    w.trans = frame.trans || 'None';
    if (n === last && frame.sourceKey) w.sourceKey = frame.sourceKey;
    w.x = (n.x || 0) + 245; w.y = n.y || 0;
    w.next = n.next || null;
    n.next = w.id;
    g.nodes.push(w);
  }
  members.forEach(n => { delete n.transitionFrame; });
  g.transitionFrames = (g.transitionFrames || []).filter(f => f.id !== frame.id);
};
//<<
