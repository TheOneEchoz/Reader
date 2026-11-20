/* NEW (not in the app yet): nodes are the basic operations; a chart is a sequence of nodes; a node can be a chart (charts inside charts). */
//>> js/75-nodes.js#0
const ENGINE_VERSION = 'nodes-5.10.1';   // shown in the page header and on the Charts screen; change it with every release
/* kind -> label, fields [key, label, placeholder], arms: the node holds sub-charts (menu/if), */
const NODE_KINDS = {
  say:   { t: 'Say',     f: [['who', 'Who', 'narrator if empty'], ['attrs', 'Appearance', 'happy'], ['text', 'Text', ''], ['with', 'Transition', 'dissolve']] },
  show:  { t: 'Show',    f: [['img', 'Character + variant', 'eileen happy'], ['at', 'Where', 'left / right / center'], ['with', 'Transition', 'dissolve'], ['layer', 'Layer', 'master']] },
  hide:  { t: 'Hide',    f: [['img', 'Character', 'eileen'], ['with', 'Transition', 'dissolve']] },
  scene: { t: 'Scene',   f: [['img', 'Background + variant', 'bg room'], ['with', 'Transition', 'fade']] },
  with:  { t: 'Transition', f: [['trans', 'Transition', 'dissolve']] },
  screen:{ t: 'Screen', f: [['mode', 'Action (show / hide)', 'show'], ['screen', 'Screen and arguments', 'vnui']] },
  camera:{ t: 'Camera / layer', f: [['mode', 'Operation (camera or show layer)', 'camera'], ['layer', 'Layer', 'master'], ['at', 'Transforms (comma separated)', 'camera_pan']] },
  audio: { t: 'Audio',   f: [['mode', 'play / stop / queue', 'play'], ['channel', 'Channel', 'music'], ['file', 'File', '"audio/theme.ogg"']] },
  set:   { t: 'Set variable', f: [['var', 'Variable', 'trust'], ['op', 'Operation', '= += -= *='], ['expr', 'Value', '1']] },
  get:   { t: 'Get variable', f: [['var', 'Into variable', 'answer'], ['src', 'From (expression) or "input"', 'trust + 1'], ['prompt', 'Prompt (input only)', 'Your name?']] },
  if:    { t: 'Branch',  arms: 'cond' },
  while: { t: 'Loop', arms: 'text', f: [['cond', 'While', 'True']] },
  menu:  { t: 'Choice menu', arms: 'text', f: [['prompt', 'Prompt', '']] },
  jump:  { t: 'Jump',    f: [['target', 'Chart', 'start']] },
  call:  { t: 'Call',    f: [['target', 'Chart', 'start']] },
  return:{ t: 'Return',  f: [['expr', 'Expression (optional)', 'value']] },
  python:{ t: 'Python',  f: [['code', 'Code', '']] },
  raw:   { t: 'Raw line', f: [['code', 'Ren\'Py line', '']] },
  chart: { t: 'Chart',   f: [['ref', 'Use chart (empty = inline)', 'name']], sub: true }
};
const nodeNew = k => { const n = { k, id: Math.random().toString(36).slice(2, 8) }; for (const [f] of (NODE_KINDS[k].f || [])) n[f] = ''; if (k === 'set') n.op = '='; if (k === 'audio') n.mode = 'play'; if (k === 'screen') n.mode = 'show'; if (k === 'camera') { n.layer = 'master'; n.mode = 'camera'; } if (k === 'get') n.src = 'input'; n.next = null; if (k === 'if') n.arms = [{ cond: 'True', to: null }, { cond: '', to: null }]; if (k === 'while') n.arms = [{ text: 'loop', to: null }, { text: 'after', to: null }]; if (k === 'menu') n.arms = [{ text: 'Option', cond: '', to: null }]; if (k === 'chart') { n.name = 'Group'; n.nodes = []; n.entry = null; n.g = 1; } return n; };
const nodeText = n => { const q = s => (s || '').trim(); switch (n.k) {
  case 'say': return `${q(n.who) || 'narrator'}${n.attrs ? ' (' + q(n.attrs) + ')' : ''}: ${n.text}`;
  case 'show': return `${n.img}${n.at ? ' at ' + n.at : ''}`; case 'hide': case 'scene': return n.img || '';
  case 'screen': return (n.mode === 'hide' ? 'hide ' : 'show ') + (n.screen || '');
  case 'with': return n.trans; case 'camera': return (n.mode === 'show layer' ? 'Show layer' : 'Camera') + ' ' + (n.layer || 'master') + (n.at ? ' at ' + n.at : '') + (n.originalCamera && n.useOriginal !== false ? ' · original game transform' : ''); case 'audio': return `${n.mode} ${n.channel} ${n.file}`;
  case 'set': return `${n.var} ${n.op} ${n.expr}`; case 'get': return `${n.var} ← ${n.src === 'input' ? 'player input' : n.src}`;
  case 'while': return 'while ' + n.cond; case 'if': return n.arms.map(a => a.cond).join(' | '); case 'menu': return n.arms.map(a => a.text).join(' · ');
  case 'jump': case 'call': return n.target; case 'return': return n.expr ? 'return ' + n.expr : 'return'; case 'chart': return n.ref ? '→ ' + n.ref : `${n.name} (${n.nodes.length} nodes)`;
  case 'python': case 'raw': return n.code; default: return ''; } };
