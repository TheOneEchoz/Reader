// Ren'Py 6.99 browser compatibility: expose an immutable, already compiled
// story snapshot. 7.4.11 does not provide a Python command bridge. The init
// block writes only to /tmp in the per-game emulated filesystem; the original
// ZIP and game scripts are left untouched. This runs only in legacy safe boot.
function legacyGraphSnapshotRpy() {
  // The previous Python-to-JavaScript `emscripten.run_script` bridge and
  // JavaScript FS snapshot reader were unreliable in the embedded 7.4 runtime.
  // Avoid relying on either of them. Standard Python stdout reaches
  // Module.print, so the sealed player can forward framed messages directly.
  // Write the snapshot separately as a fallback.
  const body = FLOW_PY + String.raw`
try:
    print("TKB_LEGACY_GRAPH_STATUS|generating")
    import json as _tkb_json
    _tkb_data = _tkbflow("graph")
    # Read registered image definitions without invoking render or modifying the
    # running game. These filenames let the read-only graph show pictures from
    # archived files without relying on the unavailable Python query bridge.
    def _tkb_legacy_pictures():
        import re as _tkb_re
        _images = getattr(renpy.display.image, "images", {})
        _out = {}
        _ext = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif")
        for _key, _obj in list(_images.items()):
            try:
                if not _key: continue
                _name = " ".join(str(_piece) for _piece in _key)
                _paths = []
                _seen = set()
                def _walk(_v, _depth):
                    if _v is None or _depth > 9 or len(_paths) >= 8: return
                    if isinstance(_v, basestring):
                        _v = _v.strip()
                        if "[" in _v and "]" in _v:
                            def _sub(_m):
                                try: return str(getattr(renpy.store, _m.group(1)))
                                except Exception: return _m.group(0)
                            _v = _tkb_re.sub(r"\[([a-zA-Z_][a-zA-Z0-9_]*)\]", _sub, _v)
                        if _v.lower().endswith(_ext) and "[" not in _v and _v not in _paths:
                            _paths.append(_v)
                        elif " " in _v or _tkb_re.match(r"^[A-Za-z_][A-Za-z_0-9]*$", _v):
                            _ref = tuple(_v.split())
                            if _ref in _images and _images[_ref] is not _obj: _walk(_images[_ref], _depth + 1)
                        return
                    if isinstance(_v, tuple) and _v and all(isinstance(_x, basestring) for _x in _v):
                        if _v in _images and _images[_v] is not _obj:
                            _walk(_images[_v], _depth + 1)
                            return
                    if isinstance(_v, (list, tuple, set)):
                        for _part in list(_v)[:20]: _walk(_part, _depth + 1)
                        return
                    if isinstance(_v, dict):
                        for _part in list(_v.values())[:20]: _walk(_part, _depth + 1)
                        return
                    if isinstance(_v, (bool, int, float)): return
                    if id(_v) in _seen: return
                    _seen.add(id(_v))
                    # Traverse known Ren'Py displayable slots. Avoid calling
                    # find_target/render: that would mutate gameplay state.
                    for _attr in ("filename", "name", "child", "image", "target", "children", "layers", "always", "attributes", "args", "kwargs", "images", "displayable", "entries", "base", "parts"):
                        try: _child = getattr(_v, _attr, None)
                        except Exception: _child = None
                        if _child is not None and _child is not _v: _walk(_child, _depth + 1)
                _walk(_obj, 0)
                if _paths: _out[_name] = {"files": _paths, "type": type(_obj).__name__}
            except Exception:
                pass
        return _out
    try: _tkb_data["imagefiles"] = _tkb_legacy_pictures()
    except Exception: _tkb_data["imagefiles"] = {}
    _tkb_raw = _tkb_json.dumps(_tkb_data, ensure_ascii=True)
    _tkb_scenes = _tkb_data.get("scenes", [])
    _tkb_total_rows = sum(len(_tkb_s.get("r", [])) for _tkb_s in _tkb_scenes)
    _tkb_fs_status = "saved"
    try:
        with open("/tmp/tkb_legacy_graph.json", "wb") as _tkb_file:
            _tkb_file.write(_tkb_raw.encode("ascii"))
    except Exception as _tkb_fs_error:
        _tkb_fs_status = "unavailable: " + str(_tkb_fs_error)[:120]
    # Python's print is supported by all 7.4.11 web runtimes, unlike
    # Emscripten Python bridge is unavailable; each part is one log line.
    _tkb_chunk_size = 6000
    _tkb_count = (len(_tkb_raw) + _tkb_chunk_size - 1) // _tkb_chunk_size
    print("TKB_LEGACY_GRAPH_STATUS|streaming:%d:%d" % (_tkb_count, len(_tkb_raw)))
    for _tkb_i in range(_tkb_count):
        _tkb_slice = _tkb_raw[_tkb_i * _tkb_chunk_size:(_tkb_i + 1) * _tkb_chunk_size]
        print("TKB_LEGACY_GRAPH_PART|%d|%s" % (_tkb_i, _tkb_slice))
    print("TKB_LEGACY_GRAPH_DONE|%d|%d|%d|%d|%s" % (_tkb_count, len(_tkb_raw), len(_tkb_scenes), _tkb_total_rows, _tkb_fs_status))
except Exception:
    # This route must not depend on the module that failed to import.
    try:
        import traceback as _tkb_tb
        _tkb_message = _tkb_tb.format_exc()
        print("TKB_LEGACY_GRAPH_ERROR|" + _tkb_message.replace(chr(10), " / ")[:3600])
    except Exception:
        print("TKB_LEGACY_GRAPH_ERROR|Unable to export legacy story")`;
  return 'init 1998 python:\n' + body.split('\n').map(line => '    ' + line).join('\n') + '\n';
}

