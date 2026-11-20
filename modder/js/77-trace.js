/* NEW (not in the app yet): the TRACE window. A small panel in a corner of the running game that shows which node ran just now,
   what data it carried, and which variables it changed.
   Two halves:
     RPY_TRACE   Ren'Py side (Python, goes into the game as game/zzzz_tankobon_trace.rpy): `_tkb_trace()` is called by the code the
                 flowchart's nodes compile to (see graphToRpy), and a statement callback reports the game's own lines too.
                 Every event is posted to this page ({t:'trace', m:...}). Nothing is sent while the panel is off.
     the panel   traceBtn() (the button, made by openGame) + the panel itself (created the first time it is switched on). */
//>> js/77-trace.js#0
const RPY_TRACE = String.raw`init 1999 python:
    import json as _tkbt_json
    import time as _tkbt_time
    class _TkbTr(object):
        pass
    _tkb_tr = _TkbTr()
    _tkb_tr.on = False
    _tkb_tr.n = 0
    _tkb_tr.last = 0
    _tkb_tr.snap = {}
    try:
        _tkb_simple = (bool, int, float, str, unicode, type(None))
    except NameError:
        _tkb_simple = (bool, int, float, str, type(None))
    def _tkb_tr_short(v, n=90):
        try:
            s = v if isinstance(v, str) else repr(v)
        except Exception:
            s = "?"
        return s if len(s) <= n else s[:n - 3] + "..."
    def _tkb_tr_clean(v):
        if isinstance(v, (list, tuple)):
            return [_tkb_tr_clean(x) for x in list(v)[:12]]
        if v is None or isinstance(v, (bool, int, float)):
            return v
        return _tkb_tr_short(v, 160)
    def _tkb_tr_send(m):
        try:
            import emscripten
            emscripten.run_script("parent.postMessage({t: 'trace', m: %s}, '*')" % _tkbt_json.dumps(m))
        except Exception:
            pass
    def _tkb_tr_vars():
        d = {}
        try:
            for k, v in list(renpy.store.__dict__.items()):
                if k[:1] != "_" and isinstance(v, _tkb_simple):
                    d[k] = v
        except Exception:
            pass
        return d
    def _tkb_tr_reset():
        _tkb_tr.snap = _tkb_tr_vars()
    def _tkb_tr_flush():
        # variables that changed since the last event belong to the entry that ran last
        cur = _tkb_tr_vars()
        old = _tkb_tr.snap
        ch = {}
        for k, v in cur.items():
            if len(ch) >= 12:
                break
            if k not in old:
                ch[k] = [None, _tkb_tr_short(v, 40)]
            elif old[k] != v or type(old[k]) != type(v):
                ch[k] = [_tkb_tr_short(old[k], 40), _tkb_tr_short(v, 40)]
        _tkb_tr.snap = cur
        if ch and _tkb_tr.last:
            _tkb_tr_send({"p": _tkb_tr.last, "v": ch})
    def _tkb_tr_log(cid, kind, chart, d):
        if not _tkb_tr.on or getattr(renpy.game, "after_rollback", False):
            return
        _tkb_tr_flush()
        _tkb_tr.n += 1
        _tkb_tr.last = _tkb_tr.n
        clean = {}
        for k, v in (d or {}).items():
            clean[k] = _tkb_tr_clean(v)
        _tkb_tr_send({"n": _tkb_tr.n, "id": cid, "k": kind, "c": chart, "d": clean, "ts": int(_tkbt_time.time() * 1000)})
    def _tkb_trace(cid, kind, chart, d=None):
        # called by flowchart nodes (compiled code)
        if not _tkb_tr.on:
            return
        d = dict(d or {})
        if "text" in d:
            try:
                d["text"] = renpy.substitute(d["text"])
            except Exception:
                pass
        _tkb_tr_log(cid, kind, chart, d)
    def _tkb_tr_stmt(name):
        # the game's own lines
        if not _tkb_tr.on:
            return
        try:
            if len(renpy.game.contexts) > 1:
                return
            n = renpy.game.script.namemap.get(renpy.game.context().current)
            if n is None:
                return
            f = str(n.filename).replace(chr(92), "/")
            if f.startswith("renpy/") or "renpy/common/" in f or "zzzz_tankobon_" in f:
                return
            nm = [c.__name__ for c in type(n).__mro__]
            d = {}
            if "Say" in nm:
                k = "say"
                d["who"] = n.who
                d["text"] = n.what
                try:
                    d["text"] = renpy.substitute(n.what)
                except Exception:
                    pass
            elif "Menu" in nm:
                k = "menu"
                d["options"] = [it[0] for it in n.items]
            elif "Jump" in nm:
                k = "jump"
                d["target"] = str(n.target)
            elif "Call" in nm:
                k = "call"
                d["target"] = str(n.label)
            elif "Return" in nm:
                k = "return"
            elif "If" in nm:
                k = "if"
                d["conditions"] = [str(e[0]) for e in n.entries]
            elif "While" in nm:
                k = "while"
                d["cond"] = str(n.condition)
            elif "Label" in nm:
                k = "label"
                d["name"] = str(n.name)
            elif "Python" in nm:
                k = "python"
                try:
                    d["code"] = str(n.code.source).strip().split("\n")[0][:120]
                except Exception:
                    pass
            elif "Camera" in nm or "ShowLayer" in nm:
                k = "stage"
                op = "camera" if "Camera" in nm else "show layer"
                layer = str(getattr(n, "layer", None) or "master")
                expressions = getattr(n, "at_list", None) or []
                d["text"] = op + (" " + layer if layer != "master" else "")
                if expressions: d["text"] += " at " + ", ".join(str(v) for v in expressions)
                if getattr(n, "atl", None) is not None: d["text"] += " [original ATL]"
                d["layer"] = layer
                d["at"] = [str(v) for v in expressions]
                d["atl"] = getattr(n, "atl", None) is not None
            elif "Scene" in nm or "Show" in nm or "Hide" in nm or "With" in nm or "UserStatement" in nm:
                k = "stage"
                try:
                    if "UserStatement" in nm:
                        d["text"] = str(n.line)[:180]
                    elif "With" in nm:
                        d["text"] = "with " + str(n.expr)
                    else:
                        d["text"] = ("scene " if "Scene" in nm else "show " if "Show" in nm else "hide ") + " ".join(n.imspec[0])
                except Exception:
                    pass
            elif "Init" in nm:
                # Initialization entries are not regular playable story nodes.
                # Some Ren'Py builds report them during runtime entry points.
                return
            elif "Pass" in nm:
                # Ren'Py synthesizes Pass statements after calls. They do no
                # work, so they don't need a visual node or unmatched alert.
                return
            else:
                # Keep unknown game statements visible as unmatched code instead
                # of silently pretending they never ran.
                k = "unmapped"
                d["summary"] = type(n).__name__
            i = f.rfind("game/")
            rel = f[i + 5:] if i >= 0 else f.lstrip("/")
            d["source"] = "%s:%d" % (rel, n.linenumber)
            d["type"] = type(n).__name__
            _tkb_tr_log("%s:%d:%s" % (rel, n.linenumber, k), k, rel, d)
        except renpy.game.CONTROL_EXCEPTIONS:
            raise
        except Exception:
            pass
    # Opt-in step debugger: a gate before each actual Ren'Py statement. It
    # deliberately does not pause init, the main menu, or nested UI contexts.
    # The outer page can release exactly one statement by increasing tickets.
    class _TkbStepState(object):
        pass
    _tkb_step_debug = _TkbStepState()
    _tkb_step_debug.enabled = False
    _tkb_step_debug.waiting = False
    _tkb_step_debug.tickets = 0
    _tkb_step_debug.number = 0
    def _tkb_st_notice(kind, extra=None):
        try:
            import emscripten
            data = {"kind": kind, "number": _tkb_step_debug.number}
            if extra is not None: data["info"] = _tkb_tr_short(extra, 180)
            emscripten.run_script("parent.postMessage({t: 'debugstep', m: %s}, '*')" % _tkbt_json.dumps(data))
        except Exception:
            pass
    def _tkb_st_stmt(statement):
        if not _tkb_step_debug.enabled: return
        try:
            ctx = renpy.game.context()
            if ctx.init_phase or getattr(ctx, "interacting", False): return
            if len(renpy.game.contexts) > 1: return
            current = getattr(ctx, "current", None)
            if current is None: return
            node = renpy.game.script.namemap.get(current)
            if node is None or type(node).__name__ == "Pass": return
            filename = str(getattr(node, "filename", ""))
            if "renpy/common/" in filename or "zzzz_tankobon_" in filename: return
            _tkb_step_debug.waiting = True
            _tkb_st_notice("waiting", "%s:%s" % (filename, getattr(node, "linenumber", 0)))
            # Timed hard pauses yield to the browser event loop. Clicks cannot
            # bypass a gate; the explicit Next button is the sole release.
            # The timeout also lets Continue/Reset unblock this callback.
            while _tkb_step_debug.enabled and _tkb_step_debug.tickets <= 0:
                renpy.pause(0.16, hard=True)
            if _tkb_step_debug.tickets > 0:
                _tkb_step_debug.tickets -= 1
            _tkb_step_debug.waiting = False
            _tkb_step_debug.number += 1
            _tkb_st_notice("released")
        except renpy.game.CONTROL_EXCEPTIONS:
            _tkb_step_debug.waiting = False
            raise
        except Exception as e:
            # Never crash the user's game just because debugger stepping is
            # unsupported in a particular Ren'Py build.
            _tkb_step_debug.enabled = False
            _tkb_step_debug.waiting = False
            _tkb_st_notice("failed", type(e).__name__ + ": " + str(e))
    if hasattr(config, "statement_callbacks"):
        config.statement_callbacks.append(_tkb_st_stmt)
        config.statement_callbacks.append(_tkb_tr_stmt)
`;