/* the game's flat rows (with depth) -> nodes; menus and branches get their arms as sub-charts */
function rowsToNodes(rows) {
  const parse = (i, d) => {
    const out = [];
    while (i < rows.length && rows[i].d >= d) {
      const r = rows[i]; if (r.d > d) { i++; continue; }
      if (r.k === 'menu' || r.k === 'if') {
        const arms = [], ak = r.k === 'menu' ? 'choice' : 'branch'; i++;
        while (i < rows.length && rows[i].k === ak && rows[i].d === d + 1) { const a = rows[i], [nodes, j] = parse(i + 1, d + 2); arms.push(r.k === 'menu' ? { text: a.t, cond: a.c && a.c !== 'True' ? a.c : '', nodes } : { cond: a.t, nodes }); i = j; }
        out.push({ k: r.k, id: r.key, arms, prompt: '' }); continue;
      }
      if (r.k === 'while') { const [body, j] = parse(i + 1, d + 1); out.push({ k: 'while', id: r.key, cond: r.t || 'True', arms: [{ text: 'loop', nodes: body }, { text: 'after', to: null }] }); i = j; continue; }
      i++; let n;
      if (r.k === 'say') n = { k: 'say', who: r.w || '', attrs: '', text: r.t, with: '' };
      else if (r.k === 'jump' || r.k === 'call') n = { k: r.k, target: r.g != null ? String(r.g) : r.t ? 'expression ' + r.t : '' };
      else if (r.k === 'return') n = { k: 'return', expr: r.t || '' };
      else if (r.k === 'stage') {
        if (r.camera === 'Camera' || r.camera === 'ShowLayer') n = { k: 'camera', mode: r.camera === 'Camera' ? 'camera' : 'show layer', layer: r.layer || 'master', at: r.cameraAt || '', originalCamera: r.key, originalKind: r.camera, hasATL: !!r.hasATL, useOriginal: true };
        else { const m = /^(show|scene|hide|with)\s*(.*)$/.exec(r.t || ''); n = m ? (m[1] === 'with' ? { k: 'with', trans: m[2] } : /^(show|hide)$/.test(m[1]) && /^screen\s+/i.test(m[2]) ? { k: 'screen', mode: m[1], screen: m[2].replace(/^screen\s+/i, '') } : { k: m[1], img: m[2], at: '', with: '' }) : { k: 'raw', code: r.t }; }
      }
      else if (r.k === 'python') { const m = /^\$?\s*([A-Za-z_][\w.]*)\s*(=|\+=|-=|\*=)(?!=)\s*(.+)$/.exec(r.t || ''); n = m ? { k: 'set', var: m[1], op: m[2], expr: m[3] } : { k: 'python', code: r.t }; }
      else n = { k: 'raw', code: r.t || '' };
      n.id = r.key; out.push(n);
    }
    return [out, i];
  };
  return parse(0, 0)[0];
}
/* nested lists (from rowsToNodes) -> a wired graph: every node has an id and `next` (menu/branch arms have `to`); an arm's last node leads on to what followed the menu */
function toGraph(list) {
  const out = []; let c = 0;
  const build = (l, after) => { let nxt = after;
    for (let i = l.length - 1; i >= 0; i--) { const n = l[i];
      // Keep the original Ren'Py statement key for following unmodified game code.
      if (!n.sourceKey && typeof n.id === 'string' && n.id.includes(':')) n.sourceKey = n.id;
      n.id = 'n' + (++c);
      if (n.arms) { n.arms = n.arms.map((a, ai) => { const { nodes, ...r } = a; return { ...r, to: n.k === 'while' ? (ai === 0 ? build(nodes || [], null) : nxt) : nodes ? build(nodes, nxt) : a.to || null }; })
        /* an `if` with no else carries on with what comes after it when nothing matches. Without this arm the compiled code ended the label with a `return`, which sends the game to the main menu. */
        if (n.k === 'if' && !n.arms.some((a, ai) => ai > 0 && (!(a.cond || '').trim() || (a.cond || '').trim() === 'True'))) n.arms.push({ cond: '', to: nxt });
      } else n.next = nxt;
      if (n.k === 'chart' && !n.g) { const s = toGraph(n.nodes || []); n.nodes = s.nodes; n.entry = s.entry; n.g = 1; }
      out.push(n); nxt = n.id; }
    return nxt; };
  const entry = build(list, null); return { nodes: out.reverse(), entry };
}
/* a game scene as a graph: an empty scene still gets a node, and a scene that runs on into the next label keeps doing so (a jump at its end) */
function sceneGraph(s) {
  const l = rowsToNodes(s.r), z = l[l.length - 1];
  if (s.fall && (!z || (z.k !== 'jump' && z.k !== 'return'))) l.push({ k: 'jump', target: s.fall });
  else if (!l.length) l.push({ k: 'return' });
  const g = toGraph(l);
  // Imported game scenes now display safe standalone `with` commands as
  // open Transition Containers right away. This is only presentation data:
  // the import preserves statement order, source keys, and wired control flow.
  // Existing saved user charts are opened directly and never auto-converted.
  if (typeof tkbCompactTransitions === 'function') {
    g.importedTransitionContainers = tkbCompactTransitions(g);
  }
  return g;
}
const healNode = n => { if ((n.k === 'show' || n.k === 'hide') && /^screen\s+\S/i.test(n.img || '') && n.sourceKey) { const old = n.k; n.k = 'screen'; n.mode = old; n.screen = (n.img || '').replace(/^screen\s+/i, ''); delete n.img; } if (n.k === 'set' && /^\s*=/.test(n.expr || '')) { n.k = 'python'; n.code = `${n.var} ${n.op}${n.expr}`; delete n.var; delete n.op; delete n.expr; } };
const ensureGraph = c => { (c.nodes || []).forEach(healNode); if (!c.g) { const s = toGraph(c.nodes || []); c.nodes = s.nodes; c.entry = s.entry; c.g = 1; } c.nodes.forEach(n => { if (n.k === 'chart' && !n.g) ensureGraph(n); }); return c; };
/* Static structural checks. This is deliberately NOT a Ren'Py syntax checker:
   it can run without a browser runtime, but it cannot validate Python, ATL,
   custom statements, or version-dependent Ren'Py grammar. */
