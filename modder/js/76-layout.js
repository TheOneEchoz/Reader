/* Tankōbon graph presentation only. Never changes control-flow links. */
//>> js/76-layout.js#0
const TKB_LAYOUT = (() => {
  const W = 210, SX = 320, LEFT = 60, MAX = 8, YGAP = 104;
  const snap = n => Math.round(n / 20) * 20;
  const height = n => 44 + Math.max(n.arms ? n.arms.length : n.k === 'jump' || n.k === 'return' ? 0 : 1, 1) * 22 + ((n.k === 'scene' || n.k === 'show') ? 98 : 0);
  const links = n => n.arms ? n.arms.map(a => a.to).filter(Boolean) : n.k === 'jump' || n.k === 'return' ? [] : n.next ? [n.next] : [];
  const arms = n => n.arms ? n.arms.map((a, i) => ({ to: a.to, i })).filter(a => a.to) : (n.k === 'jump' || n.k === 'return' || !n.next) ? [] : [{to:n.next, i:0}];
  const out = (n, i) => [n.x + W, n.y + (n.arms ? 44 + i * 22 + 11 : 12)];
  const input = n => [n.x, n.y + 12];
  // A conversation choice is a set of distinct journeys that eventually
  // return to the same menu. Stop at other menus and uncertain joins; do not
  // mistake a one-way conditional for a return-to-menu conversation.
  function choiceGroups(g) {
    const nodes = g.nodes || [], N = new Map(nodes.map(n => [n.id, n])), groups = new Map();
    for (const menu of nodes) {
      if (!menu.arms || menu.arms.length < 2) continue;
      const paths = []; let returning = 0;
      for (const arm of menu.arms) {
        const seq = [], seen = new Set(); let id = arm.to, returns = false;
        while (id && N.has(id) && seq.length < 220) {
          if (id === menu.id) { returns = true; break; }
          if (seen.has(id)) break;
          const n = N.get(id);
          // Nested branches require their own layout; don't swallow their
          // successors into a flat lane or change their control flow.
          if (n.arms) break;
          seen.add(id); seq.push(n);
          id = links(n)[0] || null;
        }
        if (returns && seq.length) returning++;
        paths.push({ text: arm.text || arm.cond || 'Choice', nodes: returns ? seq : [], returns });
      }
      if (returning < 2) continue;
      const appearances = new Map();
      for (const p of paths) for (const n of p.nodes) appearances.set(n.id, (appearances.get(n.id) || 0) + 1);
      paths.forEach(p => { p.nodes = p.nodes.filter(n => appearances.get(n.id) === 1); });
      if (paths.filter(p => p.nodes.length).length < 2) continue;
      groups.set(menu.id, paths);
    }
    return groups;
  }
  // Keep each ordinary forward chain on a common baseline, with lower lanes
  // for secondary arms. Long chains wrap without changing node semantics.
  function arrange(g) {
    const all = g.nodes || []; if (!all.length) return;
    const N = new Map(all.map(n => [n.id, n])), groups = choiceGroups(g);
    const owned = new Set();
    for (const [id, paths] of groups) for (const p of paths) for (const n of p.nodes) if (n.id !== id) owned.add(n.id);
    const placed = new Set(); const queued = new Set(); const tasks = []; let head = 0;
    const queue = id => { if (N.has(id) && !placed.has(id) && !queued.has(id) && !owned.has(id)) { queued.add(id); tasks.push(id); } };
    queue(g.entry); for (const n of all) if (!owned.has(n.id) && !queued.has(n.id)) queue(n.id);
    let top = 70; const bands = [];
    while (head < tasks.length) {
      let id = tasks[head++]; if (placed.has(id) || !N.has(id)) continue;
      const menuPaths = groups.get(id);
      if (menuPaths) {
        const menu = N.get(id); placed.add(id);
        // Reserve space on the left for distinct incoming return rails.
        menu.x = snap(LEFT + 260); menu.y = snap(top);
        let laneY = top;
        for (let idx = 0; idx < menuPaths.length; idx++) {
          const p = menuPaths[idx]; if (!p.nodes.length) { queue(links(menu)[idx]); continue; }
          const starts = laneY, stop = Math.max(1, p.nodes.length);
          for (let k = 0; k < stop; k++) {
            const n = p.nodes[k]; if (placed.has(n.id)) continue;
            n.x = snap(menu.x + SX * (1 + k % MAX));
            n.y = snap(laneY + Math.floor(k / MAX) * (208));
            placed.add(n.id);
          }
          const maxH = Math.max(...p.nodes.map(height));
          laneY += Math.ceil(stop / MAX) * 208 + Math.max(0, maxH - 92) + 38;
          bands.push({ menuId: id, index: idx, label: p.text, x: menu.x + SX - 20, y: snap(starts - 26), width: Math.min(MAX, stop) * SX, height: snap(laneY - starts - 20) });
        }
        // Unrecognized/non-return branches are still placed on other rows.
        for (const target of links(menu)) queue(target);
        top = laneY + 95;
        continue;
      }
      const chain = []; let tallest = 0;
      while (id && !placed.has(id) && !owned.has(id) && N.has(id) && chain.length < MAX) {
        const n = N.get(id);
        if (groups.has(id) && chain.length) { queue(id); break; }
        chain.push(n); placed.add(id); tallest = Math.max(tallest, height(n));
        const outs = links(n);
        for (let k = 1; k < outs.length; k++) queue(outs[k]);
        const next = outs[0];
        if (!next || placed.has(next) || owned.has(next) || !N.has(next)) { id = null; break; }
        id = next;
      }
      if (!chain.length) continue;
      chain.forEach((n, i) => { n.x = snap(LEFT + SX * i); n.y = snap(top); });
      top += tallest + YGAP;
      if (id) queue(id);
    }
    // With malformed or overlapping loops, never drop any original node.
    for (const n of all) if (!placed.has(n.id)) { n.x = LEFT; n.y = snap(top); top += height(n) + YGAP; }
    g._choiceBands = bands;
  }
  function segmentHits(x1, y1, x2, y2, node, source, target) {
    if (node.id === source.id || node.id === target.id) return false;
    const l = node.x - 7, r = node.x + W + 7, t = node.y - 7, b = node.y + height(node) + 7;
    if (Math.abs(y1 - y2) < 0.01) return y1 >= t && y1 <= b && Math.max(x1,x2) > l && Math.min(x1,x2) < r;
    if (Math.abs(x1 - x2) < 0.01) return x1 >= l && x1 <= r && Math.max(y1,y2) > t && Math.min(y1,y2) < b;
    return false;
  }
  // Compact routes, NOT scene-wide rail buses. Wires may cross each other,
  // but a connection must not travel hundreds of pixels below unrelated nodes.
  // For backwards links, use a short distinctive curve behind the nodes.
  function routes(g) {
    const nodes = g.nodes || [], N = new Map(nodes.map(n => [n.id, n]));
    const edges = [];
    for (const n of nodes) arms(n).forEach(({to,i}) => {
      if (N.has(to)) edges.push({ from:n.id, to, i, source:n, target:N.get(to) });
    });
    const BIN = 360, bins = new Map();
    for (const n of nodes) for (let k = Math.floor(n.x / BIN); k <= Math.floor((n.x + W) / BIN); k++) {
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(n);
    }
    const candidates = (l, r) => {
      const found = new Set(), result = [];
      for (let k=Math.floor(l / BIN); k <= Math.floor(r / BIN); k++) for (const n of bins.get(k) || []) {
        if (!found.has(n.id)) { found.add(n.id); result.push(n); }
      }
      return result;
    };
    // Reserve each occupied horizontal segment. If a later line would share
    // that same segment, give it a curved lane rather than hiding a wire.
    const occupied = new Map(), arrivals = new Map();
    const conflicts = (y,l,r) => (occupied.get(y) || []).some(seg => Math.min(seg[1],r)-Math.max(seg[0],l)>4);
    const reserve = (y,l,r) => {
      if (!occupied.has(y)) occupied.set(y, []);
      occupied.get(y).push([l,r]);
    };
    for (const e of edges) {
      const a = out(e.source,e.i), b = input(e.target), dx = b[0]-a[0], dy = b[1]-a[1];
      const rank = arrivals.get(e.to) || 0; arrivals.set(e.to, rank + 1);
      const flat = Math.abs(dy) < 1, forward = dx >= 28;
      // A line ending on the next node is truly horizontal when unobstructed.
      if (forward && flat && !conflicts(a[1],a[0],b[0])) {
        const hit = candidates(a[0],b[0]).some(n => segmentHits(a[0],a[1],b[0],b[1],n,e.source,e.target));
        if (!hit) {
          e.kind = 'straight'; e.d = `M${a[0]},${a[1]} H${b[0]}`;
          e.bounds = [a[0],a[1],b[0],b[1]];
          reserve(a[1],a[0],b[0]); continue;
        }
      }
      // Short cross-row connections get an elbow BETWEEN the columns. An
      // elbow is used only if it doesn't cut through other node rectangles.
      if (forward) {
        const nearby = candidates(a[0],b[0]);
        for (let j=0; j<6; j++) {
          const x = Math.round(a[0] + Math.max(22,Math.min(dx-14,dx*(0.5+(j%2 ? -1:1)*Math.ceil(j/2)*.115))));
          if (x <= a[0]+8 || x >= b[0]-8) continue;
          if (nearby.some(n => segmentHits(a[0],a[1],x,a[1],n,e.source,e.target) ||
            segmentHits(x,a[1],x,b[1],n,e.source,e.target) ||
            segmentHits(x,b[1],b[0],b[1],n,e.source,e.target))) continue;
          if (conflicts(a[1],a[0],x) || conflicts(b[1],x,b[0])) continue;
          e.kind = 'branch'; e.d = `M${a[0]},${a[1]} H${x} V${b[1]} H${b[0]}`;
          e.bounds = [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
          reserve(a[1],a[0],x); reserve(b[1],x,b[0]); break;
        }
        if (e.d) continue;
      }
      // Curved return/obstructed connection: its bounding box is local to
      // the endpoints, independent of how many nodes the scene contains.
      // Spread each arrival to make different return wires identifiable.
      const sweep = 28 + (rank % 7) * 12;
      const sign = (rank % 2 ? -1 : 1);
      const side = Math.max(42,Math.min(110,Math.abs(dx)*.18));
      const c1x = a[0] + (forward ? Math.max(28,dx*.25) : side);
      const c2x = b[0] - (forward ? Math.max(28,dx*.25) : side);
      const c1y = a[1] + sign * sweep;
      const c2y = b[1] - sign * sweep;
      e.d = `M${a[0]},${a[1]} C${Math.round(c1x)},${Math.round(c1y)} ${Math.round(c2x)},${Math.round(c2y)} ${b[0]},${b[1]}`;
      e.kind = 'return';
      e.bounds = [Math.min(a[0],b[0],c1x,c2x),Math.min(a[1],b[1],c1y,c2y),Math.max(a[0],b[0],c1x,c2x),Math.max(a[1],b[1],c1y,c2y)];
    }
    return edges;
  }
  return { height, out, input, choiceGroups, arrange, routes };
})();
//<<