/* ---------- the panel (in the page, over the game) ---------- */
ICONS.trace = '<path d="M3 12h4l3-8 4 16 3-8h4"/>';
const TRACE = { on: false, wanted: false, items: [], map: new Map(), seq: 0, open: new Set(), paused: false, collapsed: false, corner: 'bl', panel: null, raf: 0 };
const traceLS = (k, v) => { try { if (v === undefined) return localStorage.getItem('engine.trace.' + k); localStorage.setItem('engine.trace.' + k, v); } catch (e) { } return null; };
const TRACE_MAX = 300;
const TRACE_NAME = { say: 'Say', show: 'Show', hide: 'Hide', scene: 'Scene', with: 'Transition', audio: 'Audio', set: 'Set', get: 'Get', if: 'Branch', while: 'Loop', menu: 'Menu', jump: 'Jump', call: 'Call', return: 'Return', python: 'Python', raw: 'Raw', chart: 'Chart', label: 'Label', stage: 'Stage', unmapped: 'Unmapped code' };
const traceChart = c => String(c || '').replace(/^_tkbc_/, '').replace(/__[A-Za-z0-9_]+$/, ' ›');
const traceQ = s => '“' + s + '”';
/* one line saying what the entry did */
function traceSummary(e) {
  const d = e.d || {}, v = x => x == null || x === '' ? '' : String(x);
  switch (e.k) {
    case 'say': return `${v(d.who) || 'narrator'}${d.attrs ? ' (' + d.attrs + ')' : ''}: ${traceQ(v(d.text))}`;
    case 'show': return `show ${v(d.img)}${d.at ? ' at ' + d.at : ''}`;
    case 'hide': return `hide ${v(d.img)}`; case 'scene': return `scene ${v(d.img)}`;
    case 'stage': return v(d.text);
    case 'unmapped': return v(d.summary || d.type) + (d.source ? ' at ' + d.source : '');
    case 'with': return 'with ' + v(d.trans);
    case 'audio': return `${v(d.mode)} ${v(d.channel)} ${v(d.file)}`;
    case 'set': return `${v(d.var)} ${v(d.op)} ${v(d.expr)}`;
    case 'get': return `${v(d.var)} ← ${d.src === 'input' ? 'player input' : v(d.src)}`;
    case 'jump': return '→ ' + v(d.target); case 'call': return 'call ' + v(d.target);
    case 'return': return 'return';
    case 'python': return v(d.code);
    case 'raw': return v(d.code);
    case 'chart': return d.ref ? 'enter ' + d.ref : 'enter ' + v(d.name);
    case 'label': return v(d.name);
    case 'if': return d.arm != null ? (d.arm < 0 ? 'no branch matched' : `branch ${d.arm + 1}: ${v(d.cond) || 'else'}`) : (d.conditions || []).join(' | ');
    case 'while': return d.phase ? `loop ${d.phase}: ${v(d.cond)}` : 'while ' + v(d.cond);
    case 'menu': return d.chose != null ? `chose ${traceQ(d.chose)}` : 'options: ' + (d.options || []).join(' · ');
    default: return JSON.stringify(d);
  }
}
const traceVal = x => x == null ? '∅' : String(x);
function traceRow(e, prev, open, i) {
  const full = open || i === 0;
  const row = h('div', { class: 'trow' + (i === 0 ? ' new' : '') + ' k-' + e.k + (e.sep ? ' sep' : ''), 'data-n': e.seq });
  if (e.sep) { row.append(h('div', { class: 'tsep' }, e.sep)); return row; }
  row.append(h('div', { class: 'thead', onclick: () => { TRACE.open.has(e.seq) ? TRACE.open.delete(e.seq) : TRACE.open.add(e.seq); traceDraw(); } },
    h('span', { class: 'tn' }, '#' + e.n), h('span', { class: 'tk' }, TRACE_NAME[e.k] || e.k), h('span', { class: 'tc' }, traceChart(e.c)),
    h('span', { class: 'tt' }, new Date(e.ts || Date.now()).toLocaleTimeString([], { hour12: false }))));
  row.append(h('div', { class: 'tsum' }, traceSummary(e)));
  const vars = e.v && Object.entries(e.v);
  if (vars && vars.length) row.append(h('div', { class: 'tvars' }, vars.map(([k, [a, b]]) => h('span', { class: 'tv' }, h('b', null, k), ' ', traceVal(a), ' → ', traceVal(b)))));
  if (full) {
    const det = h('div', { class: 'tdet' });
    if (prev && !prev.sep) det.append(h('div', null, h('i', null, 'came from'), ' ', `#${prev.n} ${TRACE_NAME[prev.k] || prev.k}: ${traceSummary(prev)}`));
    det.append(h('div', null, h('i', null, 'node'), ' ', e.id));
    for (const [k, v] of Object.entries(e.d || {})) det.append(h('div', null, h('i', null, k), ' ', Array.isArray(v) ? v.join(' · ') : traceVal(v)));
    row.append(det);
  }
  return row;
}
function traceDraw() {
  if (TRACE.raf) return;
  TRACE.raf = requestAnimationFrame(() => {
    TRACE.raf = 0; const p = TRACE.panel; if (!p) return;
    p.className = `gametracebox c-${TRACE.corner}${TRACE.collapsed ? ' collapsed' : ''}${TRACE.paused ? ' paused' : ''}`;
    p.$status.textContent = !TRACE.items.length ? '' : `${TRACE.items.filter(x => !x.sep).length} steps`;
    p.$pause.textContent = TRACE.paused ? '▶' : '⏸'; p.$pause.title = TRACE.paused ? 'Resume' : 'Pause';
    p.$fold.textContent = TRACE.collapsed ? '▢' : '–';
    const list = TRACE.items; p.$list.textContent = '';
    if (!list.length) { p.$list.append(h('div', { class: 'tempty' }, GAME.loaded ? 'Waiting for the story to run a node… (click through the game)' : 'The game is still starting…')); return; }
    const shown = list.slice(-60).reverse(), real = list.filter(x => !x.sep);
    shown.forEach((e, i) => { const k = real.indexOf(e); p.$list.append(traceRow(e, k > 0 ? real[k - 1] : null, TRACE.open.has(e.seq), i)); });
    p.$list.scrollTop = 0;
  });
}
function traceAdd(m) {
  if (m.sep) { TRACE.items.push({ sep: m.sep, seq: ++TRACE.seq }); TRACE.map.clear(); }
  else if (m.p != null) { const e = TRACE.map.get(m.p); if (e) e.v = { ...(e.v || {}), ...m.v }; }
  else { const e = { ...m, seq: ++TRACE.seq }; TRACE.items.push(e); TRACE.map.set(m.n, e); }
  if (TRACE.items.length > TRACE_MAX) { const gone = TRACE.items.splice(0, TRACE.items.length - TRACE_MAX); gone.forEach(g => { if (g.n != null && TRACE.map.get(g.n) === g) TRACE.map.delete(g.n); }); }
  traceDraw();
}
/* tell the running game to start (or stop) reporting */
async function traceSend(on) {
  if (!GAME.frame || !GAME.loaded) return false;
  const r = await gamePy(`renpy.store._tkb_tr.on = ${on ? 'True' : 'False'}\nif ${on ? 'True' : 'False'}:\n    renpy.store._tkb_tr_reset()\nresult = True`);
  return r === true || r === 'True' || r === 1;
}
async function traceSet(on) {
  TRACE.wanted = on; traceLS('on', on ? '1' : '0');
  if (on) { if (!TRACE.panel) traceMake(); TRACE.panel.hidden = false; } else if (TRACE.panel) TRACE.panel.hidden = true;
  if (TRACE.btn) TRACE.btn.classList.toggle('on', on);
  traceDraw();
  if (!GAME.loaded) return;                       // it is switched on when the game is ready (see the message listener)
  const ok = await traceSend(on);
  if (on && !ok && TRACE.panel) TRACE.panel.$status.textContent = 'the game did not answer; restart it';
}
function traceMake() {
  const mk = (txt, title, fn) => h('button', { class: 'tbtn', type: 'button', title, 'aria-label': title, onclick: fn }, txt);
  const p = h('div', { class: 'gametracebox', role: 'log', 'aria-label': 'Trace of the story: nodes that ran' });
  p.$status = h('span', { class: 'tstatus' });
  p.$pause = mk('⏸', 'Pause', () => { TRACE.paused = !TRACE.paused; traceSend(!TRACE.paused); traceDraw(); });
  p.$fold = mk('–', 'Fold', () => { TRACE.collapsed = !TRACE.collapsed; traceLS('fold', TRACE.collapsed ? '1' : '0'); traceDraw(); });
  p.$list = h('div', { class: 'tlist' });
  p.append(h('div', { class: 'tbar' }, h('b', null, 'Trace'), p.$status, h('span', { class: 'grow' }),
    mk('⇄', 'Move to the other corner', () => { TRACE.corner = TRACE.corner === 'bl' ? 'br' : 'bl'; traceLS('corner', TRACE.corner); traceDraw(); }),
    mk('⌫', 'Clear', () => { TRACE.items.length = 0; TRACE.map.clear(); TRACE.open.clear(); traceDraw(); }), p.$pause, p.$fold,
    mk('✕', 'Close the trace', () => traceSet(false))), p.$list);
  // keep the game from getting the clicks and keys that are meant for the panel
  for (const ev of ['keydown', 'keyup', 'wheel']) p.addEventListener(ev, e => e.stopPropagation());
  TRACE.panel = p; (GAME.box || document.body).append(p);
}
/* the button for the game's corner (called by openGame). The panel is made the first time it is switched on. */
function traceBtn() {
  Object.assign(TRACE, { panel: null, items: [], map: new Map(), open: new Set(), paused: false, seq: 0 });
  TRACE.corner = traceLS('corner') === 'br' ? 'br' : 'bl'; TRACE.collapsed = traceLS('fold') === '1'; TRACE.wanted = traceLS('on') === '1';
  const b = h('button', { class: 'gameexit gametrace', type: 'button', 'aria-label': 'Trace: what node ran just now', title: 'Trace (what ran, and the data it passed on)', onclick: () => traceSet(!TRACE.wanted) }, icon('trace'));
  TRACE.btn = b; b.classList.toggle('on', TRACE.wanted);
  if (TRACE.wanted) setTimeout(() => { if (GAME.box && !TRACE.panel) { traceMake(); TRACE.panel.hidden = false; traceDraw(); } }, 0);
  return b;
}
window.addEventListener('message', e => {
  if (!GAME.frame || e.source !== GAME.frame.contentWindow) return; const m = e.data || {};
  if (m.t === 'trace') {
    if (m.m) window.dispatchEvent(new CustomEvent('tkb:trace-event', { detail: m.m }));
    if (TRACE.wanted && !TRACE.paused && m.m) traceAdd(m.m);
  }
  else if (m.t === 'loaded') { if (TRACE.wanted && TRACE.items.length) traceAdd({ sep: 'game (re)started' }); }
  else if (m.t === 'ready') { if (TRACE.wanted) traceSend(true); traceDraw(); }
});
//<<