function tkbValidateGraph(name, graph, knownLabels) {
  const issues = [], known = new Set(knownLabels || []);
  const emit = (level, code, message, nodeId, scope) => issues.push({
    level, code, message, nodeId: nodeId || null, scope: scope || name
  });
  const check = (g, scope, depth) => {
    if (depth > 20) { emit('error', 'nesting', 'More than 20 nested chart levels; cannot safely inspect this graph.', null, scope); return; }
    const nodes = Array.isArray(g.nodes) ? g.nodes : [], map = new Map();
    for (const n of nodes) {
      if (!n || typeof n.id !== 'string' || !n.id) { emit('error', 'node-id', 'A node has no valid ID.', null, scope); continue; }
      if (map.has(n.id)) emit('error', 'duplicate-id', 'Duplicate node ID: ' + n.id, n.id, scope);
      map.set(n.id, n);
      if (!NODE_KINDS[n.k]) emit('error', 'unknown-kind', 'Unknown node type: ' + n.k, n.id, scope);
    }
    if (!nodes.length) { emit('warning', 'empty-graph', 'This chart contains no commands and will return immediately.', null, scope); return; }
    const entry = map.has(g.entry) ? g.entry : null;
    if (!entry) emit('error', 'missing-entry', 'The chart has no valid start node.', null, scope);
    const edges = n => n.arms ? n.arms.map(a => a.to) : n.k === 'jump' || n.k === 'return' ? [] : [n.next];
    for (const n of nodes) {
      if (!n || !n.id) continue;
      edges(n).filter(Boolean).forEach(target => {
        if (!map.has(target)) emit('error', 'broken-wire', 'Connection points to missing node ' + target + '.', n.id, scope);
      });
      if ((n.k === 'jump' || n.k === 'call' || (n.k === 'chart' && n.ref)) && !(n.target || n.ref || '').trim())
        emit('error', 'empty-target', 'This command requires a destination label.', n.id, scope);
      if ((n.k === 'jump' || n.k === 'call') && (n.target || '').trim() && known.size &&
          /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?$/.test(n.target.trim()) && !known.has(n.target.trim()))
        emit('warning', 'unresolved-label', 'Label "' + n.target.trim() + '" was not found in the imported label list (dynamic labels may exist).', n.id, scope);
      if (n.k === 'chart' && n.ref && known.size && !known.has(n.ref.trim()))
        emit('warning', 'unresolved-chart', 'Referenced chart "' + n.ref.trim() + '" was not found.', n.id, scope);
      if (n.k === 'if' && (!Array.isArray(n.arms) || !n.arms.length))
        emit('error', 'empty-branch', 'If node must have at least one branch.', n.id, scope);
      if (n.k === 'if' && Array.isArray(n.arms)) {
        const elses = n.arms.map((a,i) => (i > 0 && (!String(a.cond || '').trim() || String(a.cond).trim() === 'True')) ? i : -1).filter(i => i >= 0);
        if (elses.length > 1 || elses.some(i => i !== n.arms.length - 1))
          emit('error', 'else-order', 'An else/unconditional branch must occur once, at the end.', n.id, scope);
      }
      if (n.k === 'menu' && (!Array.isArray(n.arms) || !n.arms.length))
        emit('warning', 'empty-menu', 'A menu with no choices will return immediately.', n.id, scope);
      if (n.k === 'menu') for (const a of (n.arms || [])) if (!String(a.text || '').trim())
        emit('warning', 'empty-choice', 'A menu choice has no text.', n.id, scope);
      if (n.k === 'while' && (!Array.isArray(n.arms) || n.arms.length < 2))
        emit('error', 'loop-arms', 'Loop requires its body and after-loop exits.', n.id, scope);
      if (n.k === 'raw' && /[\r\n]/.test(String(n.code || '')))
        emit('error', 'multiline-raw', 'Multi-line raw code cannot be safely indented by the generator; use separate nodes or a Python block.', n.id, scope);
      if ((n.k === 'raw' || n.k === 'python') && !String(n.code || '').trim())
        emit('warning', 'empty-code', 'Empty code will compile as pass.', n.id, scope);
      if (n.k === 'chart' && !n.ref) check(n, scope + ' / ' + (n.name || n.id), depth + 1);
    }
    if (entry) {
      const seen = new Set(), pending = [entry];
      while (pending.length) {
        const id = pending.pop(); if (!map.has(id) || seen.has(id)) continue;
        seen.add(id); for (const to of edges(map.get(id))) if (to && !seen.has(to)) pending.push(to);
      }
      for (const n of nodes) if (n && n.id && !seen.has(n.id))
        emit('warning', 'unreachable', 'This node is disconnected from the chart start; it will not be generated.', n.id, scope);
    }
  };
  if (!graph || typeof graph !== 'object') emit('error', 'invalid-chart', 'Chart data is not an object.', null, name);
  else check(graph, name, 0);
  return issues;
}
function tkbValidatePatches(patches, labels) {
  const known = new Set(labels || []);
  for (const p of patches || []) if (p.op === 'chart' && p.name) known.add(p.name);
  return (patches || []).filter(p => p.op === 'chart').flatMap(p => tkbValidateGraph(p.name, p, known));
}
/* a graph -> Ren'Py. Nodes reached one way run on inline; a node with several ways in, or an arm's target, gets its own label and the others `jump` to it.
   A chart node becomes its own label that the parent `call`s. Nodes nothing leads to are not compiled. */