/* The story's flowchart data: reading the game's scenes (Python), the edits file (patches), taking edits back */
//>> js/70-flow.js#0
const FLOW_FILE = 'game/zzzz_tankobon_flow.rpy';
const FLOW_PY = String.raw`def _tkbflow(mode, P=None):
    import re
    S = renpy.game.script
    taken = {}
    km = {}
    kid = {}
    def kind(n):
        names = [c.__name__ for c in type(n).__mro__]
        if "Say" in names: return "say"
        if "Menu" in names: return "menu"
        if "Jump" in names: return "jump"
        if "Call" in names: return "call"
        if "Return" in names: return "return"
        if "If" in names: return "if"
        if "While" in names: return "while"
        if "Label" in names:
            if str(n.name).startswith("_tkbflow_g"): return None
            return "label"
        if "Python" in names: return "python"
        if "Camera" in names or "ShowLayer" in names: return "stage"
        if "Scene" in names or "Show" in names or "Hide" in names or "With" in names or "UserStatement" in names: return "stage"
        return None
    def fname(n):
        return str(n.filename).replace(chr(92), "/")
    def mine(n):
        f = fname(n)
        if f.startswith("renpy/") or "renpy/common/" in f: return False
        if "zzzz_tankobon_" in f and "zzzz_tankobon_flow" not in f: return False
        return True
    def relfile(n):
        f = fname(n)
        i = f.rfind("game/")
        if i >= 0: return f[i + 5:]
        return f.lstrip("/")
    def index():
        taken.clear(); km.clear(); kid.clear()
        for n in list(S.namemap.values()):
            try:
                k = kind(n)
                if k is None or not mine(n): continue
                base = "%s:%d:%s" % (relfile(n), n.linenumber, k)
                c = taken.get(base, 0)
                taken[base] = c + 1
                key = base if c == 0 else "%s#%d" % (base, c)
                km[key] = n
                kid[id(n)] = key
            except Exception:
                pass
    def stage(n):
        try:
            names = [c.__name__ for c in type(n).__mro__]
            if "Camera" in names or "ShowLayer" in names:
                # Camera contains layer, at_list, and sometimes an entire ATL
                # block. A printable label is not sufficient to recompile ATL.
                op = "camera" if "Camera" in names else "show layer"
                layer = str(getattr(n, "layer", None) or "master")
                at = getattr(n, "at_list", None) or []
                s = op + (" " + layer if layer != "master" else "")
                if at: s += " at " + ", ".join(str(v) for v in at)
                if getattr(n, "atl", None) is not None: s += " [original ATL]"
                return s
            if "UserStatement" in names: return str(n.line)
            if "With" in names: return "with " + str(n.expr)
            im = getattr(n, "imspec", None)
            nm = " ".join(im[0]) if im else ""
            if "Scene" in names: return ("scene " + nm).strip()
            if "Show" in names: return "show " + nm
            if "Hide" in names: return "hide " + (" ".join(n.imspec[0]) if n.imspec else "")
        except Exception:
            pass
        return type(n).__name__.lower()
    def build():
        index()
        scenes = []
        labs = []
        seen = set()
        alias = {}
        cand = {}
        for key, n in list(S.namemap.items()):
            try:
                if kind(n) != "label" or not mine(n): continue
                key = str(key)
                old = cand.get(id(n))
                if old is None or (old[0].startswith("_") and not key.startswith("_")): cand[id(n)] = (key, n)
            except Exception:
                pass
        for nm0, n in cand.values():
            # The namemap also contains generated keys for compiler-created
            # return labels. The AST's own name decides whether a label is
            # private; an unrelated public namemap key must not expose it.
            real_name = str(n.name)
            if real_name.startswith("_") and not real_name.startswith("_tkbc_"):
                continue
            # Tankobon overrides intentionally alias _tkbc_* onto a public
            # label. Keep that one supported alias and use real names for all
            # ordinary game labels.
            name = (nm0 if real_name.startswith("_tkbc_") and
                    nm0.isidentifier() and not nm0.startswith("_") else real_name)
            if name != real_name: alias[id(n)] = name
            labs.append((name, n))
        labs.sort(key=lambda kn: (relfile(kn[1]), kn[1].linenumber))
        # Public script labels are scene boundaries. Ren'Py also inserts
        # private labels as continuation points around call statements.
        # The latter must NOT terminate the current scene's AST traversal.
        scene_label_ids = set(id(lab) for _, lab in labs)
        for name, lab in labs:
            sc = {"n": str(name), "f": relfile(lab), "l": lab.linenumber, "r": [], "fall": None, "new": "zzzz_tankobon_flow" in fname(lab) and id(lab) not in alias}
            rows = sc["r"]
            visited = set()
            def add(n, k, d):
                r = {"k": k, "key": kid.get(id(n), ""), "d": d, "l": n.linenumber}
                if k == "say":
                    r["t"] = n.what
                    r["w"] = n.who
                elif k == "jump" or k == "call":
                    ex = bool(getattr(n, "expression", False))
                    tg = n.target if k == "jump" else n.label
                    r["g"] = None if ex else tg
                    r["t"] = str(tg) if ex else ""
                elif k == "return":
                    r["t"] = str(n.expression) if getattr(n, "expression", None) else ""
                elif k == "python":
                    try:
                        r["t"] = str(n.code.source).strip().split("\n")[0][:120]
                    except Exception:
                        r["t"] = ""
                elif k == "stage":
                    r["t"] = stage(n)
                    cls = type(n).__name__
                    if cls in ("Camera", "ShowLayer"):
                        r["camera"] = cls
                        r["layer"] = str(getattr(n, "layer", None) or "master")
                        r["cameraAt"] = ", ".join(str(v) for v in (getattr(n, "at_list", None) or []))
                        r["hasATL"] = getattr(n, "atl", None) is not None
                elif k == "if":
                    r["t"] = ""
                rows.append(r)
                return r
            def walk(n, d, stop):
                steps = 0
                while n is not None and steps < 200000:
                    steps += 1
                    if n is stop or id(n) in visited: return
                    k = kind(n)
                    if k == "label":
                        if id(n) in scene_label_ids:
                            sc["fall"] = alias.get(id(n), str(n.name))
                            return
                        # Compiler-generated/private continuation labels do
                        # not start a user-visible chart. Follow their next
                        # node so statements after a call remain importable.
                        visited.add(id(n))
                        n = getattr(n, "next", None)
                        continue
                    visited.add(id(n))
                    if k is None:
                        n = getattr(n, "next", None)
                        continue
                    add(n, k, d)
                    if k == "menu":
                        join = n.next
                        mkey = kid.get(id(n), "")
                        for i, it in enumerate(n.items):
                            rows.append({"k": "choice", "key": "%s|c%d" % (mkey, i), "d": d + 1, "l": n.linenumber, "t": it[0], "c": it[1], "h": str(it[1]) == "False"})
                            blk = it[2]
                            if blk: walk(blk[0], d + 2, join)
                        n = join
                        continue
                    if k == "if":
                        join = n.next
                        mkey = kid.get(id(n), "")
                        for i, ent in enumerate(n.entries):
                            rows.append({"k": "branch", "key": "%s|b%d" % (mkey, i), "d": d + 1, "l": n.linenumber, "t": str(ent[0])})
                            blk = ent[1]
                            if blk: walk(blk[0], d + 2, join)
                        n = join
                        continue
                    if k == "while":
                        rows[-1]["t"] = str(n.condition)
                        blk = n.block
                        if blk: walk(blk[0], d + 1, n)
                        n = n.next
                        continue
                    if k == "jump" or k == "return": return
                    n = getattr(n, "next", None)
            walk(lab.next, 0, None)
            scenes.append(sc)
        chars = []
        try:
            for nm, v in list(renpy.store.__dict__.items()):
                if nm.startswith("_"): continue
                if isinstance(v, renpy.character.ADVCharacter):
                    try:
                        label = "%s" % (v.name,) if v.name else nm
                    except Exception:
                        label = nm
                    try:
                        tg = getattr(v, "image_tag", None)
                        tg = tg if isinstance(tg, str) else ""
                    except Exception:
                        tg = ""
                    chars.append([nm, label, tg])
        except Exception:
            pass
        chars.sort()
        return {"scenes": scenes, "chars": chars, "labels": [s["n"] for s in scenes]}
    def apply(P):
        if not P: return []
        index()
        bad = []
        for p in P:
            try:
                op = p.get("op")
                if op == "say":
                    n = km[p["key"]]
                    n.what = p["text"]
                    if "who" in p:
                        w = p["who"] or None
                        n.who = w
                        n.who_fast = bool(w and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", w))
                elif op == "go":
                    n = km[p["key"]]
                    if hasattr(n, "target"): n.target = p["to"]
                    else: n.label = p["to"]
                    n.expression = False
                elif op == "addchoice":
                    m = km[p["key"]]
                    ids = getattr(m, "_tkbf_ids", [])
                    if p["id"] in ids: continue
                    m.items = list(m.items) + [(p["text"], p.get("cond") or "True", [S.namemap[p["lab"]]])]
                    ia = getattr(m, "item_arguments", None)
                    if ia is not None: m.item_arguments = list(ia) + [None]
                    m._tkbf_ids = ids + [p["id"]]
                elif op == "choice":
                    mk, i = p["key"].split("|c")
                    m = km[mk]
                    i = int(i)
                    it = list(m.items[i])
                    if "text" in p: it[0] = p["text"]
                    if "hide" in p: it[1] = "False" if p["hide"] else (p.get("cond0") or "True")
                    if p.get("lab"): it[2] = [S.namemap[p["lab"]]]
                    m.items = list(m.items[:i]) + [tuple(it)] + list(m.items[i + 1:])
            except Exception as e:
                bad.append("%s: %s" % (p.get("key") or p.get("name"), e))
        return bad
    if mode == "graph": return build()
    return apply(P or [])`;