/* Experimental, opt-in one-statement-at-a-time playback. The Ren'Py side
   gates between script statements; standard interactions (dialogue and menus)
   still need player input. The graph always uses the genuine trace events. */
const STEPDBG = { enabled: false, waiting: false, busy: false, number: 0, note: '' };
function stepCapture() {
  if (GAME.frame) {
    try { GAME.frame.contentWindow.postMessage({ t: 'stepcapture', enabled: STEPDBG.enabled, waiting: STEPDBG.waiting }, '*'); } catch (_) { }
  }
  if (SCENE_PREVIEW.stepBar) {
    SCENE_PREVIEW.stepBar.hidden = !STEPDBG.enabled;
    if (SCENE_PREVIEW.stepStatus) SCENE_PREVIEW.stepStatus.textContent = STEPDBG.waiting ?
      'Paused before statement · ' + STEPDBG.number : STEPDBG.note || 'Interact with dialogue/menu to reach the next statement';
    if (SCENE_PREVIEW.nextButton) SCENE_PREVIEW.nextButton.disabled = STEPDBG.busy;
  }
  if (SCENE_PREVIEW.stepToggle) SCENE_PREVIEW.stepToggle.textContent = STEPDBG.enabled ? 'Step: on' : 'Step mode';
  GAME.box?.classList.toggle('preview-stepping', STEPDBG.enabled);
}
async function stepMode(on) {
  if (!GAME.frame || !GAME.loaded) return false;
  if (STEPDBG.busy) return false;
  STEPDBG.busy = true;
  stepCapture();
  const code = on
    ? 'renpy.store._tkb_step_debug.tickets = 0\nrenpy.store._tkb_step_debug.enabled = True\nresult = True'
    : 'renpy.store._tkb_step_debug.enabled = False\nrenpy.store._tkb_step_debug.tickets = 0\nresult = True';
  try {
    const r = await tkbGamePyChecked(code, 5000);
    if (!r.ok) throw new Error(r.error || 'The game did not respond');
    STEPDBG.enabled = !!on; STEPDBG.waiting = false; STEPDBG.note = on ?
      'Stepping enabled · advance game dialogue to the next statement' : '';
    if (!on) STEPDBG.number = 0;
    return true;
  } catch (e) {
    toast('Step mode: ' + String(e.message || e) + '. Use Reset game if necessary.', 6000);
    return false;
  } finally { STEPDBG.busy = false; stepCapture(); }
}
async function stepNext() {
  if (!STEPDBG.enabled || STEPDBG.busy || !GAME.loaded) return;
  if (!STEPDBG.waiting) {
    STEPDBG.note = 'Not at a statement gate. Advance any dialogue or select a menu choice in the game window.';
    stepCapture(); return;
  }
  STEPDBG.busy = true; stepCapture();
  try {
    const r = await tkbGamePyChecked('renpy.store._tkb_step_debug.tickets += 1\nresult = True', 4000);
    if (!r.ok) throw new Error(r.error || 'The game did not respond');
    STEPDBG.waiting = false;
    STEPDBG.note = 'Executing one command…';
  } catch (e) {
    STEPDBG.note = 'Next failed: ' + String(e.message || e);
  } finally { STEPDBG.busy = false; stepCapture(); }
}
window.addEventListener('message', e => {
  if (!GAME.frame || e.source !== GAME.frame.contentWindow) return;
  const m = e.data || {};
  if (m.t === 'debugstep' && m.m) {
    if (!STEPDBG.enabled) return;
    const x = m.m;
    STEPDBG.waiting = x.kind === 'waiting';
    STEPDBG.number = Number(x.number) || 0;
    if (x.kind === 'waiting') STEPDBG.note = x.info || '';
    else if (x.kind === 'failed') {
      STEPDBG.enabled = false;
      STEPDBG.note = x.info || 'Ren\'Py debugger pause failed';
      toast('Stepping is unavailable in this game: ' + STEPDBG.note, 6000);
    } else STEPDBG.note = 'Advance dialogue or click Next at the following gate';
    stepCapture();
  } else if (m.t === 'debugstepinput' && STEPDBG.enabled && STEPDBG.waiting) stepNext();
});
window.addEventListener('tkb:game-reset', () => {
  STEPDBG.enabled = false; STEPDBG.waiting = false; STEPDBG.busy = false; STEPDBG.note = '';
  stepCapture();
});