function graphToRpy(name, g) {
  const Q = rpyStr, nodes = g.nodes || [], N = new Map(nodes.map(n => [n.id, n])), entry = N.has(g.entry) ? g.entry : nodes[0] && nodes[0].id;
  const outs = n => n.arms ? n.arms.map(a => a.to) : (n.k === 'jump' || n.k === 'return') ? [] : [n.next];
  const seen = new Set(), ind = new Map(), arm = new Set(), st = [entry], order = [], subs = [];
  while (st.length) { const id = st.pop(); if (!N.has(id) || seen.has(id)) continue; seen.add(id); order.push(id); outs(N.get(id)).forEach(t => t && st.push(t)); }
  for (const id of order) for (const t of outs(N.get(id))) if (t && N.has(t)) { ind.set(t, (ind.get(t) || 0) + 1); if (N.get(id).arms) arm.add(t); }
  const lab = id => id === entry ? name : name + '_' + String(id).replace(/\W/g, '_'), labelled = id => id === entry || arm.has(id) || (ind.get(id) || 0) > 1;
  const go = t => t && N.has(t) ? 'jump ' + lab(t) : 'return', wt = n => n.transitionFrame ? '' : n.with ? ' with ' + n.with : '';
  /* the trace window (js/77-trace.js): every node reports itself when it runs; arms report which way was taken */
  const cname = g.name || name, T = (n, d) => `$ _tkb_trace(${pyLit(String(n.id))}, ${pyLit(n.k)}, ${pyLit(cname)}, ${pyLit(d || {})})`;
  const tdata = n => { switch (n.k) {
    case 'screen': return { mode: n.mode || 'show', screen: n.screen };
    case 'say': return { who: n.who, attrs: n.attrs, text: n.text }; case 'show': return { img: n.img, at: n.at }; case 'hide': case 'scene': return { img: n.img };
    case 'with': return { trans: n.trans }; case 'camera': return { mode: n.mode || 'camera', layer: n.layer, at: n.at, source: n.originalCamera || null }; case 'audio': return { mode: n.mode, channel: n.channel, file: n.file };
    case 'set': return { var: n.var, op: n.op, expr: n.expr }; case 'get': return { var: n.var, src: n.src };
    case 'jump': case 'call': return { target: n.target }; case 'return': return { expression: n.expr || '' }; case 'python': case 'raw': return { code: String(n.code || '').split('\n')[0].slice(0, 120) };
    case 'chart': return n.ref ? { ref: n.ref } : { name: n.name }; default: return {}; } };
  const op = n => { const L = body(n); if (n.arms) return L;
    const tr = tkbFrameTransitions(g, n);
    return [T(n, tdata(n)), ...L, ...tr.flatMap(f => [
      `$ _tkb_trace(${pyLit(String(f.id))}, 'with', ${pyLit(cname)}, ${pyLit({ trans: f.trans, mode: f.mode, container: true })})`,
      'with ' + (f.trans || 'None')
    ])]; };
  const body = n => { switch (n.k) {
    case 'say': return [`${n.who ? n.who + ' ' : ''}${n.attrs ? n.attrs + ' ' : ''}${Q(n.text || '')}${wt(n)}`];
    case 'show': return [`show ${n.img}${n.at ? ' at ' + n.at : ''}${n.layer ? ' onlayer ' + n.layer : ''}${wt(n)}`];
    case 'screen': return [(n.mode === 'hide' ? 'hide' : 'show') + ' screen ' + (n.screen || 'vnui')];
    case 'hide': return [`hide ${n.img}${wt(n)}`]; case 'scene': return [`scene ${n.img}${wt(n)}`]; case 'with': return ['with ' + n.trans];
    case 'camera': return n.originalCamera && n.useOriginal !== false
      ? [`$ _tkb_camera_original(${Q(n.originalCamera)}, ${Q(n.originalKind || 'Camera')})`]
      : [`${n.mode === 'show layer' ? 'show layer' : 'camera'}${n.layer && n.layer !== 'master' ? ' ' + n.layer : ''}${n.at ? ' at ' + n.at : ''}`];
    case 'audio': return [n.mode === 'stop' ? `stop ${n.channel}` : `${n.mode} ${n.channel} ${n.file}`];
    case 'set': return [/^\s*=/.test(n.expr || '') ? `$ ${n.var} ${n.op}${n.expr}` : `$ ${n.var} ${n.op} ${n.expr}`];
    case 'get': return [`$ ${n.var} = ${n.src === 'input' ? `renpy.input(${Q(n.prompt || '')})` : n.src}`];
    case 'jump': return ['jump ' + n.target]; case 'call': return ['call ' + n.target]; case 'return': return ['return' + (n.expr ? ' ' + n.expr : '')];
    case 'python': return ['python:', ...(n.code || 'pass').split('\n').map(l => '    ' + l)]; case 'raw': return [n.code || 'pass'];
    case 'chart': { if (n.ref) return ['call ' + n.ref]; const t = `${name}__${String(n.id).replace(/\W/g, '_')}`; subs.push([t, n]); return ['call ' + t]; }
    case 'while': return [`while ${n.cond || 'True'}:`, '    ' + T(n, { phase: 'again', cond: n.cond || 'True' }), n.arms[0].to && N.has(n.arms[0].to) ? '    call ' + lab(n.arms[0].to) : '    pass', T(n, { phase: 'done', cond: n.cond || 'True' }), go(n.arms[1].to)];
    case 'menu': return n.arms.length ? [T(n, { options: n.arms.map(a => a.text) }), 'menu:', ...(n.prompt ? ['    ' + Q(n.prompt)] : []), ...n.arms.flatMap(a => [`    ${Q(a.text)}${a.cond ? ' if ' + a.cond : ''}:`, '        ' + T(n, { chose: a.text, cond: a.cond || '' }), '        ' + go(a.to)])] : ['return'];
    case 'if': { const L = []; let els = false; n.arms.forEach((a, i) => { const c = (a.cond || '').trim(); if (i > 0 && (!c || c === 'True')) { L.push('else:'); els = true; } else L.push(`${i ? 'elif' : 'if'} ${c || 'True'}:`); L.push('    ' + T(n, { arm: i, cond: c })); L.push('    ' + go(a.to)); }); if (!els) L.push(T(n, { arm: -1 }), 'return'); return L; }
  } return []; };
  const out = [], done = new Set();
  if (!order.length) out.push(`label ${name}:`, '    return', '');
  for (const hd of order.filter(labelled)) { out.push(`label ${lab(hd)}:`); let id = hd;
    for (;;) { const n = N.get(id); done.add(id); op(n).forEach(l => out.push('    ' + l)); if (n.arms || n.k === 'jump' || n.k === 'return') break;
      const t = n.next; if (!t || !N.has(t)) { out.push('    return'); break; } if (labelled(t) || done.has(t)) { out.push('    jump ' + lab(t)); break; } id = t; }
    out.push(''); }
  return [out.join('\n').trimEnd(), ...subs.map(([t, s]) => graphToRpy(t, s))].join('\n\n');
}
//<<