async function flowModOf(gid) { const g = await S.gal(gid); return { g, mod: (g.game.mods || []).find(m => m.flow) }; }
async function flowText(gid) {
  const { mod } = await flowModOf(gid); if (!mod) return '';
  const list = (await rpyGetJSON(mod.list)) || [], f = list.find(x => x.p === FLOW_FILE);
  return f ? new TextDecoder().decode(await rpyRead(f.c, f.s)) : '';
}
async function flowPatches(gid) {
  const m = (await flowText(gid)).match(/^# tkbflow-data: (.*)$/m);
  try { const v = m ? JSON.parse(m[1]) : []; return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
const rpyStr = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
/* Original-camera helper is included in exported mods for game-compatible ATL. */
const CAMERA_ORIGINAL_PY = String.raw`
    def _tkb_camera_original(source_key, expected_type="Camera"):
        """Apply a compiled camera transform without executing its AST control-flow."""
        try:
            src, line, _kind = source_key.rsplit(":", 2)
            line = int(line)
        except Exception:
            raise Exception("Invalid source key for camera: %r" % (source_key,))
        src = src.replace(chr(92), "/").lower()
        def norm(fn):
            f = str(fn).replace(chr(92), "/").lower()
            i = f.rfind("game/")
            if i >= 0: f = f[i + 5:]
            if f.endswith(".rpyc"): f = f[:-1]
            return f
        if src.endswith(".rpyc"): src = src[:-1]
        if expected_type not in ("Camera", "ShowLayer"):
            raise Exception("Unknown layer transform type: %r" % (expected_type,))
        found = []
        for nd in list(renpy.game.script.namemap.values()):
            if type(nd).__name__ != expected_type: continue
            if nd.linenumber == line and norm(nd.filename) == src and all(nd is not t for t in found):
                found.append(nd)
        if len(found) != 1:
            raise Exception("Camera source %r: expected 1 original statement, found %d" % (source_key, len(found)))
        node = found[0]
        at_list = [renpy.python.py_eval(expr) for expr in (getattr(node, "at_list", None) or [])]
        atl = getattr(node, "atl", None)
        if atl is not None:
            at_list.append(renpy.display.motion.ATLTransform(atl))
        renpy.exports.layer_at_list(at_list, layer=node.layer, camera=(expected_type == "Camera"))`;

/* the mod's file: the data (to read the edits again), the scenes and stand-in labels they need, and the Python that applies them */
function flowRpy(P) {
  const out = ['# Story edits made with the flowchart in Tankobon. Switch this mod off on the game\'s page to play the game as it was.', '# tkbflow-data: ' + JSON.stringify(P), ''];
  for (const p of P) {
    if ((p.op === 'addchoice' || p.op === 'choice') && p.lab) out.push(`label ${p.lab}:`, `    jump ${p.to}`, '');
    if (p.op === 'scene') {
      out.push(`label ${p.name}:`);
      for (const l of p.lines) out.push('    ' + (l.who ? l.who + ' ' : '') + rpyStr(l.text));
      if (!p.lines.length) out.push('    pass');
      out.push(p.to ? `    jump ${p.to}` : '    return', '');
    }
  }
  out.push('# the trace window (Tankobon) listens to this; it does nothing without it', 'init -2 python:', '    def _tkb_trace(*a, **k):', '        pass', '');
  // Preserve compiled Camera ATL blocks when a copied scene is applied.
  out.push(...CAMERA_ORIGINAL_PY.split('\n'), '');
  for (const p of P) if (p.op === 'chart') out.push(graphToRpy(p.ov ? '_tkbc_' + p.name : p.name, ensureGraph(p)), '');
  out.push('init 1999 python:');
  for (const l of FLOW_PY.split('\n')) out.push(l ? '    ' + l : '');
  out.push(`    _tkbflow("apply", ${pyLit(P.filter(p => p.op !== 'scene' && p.op !== 'chart'))})`);
  for (const p of P) if (p.op === 'chart' && p.ov) out.push(`    renpy.game.script.namemap[${pyLit(p.name)}] = renpy.game.script.namemap[${pyLit('_tkbc_' + p.name)}]`);
  out.push('');
  return out.join('\n');
}
async function flowSave(gid, P) {
  const text = flowRpy(P), { g, mod: m0 } = await flowModOf(gid); let mod = m0;
  const list = mod ? ((await rpyGetJSON(mod.list)) || []) : [];
  const i = list.findIndex(f => f.p === FLOW_FILE);
  if (i >= 0) { await ST.delMany('images', list[i].c).catch(() => { }); list.splice(i, 1); }
  const buf = Crypt.te.encode(text).buffer, id = await rpyPut(buf); list.push({ p: FLOW_FILE, s: buf.byteLength, c: [id], t: Date.now() });
  if (!mod) { mod = { id: uid(), name: 'Story edits', flow: true, on: true, list: await rpyPutJSON(list), files: 0, size: 0, addedAt: Date.now() }; g.game.mods = [...(g.game.mods || []), mod]; }
  else await rpyPutJSON(list, mod.list);
  mod.files = list.length; mod.size = list.reduce((n, f) => n + f.s, 0); mod.on = true;
  await saveGallery(g);
  // Keep offline and online editors pointed at the same latest draft. This is
  // a copy of node patch data only; original imported game files are intact.
  await ST.put('meta', { id: 'tkb-legacy-graph-drafts:' + gid,
    patches: JSON.parse(JSON.stringify(P)), updated: Date.now() }).catch(e => console.warn('Node draft mirror:', e));
  return text;
}
/* the mod's file is written again from the edits kept inside it, so a file written by an older version (or one with a mistake) is put right before the game starts */
async function flowRepair(gid) {
  const { mod } = await flowModOf(gid); if (!mod || !mod.on) return;
  const cur = await flowText(gid); if (!cur) return;
  const P = await flowPatches(gid); P.forEach(p => { if (p.op === 'chart') ensureGraph(p); });
  if (flowRpy(P) !== cur) await flowSave(gid, P);
}
const flowStructural = p => !!p.lab || p.op === 'addchoice' || p.op === 'scene' || p.op === 'chart' || (p.op === 'go' && p.was && p.was.g == null);
/* the patch that puts a simple edit back as it was (no restart of the story needed) */
function flowInverse(p) {
  if (p.op === 'say') return { op: 'say', key: p.key, text: p.was.t, who: p.was.w || '' };
  if (p.op === 'go') return { op: 'go', key: p.key, to: p.was.g };
  if (p.op === 'choice') return { op: 'choice', key: p.key, text: p.was.t, hide: !!p.was.h, cond0: p.was.c };
  return null;
}
const FLOW = { SW: 270, GX: 90, GY: 22, HH: 34, RH: 26, LIM: 8 };
//<<