/* A small, interactive window around the SAME running Ren'Py iframe.
   Never clone or move the iframe: that would restart the game and lose state. */
const SCENE_PREVIEW = { active: false, title: null, target: '', jumpButton: null, stepBar: null, stepStatus: null, nextButton: null, stepToggle: null, resizeCleanup: null };
/* The preview stays anchored at bottom/right. Dragging the top-left corner
   changes its width/height, instead of moving or reloading the game iframe. */
function installPreviewResize(box, head) {
  const grip = h('button', { class: 'preview-resize-handle', type: 'button',
    title: 'Drag to resize from the top-left corner (arrow keys also work)',
    'aria-label': 'Resize game preview from top-left corner' });
  head.prepend(grip);
  const controller = new AbortController();
  const listen = (type, callback) => grip.addEventListener(type, callback, { signal: controller.signal });
  let drag = null;
  function bounds() {
    const rect = box.getBoundingClientRect();
    const style = getComputedStyle(box);
    const minWidth = parseFloat(style.minWidth) || 300;
    const minHeight = parseFloat(style.minHeight) || 200;
    // Keep the preview on screen, including on phones after a viewport resize.
    return { rect, minWidth, minHeight,
      maxWidth: Math.max(minWidth, rect.right - 10),
      maxHeight: Math.max(minHeight, rect.bottom - 10) };
  }
  function size(width, height) {
    const b = bounds();
    box.style.width = Math.round(Math.max(b.minWidth, Math.min(b.maxWidth, width))) + 'px';
    box.style.height = Math.round(Math.max(b.minHeight, Math.min(b.maxHeight, height))) + 'px';
  }
  listen('pointerdown', e => {
    if (e.button !== 0 || !box.classList.contains('preview-docked')) return;
    e.preventDefault(); e.stopPropagation();
    const rect = box.getBoundingClientRect();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
    box.classList.add('preview-resizing');
    grip.setPointerCapture(e.pointerId);
  });
  listen('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    // Moving up or left enlarges the preview; its bottom-right corner stays put.
    size(drag.width + drag.x - e.clientX, drag.height + drag.y - e.clientY);
  });
  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    box.classList.remove('preview-resizing');
    if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
  }
  listen('pointerup', end);
  listen('pointercancel', end);
  listen('lostpointercapture', () => { drag = null; box.classList.remove('preview-resizing'); });
  listen('keydown', e => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const b = bounds(), step = e.shiftKey ? 40 : 12;
    size(b.rect.width + (e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0),
      b.rect.height + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0));
  });
  const onWindowResize = () => {
    // Don't override default CSS dimensions unless the user resized manually.
    if (box.style.width || box.style.height) {
      const b = bounds();
      size(b.rect.width, b.rect.height);
    }
  };
  window.addEventListener('resize', onWindowResize, { signal: controller.signal });
  return () => { controller.abort(); drag = null; box.classList.remove('preview-resizing'); grip.remove(); };
}
function closeScenePreview() {
  if (!SCENE_PREVIEW.active) return;
  SCENE_PREVIEW.active = false;
  if (STEPDBG.enabled) stepMode(false);
  SCENE_PREVIEW.resizeCleanup?.();
  SCENE_PREVIEW.resizeCleanup = null;
  if (GAME.box) {
    GAME.box.classList.remove('preview-docked');
    GAME.box.style.width = ''; GAME.box.style.height = '';
    GAME.box.querySelector('.preview-game-head')?.remove();
    GAME.box.querySelector('.preview-stepbar')?.remove();
  }
  SCENE_PREVIEW.title = null;
  SCENE_PREVIEW.jumpButton = null;
  SCENE_PREVIEW.stepBar = SCENE_PREVIEW.stepStatus = SCENE_PREVIEW.nextButton = SCENE_PREVIEW.stepToggle = null;
  window.dispatchEvent(new CustomEvent('tkb:preview-state', { detail: { active: false } }));
  if (!TRACE.wanted && GAME.loaded) traceSend(false);
  syncGameAudio(true);
}
function openScenePreview(scene) {
  if (!GAME.box || !GAME.frame || !GAME.loaded) {
    toast('Start the game first, then open a scene preview.', 4000);
    return false;
  }
  scene = String(scene || '').trim();
  if (!scene) { toast('Choose a scene to preview.', 3000); return false; }
  if (!SCENE_PREVIEW.active) {
    SCENE_PREVIEW.active = true;
    GAME.box.classList.add('preview-docked');
    syncGameAudio(true);
    const name = h('span', { class: 'preview-game-caption' }, 'Live game · ' + scene);
    const setup = h('button', { class: 'preview-game-action', type: 'button',
      title: 'Set variables and initialization commands needed by this scene',
      onclick: () => openSceneSetup(SCENE_PREVIEW.target) }, 'Scene setup');
    const reset = h('button', { class: 'preview-game-action', type: 'button',
      title: 'Reboot the embedded game after a crash, without reloading the browser',
      onclick: resetRunningGame }, 'Reset game');
    const jump = h('button', { class: 'preview-game-action', type: 'button',
      title: 'Apply saved scene prerequisites, then jump to the label',
      onclick: () => previewJumpToScene(SCENE_PREVIEW.target) }, 'Jump to scene');
    const finish = h('button', { class: 'preview-game-action preview-game-close', type: 'button',
      title: 'Hide the game preview (the game keeps running)',
      'aria-label': 'Close game preview', onclick: closeScenePreview }, '×');
    const mode = h('button', { class: 'preview-game-action', type: 'button',
      title: 'Pause the original Ren\'Py runtime before each script statement (experimental)',
      onclick: () => stepMode(!STEPDBG.enabled) }, 'Step mode');
    const next = h('button', { class: 'preview-game-action step-next', type: 'button',
      title: 'Execute one Ren\'Py script statement at a time', onclick: stepNext }, 'Next ▸');
    const continueB = h('button', { class: 'preview-game-action', type: 'button',
      title: 'Resume ordinary gameplay', onclick: () => stepMode(false) }, 'Continue');
    const status = h('span', { class: 'preview-step-status' }, 'Advance dialogue to reach the next script statement');
    const stepBar = h('div', { class: 'preview-stepbar', hidden: true }, next, continueB, status);
    // Wheel in the preview advances one statement when a step gate is waiting.
    // The game itself remains interactive for dialogue and menu choices.
    stepBar.addEventListener('wheel', e => { e.preventDefault(); if (STEPDBG.waiting && !STEPDBG.busy) stepNext(); }, { passive: false });
    const bar = h('div', { class: 'preview-game-head' }, name, mode, setup, jump, reset, finish);
    GAME.box.append(bar, stepBar);
    SCENE_PREVIEW.resizeCleanup = installPreviewResize(GAME.box, bar);
    SCENE_PREVIEW.title = name;
    SCENE_PREVIEW.jumpButton = jump;
    SCENE_PREVIEW.stepBar = stepBar;
    SCENE_PREVIEW.stepStatus = status;
    SCENE_PREVIEW.nextButton = next;
    SCENE_PREVIEW.stepToggle = mode;
    stepCapture();
    // Enables actual game/compiled-node events, not a fake animation.
    traceSend(true).then(ok => { if (SCENE_PREVIEW.active && !ok) toast('Live tracing did not start; try restarting the game.', 4000); });
  }
  SCENE_PREVIEW.target = scene;
  if (SCENE_PREVIEW.title) SCENE_PREVIEW.title.textContent = 'Live game · ' + scene;
  stepCapture();
  window.dispatchEvent(new CustomEvent('tkb:preview-state', { detail: { active: true, scene } }));
  return true;
}
