/* NEW: the chart editor: a graph canvas. Boxes are basic nodes; wire a box's right dot to the next box. A chart node opens a chart inside it. */
//>> js/76-charts.js#0
function openCharts(api) {   // api: { scenes(), P(), labels(), save(), apply() }
  $('#charts') && $('#charts').remove();
  const readOnly = !!api.readOnly;
  const root = h('div', { id: 'charts', role: 'dialog', 'aria-label': 'Charts' });
  if (readOnly) root.classList.add('charts-readonly');
  document.body.append(root);
  if (readOnly) {
    // The node editor has many controls created on selection. Disable every
    // change control, including dynamically constructed fields, and preserve
    // only the nested-chart navigation action. The original game is untouched.
    const lock = () => {
      for (const el of root.querySelectorAll('#cpanel input, #cpanel textarea, #cpanel select, #cpanel button:not(.ch-open-subchart), #cinner .gf-mode, #ch-add-node, #ch-new, #ch-apply, #ch-compact-btn')) {
        if (!el.disabled) el.disabled = true;
      }
    };
    const observer = new MutationObserver(lock);
    observer.observe(root, { childList: true, subtree: true });
    const baseRemove = root.remove.bind(root);
    root.remove = () => { observer.disconnect(); baseRemove(); };
  }
  // Always restore sound policy when the chart overlay is removed.
  const chartRemove = root.remove.bind(root);
  root.remove = () => { chartRemove(); syncGameAudio(true); };
  syncGameAudio(true);
  const mine = () => api.P().filter(p => p.op === 'chart'), trunc = (t, n = 30) => { t = String(t == null ? '' : t).replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const W = 210, GRID = 20, IMGH = 90, hasImg = n => !!api.image && (n.k === 'show' || n.k === 'scene'), rowsOf = n => n.arms ? n.arms.length : (n.k === 'jump' || n.k === 'return') ? 0 : 1, HT = n => 44 + Math.max(rowsOf(n), 1) * 22 + (hasImg(n) ? IMGH + 8 : 0), outPt = (n, i) => TKB_LAYOUT.out(n, i), inPt = n => TKB_LAYOUT.input(n);
  let ptr = [0, 0], rebase = null; root.addEventListener('pointermove', e => { ptr = [e.clientX, e.clientY]; }, true);
  let cur = null, path = [], sel = null, selectedFrame = null, msel = new Set(), k = 1, ox = 30, oy = 30, wire = null, inner, svg, panel, view;
  let runningId = null, lastRunningId = null, runningFrame = null, runningScene = '', stepCount = 0, lastMatch = null;
  const visitedFrames = new Set();
  const unmatchedEvents = [];
  const traceBase = id => String(id || '').replace(/#\d+$/, '');
  const tracePosition = id => traceBase(id).replace(/:[^:]*$/, '');
  // Normalize paths for matching only. Ren'Py can emit .rpyc while a
  // chart-import key was written with .rpy; retain the original text for UI.
  const sourceNorm = id => tracePosition(id).replace(/\\/g, '/')
    .replace(/^.*\/game\//i, '').replace(/^game\//i, '')
    .replace(/\.rpyc(?=:\d+$)/i, '.rpy').toLowerCase();
  // Only fallback to file/line matches when they are unambiguous.
  const sameSource = (a, b) => sourceNorm(a) && sourceNorm(a) === sourceNorm(b);
  // Statements can share one source line. A Ren'Py `scene/show ... with`
  // is commonly traced as with/scene/with with identical file and line.
  // Never label all of these as the first node on that line.
  const stmtText = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const sourceStatement = n => {
    switch (n.k) {
      case 'scene': case 'show': case 'hide': return stmtText(n.k + ' ' + (n.img || ''));
      case 'screen': return stmtText((n.mode === 'hide' ? 'hide' : 'show') + ' screen ' + (n.screen || ''));
      case 'with': return stmtText('with ' + (n.trans || ''));
      case 'camera': return stmtText((n.mode === 'show layer' ? 'show layer' : 'camera') + (n.layer && n.layer !== 'master' ? ' ' + n.layer : '') + (n.at ? ' at ' + n.at : '') + (n.hasATL && n.useOriginal !== false ? ' [original ATL]' : ''));
      case 'raw': return stmtText(n.code);
      case 'set': return stmtText(n.var + ' ' + n.op + ' ' + n.expr);
      case 'python': return stmtText(n.code);
      case 'jump': case 'call': return stmtText(n.k + ' ' + n.target);
      case 'say': return stmtText(n.text);
      default: return '';
    }
  };
  const eventStatement = t => {
    if (!t) return '';
    const d = t.d || {};
    if (t.k === 'stage') return stmtText(d.text);
    if (t.k === 'say') return stmtText(d.text);
    if (t.k === 'python') return stmtText(d.code);
    if (t.k === 'call' || t.k === 'jump') return stmtText(t.k + ' ' + d.target);
    return '';
  };
  const chooseSourceNode = (matches, t) => {
    if (matches.length === 1) return matches[0];
    if (!t || matches.length === 0) return null;
    const statement = eventStatement(t);
    if (!statement) return null;
    const exact = matches.filter(n => sourceStatement(n) === statement);
    return exact.length === 1 ? exact[0] : null;
  };
  const findTracedNode = (g, id, t) => {
    const nodes = g.nodes || [];
    const byNodeId = nodes.find(n => String(n.id) === String(id));
    if (byNodeId) return byNodeId;
    const sameKey = nodes.filter(n => n.sourceKey && traceBase(n.sourceKey) === traceBase(id));
    if (sameKey.length) return chooseSourceNode(sameKey, t);
    const sameLine = nodes.filter(n => n.sourceKey && sameSource(n.sourceKey, id));
    return chooseSourceNode(sameLine, t);
  };
  const findTracedFrame = (g, id, t) => {
    if (!g || !t) return null;
    const statement = eventStatement(t);
    if (t.k !== 'with' && !/^with\s/.test(statement)) return null;
    const frames = g.transitionFrames || [];
    const direct = frames.find(f => f.id === String(id) && t.k === 'with');
    if (direct) return direct;
    const matches = frames.filter(f => f.sourceKey && sameSource(f.sourceKey, id) &&
      (statement ? stmtText('with ' + f.trans) === statement : true));
    return matches.length === 1 ? matches[0] : null;
  };
  const visitedIds = new Set(), visitedEdges = new Set();
  const originalLocations = new Map(), sourceLineLocations = new Map(), sourceRows = new Map();
  for (const sc of api.scenes()) for (const r of sc.r || []) {
    if (r.key && !originalLocations.has(r.key)) originalLocations.set(r.key, sc.n);
    if (r.key) {
      const loc = sourceNorm(r.key);
      if (!sourceLineLocations.has(loc)) sourceLineLocations.set(loc, new Set());
      sourceLineLocations.get(loc).add(sc.n);
      if (!sourceRows.has(loc)) sourceRows.set(loc, []);
      sourceRows.get(loc).push({ scene: sc.n, kind: r.k, key: r.key });
    }
  }
  const sourceSceneFor = id => {
    const direct = originalLocations.get(id) || originalLocations.get(traceBase(id));
    if (direct) return direct;
    const scenes = sourceLineLocations.get(sourceNorm(id));
    return scenes && scenes.size === 1 ? [...scenes][0] : null;
  };
  // Diagnose failed mappings without claiming an executed statement was skipped.
  // A trace can be genuine even when no editable chart node exists.
  const traceCoverage = t => {
    const rows = sourceRows.get(sourceNorm(t.id)) || [];
    const inGraph = inner && cur && path.length ? (G().nodes || []).filter(n => n.sourceKey && sameSource(n.sourceKey, t.id)) : [];
    let category, explanation;
    if (t.k === 'unmapped') {
      category = 'AST not represented';
      explanation = 'Ren\'Py executed an AST type (' + (t.d?.type || 'unknown') + ') which the chart importer does not represent as an ordinary node.';
    } else if (inGraph.length > 1) {
      category = 'Ambiguous line';
      explanation = 'More than one graph node belongs to this file and line. A source-line fallback cannot safely choose one.';
    } else if (!rows.length) {
      category = 'Missing from import';
      explanation = 'The Ren\'Py tracer saw this statement, but it is absent from the current imported flow rows. Inspect label and branch traversal in the flow importer.';
    } else if (cur && !rows.some(r => r.scene === cur.name)) {
      category = 'Other chart';
      explanation = 'Source rows exist under ' + [...new Set(rows.map(r => r.scene))].join(', ') + ', not the currently displayed chart ' + cur.name + '.';
    } else {
      category = 'Graph source mismatch';
      explanation = 'Source rows were imported, but the open graph could not match their source keys. Check nested/edited chart source metadata and duplicate lines.';
    }
    return { category, explanation, importedRows: rows.slice(0, 8), graphMatches: inGraph.length, openChart: cur?.name || '' };
  };
  const liveStatus = msg => {
    const el = root.querySelector('#ch-live-status');
    if (el) el.textContent = msg;
  };
  const markRunning = () => {
    if (!inner) return;
    inner.querySelectorAll('.gnode').forEach(el => {
      el.classList.toggle('running', !!runningId && el.dataset.id === runningId);
      el.classList.toggle('executed', visitedIds.has(el.dataset.id));
    });
    inner.querySelectorAll('.gframe').forEach(el => {
      const id = el.dataset.frame;
      el.classList.toggle('running', runningFrame === id);
      el.classList.toggle('executed', visitedFrames.has(id));
    });
    if (svg) svg.querySelectorAll('path[data-a][data-b]').forEach(el => {
      el.classList.toggle('executed', visitedEdges.has(el.dataset.a + '>' + el.dataset.b));
    });
  };
  const followNode = n => {
    if (!view || !n) return;
    const r = view.getBoundingClientRect();
    const availW = Math.max(240, r.width - (SCENE_PREVIEW.active ? 490 : 0));
    const px = n.x * k + ox, py = n.y * k + oy;
    if (px < 30 || px > availW - W * k - 30 || py < 35 || py > r.height - HT(n) * k - 25) {
      ox = Math.round(availW * .40 - (n.x + W / 2) * k);
      oy = Math.round(r.height * .45 - (n.y + HT(n) / 2) * k);
      xf();
    }
  };
  const findNestedPath = (g, id, parents, t) => {
    if (findTracedNode(g, id, t)) return parents;
    for (const n of (g.nodes || [])) if (n.k === 'chart' && n.nodes && !n.ref) {
      const hit = findNestedPath(n, id, parents.concat({ title: n.name || 'Group', g: n }), t);
      if (hit) return hit;
    }
    return null;
  };
  const visitLastNode = () => {
    if (!lastMatch) { toast('No chart node has been confirmed by live tracing yet.', 3500); return; }
    if (!cur || cur.name !== lastMatch.scene) openScene(lastMatch.scene);
    if (!cur) { toast('The last running scene is not in the imported chart.', 3800); return; }
    const hit = findNestedPath(cur, lastMatch.source, [{ title: cur.name, g: cur }], lastMatch.trace);
    if (hit) { path = hit; clearSel(); edit(); }
    const node = (G().nodes || []).find(n => n.id === lastMatch.id) || findTracedNode(G(), lastMatch.source, lastMatch.trace);
    if (!node) { toast('The last node was edited or is no longer in this chart.', 4000); return; }
    // Recenter even when the node is on screen; navigation must be predictable.
    const r = view.getBoundingClientRect(), usable = Math.max(250, r.width - (SCENE_PREVIEW.active ? 460 : 0));
    ox = Math.round(usable * .45 - (node.x + W / 2) * k);
    oy = Math.round(r.height * .43 - (node.y + HT(node) / 2) * k);
    xf();
    markRunning();
  };
  const updateUnmatchedButton = () => {
    const btn = root.querySelector('#ch-unmatched-btn');
    if (btn) btn.textContent = 'Unmatched (' + unmatchedEvents.length + ')';
  };
  const recordUnmatched = (t, reason) => {
    if (t.k === 'label' || (t.k === 'unmapped' && (t.d?.type === 'Init' || t.d?.type === 'Pass'))) return; // Internal nodes don't need boxes.
    const coverage = traceCoverage(t);
    unmatchedEvents.push({ id: String(t.id || ''), kind: t.k, chart: t.c,
      source: t.d?.source || tracePosition(t.id), summary: traceSummary(t),
      category: coverage.category, reason: coverage.explanation,
      importedRows: coverage.importedRows, graphMatches: coverage.graphMatches,
      openChart: coverage.openChart, step: stepCount });
    if (unmatchedEvents.length > 80) unmatchedEvents.shift();
    updateUnmatchedButton();
  };
  const showUnmatched = () => {
    root.querySelector('#ch-unmatched-view')?.remove();
    const overlay = h('div', { id: 'ch-unmatched-view', class: 'ch-unmatched-shade' });
    const close = () => overlay.remove();
    const lines = unmatchedEvents.slice().reverse().map(item => h('div', { class: 'ch-unmatched-row' },
      h('b', {}, 'Step ' + item.step + ' · ' + item.kind + ' · ' + item.category),
      h('small', {}, item.source || item.id || '(no source location)'),
      h('div', {}, item.summary || '(no statement details)'),
      h('small', {}, item.reason)));
    const counts = new Map(), files = new Map();
    for (const item of unmatchedEvents) {
      counts.set(item.category, (counts.get(item.category) || 0) + 1);
      const file = String(item.source || '').replace(/:\d+$/, '') || '(unknown)';
      files.set(file, (files.get(file) || 0) + 1);
    }
    const countSummary = [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => n + ' ' + k).join(' · ');
    const fileSummary = [...files].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => n + ' in ' + k).join(' · ');
    const copy = h('button', { class: 'btn small', onclick: async () => {
      const data = JSON.stringify(unmatchedEvents, null, 2);
      try { await navigator.clipboard.writeText(data); toast('Unmatched trace copied.', 2500); }
      catch (_) { prompt('Copy unmatched trace', data); }
    } }, 'Copy diagnostic');
    overlay.append(h('div', { class: 'ch-unmatched-dialog' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', {}, 'Execution without a chart node'), copy,
        h('button', { class: 'btn small', onclick: close }, 'Close')),
      h('p', { class: 'hint' }, 'These are executed Ren\'Py statements without a uniquely matching graph node. They are not necessarily skipped statements: some AST types have no boxes. This list retains the latest 80 events.'),
      h('p', { class: 'hint' }, countSummary || 'No unmatched events recorded.'),
      h('p', { class: 'hint' }, fileSummary),
      h('div', { class: 'ch-unmatched-list' }, ...(lines.length ? lines : [h('p', {}, 'No unmatched execution events recorded.')]))));
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
    root.append(overlay);
  };
  const onLiveTrace = e => {
    if (!SCENE_PREVIEW.active || !root.isConnected || !e.detail || e.detail.p != null) return;
    const t = e.detail;
    stepCount++;
    let dest = cur && cur.name;
    const sourceScene = sourceSceneFor(t.id);
    if (sourceScene) dest = sourceScene;
    else if (api.scenes().some(x => x.n === t.c) || api.P().some(x => x.op === 'chart' && x.name === t.c)) dest = t.c;
    else if (t.k === 'label' && t.d && (api.scenes().some(x => x.n === t.d.name) || api.P().some(x => x.op === 'chart' && x.name === t.d.name))) dest = t.d.name;
    if (dest && (!cur || dest !== cur.name)) openScene(dest);
    if (!cur || !inner) { recordUnmatched(t, 'No chart is currently open.'); return; }
    let frame = findTracedFrame(G(), t.id, t);
    let node = frame ? (tkbFrameNodes(G(), frame).slice(-1)[0] || null) : findTracedNode(G(), t.id, t);
    if (!node) {
      const hit = findNestedPath(cur, t.id, [{ title: cur.name, g: cur }], t);
      if (hit) { path = hit; clearSel(); edit(); node = findTracedNode(G(), t.id, t); }
    }
    if (node) {
      if (runningScene !== cur.name) { visitedIds.clear(); visitedEdges.clear(); lastRunningId = null; runningScene = cur.name; }
      const from = G().nodes.find(n => n.id === lastRunningId);
      if (from && lastRunningId !== node.id &&
          (from.next === node.id || (from.arms || []).some(arm => arm.to === node.id))) {
        visitedEdges.add(lastRunningId + '>' + node.id);
      }
      runningId = node.id; lastRunningId = node.id; visitedIds.add(node.id);
      runningFrame = frame ? frame.id : (node.transitionFrame || null);
      if (runningFrame) visitedFrames.add(runningFrame);
      lastMatch = { scene: cur.name, source: node.sourceKey || String(t.id), id: node.id, trace: t };
      markRunning(); followNode(node);
      liveStatus('● Live · ' + cur.name + ' · ' + (NODE_KINDS[node.k]?.t || node.k) + ' · step ' + stepCount);
    } else if (t.k === 'label') {
      // A label transition is useful for scene navigation, but is not a node;
      // don't discard the last confirmed running node when seeing one.
      liveStatus('● Entered ' + (t.d?.name || dest) + ' · waiting for the next statement');
    } else {
      recordUnmatched(t, 'No exact or unique file/line match in the chart. It may be a source statement the importer does not represent.');
      liveStatus('● Live · ' + (dest || t.c || 'story') + ' · step ' + stepCount +
        ' · unmatched ' + t.k + ' (' + (t.d?.source || t.id || '?') + ')');
    }
  };
  const onPreviewState = e => {
    const active = !!e.detail?.active;
    root.classList.toggle('preview-active', active);
    liveStatus(active ? '● Game preview running · follow nodes as the story advances' : '');
    if (!active) { runningId = null; runningFrame = null; markRunning(); }
  };
  const onGameReset = () => {
    runningId = null; lastRunningId = null; runningFrame = null; runningScene = ''; stepCount = 0; lastMatch = null;
    visitedIds.clear(); visitedEdges.clear(); visitedFrames.clear(); unmatchedEvents.length = 0;
    markRunning(); updateUnmatchedButton();
    liveStatus('↻ Game reset · waiting for the runtime to restart');
  };
  const onPreviewError = e => {
    if (!SCENE_PREVIEW.active) return;
    liveStatus('⚠ Game error: ' + (e.detail?.short || 'unknown error').slice(0, 170));
  };
  window.addEventListener('tkb:trace-event', onLiveTrace);
  window.addEventListener('tkb:preview-state', onPreviewState);
  window.addEventListener('tkb:preview-error', onPreviewError);
  window.addEventListener('tkb:game-reset', onGameReset);
  const rm = root.remove.bind(root);
  let imgObserver = null;
  root.remove = () => {
    if (imgObserver) imgObserver.disconnect();
    cancelAnimationFrame(routeRAF); cancelAnimationFrame(viewportRAF); routeRAF = viewportRAF = 0;
    closeScenePreview();
    window.removeEventListener('tkb:trace-event', onLiveTrace);
    window.removeEventListener('tkb:preview-state', onPreviewState);
    window.removeEventListener('tkb:preview-error', onPreviewError);
    window.removeEventListener('tkb:game-reset', onGameReset);
    document.removeEventListener('keydown', onKey, true);
    rm();
    if (typeof api.onClose === 'function') api.onClose();
    syncGameAudio(true);
  };

  const G = () => path[path.length - 1].g;
  let selectedEdgeKey = null, hoverEdgeKey = null, hoverNodeId = null;
  let lastEdgeSignature = '', routeCache = null, routeRAF = 0, viewportRAF = 0;
  let visibleGraph = null;
  const worldBounds = () => {
    const r = view.getBoundingClientRect(), pad = 280;
    return { l:(-ox-pad)/k, t:(-oy-pad)/k, r:(r.width-ox+pad)/k, b:(r.height-oy+pad)/k };
  };
  const inView = (n, b) => n.x + W >= b.l && n.x <= b.r && n.y + HT(n) >= b.t && n.y <= b.b;
  const edgeVisible = (e, b) => !e.bounds || (e.bounds[2] >= b.l && e.bounds[0] <= b.r && e.bounds[3] >= b.t && e.bounds[1] <= b.b);
  let paintViewport = () => {};
  const scheduleViewport = () => {
    if (viewportRAF) return;
    viewportRAF = requestAnimationFrame(() => { viewportRAF = 0; if (view?.isConnected) paintViewport(); });
  };
  const updateEdgeHighlight = () => {
    if (!svg) return;
    const target = selectedEdgeKey || hoverEdgeKey;
    for (const el of svg.querySelectorAll('path.ch-edge')) {
      const chosen = !!selectedEdgeKey && el.dataset.key === selectedEdgeKey;
      const related = target ? el.dataset.key === target : !!hoverNodeId && (el.dataset.a === hoverNodeId || el.dataset.b === hoverNodeId);
      el.classList.toggle('ch-edge-selected', chosen);
      el.classList.toggle('ch-edge-focus', related);
      el.classList.toggle('ch-edge-dim', !!(target || hoverNodeId) && !related);
    }
  };
  // History snapshots are per top-level chart, not per DOM node. Restoring a
  // chart in-place keeps the patches array identity stable; then reopen from
  // the root to avoid dangling references into an old nested graph.
  const histories = new WeakMap(), MAX_UNDO = 30;
  const historyFor = () => {
    if (!cur) return null;
    if (!histories.has(cur)) { const initial = JSON.stringify(cur); histories.set(cur, { now: initial, initial, wasPatch: api.P().includes(cur), past: [], future: [] }); }
    return histories.get(cur);
  };
  const historyButtons = () => {
    const history = historyFor();
    const undo = root.querySelector('#ch-undo'), redo = root.querySelector('#ch-redo');
    if (undo) undo.disabled = readOnly || !history?.past.length;
    if (redo) redo.disabled = readOnly || !history?.future.length;
  };
  const persist = () => {
    if (readOnly) return;
    const history = historyFor(), fresh = JSON.stringify(cur);
    if (fresh !== history.now) {
      history.past.push(history.now);
      if (history.past.length > MAX_UNDO) history.past.shift();
      history.now = fresh; history.future.length = 0;
    }
    if (cur && !api.P().includes(cur)) api.P().push(cur);
    api.save(); historyButtons();
  };
  const travelHistory = direction => {
    if (readOnly || !cur) return;
    const hist = historyFor(), from = direction < 0 ? hist.past : hist.future;
    if (!from.length) return;
    const into = direction < 0 ? hist.future : hist.past;
    into.push(hist.now); if (into.length > MAX_UNDO) into.shift();
    hist.now = from.pop();
    const saved = JSON.parse(hist.now);
    Object.keys(cur).forEach(key => { delete cur[key]; });
    Object.assign(cur, saved);
    path = [{ title: cur.name || 'Chart', g: cur }];
    // Undoing the first change to an imported scene must restore the original
    // rather than retaining a needless whole-scene override.
    const patches = api.P(), index = patches.indexOf(cur);
    if (hist.now === hist.initial && !hist.wasPatch) {
      if (index >= 0) patches.splice(index, 1);
    } else if (index < 0) patches.push(cur);
    clearSel(); api.save(); edit(); historyButtons();
  };
  const showValidation = (issues, applyAfter = null) => {
    root.querySelector('#ch-validation')?.remove();
    const counts = { error: issues.filter(i => i.level === 'error').length, warning: issues.filter(i => i.level === 'warning').length };
    const shade = h('div', { id: 'ch-validation', class: 'ch-unmatched-shade' });
    const box = h('div', { class: 'ch-unmatched-dialog' });
    const close = () => shade.remove();
    const list = issues.slice(0, 120).map(issue => h('div', { class: 'ch-unmatched-row' },
      h('b', {}, (issue.level === 'error' ? 'Error' : 'Warning') + ' · ' + issue.code),
      h('small', {}, issue.scope + (issue.nodeId ? ' · node ' + issue.nodeId : '')),
      h('div', {}, issue.message)));
    box.append(h('div', { class: 'row', style: 'justify-content:space-between;gap:10px' },
      h('b', {}, 'Graph validation'), h('button', { class: 'btn small', onclick: close }, 'Close')),
      h('p', { class: 'hint' }, counts.error + ' error(s), ' + counts.warning + ' warning(s). These checks are structural only: Ren’Py syntax, embedded Python, transforms and game-dependent labels still need testing in the target Ren’Py version.'),
      h('div', { class: 'ch-unmatched-list' }, ...(list.length ? list : [h('p', {}, 'No structural problems detected.')])));
    if (issues.length > 120) box.append(h('p', { class: 'hint' }, 'Showing the first 120 results.'));
    if (applyAfter && !counts.error) box.append(h('button', { class: 'btn primary', onclick: () => { close(); applyAfter(); } }, 'Continue applying (warnings acknowledged)'));
    shade.append(box); shade.addEventListener('pointerdown', e => { if (e.target === shade) close(); }); root.append(shade);
    return counts;
  };

  const snapV = (v, free) => free ? Math.round(v) : Math.round(v / GRID) * GRID;
  const frameBounds = (f, g = G()) => {
    const m = tkbFrameNodes(g, f).filter(n => Number.isFinite(n.x) && Number.isFinite(n.y));
    if (!m.length) return { x: f.x || 0, y: f.y || 0, w: 260, h: 145 };
    const minX = Math.min(...m.map(n => n.x)), minY = Math.min(...m.map(n => n.y));
    const maxX = Math.max(...m.map(n => n.x + W)), maxY = Math.max(...m.map(n => n.y + HT(n)));
    return { x: minX - 14, y: minY - 32, w: maxX - minX + 28, h: maxY - minY + 50 };
  };
  const boundsStyle = b => `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
  const withinBounds = (b, p) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
  const frameAt = (p, snapshots) => {
    const hits = (G().transitionFrames || []).filter(f => withinBounds(snapshots.get(f.id) || frameBounds(f), p));
    hits.sort((a, b) => { const x = snapshots.get(a.id) || frameBounds(a), y = snapshots.get(b.id) || frameBounds(b); return x.w * x.h - y.w * y.h; });
    return hits[0] || null;
  };
  const updateFrames = () => {
    if (!inner) return;
    inner.querySelectorAll('.gframe').forEach(el => {
      const f = (G().transitionFrames || []).find(q => q.id === el.dataset.frame);
      if (f) el.style.cssText = boundsStyle(frameBounds(f));
    });
  };

  const clearSel = () => { sel = null; selectedFrame = null; msel = new Set(); };
  /* a picture for a Show / Scene node: the game is asked what file the image name stands for */
  const imgBox = n => { const nm = (n.img || '').trim(), box = h('div', { class: 'gimg', style: `top:${44 + Math.max(rowsOf(n), 1) * 22 + 4}px;height:${IMGH}px` }, h('small', {}, nm ? 'looking…' : 'no image set'));
    const load = () => {
      if (!nm || !api.image || box.dataset.loaded) return;
      box.dataset.loaded = '1';
      const display = u => {
        if (!root.isConnected || !box.isConnected) return;
        const us = Array.isArray(u) ? u : u ? [u] : [], inf = api.imageInfo && api.imageInfo(nm);
        box.classList.toggle('layers', us.length > 1);
        if (us.length) return box.replaceChildren(...us.map(x => h('img', { src: x, alt: nm, title: inf?.why || nm, draggable: 'false', onerror: ev => { ev.target.replaceWith(h('small', {}, 'Image format could not be displayed')); } })));
        const reason = inf?.why || 'No matching picture found';
        const retry = api.retryImage ? h('button', { type: 'button', class: 'btn small', style: 'padding:3px 8px;font-size:11px', onclick: ev => { ev.stopPropagation(); box.replaceChildren(h('small', {}, 'retrying…')); Promise.resolve(api.retryImage(nm)).then(display, err); } }, 'Retry') : null;
        box.replaceChildren(h('small', {title:reason}, reason), retry);
      };
      const err = e => { if (root.isConnected && box.isConnected) box.replaceChildren(h('small', {}, 'Image lookup failed: '+String(e?.message||e))); };
      Promise.resolve().then(()=>api.image(nm)).then(display, err);
    };
    if (nm && api.image) {
      if ((readOnly || api.legacy) && typeof IntersectionObserver !== 'undefined') {
        // DDLC has hundreds of Show nodes. Read artwork only when the user
        // pans near it; otherwise a long chart can load every sprite at once.
        if (!imgObserver) imgObserver = new IntersectionObserver(entries => {
          for (const e of entries) if (e.isIntersecting) {
            imgObserver.unobserve(e.target);
            if (e.target._tkbLoad) e.target._tkbLoad();
          }
        }, { root: view, rootMargin: '200px' });
        box._tkbLoad = load;
        imgObserver.observe(box);
      } else load();
    }
    return box; };
  const removeNodes = ids => { const g = G(); g.nodes = g.nodes.filter(x => !ids.has(x.id)); for (const m of g.nodes) { if (ids.has(m.next)) m.next = null; (m.arms || []).forEach(a => { if (ids.has(a.to)) a.to = null; }); } if (ids.has(g.entry)) g.entry = g.nodes[0] ? g.nodes[0].id : null; clearSel(); persist(); nodes(); drawPanel(); };
  /* the tidy places: layers from left to right (a box is right of every box that leads to it), the order in each layer chosen to keep wires from
     crossing, each box lined up with the wire that comes in, everything on the grid. A very long chain is wrapped into rows. */
  const tidyGraphDense = g => {
    const list = g.nodes; if (!list.length) return;
    const N = new Map(list.map(n => [n.id, n])), outs = n => (n.arms ? n.arms.map((a, i) => [a.to, i]) : rowsOf(n) ? [[n.next, 0]] : []).filter(([t]) => t && N.has(t) && t !== n.id);
    const hasIn = new Set(); for (const n of list) for (const [t] of outs(n)) hasIn.add(t);
    const state = new Map(), back = new Set(), post = [], ek = (a, t, i) => a + '>' + t + '>' + i;
    const roots = [N.get(g.entry), ...list.filter(n => !hasIn.has(n.id)), ...list].filter(Boolean);
    for (const r of roots) { if (state.has(r.id)) continue; state.set(r.id, 1); const st = [[r, 0, outs(r)]];
      while (st.length) { const top = st[st.length - 1];
        if (top[1] < top[2].length) { const [t, i] = top[2][top[1]++], s2 = state.get(t); if (s2 === 1) back.add(ek(top[0].id, t, i)); else if (!s2) { state.set(t, 1); const m = N.get(t); st.push([m, 0, outs(m)]); } }
        else { state.set(top[0].id, 2); post.push(top[0]); st.pop(); } } }
    post.reverse(); const ord = new Map(post.map((n, i) => [n.id, i]));
    const layer = new Map(list.map(n => [n.id, 0])), up = new Map(list.map(n => [n.id, []])), dn = new Map(list.map(n => [n.id, []]));
    for (const n of post) for (const [t, i] of outs(n)) if (!back.has(ek(n.id, t, i))) { layer.set(t, Math.max(layer.get(t), layer.get(n.id) + 1)); up.get(t).push([n, i]); dn.get(n.id).push([N.get(t), i]); }
    const Ls = []; for (const n of list) (Ls[layer.get(n.id)] = Ls[layer.get(n.id)] || []).push(n);
    for (let l = 0; l < Ls.length; l++) Ls[l] = (Ls[l] || []).sort((a, b) => ord.get(a.id) - ord.get(b.id));
    const pos = new Map(); const index = () => Ls.forEach(L => L.forEach((n, i) => pos.set(n.id, i))); index();
    const sweep = (L, nb, rev) => { const key = new Map(); for (const n of L) { const e = nb.get(n.id); if (!e.length) { key.set(n, pos.get(n.id)); continue; } let t = 0; for (const [m, i] of e) t += pos.get(m.id) + (rev ? 0 : i * 0.05); key.set(n, t / e.length); } L.sort((a, b) => key.get(a) - key.get(b) || pos.get(a.id) - pos.get(b.id)); L.forEach((n, i) => pos.set(n.id, i)); };
    for (let it = 0; it < 6; it++) { for (let l = 1; l < Ls.length; l++) sweep(Ls[l], up, false); for (let l = Ls.length - 2; l >= 0; l--) sweep(Ls[l], dn, true); }
    // heights: stack each layer, then pull boxes toward the wire that comes in (and goes out), keeping their order
    const GAPY = 40, pin = i => 44 + i * 22 + 11; const y = new Map();
    for (const L of Ls) { let c = 0; for (const n of L) { y.set(n.id, c); c += HT(n) + GAPY; } }
    const settle = (L, want) => { let floor = -1e9; for (const n of L) { const w = want(n); const v = Math.max(w == null ? y.get(n.id) : w, floor); y.set(n.id, v); floor = v + HT(n) + GAPY; } };
    for (let it = 0; it < 4; it++) {
      for (let l = 1; l < Ls.length; l++) settle(Ls[l], n => { const e = up.get(n.id); return e.length ? e.reduce((t, [m, i]) => t + y.get(m.id) + pin(i) - 12, 0) / e.length : null; });
      for (let l = Ls.length - 2; l >= 0; l--) settle(Ls[l], n => { const e = dn.get(n.id); return e.length ? e.reduce((t, [m, i]) => t + y.get(m.id) + 12 - pin(i), 0) / e.length : null; });
    }
    // x by layer; a long chain wraps into rows of PER layers
    const CW = W + 90, PER = Ls.length > 12 ? Math.max(6, Math.ceil(Math.sqrt(Ls.length * 2))) : Ls.length; let cursor = 0;
    for (let b = 0; b * PER < Ls.length; b++) {
      const ns = []; for (let l = b * PER; l < Math.min(Ls.length, (b + 1) * PER); l++) for (const n of Ls[l]) ns.push(n);
      const top = Math.min(...ns.map(n => y.get(n.id))), bot = Math.max(...ns.map(n => y.get(n.id) + HT(n)));
      for (const n of ns) { n.x = snapV(40 + (layer.get(n.id) - b * PER) * CW); n.y = snapV(40 + cursor + y.get(n.id) - top); }
      cursor += bot - top + 140;
    }
  };
  // Story-first layout: arrange commands into short left-to-right lines, like
  // reading a storyboard. Branches remain wired and join only after their
  // incoming paths. Avoid the deep diagonal stacked columns in Dense layout.
  const tidyGraphStory = g => {
    const list = g.nodes || []; if (!list.length) return;
    const N = new Map(list.map(n => [n.id, n]));
    const ix = new Map(list.map((n, i) => [n.id, i]));
    const adj = n => (n.arms ? n.arms.map(a => a.to) : rowsOf(n) ? [n.next] : []).filter(t => t && N.has(t) && t !== n.id);
    // Discover loop backs; they are rendered as return wires but do not
    // impose an impossible topological ordering on a loop header.
    const seen = new Map(), back = new Set(), stack = [];
    const ek = (a, b) => a + '>' + b;
    for (const r of [N.get(g.entry), ...list].filter(Boolean)) {
      if (seen.has(r.id)) continue;
      seen.set(r.id, 1); stack.push([r, 0, adj(r)]);
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top[1] >= top[2].length) { seen.set(top[0].id, 2); stack.pop(); continue; }
        const t = top[2][top[1]++];
        if (seen.get(t) === 1) back.add(ek(top[0].id, t));
        else if (!seen.has(t)) { seen.set(t, 1); const q = N.get(t); stack.push([q, 0, adj(q)]); }
      }
    }
    const incoming = new Map(list.map(n => [n.id, 0]));
    for (const n of list) for (const to of adj(n)) if (!back.has(ek(n.id, to))) incoming.set(to, incoming.get(to) + 1);
    let ready = list.filter(n => incoming.get(n.id) === 0).sort((a,b) => ix.get(a.id) - ix.get(b.id));
    const order = [], used = new Set(); let prev = null;
    while (ready.length) {
      // Prefer a direct continuation, then the next statement in source order.
      let at = prev ? ready.findIndex(n => adj(prev).includes(n.id)) : -1;
      if (at < 0 && g.entry && !used.has(g.entry)) at = ready.findIndex(n => n.id === g.entry);
      if (at < 0) at = 0;
      const n = ready.splice(at, 1)[0]; if (used.has(n.id)) continue;
      order.push(n); used.add(n.id); prev = n;
      for (const to of adj(n)) if (!back.has(ek(n.id, to))) {
        incoming.set(to, incoming.get(to) - 1);
        if (incoming.get(to) === 0 && !used.has(to)) ready.push(N.get(to));
      }
      ready.sort((a,b) => ix.get(a.id) - ix.get(b.id));
    }
    for (const n of list) if (!used.has(n.id)) order.push(n); // malformed cycles
    const PER = Math.max(6, Math.min(11, Number(g.flowColumns) || 9));
    const GAPX = 88, GAPY = 115, CW = W + GAPX;
    let y = 70;
    for (let start = 0; start < order.length; start += PER) {
      const batch = order.slice(start, start + PER);
      const maxH = Math.max(...batch.map(HT));
      for (let i = 0; i < batch.length; i++) {
        batch[i].x = snapV(50 + i * CW);
        batch[i].y = snapV(y + (maxH - HT(batch[i])) / 2);
      }
      y += maxH + GAPY;
    }
  };
  const tidyGraph = g => (g.layoutMode === 'dense' ? tidyGraphDense(g) : TKB_LAYOUT.arrange(g));
  const layout = g => { if (g.nodes.some(n => n.x == null)) tidyGraph(g); };
  const drag = (onmove, onup) => { const up = e => { window.removeEventListener('pointermove', onmove); window.removeEventListener('pointerup', up); onup && onup(e); }; window.addEventListener('pointermove', onmove); window.addEventListener('pointerup', up); };
  const pt = e => { const r = view.getBoundingClientRect(); return [(e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k]; };
  const xf = () => { inner.style.transform = `translate(${ox}px,${oy}px) scale(${k})`; const gs = GRID * k; view.style.backgroundImage = gs < 6 ? 'none' : 'radial-gradient(var(--line,#bbb) 1px, transparent 1px)'; view.style.backgroundSize = `${gs}px ${gs}px`; view.style.backgroundPosition = `${ox}px ${oy}px`; scheduleViewport(); };
  // Cache routes while panning. Only draw connections in/near the viewport;
  // thousands of nodes no longer require thousands of SVG path elements.
  const paintEdges = () => {
    if (!svg || !view?.isConnected || !path.length) return;
    const all = routeCache || (routeCache = TKB_LAYOUT.routes(G()));
    const b = worldBounds();
    const shown = G().nodes.length > 320 ? all.filter(e => edgeVisible(e,b)) : all;
    const signature = shown.map(e => `${e.from}/${e.i}/${e.to}`).join(';') + (wire ? '/wire' : '');
    if (signature === lastEdgeSignature && !wire) return;
    lastEdgeSignature = signature;
    const html = shown.map(e => {
      const key = `${e.from}|${e.i}|${e.to}`;
      const attr = `data-key="${key}" data-a="${e.from}" data-b="${e.to}" data-arm="${e.i}"`;
      return `<path class="ch-edge ch-${e.kind}" ${attr} d="${e.d}"/><path class="ch-edge-hit" ${attr} d="${e.d}"><title>${e.from} → ${e.to}</title></path>`;
    });
    if (wire) {
      const a = outPt(wire.a,wire.i), b = [wire.x,wire.y];
      html.push(`<path class="tmp" d="M${a[0]},${a[1]} C${a[0]+55},${a[1]} ${b[0]-55},${b[1]} ${b[0]},${b[1]}"/>`);
    }
    svg.innerHTML = html.join('');
    updateEdgeHighlight(); markRunning();
  };
  const edges = () => {
    routeCache = null; lastEdgeSignature = '';
    if (routeRAF) return;
    routeRAF = requestAnimationFrame(() => { routeRAF = 0; paintEdges(); });
  };
  const markSel = () => { $$('.gnode', inner).forEach(e => e.classList.toggle('sel', msel.has(e.dataset.id))); $$('.gframe', inner).forEach(e => e.classList.toggle('selected', e.dataset.frame === selectedFrame)); };
  const ASSET = { img: 'image', file: 'audio', target: 'label', ref: 'label', who: 'char' }, ASSET_TITLE = { image: 'Pick a picture', audio: 'Pick a sound', label: 'Pick a chart or scene', char: 'Pick a character', tag: 'Pick a character image' };
  const pickAsset = (kind, done) => {
    $('#chpick') && $('#chpick').remove();
    const q = h('input', { class: 'text', placeholder: 'Search…', autocomplete: 'off', 'aria-label': 'Search' }), list = h('div', { class: 'plist' }), info = h('small', { class: 'hint' }, 'Reading the game…');
    const m = h('div', { id: 'chpick', onclick: e => { if (e.target === m) m.remove(); } }, h('div', { class: 'box stack' }, h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('b', {}, ASSET_TITLE[kind]), h('button', { class: 'btn small ghost', 'aria-label': 'Close', onclick: () => m.remove() }, icon('x'))), q, info, list));
    root.append(m); q.focus();
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); en.target._load && en.target._load(); } }), { root: list }) : null;
    let all = [], hit = [];
    const draw = () => { const t = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean); hit = all.filter(a => t.every(w => a.name.toLowerCase().includes(w)));
      info.textContent = `${hit.length} of ${all.length}` + (hit.length > 80 ? ' (showing 80: type more to narrow it down)' : '');
      list.replaceChildren(...hit.slice(0, 80).map(a => { const b = h('button', { type: 'button', class: 'pitem', onclick: () => { m.remove(); done(a.value); } }, (kind === 'image' || kind === 'tag') ? h('span', { class: 'pth' }) : null, h('span', { class: 'pn' }, a.name));
        if (kind === 'image' || kind === 'tag') { b._load = () => Promise.resolve(api.image(a.value)).then(u => { const us = Array.isArray(u) ? u : u ? [u] : [], th = b.firstChild; th.classList.toggle('layers', us.length > 1); th.replaceChildren(...us.map(x => h('img', { src: x, alt: '', draggable: 'false' }))); }); io ? io.observe(b) : b._load(); }
        return b; })); };
    Promise.resolve(api.assets(kind)).then(a => { all = a || []; draw(); }, () => { info.textContent = 'The game\'s files could not be read.'; });
    q.addEventListener('input', draw); q.addEventListener('keydown', e => { if (e.key === 'Enter' && hit[0]) { m.remove(); done(hit[0].value); } else if (e.key === 'Escape') { e.stopPropagation(); m.remove(); } });
  };
  /* Character + Variant: an image name is a tag (the character, or a background) and its variant words (a layered image's attributes, like "casual happy").
     The node still keeps one `img` text; anything after the image name (at left, as x, behind y, onlayer…, with…) is kept as it was. */
  const IMG_TAIL = /\s+(?:at|as|behind|onlayer|zorder|with|where)\b[\s\S]*$/;
  const splitImg = v => { v = String(v || ''); const m = IMG_TAIL.exec(v), w = (m ? v.slice(0, m.index) : v).trim().split(/\s+/).filter(Boolean); return { tag: w[0] || '', vars: w.slice(1).join(' '), tail: m ? m[0] : '' }; };
  const pickVariant = (tag, cur, done) => {
    $('#chpick') && $('#chpick').remove(); tag = String(tag || '').trim();
    if (!tag) { toast('Choose the character first.', 2500); return; }
    const chosen = new Set(String(cur || '').split(/\s+/).filter(Boolean)), known = [], groupOf = new Map();
    const prev = h('div', { class: 'vprev' }, h('small', {}, 'preview')), body = h('div', { class: 'plist vlist' }, h('small', { class: 'hint' }, 'Reading the game…'));
    const m = h('div', { id: 'chpick', onclick: e => { if (e.target === m) m.remove(); } }, h('div', { class: 'box stack' }, h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('b', {}, `Variant of ${tag}`), h('button', { class: 'btn small ghost', 'aria-label': 'Close', onclick: () => m.remove() }, icon('x'))),
      prev, body, h('div', { class: 'row' }, h('button', { class: 'btn small primary', type: 'button', onclick: () => { m.remove(); done([...known.filter(w => chosen.has(w)), ...[...chosen].filter(w => !known.includes(w))].join(' ')); } }, 'Use this'), h('button', { class: 'btn small', type: 'button', onclick: () => { chosen.clear(); paint(); } }, 'Clear'))));
    root.append(m); let tm = 0, seq = 0;
    const words = () => [...chosen].join(' ');
    const preview = () => { clearTimeout(tm); tm = setTimeout(() => { const me = ++seq; Promise.resolve(api.image(tag + ' ' + words())).then(u => { if (me !== seq) return; const us = Array.isArray(u) ? u : u ? [u] : []; prev.classList.toggle('layers', us.length > 1); prev.replaceChildren(...(us.length ? us.map(x => h('img', { src: x, alt: '', draggable: 'false' })) : [h('small', { title: 'no picture for this combination' }, (() => { const nm = (tag + ' ' + words()).trim(), inf = api.imageInfo && api.imageInfo(nm); return 'no picture for this combination' + (inf && inf.why ? ' — ' + inf.why : ''); })())])); }, () => { }); }, 120); };
    const btns = [];
    const paint = () => { btns.forEach(([b, f]) => b.classList.toggle('on', f())); preview(); };
    const opt = (label, on, click) => { const b = h('button', { type: 'button', class: 'vopt', 'aria-pressed': 'false', onclick: () => { click(); paint(); b.setAttribute('aria-pressed', on() ? 'true' : 'false'); } }, label); btns.push([b, on]); return b; };
    Promise.resolve(api.variants ? api.variants(tag) : { layered: [], plain: [] }).then(info => {
      const kids = [];
      for (const g of info.layered || []) {
        kids.push(h('div', { class: 'vgrp' }, h('small', { class: 'hint' }, g.group ? `${g.group} (one of)` : 'Other parts (any)'), h('div', { class: 'vrow' }, g.attrs.map(([a, def]) => { known.push(a); if (g.group) groupOf.set(a, g.group);
          return opt(a + (def ? ' · default' : ''), () => chosen.has(a), () => { if (chosen.has(a)) chosen.delete(a); else { if (g.group) for (const [o, gg] of groupOf) if (gg === g.group) chosen.delete(o); chosen.add(a); } }); }))));
      }
      if ((info.plain || []).length) kids.push(h('div', { class: 'vgrp' }, h('small', { class: 'hint' }, (info.layered || []).length ? 'Ready-made combinations' : 'Variants (one of)'), h('div', { class: 'vrow' }, info.plain.map(v => { const w = v.split(/\s+/); w.forEach(x => known.includes(x) || known.push(x));
        return opt(v, () => w.every(x => chosen.has(x)) && chosen.size === w.length, () => { const same = w.every(x => chosen.has(x)) && chosen.size === w.length; chosen.clear(); if (!same) w.forEach(x => chosen.add(x)); }); }))));
      body.replaceChildren(...(kids.length ? kids : [h('small', { class: 'hint' }, `No variants found for “${tag}”. Type them into the Variant box instead.`)])); paint();
    }, () => body.replaceChildren(h('small', { class: 'hint' }, 'The game\'s files could not be read.')));
  };
  const tagOfWho = who => { const c = (api.chars ? api.chars() : []).find(x => x[0] === who); return (c && c[2]) || who || ''; };
  const imgField = o => {
    const bg = o.k === 'scene', hide = o.k === 'hide', sp = splitImg(o.img);
    const tag = h('input', { class: 'text', value: sp.tag, placeholder: bg ? 'bg' : 'eileen', 'aria-label': bg ? 'Background' : 'Character' }), vr = h('input', { class: 'text', value: sp.vars, placeholder: 'casual happy', 'aria-label': 'Variant' });
    const commit = () => { const t = splitImg(o.img).tail; o.img = [tag.value.trim(), hide ? '' : vr.value.trim()].filter(Boolean).join(' ') + t; persist(); nodes(); };
    tag.onchange = vr.onchange = commit;
    return h('div', { class: 'stack' },
      h('label', { class: 'hint' }, bg ? 'Background' : 'Character (image name)', h('div', { class: 'frow' }, tag, api.assets ? h('button', { class: 'btn small', type: 'button', title: 'Pick from the game\'s characters and backgrounds', onclick: e => { e.preventDefault(); pickAsset('tag', v => { if (tag.value.trim() !== v) vr.value = ''; tag.value = v; commit(); }); } }, icon('search'), 'Browse') : null)),
      hide ? null : h('label', { class: 'hint' }, 'Variant', h('div', { class: 'frow' }, vr, api.variants ? h('button', { class: 'btn small', type: 'button', title: 'Pick outfit, expression… of this image', onclick: e => { e.preventDefault(); pickVariant(tag.value, vr.value, v => { vr.value = v; commit(); }); } }, icon('search'), 'Browse') : null)));
  };
  const field = (o, [key, lab, ph]) => {
    if (key === 'img' && (o.k === 'show' || o.k === 'hide' || o.k === 'scene')) return imgField(o);
    const i = h('input', { class: 'text', value: o[key] || '', placeholder: ph, 'aria-label': lab, onchange: () => { o[key] = i.value; persist(); nodes(); } });
    if (o.k === 'say' && key === 'attrs' && api.variants) return h('label', { class: 'hint' }, lab, h('div', { class: 'frow' }, i, h('button', { class: 'btn small', type: 'button', title: 'Pick the variant of who speaks', onclick: e => { e.preventDefault(); pickVariant(tagOfWho(o.who), i.value, v => { i.value = v; o.attrs = v; persist(); nodes(); }); } }, icon('search'), 'Browse')));
    return h('label', { class: 'hint' }, lab, ASSET[key] && api.assets ? h('div', { class: 'frow' }, i, h('button', { class: 'btn small', type: 'button', title: 'Search the game\'s own ' + ASSET[key] + 's', onclick: e => { e.preventDefault(); pickAsset(ASSET[key], v => { i.value = v; o[key] = v; persist(); nodes(); }); } }, icon('search'), 'Browse')) : i); };
  const setEdge = (n, i, t) => { if (n.arms) n.arms[i].to = t; else n.next = t; };
  const nodeEl = (g, n) => { const K = NODE_KINDS[n.k], rows = n.arms ? n.arms.map((a, i) => [n.k === 'if' ? a.cond || 'else' : a.text, i]) : rowsOf(n) ? [['', 0]] : [];
    return h('div', { class: `gnode k-${n.k}${msel.has(n.id) ? ' sel' : ''}`, 'data-id': n.id, style: `left:${n.x}px;top:${n.y}px;width:${W}px;height:${HT(n)}px`, onpointerdown: e => { if (e.target.classList.contains('pin') || e.button !== 0) return; e.stopPropagation();
        if (e.ctrlKey || e.metaKey) { if (msel.has(n.id)) { msel.delete(n.id); if (sel === n.id) sel = [...msel].pop() || null; } else { msel.add(n.id); sel = n.id; } markSel(); drawPanel(); return; }
        selectedFrame = null;
        if (readOnly) { msel = new Set([n.id]); sel = n.id; markSel(); drawPanel(); return; }
        const was = msel.has(n.id); if (!was) msel = new Set([n.id]); sel = n.id; markSel(); drawPanel();
        let mine = g.nodes.filter(x => msel.has(x.id)).map(x => [x, x.x, x.y]), s0 = [e.clientX, e.clientY, n.x, n.y]; let mv = false;
        const originalFrames = new Map((g.transitionFrames || []).map(f => [f.id, frameBounds(f, g)]));
        rebase = () => { s0 = [ptr[0], ptr[1], n.x, n.y]; mine = mine.map(([m]) => [m, m.x, m.y]); };
        drag(ev => { if (!mv && Math.hypot(ev.clientX - s0[0], ev.clientY - s0[1]) < 4) return; mv = true;
            const dx = snapV(s0[2] + (ev.clientX - s0[0]) / k, ev.shiftKey) - s0[2], dy = snapV(s0[3] + (ev.clientY - s0[1]) / k, ev.shiftKey) - s0[3];   // Shift: no snapping
            for (const [m, x0, y0] of mine) { m.x = x0 + dx; m.y = y0 + dy; const el = inner.querySelector(`[data-id="${m.id}"]`); if (el) { el.style.left = m.x + 'px'; el.style.top = m.y + 'px'; } } edges(); },
          () => { rebase = null;
            if (mv) {
              for (const [m] of mine) {
                const at = frameAt([m.x + W / 2, m.y + HT(m) / 2], originalFrames);
                if (at && tkbCanTransition(m)) m.transitionFrame = at.id;
                else if (!at) delete m.transitionFrame;
              }
              persist(); nodes(); drawPanel();
            } else if (was && msel.size > 1) { msel = new Set([n.id]); markSel(); drawPanel(); }
          }); },
      ondblclick: () => { if (n.k === 'chart' && !n.ref) { path.push({ title: n.name, g: n }); clearSel(); edit(); } } },
      h('div', { class: 'gh' }, (g.entry === n.id ? '▶ ' : '') + K.t), h('div', { class: 'gt' }, trunc(nodeText(n))), h('span', { class: 'pin in' }), hasImg(n) ? imgBox(n) : null,
      rows.map(([lab, i]) => h('div', { class: 'gp', style: `top:${44 + i * 22}px` }, h('small', {}, trunc(lab, 22)), h('span', { class: 'pin out', style: !n.arms ? 'top:-38px' : '', onpointerdown: e => { e.stopPropagation(); e.preventDefault(); if (readOnly) return; wire = { a: n, i, x: 0, y: 0 };
        const p0 = [e.clientX, e.clientY]; let went = false;
        drag(ev => { if (!went && Math.hypot(ev.clientX - p0[0], ev.clientY - p0[1]) < 6) return; went = true; [wire.x, wire.y] = pt(ev); edges(); }, ev => { const t = document.elementFromPoint(ev.clientX, ev.clientY), ne = t && t.closest('.gnode'); wire = null;
          // only a real drag changes the wire; dropping on its own box or outside the canvas (panel, picker) keeps it; only empty canvas cuts it
          if (went && !(ne && ne.dataset.id === n.id) && (ne || (t && t.closest('#cview')))) { setEdge(n, i, ne ? ne.dataset.id : null); persist(); } edges(); }); } })))); };
  const frameEl = (g, f) => {
    const mode = h('select', { class: 'gf-mode', 'aria-label': 'Transition behavior', title: 'Choose when the transition runs',
      onpointerdown: e => e.stopPropagation(), onclick: e => e.stopPropagation(), onchange: e => {
        f.mode = e.target.value; persist(); nodes(); drawPanel();
      } }, h('option', { value: 'group', selected: f.mode !== 'each' }, 'Once after group'), h('option', { value: 'each', selected: f.mode === 'each' }, 'After each'));
    const header = h('div', { class: 'gf-head', onpointerdown: e => {
      if (e.button !== 0 || e.target.closest('select')) return;
      e.preventDefault(); e.stopPropagation(); clearSel(); selectedFrame = f.id; markSel(); drawPanel();
      const start = [e.clientX, e.clientY], fpos = [f.x || 0, f.y || 0];
      const children = tkbFrameNodes(g, f).map(n => [n, n.x, n.y]); let moved = false;
      drag(ev => { if (!moved && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 4) return;
        moved = true;
        const dx = snapV((ev.clientX - start[0]) / k, ev.shiftKey), dy = snapV((ev.clientY - start[1]) / k, ev.shiftKey);
        f.x = fpos[0] + dx; f.y = fpos[1] + dy;
        for (const [n, x, y] of children) {
          n.x = x + dx; n.y = y + dy;
          const el = inner.querySelector(`[data-id="${n.id}"]`);
          if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
        }
        updateFrames(); edges();
      }, () => { if (moved) { persist(); nodes(); drawPanel(); } });
    } }, h('b', {}, '◈ Transition: ' + (f.trans || 'None')), h('span', { class: 'gf-count' }, tkbFrameNodes(g, f).length + ' nodes'), mode);
    return h('div', { class: 'gframe' + (selectedFrame === f.id ? ' selected' : ''), 'data-frame': f.id, style: boundsStyle(frameBounds(f, g)) }, header);
  };
  const nodes = () => { const g = G(); layout(g); inner.querySelectorAll('.gnode,.gframe,.gchoice-band').forEach(e => e.remove());
    const cb = root.querySelector('#ch-compact-btn');
    if (cb) { const s = tkbCompactAnalysis(g); cb.textContent = 'Compact + tidy' + (s.eligible ? ' (' + s.eligible + ')' : ''); cb.title = s.eligible ? 'Convert ' + s.eligible + ' safe standalone transition(s) into containers' : 'Click to see why no transitions can be compacted'; }
    // Non-interactive colored lanes make returning dialogue options legible.
    for (const band of g._choiceBands || []) {
      const el = h('div', { class: 'gchoice-band', style: `left:${band.x}px;top:${band.y}px;width:${band.width}px;height:${band.height}px` },
        h('span', { class: 'gchoice-label' }, `Choice ${band.index + 1} · ${trunc(band.label, 35)}`));
      inner.append(el);
    }
    (g.transitionFrames || []).forEach(f => inner.append(frameEl(g, f)));
    visibleGraph = g;
    const bounds = worldBounds();
    for (const n of g.nodes) if (g.nodes.length <= 320 || inView(n,bounds) || msel.has(n.id) || runningId === n.id)
      inner.append(nodeEl(g,n));
    edges(); markRunning(); };
  paintViewport = () => {
    if (!path.length || G() !== visibleGraph || G().nodes.length <= 320 || !inner) return;
    const g = G(), b = worldBounds(), existing = new Map();
    for (const el of inner.querySelectorAll('.gnode')) existing.set(el.dataset.id,el);
    for (const n of g.nodes) {
      const want = inView(n,b) || msel.has(n.id) || runningId === n.id;
      const el = existing.get(n.id);
      if (want && !el) inner.append(nodeEl(g,n));
      else if (!want && el) el.remove();
    }
    paintEdges(); markRunning();
  };
  const drawPanel = () => { const g = G(), n = g.nodes.find(x => x.id === sel);
    if (msel.size > 1) { const ch = () => g.nodes.filter(x => msel.has(x.id)), act = f => () => { f(ch()); persist(); nodes(); drawPanel(); };
      return panel.replaceChildren(h('div', { class: 'stack', id: 'ch-multi' }, h('b', {}, `${msel.size} nodes selected`),
        h('p', { class: 'hint', style: 'margin:0' }, 'Drag any selected box to move them all. Ctrl-click adds or removes one, Ctrl+A selects all, Esc clears. Hold Shift while dragging to move without snapping to the grid.'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: act(c => { const x = Math.min(...c.map(m => m.x)); c.forEach(m => { m.x = x; }); }) }, 'Align left'),
          h('button', { class: 'btn small', onclick: act(c => { const y = Math.min(...c.map(m => m.y)); c.forEach(m => { m.y = y; }); }) }, 'Align top'),
          h('button', { class: 'btn small', onclick: act(c => { c.sort((a, b) => a.y - b.y); const x = Math.min(...c.map(m => m.x)); let y = c[0].y; for (const m of c) { m.x = x; m.y = y; y += HT(m) + GRID * 2; } }) }, 'Stack in a column'),
          h('button', { class: 'btn small danger', onclick: () => removeNodes(new Set(msel)) }, icon('trash'), 'Delete selected')))); }
    const frame = (g.transitionFrames || []).find(f => f.id === selectedFrame);
    if (frame && !n) {
      const members = tkbFrameNodes(g, frame);
      const trans = h('input', { class: 'text', 'aria-label': 'Transition name', value: frame.trans || 'None', placeholder: 'dissolve', onchange: e => { frame.trans = e.target.value.trim() || 'None'; persist(); nodes(); } });
      const mode = h('select', { class: 'text', 'aria-label': 'Transition mode', onchange: e => { frame.mode = e.target.value; persist(); nodes(); drawPanel(); } },
        h('option', { value: 'group', selected: frame.mode !== 'each' }, 'Once after group'),
        h('option', { value: 'each', selected: frame.mode === 'each' }, 'After each compatible node'));
      return panel.replaceChildren(h('div', { class: 'stack' }, h('b', {}, 'Transition Container (' + members.length + ' nodes)'),
        h('div', { class: 'row' }, h('label', { class: 'hint' }, 'Transition', trans), h('label', { class: 'hint' }, 'When to apply', mode)),
        h('p', { class: 'hint', style: 'margin:0' }, 'Drag compatible nodes into or out of this open frame. It resizes around its contents. ‘Once after group’ emits one Ren’Py with statement at the end of each consecutive run of contained nodes. ‘After each’ emits one after each contained command. The graph wiring determines execution order; nesting does not reorder it.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => { tkbUnwrapFrame(g, frame); clearSel(); persist(); nodes(); drawPanel(); } }, 'Convert back to transition node(s)'),
          h('button', { class: 'btn small danger', onclick: () => {
            if (!confirm('Remove this container and its transition effects? Commands inside will remain.')) return;
            members.forEach(m => delete m.transitionFrame); g.transitionFrames = g.transitionFrames.filter(f => f.id !== frame.id);
            clearSel(); persist(); nodes(); drawPanel();
          } }, 'Remove transition'))));
    }
    if (!n) return panel.replaceChildren(h('p', { class: 'hint' }, readOnly ? 'Select a command to inspect it. Scroll to zoom; use Fit or Tidy to navigate. Use Scene map to see how this scene connects to others. Read-only mode never changes the game.' : 'Drag a box\'s right dot onto another box to wire it; drop on empty space to cut the wire. Drag boxes to move them (they snap to the grid; hold Shift while dragging to move them freely). Drag a rectangle with the left button to select several boxes. Add a Transition Container to group commands without changing their connections.'));
    const K = NODE_KINDS[n.k], kids = [h('b', {}, K.t)];
    if (n.transitionFrame) {
      const fr = tkbTransitionFrame(g, n);
      kids.push(h('div', { class: 'row' }, h('small', { class: 'hint' }, 'Inside Transition: ' + (fr?.trans || 'None')),
        h('button', { class: 'btn small ghost', onclick: () => { delete n.transitionFrame; persist(); nodes(); drawPanel(); } }, 'Remove from container')));
    }
    if (n.k === 'camera' && n.originalCamera && n.useOriginal !== false) {
      kids.push(h('p', { class: 'hint' }, 'Original Ren’Py camera statement. It will reuse its compiled camera transform, including any ATL block, when applied.'));
      kids.push(h('button', { class: 'btn small', onclick: () => { n.useOriginal = false; persist(); nodes(); drawPanel(); } }, 'Convert to custom camera'));
    } else { for (const f of K.f || []) kids.push(field(n, f)); }
    if (n.k === 'chart') { kids.push(field(n, ['name', 'Name', 'Group'])); if (!n.ref) kids.push(h('button', { class: 'btn small ch-open-subchart', onclick: () => { path.push({ title: n.name, g: n }); clearSel(); edit(); } }, `Open chart (${n.nodes.length} nodes) ▸`)); }
    if (n.arms) { n.arms.forEach((a, i) => kids.push(h('div', { class: 'row' }, field(a, [K.arms, K.arms === 'cond' ? 'Condition (empty = else)' : 'Choice text', '']), n.k === 'menu' ? field(a, ['cond', 'Only if', '']) : null, n.k === 'while' ? null : h('button', { class: 'btn small ghost', 'aria-label': 'Remove', onclick: () => { n.arms.splice(i, 1); persist(); edit(); } }, icon('trash')))));
      if (n.k !== 'while') kids.push(h('button', { class: 'btn small', onclick: () => { n.arms.push(n.k === 'if' ? { cond: '', to: null } : { text: 'Option', cond: '', to: null }); persist(); nodes(); drawPanel(); } }, icon('plus'), n.k === 'if' ? 'Add branch' : 'Add choice')); }
    kids.push(h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { g.entry = n.id; persist(); nodes(); } }, '▶ Start here'),
      h('button', { class: 'btn small danger', onclick: () => { g.nodes = g.nodes.filter(x => x !== n); for (const m of g.nodes) { if (m.next === n.id) m.next = null; (m.arms || []).forEach(a => { if (a.to === n.id) a.to = null; }); } if (g.entry === n.id) g.entry = g.nodes[0] ? g.nodes[0].id : null; clearSel(); persist(); nodes(); drawPanel(); } }, icon('trash'), 'Delete node')));
    panel.replaceChildren(h('div', { class: 'stack' }, kids)); };
  const fit = () => { const g = G(); if (!g.nodes.length && !(g.transitionFrames || []).length) return; let x1 = 1, y1 = 1; for (const n of g.nodes) { x1 = Math.max(x1, n.x + W); y1 = Math.max(y1, n.y + HT(n)); } for (const f of (g.transitionFrames || [])) { const b = frameBounds(f, g); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); } const r = view.getBoundingClientRect(); k = Math.max(0.12, Math.min(1, (r.width - 60) / x1, (r.height - 60) / y1)); ox = 20; oy = 20; xf(); };
  const edit = () => { const g = G(), top = h('div', { class: 'mtop' }, h('button', { class: 'btn small', id: 'ch-map-back', onclick: home }, icon('back'), api.sceneMap ? 'Scene map' : 'Charts'),
      path.map((p, i) => h('button', { class: 'btn small ghost', onclick: () => { path = path.slice(0, i + 1); clearSel(); edit(); } }, (i ? '› ' : '') + p.title)),
      h('select', { id: 'ch-add-node', class: 'text', 'aria-label': 'Add a node', style: 'width:auto', onchange: e => { const kd = e.target.value; e.target.value = ''; if (!kd) return;
        const r = view.getBoundingClientRect(), nx = snapV((r.width / 2 - ox) / k - W / 2), ny = snapV((r.height / 3 - oy) / k);
        if (kd === 'transitionFrame') { const fr = tkbNewFrame(g, nx, ny, 'dissolve', 'group'); clearSel(); selectedFrame = fr.id; persist(); nodes(); drawPanel(); return; }
        const n = nodeNew(kd); n.x = nx; n.y = ny; g.nodes.push(n); if (!g.entry) g.entry = n.id; clearSel(); sel = n.id; persist(); nodes(); drawPanel();
      } }, h('option', { value: '' }, '+ Add node'), h('option', { value: 'transitionFrame' }, 'Transition Container'), Object.keys(NODE_KINDS).map(kd => h('option', { value: kd }, NODE_KINDS[kd].t))),
      h('button', { class: 'btn small ghost', id: 'ch-compact-btn', title: 'Check this chart for standalone transitions that can become containers', onclick: () => {
        const report = msg => {
          const el = root.querySelector('#ch-compact-result');
          if (el) {
            el.replaceChildren(h('span', { style: 'flex:1;min-width:0' }, msg),
              h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'Dismiss conversion message', onclick: () => { el.style.display = 'none'; } }, '×'));
            el.style.display = 'flex';
          }
        };
        try {
          const before = tkbCompactAnalysis(g);
          if (!before.eligible) {
            const why = Object.entries(before.reasons).sort((a,b) => b[1] - a[1])
              .slice(0, 3).map(([name, count]) => `${count} ${name}`).join('; ');
            report(!before.total ? 'This chart has no standalone Transition nodes to compact.' :
              `${before.total} Transition node(s), 0 safe conversions. ${why}. The rest are kept separate to preserve branching.`);
            return;
          }
          // Preserve the part of the graph the user was looking at while
          // compacting hundreds of boxes in a large scene.
          const vr = view.getBoundingClientRect();
          const vx = (vr.width / 2 - ox) / k, vy = (vr.height / 2 - oy) / k;
          const anchors = g.nodes.filter(n => n.k !== 'with');
          const anchor = anchors.length ? anchors.reduce((best, n) =>
            Math.hypot(n.x + W / 2 - vx, n.y + HT(n) / 2 - vy) < Math.hypot(best.x + W / 2 - vx, best.y + HT(best) / 2 - vy) ? n : best) : null;
          const count = tkbCompactTransitions(g);
          if (!count) { report('Conversion found candidates but did not change the chart. No data was saved.'); return; }
          clearSel();
          const last = (g.transitionFrames || []).slice(-1)[0];
          if (last) selectedFrame = last.id;
          // Reflow explicitly on compaction so the removed transition boxes
          // actually reduce the width/number of rows rather than leaving gaps.
          // The user chose a layout-changing action; command order and edges
          // remain unchanged.
          tidyGraph(g);
          persist(); nodes(); drawPanel();
          if (anchor) {
            ox = Math.round(vr.width / 2 - (anchor.x + W / 2) * k);
            oy = Math.round(vr.height / 2 - (anchor.y + HT(anchor) / 2) * k);
            xf();
          }
          const after = tkbCompactAnalysis(g);
          const extra = after.total ? ` ${after.total} transition(s) left standalone for safety.` : '';
          report(`Converted ${count} transition(s) to open containers (Once after group) and tidied the graph to close gaps.${extra} Command order and connections are unchanged.`);
        } catch (error) {
          console.error('[Tankobon compact transitions]', error);
          report('Compact transitions failed: ' + (error && error.message || error));
        }
      } }, 'Compact + tidy'),
      h('select', { class: 'btn small ghost', id: 'ch-layout-mode', title: 'Choose between readable story rows and the older dense graph', onchange: e => { g.layoutMode = e.target.value; tidyGraph(g); persist(); nodes(); edges(); fit(); } },
        h('option', { value: 'story', selected: g.layoutMode !== 'dense' }, 'Story flow'),
        h('option', { value: 'dense', selected: g.layoutMode === 'dense' }, 'Dense graph')),
      h('button', { class: 'btn small ghost', onclick: () => { tidyGraph(g); persist(); nodes(); fit(); } }, icon('sort'), 'Tidy'), h('button', { class: 'btn small ghost', onclick: fit }, icon('full'), 'Fit'),
      readOnly ? null : h('button', { class: 'btn small ghost', id: 'ch-undo', title: 'Undo graph edit (Ctrl+Z)', onclick: () => travelHistory(-1) }, 'Undo'),
      readOnly ? null : h('button', { class: 'btn small ghost', id: 'ch-redo', title: 'Redo graph edit (Ctrl+Shift+Z or Ctrl+Y)', onclick: () => travelHistory(1) }, 'Redo'),
      h('button', { class: 'btn small ghost', id: 'ch-validate', onclick: () => showValidation(tkbValidateGraph(cur.name, cur, api.labels())) }, 'Validate'),
      h('small', { class: 'hint' }, ENGINE_VERSION + (readOnly ? ' · Read only' : api.legacy ? ' · Legacy draft editor' : '')), api.preview ? h('button', { class: 'btn small', id: 'ch-play', title: 'Dock the running game and follow real execution on this graph', onclick: () => api.preview(cur.name) }, icon('play'), 'Preview scene') : null,
      api.preview ? h('button', { class: 'btn small ghost', id: 'ch-last-node', title: 'Go to the last node confirmed by the live game trace', onclick: visitLastNode }, icon('move'), 'Last node') : null,
      api.preview ? h('button', { class: 'btn small ghost', id: 'ch-unmatched-btn', title: 'Inspect executed game statements without a matching chart node', onclick: showUnmatched }, 'Unmatched (' + unmatchedEvents.length + ')') : null,
      api.preview ? h('button', { class: 'btn small', id: 'ch-setup', title: 'Configure variables before jumping to this scene', onclick: () => openSceneSetup(cur.name) }, icon('tune'), 'Scene setup') : null,
      api.preview ? h('button', { class: 'btn small', id: 'ch-reset', title: 'Restart the embedded game, preserving this editor', onclick: resetRunningGame }, icon('restart'), 'Reset game') : null,
      api.legacy && api.resetScene ? h('button', { class: 'btn small ghost', id: 'ch-restore-scene', onclick: async () => {
        if (!mine().some(p=>p.name===cur?.name)) return toast('This scene has no saved changes.',2500);
        if (!confirm('Discard your draft changes to this scene? The imported original will be shown again.')) return;
        const name=cur.name; await api.resetScene(name); openScene(name);
      } }, 'Discard scene draft') : null,
      readOnly ? null : h('button', { class: 'btn small primary', id: 'ch-apply', onclick: () => {
        const issues = tkbValidatePatches(api.P(), api.labels());
        const run = async () => {
          try { const ok=await api.apply(); if (ok !== false && !api.legacy) toast('Applied to the game.', 2500); }
          catch(e) { console.error('Apply failed',e); toast('Could not apply changes: '+(e?.message||e),6000); }
        };
        if (issues.length) showValidation(issues, issues.some(i => i.level === 'error') ? null : run);
        else run();
      } }, api.applyLabel || 'Apply to game'));
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'cedges'; inner = h('div', { id: 'cinner' }, svg); panel = h('div', { id: 'cpanel' });
    view = h('div', { id: 'cview', onpointerdown: e => {
        if (e.button === 0 && e.target.closest('.gnode')) return;
        // middle button (or a finger): move around (by what the pointer moved, so zooming at the same time works)
        if (e.button === 1 || (e.button === 0 && e.pointerType === 'touch')) { e.preventDefault(); if (e.button === 0) { clearSel(); markSel(); drawPanel(); } let last = [e.clientX, e.clientY]; view.classList.add('panning'); drag(ev => { ox += ev.clientX - last[0]; oy += ev.clientY - last[1]; last = [ev.clientX, ev.clientY]; xf(); }, () => view.classList.remove('panning')); return; }
        if (e.button !== 0) return;
        selectedEdgeKey = null; updateEdgeHighlight();
        // left button: a rectangle that selects the boxes it touches (Ctrl/Shift adds to the selection); it stays fixed on the picture while you zoom
        const add = e.ctrlKey || e.metaKey || e.shiftKey, r = view.getBoundingClientRect(), wx0 = (e.clientX - r.left - ox) / k, wy0 = (e.clientY - r.top - oy) / k, base = add ? new Set(msel) : new Set(); let box = null, moved = false;
        if (!add) { clearSel(); markSel(); drawPanel(); }
        drag(ev => { const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top, wx1 = (x1 - ox) / k, wy1 = (y1 - oy) / k, sx0 = wx0 * k + ox, sy0 = wy0 * k + oy; if (!moved && Math.hypot(x1 - sx0, y1 - sy0) < 5) return; moved = true;
          if (!box) { box = h('div', { class: 'mmarq' }); view.append(box); }
          box.style.left = Math.min(sx0, x1) + 'px'; box.style.top = Math.min(sy0, y1) + 'px'; box.style.width = Math.abs(x1 - sx0) + 'px'; box.style.height = Math.abs(y1 - sy0) + 'px';
          const ax = Math.min(wx0, wx1), bx = Math.max(wx0, wx1), ay = Math.min(wy0, wy1), by = Math.max(wy0, wy1);
          msel = new Set(base); for (const n of G().nodes) if (n.x < bx && n.x + W > ax && n.y < by && n.y + HT(n) > ay) msel.add(n.id); sel = [...msel].pop() || null; markSel(); },
          () => { box && box.remove(); drawPanel(); }); } }, inner);
    // A clicked connection remains highlighted even after the pointer leaves.
    view.addEventListener('pointerover', e => {
      const id = e.target.closest('.gnode')?.dataset.id || null;
      if (id !== hoverNodeId) { hoverNodeId = id; updateEdgeHighlight(); }
    });
    view.addEventListener('pointerleave', () => { hoverNodeId = null; hoverEdgeKey = null; updateEdgeHighlight(); });
    svg.addEventListener('pointerover', e => {
      const pathEl = e.target.closest('.ch-edge-hit');
      if (pathEl) { hoverEdgeKey = pathEl.dataset.key; updateEdgeHighlight(); }
    });
    svg.addEventListener('pointerout', e => {
      if (e.target.closest('.ch-edge-hit')) { hoverEdgeKey = null; updateEdgeHighlight(); }
    });
    svg.addEventListener('pointerdown', e => {
      const hit = e.target.closest('.ch-edge-hit');
      if (!hit || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      selectedEdgeKey = selectedEdgeKey === hit.dataset.key ? null : hit.dataset.key;
      updateEdgeHighlight();
    });
    view.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
    historyButtons();
    view.addEventListener('wheel', e => { e.preventDefault(); const r = view.getBoundingClientRect(), f = Math.exp(-e.deltaY * 0.0015), nk = Math.min(2.5, Math.max(0.1, k * f)), q = nk / k, cx = e.clientX - r.left, cy = e.clientY - r.top; ox = cx - (cx - ox) * q; oy = cy - (cy - oy) * q; k = nk; xf(); rebase && rebase(); }, { passive: false });
    root.replaceChildren(top, ...(readOnly || api.legacy ? [h('div', { id: 'ch-readonly-banner', role: 'status', style: 'padding:9px 14px;border-bottom:1px solid var(--line,#394047);font-size:13px' }, readOnly ? 'Read-only inspection.' : api.offline ? 'Offline node editing from a saved AST snapshot. No Ren’Py runtime is running. Your changes stay drafts until explicitly applied for the next launch; static graph checks cannot verify version-specific script syntax.' : 'Legacy safe boot · editable drafts are saved locally. Changes affect gameplay ONLY after you explicitly apply the mod and restart. Live tracing and jump-to-scene are not enabled.')] : []), h('div', { id: 'ch-compact-result', role: 'status', style: 'display:none;padding:7px 12px;background:var(--panel, #20242b);border-bottom:1px solid var(--line, #3a3e45);font-size:13px;white-space:normal;' }), h('div', { class: 'ch-livebar', id: 'ch-live-status', role: 'status', 'aria-live': 'polite' }, SCENE_PREVIEW.active ? '● Live game preview · follow nodes as the story advances' : ''), view, panel); root.classList.toggle('preview-active', SCENE_PREVIEW.active); if (!g.nodes.length) view.append(h('p', { class: 'hint', style: 'position:absolute;left:20px;top:16px;margin:0' }, 'This chart is empty. Use “+ Add node” above.')); nodes(); drawPanel(); xf(); if (path.length === 1 && !cur.fitted) {
      cur.fitted = 1;
      if (g.nodes.length > 45 && g.layoutMode !== 'dense') {
        // Start at readable scale, near the first story command. Fitting the
        // entire scene used to shrink hundreds of nodes to unreadable dots.
        const entry = g.nodes.find(n => n.id === g.entry) || g.nodes[0];
        k = 0.85; ox = 45 - (entry?.x || 0) * k; oy = 95 - (entry?.y || 0) * k; xf();
      } else fit();
    } };
  const open = (c, t) => { selectedEdgeKey = null; hoverEdgeKey = null; hoverNodeId = null; routeCache = null; lastEdgeSignature = ''; cur = ensureGraph(c); path = [{ title: t || c.name, g: c }]; clearSel(); k = 1; ox = oy = 30; historyFor(); edit(); historyButtons(); };
  const sceneMapState = {};
  function home() {
    if (api.sceneMap && typeof tkbDrawSceneMap === 'function') {
      selectedEdgeKey = null; routeCache = null; lastEdgeSignature = ''; cur = null; path = []; clearSel();
      tkbDrawSceneMap(root, api.scenes(), openScene, () => root.remove(), api.start || 'start', sceneMapState);
      return;
    }
    const top = h('div', { class: 'mtop' }, h('button', { class: 'btn small', id: 'ch-close', onclick: () => root.remove() }, icon('back'), 'Flowchart'), h('b', {}, 'Charts'), h('small', { class: 'hint', id: 'ch-ver' }, ENGINE_VERSION));
    const mk = () => { const n = prompt('Chart name (letters, numbers, _)'); if (!n || !/^[A-Za-z_]\w*$/.test(n) || n[0] === '_' || api.labels().has(n)) return n && toast('Pick a free name: letters, numbers, _.', 3500); const c = { op: 'chart', name: n, g: 1, nodes: [], entry: null }; const s = nodeNew('say'); s.text = 'Hello.'; c.nodes.push(s); c.entry = s.id; cur = c; persist(); open(c); };
    const scn = api.scenes().filter(s => !mine().some(p => p.name === s.n));
    const search = h('input', { id: 'ch-scene-search', class: 'text', type: 'search', placeholder: 'Search scene labels…', 'aria-label': 'Search scene labels' });
    const results = h('div', { class: 'stack', id: 'ch-scene-results' });
    const found = h('small', { class: 'hint', id: 'ch-scene-count' });
    const show = () => {
      const q = search.value.trim().toLowerCase();
      const matches = q ? scn.filter(s => s.n.toLowerCase().includes(q) || s.f?.toLowerCase().includes(q)) : scn;
      found.textContent = matches.length + ' matching scenes' + (matches.length > 80 ? ' · showing first 80; search to narrow down' : '');
      results.replaceChildren(...matches.slice(0, 80).map(s => h('button', { class: 'btn small', onclick: () => openScene(s.n) }, `${s.n} · ${s.r.length} commands`)));
    };
    search.addEventListener('input', show);
    root.replaceChildren(top, h('div', { class: 'stack cbody' },
      h('p', { class: 'hint' }, readOnly
        ? 'Read-only nodes from the game’s compiled Ren’Py script. This mode does not alter gameplay, saves or the original script. To edit or live-trace commands, choose Full editor boot in Runtime / Compatibility (experimental for Ren’Py 6.99).'
        : api.legacy ? (api.offline ? 'Offline graph snapshot: edit safely without launching Ren’Py. Changes remain drafts until Apply on next launch.' : 'Same command-node editor as newer games. Legacy safe boot saves your changes as local drafts; Apply on next launch generates an experimental Story edits mod.') : 'Every scene is a chart of basic nodes. Edits create a separate Story edits mod that can be applied to the running game.'),
      readOnly ? null : h('button', { class: 'btn primary', id: 'ch-new', onclick: mk }, icon('plus'), 'New chart'),
      !readOnly && mine().length ? h('b', {}, `Your charts (${mine().length})`) : null,
      !readOnly ? mine().map(p => h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { cur = p; open(p); } }, `${p.name}${p.ov ? ' (edited scene)' : ''} · ${p.nodes.length} nodes`), h('button', { class: 'btn small ghost', 'aria-label': p.ov ? 'Restore the original' : 'Delete', title: p.ov ? 'Restore the original scene' : 'Delete', onclick: () => { api.P().splice(api.P().indexOf(p), 1); api.save(); home(); } }, icon(p.ov ? 'undo' : 'trash')))) : null,
      h('b', {}, `Scenes of the game (${scn.length})`), search, found, results));
    show();
  }
  const openScene = n => {
    const saved = mine().find(p => p.name === n);
    if (saved) { cur = saved; return open(saved); }
    const s = api.scenes().find(x => x.n === n); if (!s) return home();
    cur = { op: 'chart', name: s.n, ov: true, ...sceneGraph(s) };
    cur.g = 1;
    open(cur);
    // Imported previews aren't saved until the user edits. Make it clear
    // these are already grouped, with a way to compact any unsafe leftovers.
    const count = cur.importedTransitionContainers || 0;
    if (count) {
      const msg = root.querySelector('#ch-compact-result');
      if (msg) {
        msg.replaceChildren(h('span', { style: 'flex:1;min-width:0' },
          'Automatically grouped ' + count + ' safe transition(s) into open containers while importing this scene. Source order and game behavior are unchanged. Remaining complex transitions stay separate.'),
          h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'Dismiss import message', onclick: () => { msg.style.display = 'none'; } }, '×'));
        msg.style.display = 'flex';
      }
    }
  };
  const onKey = e => {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
    if (e.target.closest && e.target.closest('input,textarea,select,button,#chpick')) { if (e.key === 'Escape' && $('#chpick')) { e.preventDefault(); e.stopPropagation(); $('#chpick').remove(); } return; }
    if ($('#chpick')) return;
    const editing = !!root.querySelector('#cview');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (editing && (msel.size || selectedFrame)) { clearSel(); markSel(); drawPanel(); } else root.remove(); return; }
    if (!editing || !cur) return;
    if (!readOnly && (e.ctrlKey || e.metaKey) && !e.altKey &&
        (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault(); e.stopPropagation();
      travelHistory(e.key.toLowerCase() === 'y' || e.shiftKey ? 1 : -1);
      return;
    }
    if (!readOnly && (e.key === 'Delete' || e.key === 'Backspace') && msel.size) { e.preventDefault(); removeNodes(new Set(msel)); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); const all = G().nodes; msel = new Set(all.map(n => n.id)); sel = all.length ? all[all.length - 1].id : null; markSel(); drawPanel(); }
  };
  document.addEventListener('keydown', onKey, true);
  if (api.sceneMap) home(); else api.start ? openScene(api.start) : home();
}
//<<
