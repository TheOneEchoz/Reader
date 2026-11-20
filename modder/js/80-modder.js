/* Legacy safe-boot graph editor: compiled AST via snapshot, editable drafts
   saved per game. Running scripts change only after explicit mod activation. */
// A direct filesystem snapshot for 6.99 under the old 7.4 web runtime. In that
// runtime, window.renpy_exec is missing; gamePy() always returns null.
async function readLegacyGraph(ms = 25000) {
  if (!GAME.frame || !GAME.loaded) throw new Error('The game has not finished mounting its files.');
  const frame = GAME.frame;
  // The compiled AST was sent by Python before the main menu became ready.
  // Prefer that verified payload. It avoids the 7.4 web runtime's intermittent
  // "FS error" when reading the Python-created /tmp file from JavaScript.
  if (typeof GAME.legacyGraphWire === 'string') {
    const data = JSON.parse(GAME.legacyGraphWire);
    if (!data || !Array.isArray(data.scenes)) throw new Error('Invalid direct story snapshot');
    return data;
  }
  const reply = await new Promise(resolve => {
    GAME.graphq = GAME.graphq || new Map();
    const q = 'legacygraph-' + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { GAME.graphq.delete(q); resolve({ err: 'Timed out requesting the story snapshot' }); }, ms);
    GAME.graphq.set(q, m => { clearTimeout(timer); resolve(m); });
    frame.contentWindow.postMessage({ t: 'legacygraph', q }, '*');
  });
  if (!reply || reply.err) throw new Error('Could not retrieve the story snapshot. ' + (reply?.err || 'No response from Ren’Py') + '. Direct transfer: ' + (GAME.legacyGraphTransport || 'not received') + '.');
  if (GAME.frame !== frame) throw new Error('The game was closed while loading its story');
  const raw = new TextDecoder().decode(new Uint8Array(reply.buf));
  const result = JSON.parse(raw);
  if (!result || !Array.isArray(result.scenes)) throw new Error('Invalid story snapshot');
  return result;
}
/* One Modding screen for modern and legacy games. Legacy provides the same
   scene graph / changes / Charts UI with an offline story snapshot and a local
   draft writer, rather than a Python eval bridge or live hot reload. */
async function openLegacyNodes(gid) {
  if (!GAME.loaded || !GAME.frame) return toast('Start the game before opening its nodes.', 3500);
  if ($('#modder') || $('#charts') || $('#tkb-legacy-nodes-load')) return;
  const overlay = h('div', { id: 'tkb-legacy-nodes-load', role: 'status', style: 'position:fixed;inset:0;z-index:70000;background:rgba(10,12,17,.94);display:flex;align-items:center;justify-content:center;color:white' },
    h('div', { class: 'stack', style: 'max-width:510px;padding:24px;gap:12px' }, h('b', {}, 'Loading the shared Modding editor…'),
      h('p', { class: 'hint', style: 'margin:0' }, 'Reading compiled scenes and saved drafts without changing the working Legacy safe-boot player.'),
      h('button', { class: 'btn small', onclick: () => overlay.remove() }, 'Hide loading message')));
  document.body.append(overlay);
  let pics;
  try {
    let D = GAME.legacyNodesCache && GAME.legacyNodesCache.frame === GAME.frame && GAME.legacyNodesCache.data;
    if (!D) {
      D = await readLegacyGraph();
      if (!D || !Array.isArray(D.scenes) || !D.scenes.length) throw new Error('The running game did not return any compiled scenes.');
      GAME.legacyNodesCache = {frame: GAME.frame, data: D};
      GAME.legacyGraphWire = null;
    }
    if (!overlay.isConnected) return;
    D.chars = Array.isArray(D.chars) ? D.chars : [];
    D.labels = Array.isArray(D.labels) ? D.labels : D.scenes.map(x => x.n);
    // Keep a reusable snapshot so the next graph-editing session does not
    // require a working browser runtime. Store original AST data, never drafts.
    await tkbCacheStory(gid, D).catch(e => console.warn('Story snapshot cache:', e));
    const draftId = 'tkb-legacy-graph-drafts:' + gid;
    const old = await ST.get('meta', draftId).catch(() => null);
    const P = Array.isArray(old?.patches) ? old.patches : await flowPatches(gid).catch(() => []);
    const saveDraft = patches => ST.put('meta', {id:draftId, patches:JSON.parse(JSON.stringify(patches)), updated:Date.now()});
    const applyMod = async patches => {
      await saveDraft(patches);
      if (!patches.length) return toast('No draft changes to apply.', 2500), false;
      const faults = tkbValidatePatches(patches, D.labels).filter(i => i.level === 'error');
      if (faults.length) { toast('Cannot apply: ' + faults.length + ' graph error(s). Open a chart and select Validate.', 6500); return false; }
      if (!confirm('Apply ' + patches.length + ' Story edits on the NEXT launch?\n\nThe running game will not change. You can disable Story edits in the library if a mod fails.')) return false;
      await flowSave(gid, patches);
      toast('Story edits mod saved. Restart the game to test changes. Original imported files are unchanged.', 6500);
      return true;
    };
    pics = tkbLegacyPictureResolver(gid, D);
    overlay.remove();
    await openModder(gid, { D, P, pics, saveDraft, applyMod });
  } catch(e) {
    overlay.remove();
    if (pics) pics.close();
    console.error('Legacy Modding editor:',e);
    toast('Could not open the Legacy Modding editor: ' + (e.message || e), 7000);
  }
}

/* Stored ASTs are not game archives and are never interpreted as code by
   the editor. A cached graph can be edited completely offline, even if the
   game cannot boot in the embedded Ren'Py runtime. Fresh compiled-only games
   still require a story importer: caching does not decompile .rpyc files. */
async function tkbCacheStory(gid, D) {
  if (!D || !Array.isArray(D.scenes) || !D.scenes.length) return false;
  await ST.put('meta', { id: 'tkb-story-snapshot:' + gid,
    source: 'renpy-ast', savedAt: Date.now(), data: JSON.parse(JSON.stringify(D)) });
  return true;
}
async function openOfflineNodes(gid) {
  if ($('#modder') || $('#charts')) return toast('Close the open editor first.', 3000);
  const record = await ST.get('meta', 'tkb-story-snapshot:' + gid).catch(() => null);
  if (!record?.data || !Array.isArray(record.data.scenes) || !record.data.scenes.length)
    return toast('No saved story snapshot yet. Use Inspect archives for .rpy sources, or open the game’s nodes once to cache its compiled story.', 7000);
  const D = record.data;
  D.chars = Array.isArray(D.chars) ? D.chars : [];
  D.labels = Array.isArray(D.labels) ? D.labels : D.scenes.map(s => s.n);
  const id = 'tkb-legacy-graph-drafts:' + gid;
  const old = await ST.get('meta', id).catch(() => null);
  const P = Array.isArray(old?.patches) ? old.patches : await flowPatches(gid).catch(() => []);
  const saveDraft = patches => ST.put('meta', { id,
    patches: JSON.parse(JSON.stringify(patches)), updated: Date.now() });
  const applyMod = async patches => {
    await saveDraft(patches);
    if (!patches.length) { toast('No draft changes to apply.', 2500); return false; }
    const failures = tkbValidatePatches(patches, D.labels).filter(i => i.level === 'error');
    if (failures.length) { toast('Cannot apply: ' + failures.length + ' graph error(s). Use Validate in Charts.', 6500); return false; }
    if (!confirm('Enable ' + patches.length + ' edited Story patches for the NEXT game launch?\n\nThis does not start Ren’Py. The imported source files remain unchanged. If the game fails, disable Story edits in the library.')) return false;
    await flowSave(gid, patches);
    toast('Story edits mod saved for next launch. No browser runtime was started.', 5500);
    return true;
  };
  const pics = tkbLegacyPictureResolver(gid, D);
  try { await openModder(gid, { D, P, pics, saveDraft, applyMod, offline: true }); }
  catch(e) { pics.close(); console.error('Offline nodes:', e); toast('Could not open offline nodes: ' + (e.message || e), 6000); }
}

/* The flowchart screen: layout, drawing, moving boxes, selecting, editing */
//>> js/80-modder.js#0
async function openModder(gid, legacy = null) {
  if (!legacy && TKB_COMPAT.bootMode((await S.gal(gid)).game) === 'safe') return openLegacyNodes(gid);
  if ((!GAME.loaded && !legacy?.offline) || $('#modder')) return;
  try { document.activeElement && document.activeElement.blur(); } catch (e) { }
  const root = h('div', { id: 'modder', role: 'dialog', 'aria-label': 'Modding mode' }, h('div', { class: 'mload' }, 'Reading the story…'));
  document.body.append(root);
  syncGameAudio(true);
  const read = () => legacy ? Promise.resolve(legacy.D) : gamePy(FLOW_PY + '\nresult = _tkbflow("graph")', 120000);
  // The cached legacy snapshot is a faithful copy of the running game's
  // original AST. Keep it immutable: UI draft edits must not leak into the
  // next editor session or into archive/image metadata.
  let D = legacy ? JSON.parse(JSON.stringify(await read())) : await read();
  if (!legacy && D?.scenes?.length) await tkbCacheStory(gid, D).catch(e => console.warn('Story snapshot cache:', e));
  if (!D || !D.scenes || !D.scenes.length) { root.remove(); syncGameAudio(true); return toast(D ? 'No story scenes were found in this game.' : 'The story could not be read from this game.', 4000); }
  const g0 = await S.gal(gid);
  const activeDraft = !legacy ? await ST.get('meta', 'tkb-legacy-graph-drafts:' + gid).catch(() => null) : null;
  let P = legacy ? legacy.P : Array.isArray(activeDraft?.patches) ? activeDraft.patches : await flowPatches(gid), nid = P.reduce((m, p) => Math.max(m, p.id || 0), 0);
  const st = { sel: null, multi: new Set(), selMode: false, refs: false, open: new Set(), stage: false, k: 1, x: 24, y: 24 };
  const { SW, GX, GY, HH, RH, LIM } = FLOW;
  const GRID = 30, snapV = (v, free) => free ? Math.round(v) : Math.round(v / GRID) * GRID;   // boxes snap to a grid; Shift while dragging turns that off
  let suppress = false;
  const labelSet = () => new Set([...D.labels, ...P.filter(p => p.op === 'scene' || p.op === 'chart').map(p => p.name)]);
  const charName = v => { const c = D.chars.find(x => x[0] === v); return c ? c[1] : v; };
  const trunc = (t, n = 48) => { t = String(t == null ? '' : t).replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const rowByKey = key => { for (const s of D.scenes) for (const r of s.r) if (r.key === key) return r; return null; };
  const patchFor = (op, key) => P.find(p => p.op === op && p.key === key);
  const busy = msg => { let b = root.querySelector('.mload'); if (!msg) { b && b.remove(); return; } if (!b) { b = h('div', { class: 'mload' }); root.append(b); } b.textContent = msg; };


  /* the picture a Show / Scene node stands for: the game says which file an image name is, or the pictures are matched by name */
  const PYIMG = `class _TkbA(dict):
    def __missing__(self, k): return k in self.act
def _tkbok(l, active):
    try:
        def lst(v): return [v] if isinstance(v, str) else list(v) if isinstance(v, (list, tuple, set)) else []
        a = lst(getattr(l, "if_all", None)); b = lst(getattr(l, "if_any", None)); c = lst(getattr(l, "if_not", None))
        if a and not all(i in active for i in a): return False
        if b and not any(i in active for i in b): return False
        if c and any(i in active for i in c): return False
        cond = getattr(l, "condition", None)
        if isinstance(cond, str) and cond.strip():
            m = _TkbA(); m.act = active
            if not eval(cond, {"__builtins__": {}}, m): return False
    except Exception:
        pass
    return True
def _tkbparts(tag):
    try:
        ims = renpy.display.image.images; groups = {}; order = []; plain = set()
        for k, v in ims.items():
            if not k or k[0] != tag: continue
            if len(k) > 1: plain.add(" ".join(k[1:]))
            ls = getattr(v, "attributes", None) or []
            if isinstance(ls, dict): ls = list(ls.values())
            for l in ls:
                n = getattr(l, "attribute", None)
                if not n: continue
                g = getattr(l, "group", None); g = g if isinstance(g, str) else ""
                if g not in groups: groups[g] = []; order.append(g)
                if not any(q[0] == n for q in groups[g]): groups[g].append([n, bool(getattr(l, "default", False))])
        return {"layered": [{"group": g, "attrs": groups[g]} for g in order], "plain": sorted(plain)}
    except Exception:
        return {"layered": [], "plain": []}
def _tkbimg(nm, detailed=False):
    """Inspect registered images without changing Ren'Py's live displayables."""
    import re
    report = {"requested": nm, "files": [], "references": [], "unresolved": [], "variables": {}, "errors": []}
    try:
        words = nm.strip().split()
        if not words: return report if detailed else []
        images = renpy.display.image.images
        store = renpy.store
        requested = set(words[1:])
        seen = set()
        exts = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".svg")

        def find_key(label):
            if isinstance(label, tuple):
                if label in images: return label
                label = " ".join(label)
            if not isinstance(label, str): return None
            label = label.strip()
            if not label: return None
            direct = tuple(label.split())
            if direct in images: return direct
            # Ren'Py names can have implicit attribute separators. E.g.
            # rubysecret1b1 (a DynamicImage result) may be registered as
            # image rubysecret1b 1. Only accept unambiguous normalized matches.
            flat = "".join(label.split()).casefold()
            options = [k for k in images if "".join(k).casefold() == flat]
            if len(options) == 1: return options[0]
            if len(options) > 1:
                report["unresolved"].append("Ambiguous image name: " + label + " -> " + repr(options[:6]))
            return None

        def substitute(template):
            missing = []
            def replace(match):
                key = match.group(1)
                try:
                    val = getattr(store, key)
                    report["variables"][key] = repr(val)[:120]
                    return str(val)
                except Exception:
                    try:
                        val = renpy.python.store_dicts["store"][key]
                        report["variables"][key] = repr(val)[:120]
                        return str(val)
                    except Exception:
                        missing.append(key)
                        report["variables"][key] = "MISSING"
                        return match.group(0)
            text = re.sub(r"\\[([A-Za-z_][A-Za-z_0-9]*)\\]", replace, template)
            if missing:
                report["unresolved"].append("Unbound variables in " + template + ": " + ", ".join(missing))
                return None
            return text

        def permitted(layer, active):
            def names(v):
                if isinstance(v, str): return [v]
                if isinstance(v, (tuple, list, set)): return list(v)
                return []
            if any(v not in active for v in names(getattr(layer, "if_all", None))): return False
            ors = names(getattr(layer, "if_any", None))
            if ors and not any(v in active for v in ors): return False
            if any(v in active for v in names(getattr(layer, "if_not", None))): return False
            cond = getattr(layer, "condition", None)
            if isinstance(cond, str) and cond.strip():
                class Scope(dict):
                    def __missing__(self, key):
                        if key in active: return True
                        try: return getattr(store, key)
                        except Exception: return False
                try: return bool(eval(cond, {"__builtins__": {}}, Scope()))
                except Exception as error:
                    report["unresolved"].append("Condition could not be evaluated: " + cond + ": " + str(error)[:80])
                    return False
            return True

        def visit(value, depth=0):
            if value is None or depth > 25 or len(report["files"]) >= 40: return
            if isinstance(value, str):
                value = value.strip()
                if not value: return
                if "[" in value and "]" in value:
                    value = substitute(value)
                    if value is None: return
                if value.lower().endswith(exts):
                    if value not in report["files"]: report["files"].append(value)
                    return
                k = find_key(value)
                if k is not None:
                    visit_ref(k, depth + 1)
                else:
                    report["unresolved"].append("No registered image: " + value)
                return
            if isinstance(value, tuple) and value and all(isinstance(x, str) for x in value):
                k = find_key(value)
                if k is not None: visit_ref(k, depth + 1)
                else: report["unresolved"].append("Unregistered image reference: " + " ".join(value))
                return
            if isinstance(value, (list, tuple)):
                for part in value: visit(part, depth + 1)
                return
            ident = id(value)
            if ident in seen: return
            seen.add(ident)
            cls = type(value).__name__
            if cls == "DynamicImage":
                template = getattr(value, "name", None)
                if isinstance(template, str):
                    visit(template, depth + 1)
                else:
                    report["unresolved"].append("DynamicImage without a string name")
                # Do not call find_target() here: it updates the real game's
                # image objects and can change what later playback renders.
                return
            if cls == "ImageReference":
                name = getattr(value, "name", None)
                if name is not None: visit(name, depth + 1)
                else: report["unresolved"].append("ImageReference without a name")
                return
            filename = getattr(value, "filename", None)
            if isinstance(filename, str) and filename.lower().endswith(exts):
                visit(filename, depth + 1)
                return
            image_name = getattr(value, "name", None)
            if cls == "Image" and isinstance(image_name, str):
                visit(image_name, depth + 1)
                return
            layers = getattr(value, "layers", None)
            attrs = getattr(value, "attributes", None)
            if layers is not None or attrs is not None:
                sequence = layers if layers is not None else attrs
                if isinstance(sequence, dict): sequence = list(sequence.values())
                sequence = list(sequence or [])
                # LayeredImage.layers includes the base and the optional layers
                # in display order; attributes often duplicates those objects.
                # Only use separate 'always' entries if layers are absent.
                if layers is None:
                    always = getattr(value, "always", None) or []
                    if isinstance(always, dict): always = list(always.values())
                    sequence = list(always) + sequence
                choices = [l for l in sequence if getattr(l, "attribute", None) is not None]
                selected_groups = {getattr(l, "group", None) for l in choices if getattr(l, "attribute", None) in requested}
                active = set(requested)
                for layer in choices:
                    attr = getattr(layer, "attribute", None)
                    if (attr not in requested and getattr(layer, "default", False)
                            and getattr(layer, "group", None) not in selected_groups):
                        active.add(attr)
                for layer in sequence:
                    attr = getattr(layer, "attribute", None)
                    if attr is not None and attr not in active: continue
                    if not permitted(layer, active): continue
                    visit(getattr(layer, "image", layer), depth + 1)
                return
            for field in ("child", "image", "displayable", "d"):
                child = getattr(value, field, None)
                if child is not None and child is not value:
                    visit(child, depth + 1)
                    return
            children = getattr(value, "children", None)
            if isinstance(children, (tuple, list)):
                for child in children: visit(child, depth + 1)

        def visit_ref(key, depth=0):
            label = " ".join(key)
            if label not in report["references"]: report["references"].append(label)
            if depth > 25: return
            visit(images[key], depth + 1)

        key = find_key(tuple(words))
        if key is None: key = find_key((words[0],))
        if key is not None:
            visit_ref(key)
        else:
            possibilities = [(k, v) for k, v in images.items() if k and k[0] == words[0] and set(k[1:]) <= requested]
            if possibilities:
                k, v = max(possibilities, key=lambda kv: len(kv[0]))
                visit_ref(k)
            else: report["unresolved"].append("Image tag not registered: " + words[0])
    except Exception as error:
        report["errors"].append(type(error).__name__ + ": " + str(error)[:240])
    return report if detailed else report["files"]
def _tkbimgdiag(nm):
    def _layer_allowed(layer, active):
        # Keep this helper in the same function scope as the layer walker.
        # Ren'Py's gamePy execution does not reliably expose sibling definitions
        # as globals when exec() receives separate globals and locals.
        try:
            def names(v):
                if isinstance(v, str): return [v]
                if isinstance(v, (list, tuple, set)): return list(v)
                return []
            all_of = names(getattr(layer, "if_all", None))
            any_of = names(getattr(layer, "if_any", None))
            none_of = names(getattr(layer, "if_not", None))
            if all_of and not all(n in active for n in all_of): return False
            if any_of and not any(n in active for n in any_of): return False
            if none_of and any(n in active for n in none_of): return False
            cond = getattr(layer, "condition", None)
            if isinstance(cond, str) and cond.strip():
                class _ActiveNames(dict):
                    def __missing__(self, key): return key in active
                if not eval(cond, {"__builtins__": {}}, _ActiveNames()): return False
        except Exception:
            pass
        return True
    """Read-only diagnostics for arbitrary Ren'Py layered image tags."""
    import re
    result = {"requested": nm, "tag": "", "registered": [], "selected": [],
              "variables": {}, "candidates": [], "errors": []}
    try:
        ws = nm.split()
        if not ws: return result
        tag = ws[0]
        result["tag"] = tag
        ims = renpy.display.image.images
        matches = [(k, v) for k, v in ims.items() if k and k[0] == tag]
        result["registered"] = [" ".join(k) for k, v in matches][:30]
        base = ims.get((tag,))
        if base is None and matches: base = matches[0][1]
        if base is None:
            result["errors"].append("No registered image for this tag")
            return result
        result["root_type"] = type(base).__name__
        selected = set(ws[1:])
        def examine(obj, label, depth=0):
            if obj is None or depth > 7: return
            typ = type(obj).__name__
            if typ == "DynamicImage":
                template = getattr(obj, "name", None)
                if not isinstance(template, str): return
                scope = {}
                for key in re.findall(r"\\[([A-Za-z_][A-Za-z_0-9]*)\\]", template):
                    try:
                        val = getattr(renpy.store, key)
                        scope[key] = val
                        result["variables"][key] = repr(val)[:120]
                    except Exception as e:
                        result["variables"][key] = "MISSING: " + str(e)[:120]
                resolved = re.sub(r"\\[([A-Za-z_][A-Za-z_0-9]*)\\]",
                    lambda m: str(scope[m.group(1)]) if m.group(1) in scope else m.group(0), template)
                result["candidates"].append({"layer": label, "template": template,
                    "resolved": resolved, "unresolved": "[" in resolved and "]" in resolved})
                return
            if typ == "Image":
                result["candidates"].append({"layer": label, "resolved": str(getattr(obj, "filename", getattr(obj, "name", "")))})
                return
            if typ == "ImageReference":
                result["candidates"].append({"layer": label, "reference": repr(getattr(obj, "name", None))[:160]})
                return
            for key in ("child", "image", "target"):
                child = getattr(obj, key, None)
                if child is not None and child is not obj:
                    examine(child, label + "/" + key, depth + 1)
                    return
            children = getattr(obj, "children", None)
            if isinstance(children, (tuple, list)):
                for child in children[:8]: examine(child, label + "/children", depth + 1)
        # The attributes list owns the mutually exclusive variants. Some Ren'Py
        # versions also expose those very same objects through layers; never
        # treat everything in layers as unconditional.
        attrs_list = list(getattr(base, "attributes", None) or [])
        group_of = {}
        for a in attrs_list:
            name = getattr(a, "attribute", None)
            if name is not None:
                group_of[name] = getattr(a, "group", None)
        selected_groups = set(group_of[n] for n in selected if n in group_of)
        active = set(n for n in selected if n in group_of)
        for a in attrs_list:
            n = getattr(a, "attribute", None)
            if n is not None and n not in active and getattr(a, "default", False):
                if getattr(a, "group", None) not in selected_groups:
                    active.add(n)
        # Track attributes by identity as well as name to avoid re-adding them
        # when Ren'Py exposes them through multiple collections.
        attribute_ids = set(id(a) for a in attrs_list)
        def allowed(layer):
            n = getattr(layer, "attribute", None)
            if n is not None:
                return n in active and _layer_allowed(layer, active)
            if id(layer) in attribute_ids:
                return False
            return _layer_allowed(layer, active)
        def visit_layer(layer, label):
            if not allowed(layer): return
            n = getattr(layer, "attribute", None)
            if n is not None and n not in active: return
            examine(getattr(layer, "image", layer), label)
        # These containers may contain attributes, not just unconditional art.
        for field in ("always", "layers"):
            values = getattr(base, field, None) or []
            if isinstance(values, dict): values = list(values.values())
            for i, layer in enumerate(values):
                visit_layer(layer, field + "/" + str(i))
        for field in ("base", "image", "child"):
            value = getattr(base, field, None)
            if value is not None and value is not base:
                examine(value, field)
        for layer in attrs_list:
            n = getattr(layer, "attribute", None)
            if n is None or n not in active or not allowed(layer): continue
            result["selected"].append({"group": getattr(layer, "group", None), "attribute": n})
            examine(getattr(layer, "image", None), str(n))
        # Only include unconditional always layers, and avoid duplicating those
        # already visited above.
        if not result["selected"] and not result["candidates"] and result["root_type"] != "LayeredImage":
            examine(base, "root")
    except Exception as e:
        result["errors"].append(type(e).__name__ + ": " + str(e)[:250])
    return result

def _tkbimgwhy(nm):
    try:
        ws = nm.split(); ims = renpy.display.image.images
        if tuple(ws) in ims: return "it is defined (as " + type(ims[tuple(ws)]).__name__ + ") but no picture file could be found inside it"
        near = sorted(" ".join(k) for k in ims.keys() if k[0] == ws[0])[:6]
        if near: return "no image with exactly this name; similar: " + ", ".join(near)
        return "no image has the tag " + ws[0]
    except Exception:
        return ""
`;
  const PYIMGS = `def _tkbimgs():
    try:
        out = set()
        for k, v in renpy.display.image.images.items():
            out.add(" ".join(k))
            for l in (getattr(v, "attributes", None) or []):
                n = getattr(l, "attribute", None)
                if n: out.add(" ".join(k) + " " + n)
        return sorted(out)
    except Exception:
        return []
result = _tkbimgs()
`;
  const imgCache = new Map(), imgInfo = new Map(), audioNames = []; let lastGuess = null;
  const extOf = f => (String(f).split('.').pop() || '').toLowerCase(), PIC_RE = /\.(png|jpe?g|webp|avif|gif|bmp|svg|tga|psd|tiff?|ico)$/i; let imgQ = Promise.resolve(), imgList = null, picNames = null;
  const IMG_TAIL = /\s+(?:at|as|behind|onlayer|zorder|with|where)\b[\s\S]*$/, PIC_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon' };
  const picUrl = async path => {
    path = String(path).replace(/^\/+/, '').replace(/^game\//i, ''); if (!imgList) imgList = await gameFileList(await S.gal(gid));
    let rd = (await gameFileReader(imgList, path)) || (await gameFileReader(imgList, 'images/' + path));   // (a bare file name is looked for in the game folder and in images/)
    if (!rd) { await picIndex(); const base = path.split('/').pop().toLowerCase(), hit = picNames.find(n => n.split('/').pop().toLowerCase() === base); if (hit) rd = await gameFileReader(imgList, hit); }
    if (!rd) return null;
    return URL.createObjectURL(new Blob([await rd()], { type: PIC_MIME[(path.split('.').pop() || '').toLowerCase()] || 'image/png' }));
  };
  const picIndex = async () => {
    if (!imgList) imgList = await gameFileList(await S.gal(gid));
    if (picNames) return; picNames = [];
    const add = n => { if (PIC_RE.test(n)) picNames.push(n); else if (RPY_AUDIO.test(n)) audioNames.push(n); };
    for (const f of imgList) if (/^game\//i.test(f.p) && !/\.rpa$/i.test(f.p)) add(f.p.slice(5));
    for (const a of imgList) if (/\.rpa$/i.test(a.p)) { const idx = await rpaIndex(a).catch(() => null); if (idx) for (const n of idx.keys()) add(n); }
    audioNames.sort();
  };
  const picGuess = async nm => {
    if (!imgList) imgList = await gameFileList(await S.gal(gid));
    await picIndex();
    const words = x => x.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/^(game\/)?images\//, '').split(/[\s_\-\/]+/).filter(Boolean), w = words(nm), ws = new Set(w);
    const all = picNames.map(p => [p, words(p)]).filter(([, t]) => t.length && t[0] === w[0]);
    const exact = all.filter(([, t]) => t.length === ws.size && t.every(x => ws.has(x)));
    if (exact.length) { lastGuess = exact[0][0]; return [await picUrl(exact[0][0])]; }
    const sup = all.filter(([, t]) => w.every(x => t.includes(x))).sort((x, y) => x[1].length - y[1].length);
    if (sup.length) { lastGuess = sup[0][0]; return [await picUrl(sup[0][0])]; }
    let groups = new Set(), defs = new Set();
    try { const r = await gamePy(PYIMG + '\nresult = _tkbparts(' + JSON.stringify(nm.split(/\s+/)[0]) + ')', 4000); for (const g of (r && r.layered) || []) { if (g.group) groups.add(g.group.toLowerCase()); for (const [a, d] of g.attrs) { if (d && !(g.attrs.some(([x]) => ws.has(x.toLowerCase())))) defs.add(a.toLowerCase()); } } } catch (e) { }
    const okw = new Set([...ws, ...groups, ...defs]), deep = picNames.map(p => { const t = words(p), i = t.indexOf(w[0]); return [p, i < 0 ? [] : t.slice(i)]; }).filter(([, t]) => t.length);
    const lay = deep.filter(([, t]) => t.every(x => okw.has(x)) && t.some(x => ws.has(x) || defs.has(x)) || (t.length === 1 && t[0] === w[0])).sort((x, y) => x[1].length - y[1].length).slice(0, 16);
    if (lay.length > 1 || (lay.length === 1 && w.length === 1)) { const us = []; lastGuess = lay[0][0]; for (const [p] of lay) { const u = await picUrl(p).catch(() => null); if (u) us.push(u); } if (us.length) return us; }
    const parts = all.filter(([, t]) => t.every(x => ws.has(x))).sort((x, y) => x[1].length - y[1].length).slice(0, 8);   // a sprite made of pieces: base, outfit, face…
    const urls = []; if (parts.length) lastGuess = parts[0][0]; for (const [p] of parts) { const u = await picUrl(p); if (u) urls.push(u); }
    return urls;
  };
  const runtimeImgFor = name => {
    const nm = String(name || '').replace(IMG_TAIL, '').trim().replace(/^["']|["']$/g, ''); if (!nm) return Promise.resolve(null);
    if (!imgCache.has(nm)) imgCache.set(nm, imgQ = imgQ.then(async () => {
      let us = [], why = 'The game has no image with this name.', ext = null; lastGuess = null;
      try { const fs = await gamePy(PYIMG + '\nresult = _tkbimg(' + JSON.stringify(nm) + ')', 6000);
        if (Array.isArray(fs) && fs.length) { ext = extOf(fs[0]); why = 'The game says this is ' + fs[0] + ', but that file is not in its files.'; for (const f of fs) { const u = await picUrl(f).catch(() => null); if (u) us.push(u); } } } catch (e) { }
      if (!us.length) { try { us = (await picGuess(nm)) || []; if (lastGuess) { ext = extOf(lastGuess); why = 'A file like it was found (' + lastGuess + ') but it could not be read.'; } } catch (e) { } }
      if (!us.length && !ext) { try { const w = await gamePy(PYIMG + '\nresult = _tkbimgwhy(' + JSON.stringify(nm) + ')', 4000); if (w) why = 'Not found: ' + w + '.'; } catch (e) { } }
      {
        try {
          const diag = await gamePy(PYIMG + '\nresult = _tkbimgdiag(' + JSON.stringify(nm) + ')', 7000);
          if (diag && typeof diag === 'object') {
            const report = await gamePy(PYIMG + '\nresult = _tkbimg(' + JSON.stringify(nm) + ', True)', 7000);
            if (report) diag.resolution = report;
            const candidates = [...new Set([...(report && report.files || []), ...(diag.candidates || []).map(x => x.resolved || x.reference || x.template).filter(Boolean)])];
            // Never discard files already loaded by the authoritative resolver.
            const loadedPaths = new Set();
            await picIndex();
            const checked = [];
            for (const f of (us.length ? [] : candidates.slice(0, 16))) {
              if (!/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f)) continue;
              const base = f.split('/').pop().toLowerCase();
              const matches = picNames.filter(p => p.toLowerCase() === f.toLowerCase() || p.split('/').pop().toLowerCase() === base).slice(0, 8);
              const resolved = [];
              for (const p of matches) {
                try { if (loadedPaths.has(p.toLowerCase())) { resolved.push(p); continue; } const u = await picUrl(p); if (u) { resolved.push(p); us.push(u); loadedPaths.add(p.toLowerCase()); } }
                catch (e) { checked.push({ file: p, error: String(e) }); }
              }
              checked.push({ candidate: f, indexedMatches: matches, loaded: resolved });
            }
            diag.fileLookup = checked;
            const missing = Object.entries(diag.variables || {}).filter(([,v]) => String(v).startsWith('MISSING')).map(([k]) => k);
            const detail = [
              'Diagnostic ' + ENGINE_VERSION + ': ' + (diag.root_type || 'no registered root'),
              missing.length ? 'Missing variables: ' + missing.join(', ') : '',
              candidates.length ? 'Candidate files: ' + candidates.slice(0, 5).join(' | ') : 'No image paths extracted',
              checked.length ? 'File lookup: ' + checked.map(x => x.candidate + ' (' + x.indexedMatches.length + ' indexed matches; ' + x.loaded.length + ' loaded)').join(' | ') : 'No candidate filenames to check (possibly registered image references)',
              (diag.errors || []).join('; '),
              (report && report.unresolved || []).slice(0, 5).join('; '),
              (report && report.errors || []).join('; ')
            ].filter(Boolean).join(' — ');
            if (!us.length) why += '\n' + detail;
            console.groupCollapsed('[Tankobon image diagnostic] ' + nm);
            console.log(diag);
            console.groupEnd();
            window.tkbLastImageDiagnostic = diag;
          }
        } catch (e) { why += '\nDiagnostic failed: ' + String(e && e.message || e); }
      }
      imgInfo.set(nm, { why: us.length ? null : why, ext });
      return us.length ? us : null;
    }));
    return imgCache.get(nm);
  };
  const imgFor = legacy ? legacy.pics.image : runtimeImgFor;
  /* the variants of a character image (its tag): layered image groups and attributes, or the `image tag variant` definitions, or (game not running) the picture files' names */
  const variantsFor = async tag => {
    if (legacy) {
      const found = await legacy.pics.assets('image');
      const plain = found.map(n => n.value).filter(n => n.split(/\s+/)[0] === tag).map(n => n.split(/\s+/).slice(1).join(' ')).filter(Boolean);
      return { layered: [], plain: [...new Set(plain)].sort() };
    }
    tag = String(tag || '').trim(); if (!tag) return { layered: [], plain: [] };
    try { const r = await gamePy(PYIMG + '\nresult = _tkbparts(' + JSON.stringify(tag) + ')', 6000); if (r && ((r.layered || []).length || (r.plain || []).length)) return r; } catch (e) { }
    await picIndex(); const plain = new Set();
    for (const n of picNames) { const w = n.replace(/^images\//i, '').replace(/\.[a-z0-9]+$/i, '').split(/[\s_\/]+/).filter(Boolean); if (w[0] === tag && w.length > 1) plain.add(w.slice(1).join(' ')); }
    return { layered: [], plain: [...plain].sort() };
  };
  /* what the node fields can be filled from: the game's own pictures (by image name), sounds, scenes and characters */
  const assetsFor = async kind => {
    if (legacy && kind !== 'label' && kind !== 'char') return legacy.pics.assets(kind);
    if (kind === 'label') return [...labelSet()].sort().map(n => ({ name: n, value: n }));
    if (kind === 'tag') { const nm = await assetsFor('image'), tags = new Map(); for (const a of nm) { const t = a.value.split(/\s+/)[0]; if (t && !tags.has(t)) { const c = D.chars.find(x => x[2] === t); tags.set(t, { name: c ? `${t} (${c[1]})` : t, value: t }); } } return [...tags.values()]; }
    if (kind === 'char') return D.chars.map(c => ({ name: `${c[1]} (${c[0]})`, value: c[0] }));
    await picIndex();
    if (kind === 'audio') return audioNames.map(n => ({ name: n, value: '"' + n + '"' }));
    const set = new Set(); try { const r = await gamePy(PYIMGS, 8000); if (Array.isArray(r)) r.forEach(n => set.add(n)); } catch (e) { }
    if (!set.size) for (const n of picNames) if (/^images\//i.test(n)) set.add(n.replace(/^images\//i, '').replace(/\.[a-z0-9]+$/i, '').split(/[\s_\/]+/).join(' '));
    return [...set].sort().map(n => ({ name: n, value: n }));
  };
  /* ---- the picture ----
     Only the scenes in (or near) the view are made of page elements, and the arrows are drawn on a canvas, so a story with
     hundreds of scenes stays smooth. Zoomed out, boxes lose their lines, and further out they are drawn on the canvas too. */
  const dl = h('datalist', { id: 'modlabels' });
  const vrows = s => st.stage ? s.r : s.r.filter(r => r.k !== 'stage');
  const manual = new Map(Object.entries(g0.game.flowpos || {}).filter(([, v]) => Array.isArray(v) && v.length === 2)); // boxes moved by hand: name -> [x, y]
  const sharedOv = new Map(Object.entries(g0.game.flowshared || {}).filter(([, v]) => typeof v === 'boolean'));   // scenes the user made shared (true) or normal (false)
  let SHARED = new Set(), USERS = new Map();   // shared scenes (like functions: used from many places) and, for each scene, the scenes that lead to it
  const SHARE_MIN = 5;
  const computeShared = () => {
    USERS = new Map(); SHARED = new Set();
    for (const s of D.scenes) {
      const add = b => { if (b && b !== s.n) (USERS.get(b) || USERS.set(b, new Set()).get(b)).add(s.n); };
      for (const r of s.r) if ((r.k === 'jump' || r.k === 'call') && r.g) add(r.g);
      if (s.fall) add(s.fall);
    }
    for (const s of D.scenes) { const o = sharedOv.get(s.n), c = USERS.has(s.n) ? USERS.get(s.n).size : 0; if (c > 0 && (o === true || (o !== false && s.n !== 'start' && c >= SHARE_MIN))) SHARED.add(s.n);   /* a scene nothing leads to cannot be shared (it crashed the layout) */ }
  };
  let auto = new Map(), POS = new Map(), EDG = [], WP = new Map(), edited = new Set(), dlKey = '';   // auto: tidy places; POS: name -> {x, y, h, rows, more, extra, idx}
  const sizeOf = s => {
    const all = vrows(s), open = st.open.has(s.n), shown = open ? all : all.slice(0, LIM), more = all.length - shown.length, extra = more > 0 || (open && all.length > LIM) ? 1 : 0;
    return { x: 0, y: 0, rows: shown, more, extra, h: HH + (shown.length + extra) * RH + 4, idx: new Map(shown.map((r, i) => [r, i])) };
  };
  const linksOf = s => { const t = new Set(); for (const r of s.r) if ((r.k === 'jump' || r.k === 'call') && r.g && r.g !== s.n) t.add(r.g); if (s.fall && s.fall !== s.n) t.add(s.fall); return t; };
  /* the tidy places. Scenes that lead to each other form a group. In a group the scenes are in layers from left to right: a scene is
     always to the right of the scenes whose jumps lead to it, so the story reads from left to right and the scenes that lead to the
     same scene are in the column before it, one above the other. The order in each column is chosen to keep arrows from crossing,
     a long arrow gets a lane of its own (so it does not run behind boxes), and each box is lined up with the arrows that come in.
     Jumps (the solid arrows) decide all this; calls and fall-through (dashed, dotted) only count for a scene no jump leads to. */
  const tidy = () => {
    const sc = D.scenes, by = new Map(sc.map(s => [s.n, s])), sz = new Map(sc.map(s => [s.n, sizeOf(s)]));
    const links = new Map();   // every link between two scenes once: {a, b, k, oy (where on the box a it starts)}
    for (const s of sc) {
      const q = sz.get(s.n);
      const add = (b, k, row) => {
        if (!by.has(b) || b === s.n || SHARED.has(b) || SHARED.has(s.n)) return;
        const key = s.n + '\n' + b, old = links.get(key), oy = row ? HH + (q.idx.has(row) ? q.idx.get(row) : q.rows.length) * RH + RH / 2 : q.h - 8;
        if (!old) links.set(key, { a: s.n, b, k, oy }); else if (k === 'jump' && old.k !== 'jump') { old.k = 'jump'; old.oy = oy; }
      };
      for (const r of s.r) if ((r.k === 'jump' || r.k === 'call') && r.g) add(r.g, r.k, r);
      if (s.fall) add(s.fall, 'fall', null);
    }
    // shared scenes (many others lead to them) stay out of all this: they are put in a block of their own
    const jumped = new Set(); for (const l of links.values()) if (l.k === 'jump') jumped.add(l.b);
    const E = [...links.values()].filter(l => l.k === 'jump' || !jumped.has(l.b));
    const outE = new Map(sc.map(s => [s.n, []])), inE = new Map(sc.map(s => [s.n, []]));
    for (const e of E) { outE.get(e.a).push(e); inE.get(e.b).push(e); }
    const uf = new Map(sc.map(s => [s.n, s.n])), root = x => { while (uf.get(x) !== x) { uf.set(x, uf.get(uf.get(x))); x = uf.get(x); } return x; };
    for (const e of E) { const ra = root(e.a), rb = root(e.b); if (ra !== rb) uf.set(ra, rb); }
    const groups = new Map(); for (const s of sc) { if (SHARED.has(s.n)) continue; const r = root(s.n); (groups.get(r) || groups.set(r, []).get(r)).push(s); }
    let total = 0; for (const s of sc) total += (SW + GX) * (sz.get(s.n).h + GY);
    const DUMMY = 8, GYD = 10, cw = SW + GX;
    const layoutGroup = list => {
      const names = list.map(s => s.n);
      if (names.length === 1) return { local: new Map([[names[0], [0, 0]]]), wp: new Map(), W: SW, H: sz.get(names[0]).h };
      // 1. leave out the arrows that go back (they would make a loop): depth first from the start, then from scenes nothing leads to
      const state = new Map(), disc = new Map(), back = new Set(), post = [];
      const roots = [...names.filter(n => n === 'start'), ...names.filter(n => n !== 'start' && inE.get(n).length === 0), ...names];
      for (const r0 of roots) {
        if (state.has(r0)) continue;
        const stack = [[r0, 0]]; state.set(r0, 1); disc.set(r0, disc.size);
        while (stack.length) {
          const top = stack[stack.length - 1], es = outE.get(top[0]);
          if (top[1] < es.length) { const e = es[top[1]++], s2 = state.get(e.b); if (s2 === 1) back.add(e); else if (!s2) { state.set(e.b, 1); disc.set(e.b, disc.size); stack.push([e.b, 0]); } }
          else { state.set(top[0], 2); post.push(top[0]); stack.pop(); }
        }
      }
      const topo = post.reverse();
      // 2. layers: a scene is right of every scene that leads to it; a scene nothing leads to moves up to just before its first scene
      const layer = new Map(names.map(n => [n, 0])), indag = new Map(names.map(n => [n, 0]));
      for (const n of topo) for (const e of outE.get(n)) if (!back.has(e)) { layer.set(e.b, Math.max(layer.get(e.b), layer.get(n) + 1)); indag.set(e.b, indag.get(e.b) + 1); }
      for (let i = topo.length - 1; i >= 0; i--) {
        const n = topo[i]; if (n === 'start' || indag.get(n) > 0) continue;
        const outs = outE.get(n).filter(e => !back.has(e)); if (!outs.length) continue;
        layer.set(n, Math.max(layer.get(n), Math.min(...outs.map(e => layer.get(e.b))) - 1));
      }
      // 3. the boxes, and a stand-in in each layer a long arrow passes
      const Ls = [], nodes = new Map(); let count = 0;
      const mk = (name, l, hh, dummy, o0) => { const nd = { name, l, h: hh, dummy, up: [], dn: [], pos: 0, y: 0, o0 }; (Ls[l] = Ls[l] || []).push(nd); count++; return nd; };
      const link = (u, v, ou) => { const ov = v.dummy ? DUMMY / 2 : HH / 2; u.dn.push({ n: v, ou, ov }); v.up.push({ n: u, ou, ov }); };
      for (const s of list) nodes.set(s.n, mk(s.n, layer.get(s.n), sz.get(s.n).h, false, disc.get(s.n)));
      const chains = new Map();
      for (const n of topo) for (const e of outE.get(n)) {
        if (back.has(e)) continue;
        const A = nodes.get(e.a), B = nodes.get(e.b); let prev = A, ou = e.oy; const ch = [];
        for (let l = A.l + 1; l < B.l; l++) { const d = mk(null, l, DUMMY, true, A.o0 + 0.5); ch.push(d); link(prev, d, ou); prev = d; ou = DUMMY / 2; }
        link(prev, B, ou); if (ch.length) chains.set(e.a + '\n' + e.b, ch);
      }
      const maxL = Ls.length - 1;
      for (const L of Ls) { L.sort((a, b) => a.o0 - b.o0); L.forEach((nd, i) => { nd.pos = i; }); }
      // 4. the order in each column: sweeps by the average place of the neighbours, then swaps of neighbours that remove crossings
      const reorder = (L, down) => {
        const key = new Map();
        for (const nd of L) {
          const ns = down ? nd.up : nd.dn; if (!ns.length) { key.set(nd, nd.pos); continue; }
          let t = 0; for (const e of ns) t += e.n.pos + (down ? (e.n.dummy ? 0.5 : Math.min(0.95, e.ou / e.n.h)) : 0.5);
          key.set(nd, t / ns.length);
        }
        L.sort((a, b) => key.get(a) - key.get(b) || a.pos - b.pos); L.forEach((nd, i) => { nd.pos = i; });
      };
      const cross = (u, v) => { let c = 0; for (const [a, b] of [[u.up, v.up], [u.dn, v.dn]]) for (const x of a) for (const y of b) if (x.n.pos > y.n.pos) c++; return c; };
      const rounds = count > 15000 ? 2 : 6;
      for (let it = 0; it < rounds; it++) {
        for (let l = 1; l <= maxL; l++) reorder(Ls[l], true);
        for (let l = maxL - 1; l >= 0; l--) reorder(Ls[l], false);
        if (count > 12000) continue;
        for (let pass = 0; pass < 4; pass++) {
          let changed = false;
          for (const L of Ls) for (let i = 0; i + 1 < L.length; i++) { const u = L[i], v = L[i + 1]; if (cross(v, u) < cross(u, v)) { L[i] = v; L[i + 1] = u; v.pos = i; u.pos = i + 1; changed = true; } }
          if (!changed) break;
        }
      }
      // 5. heights: stack each column, then line boxes up with their arrows (keeping the order and a gap between boxes)
      const sep = (u, v) => u.dummy || v.dummy ? GYD : GY;
      for (const L of Ls) { let y = 0; L.forEach((nd, i) => { nd.y = y; y += nd.h + (i + 1 < L.length ? sep(nd, L[i + 1]) : 0); }); }
      const place = (L, want) => {
        const n = L.length, off = new Array(n); let o = 0;
        for (let i = 0; i < n; i++) { off[i] = o; o += L[i].h + (i + 1 < n ? sep(L[i], L[i + 1]) : 0); }
        const bl = [];
        for (let i = 0; i < n; i++) {
          const w0 = want.get(L[i]), w = w0 ? w0.w : 1e-4, t = (w0 ? w0.y : L[i].y) - off[i];
          bl.push({ s: t * w, w, c: 1 });
          while (bl.length > 1 && bl[bl.length - 2].s / bl[bl.length - 2].w > bl[bl.length - 1].s / bl[bl.length - 1].w) { const b = bl.pop(), a = bl[bl.length - 1]; a.s += b.s; a.w += b.w; a.c += b.c; }
        }
        let i = 0; for (const b of bl) { const q = b.s / b.w; for (let k = 0; k < b.c; k++, i++) L[i].y = q + off[i]; }
      };
      for (let it = 0; it < 4; it++) {
        for (let l = 1; l <= maxL; l++) { const want = new Map(); for (const nd of Ls[l]) if (nd.up.length) { let t = 0, w = 0; for (const e of nd.up) { const k = e.n.dummy || nd.dummy ? 2 : 1; t += k * (e.n.y + e.ou - e.ov); w += k; } want.set(nd, { y: t / w, w }); } place(Ls[l], want); }
        for (let l = maxL - 1; l >= 0; l--) { const want = new Map(); for (const nd of Ls[l]) if (nd.dn.length) { let t = 0, w = 0; for (const e of nd.dn) { const k = e.n.dummy || nd.dummy ? 2 : 1; t += k * (e.n.y + e.ov - e.ou); w += k; } want.set(nd, { y: t / w, w }); } place(Ls[l], want); }
      }
      let top = 1e12; for (const nd of nodes.values()) top = Math.min(top, nd.y);
      const local = new Map(), wp = new Map(); let H = 0;
      for (const [n, nd] of nodes) { local.set(n, [nd.l * cw, nd.y - top]); H = Math.max(H, nd.y - top + nd.h); }
      for (const [k, ch] of chains) wp.set(k, ch.map(d => [d.l * cw + SW / 2, d.y - top + DUMMY / 2]));
      return { local, wp, W: (maxL + 1) * cw - GX, H };
    };
    const placed = [];
    for (const list of groups.values()) { const g = layoutGroup(list); placed.push({ first: list.some(s => s.n === 'start') ? 1 : 0, n: list.length, ...g }); }
    placed.sort((a, b) => b.first - a.first || b.n - a.n);
    const rowW = Math.max(Math.min(Math.max(...placed.map(g => g.W)), 30000), Math.sqrt(total) * 1.8, 4000);
    const A = new Map(), wp = new Map();
    const shl = sc.filter(s => SHARED.has(s.n)).sort((a, b) => USERS.get(b.n).size - USERS.get(a.n).size);
    let py0 = 0;
    if (shl.length) {
      const nc = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(shl.length * 1.5)))); let y = 0;
      for (let i = 0; i < shl.length; i += nc) { let hm = 0; shl.slice(i, i + nc).forEach((s, j) => { A.set(s.n, [j * cw, y]); hm = Math.max(hm, sz.get(s.n).h); }); y += hm + GY + 10; }
      py0 = y + 100;
    }
    let px = 0, py = py0, rh = 0;
    for (const g of placed) {
      if (px > 0 && px + g.W > rowW) { px = 0; py += rh + 90; rh = 0; }
      for (const [n, [lx, ly]] of g.local) A.set(n, [px + lx, py + ly]);
      for (const [k, pts] of g.wp) wp.set(k, pts.map(([x, y]) => [px + x, py + y]));
      px += g.W + 80; rh = Math.max(rh, g.H);
    }
    return { A, wp };
  };
  /* full: every scene gets its tidy place again; otherwise the places stay and a new scene goes next to the scene that leads to it */
  const relayout = full => {
    computeShared();
    if (full || !auto.size) { const r = tidy(); auto = r.A; WP = r.wp; }
    POS = new Map(); EDG = [];
    for (const s of D.scenes) { const q = sizeOf(s), m = manual.get(s.n) || auto.get(s.n); if (m) { q.x = m[0]; q.y = m[1]; } POS.set(s.n, q); }
    for (const s of D.scenes) {
      for (const r of s.r) if ((r.k === 'jump' || r.k === 'call') && r.g && r.g !== s.n && POS.has(r.g)) EDG.push({ a: s.n, b: r.g, kind: r.k, row: r });
      if (s.fall && s.fall !== s.n && POS.has(s.fall)) EDG.push({ a: s.n, b: s.fall, kind: 'fall', row: null });
    }
    for (const e of EDG) e.hub = SHARED.has(e.a) || SHARED.has(e.b);   // arrows of shared scenes only show while one end is selected (or "Show arrows")
    for (const s of D.scenes) {
      if (manual.has(s.n) || auto.has(s.n)) continue;
      const q = POS.get(s.n), e = EDG.find(x => x.b === s.n), src = e && POS.get(e.a);
      let x = src ? src.x + SW + GX : 0, y = src ? src.y : 0;
      if (!src) for (const o of POS.values()) y = Math.max(y, o.y + o.h + 60);
      const clash = () => { for (const [n, o] of POS) if (n !== s.n && (auto.has(n) || manual.has(n)) && x < o.x + SW + 20 && x + SW + 20 > o.x && y < o.y + o.h + 20 && y + q.h + 20 > o.y) return true; return false; };
      for (let i = 0; i < 400 && clash(); i++) y += 60;
      q.x = x; q.y = y; auto.set(s.n, [x, y]);
    }
    const key = [...labelSet()].join('\n'); if (key !== dlKey) { dlKey = key; dl.replaceChildren(...[...labelSet()].map(n => h('option', { value: n }))); }
  };
  const TAGS = { choice: '›', branch: 'if', jump: 'jump', call: 'call', return: 'end', python: '$', stage: '·', menu: 'menu', if: '', while: 'while' };
  const rowEl = (s, r) => {
    const pad = 8 + Math.min(r.d, 6) * 10;
    let body;
    if (r.k === 'say') body = [r.w ? h('b', {}, charName(r.w) + ': ') : null, r.t];
    else if (r.k === 'jump' || r.k === 'call') body = r.g ? (SHARED.has(r.g) ? [h('span', { class: 'fx' }, 'ƒ'), ' ' + r.g] : r.g) : '(computed) ' + r.t;
    else if (r.k === 'choice') body = r.t;
    else if (r.k === 'branch') body = r.t === 'True' ? 'else' : r.t;
    else if (r.k === 'if') body = 'branch';
    else body = r.t || '';
    const full = r.k === 'say' ? (r.w ? charName(r.w) + ': ' : '') + r.t : r.k === 'jump' || r.k === 'call' ? r.k + ' ' + (r.g || r.t) : r.t;
    return h('div', { class: `mrow k-${r.k}${r.h ? ' off' : ''}${edited.has(r.key) ? ' edited' : ''}${st.sel && st.sel.key === r.key && st.sel.s === s.n ? ' sel' : ''}`, 'data-key': r.key, style: `padding-left:${pad}px`, title: trunc(full, 300),
      onclick: e => clickScene(e, s, r.key) }, TAGS[r.k] ? h('span', { class: 'tag' }, TAGS[r.k]) : null, h('span', { class: 'txt' }, body),
      (r.k === 'jump' || r.k === 'call') && r.g && SHARED.has(r.g) ? h('button', { class: 'goref', type: 'button', title: 'Show the shared scene ' + r.g, 'aria-label': 'Show ' + r.g, onpointerdown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); if (suppress) return; st.sel = { s: r.g, key: null }; focusOn(r.g); select(); } }, '↗') : null);
  };
  const isUser = n => !!(st.sel && SHARED.has(st.sel.s) && USERS.get(st.sel.s).has(n));
  const sceneEl = (s, q, lod) => {
    const nl = s.r.filter(r => r.k === 'say').length;
    const head = h('div', { class: 'mh', onpointerdown: e => beginBox(e, s), onclick: e => clickScene(e, s, null) }, h('b', {}, SHARED.has(s.n) ? [h('span', { class: 'fx' }, 'ƒ'), ' '] : null, s.n), h('small', {}, `${nl} line${nl === 1 ? '' : 's'}${SHARED.has(s.n) ? ' · used by ' + USERS.get(s.n).size : ''}`));
    const open = st.open.has(s.n);
    const tail = lod ? null : q.more ? h('div', { class: 'mrow more', onclick: () => { if (suppress) return; toggleOpen(s.n, true); } }, `+ ${q.more} more…`)
      : open && q.extra ? h('div', { class: 'mrow more', onclick: () => { if (suppress) return; toggleOpen(s.n, false); } }, 'Show fewer') : null;
    return h('div', { class: 'mscene' + (st.sel && st.sel.s === s.n ? ' sel' : '') + (s.new ? ' new' : '') + (SHARED.has(s.n) ? ' shared' : '') + (isUser(s.n) ? ' usr' : '') + (lod ? ' lod' : '') + (st.multi.has(s.n) ? ' multi' : '') + (hitSet.has(s.n) ? ' hit' : ''), 'data-scene': s.n, style: `left:${q.x}px;top:${q.y}px;width:${SW}px;height:${q.h}px` }, head, lod ? null : q.rows.map(r => rowEl(s, r)), tail);
  };
  const cv = h('canvas', { id: 'modedges' });
  const cx2 = cv.getContext('2d');
  const canvas = h('div', { id: 'modcanvas' });
  const view = h('div', { id: 'modview' }, cv, canvas);
  const els = new Map(); let curLod = 0, raf = 0, cols = null;
  const colors = () => { if (cols && Date.now() - cols.t < 800) return cols; const cs = getComputedStyle(root), v = n => cs.getPropertyValue(n).trim(); return (cols = { t: Date.now(), muted: v('--muted') || '#888', accent: v('--accent') || '#d0382a', surface: v('--surface2') || '#ddd', line: v('--line') || '#bbb' }); };
  /* where an arrow goes: from its line in the box to the title of the other box, through the lane that was kept for it (a lane is only
     used while both boxes are where the tidy layout put them) */
  const edgePts = e => {
    const a = POS.get(e.a), b = POS.get(e.b);
    const sx = a.x + SW, sy = e.row ? a.y + HH + (a.idx.has(e.row) ? a.idx.get(e.row) : a.rows.length) * RH + RH / 2 : a.y + a.h - 8, tx = b.x, ty = b.y + HH / 2;
    const mv = boxDrag && boxDrag.moved ? boxDrag.names : null;
    const w = !manual.has(e.a) && !manual.has(e.b) && !(mv && (mv.has(e.a) || mv.has(e.b))) ? WP.get(e.a + '\n' + e.b) : null;
    return w ? [[sx, sy], ...w, [tx, ty]] : [[sx, sy], [tx, ty]];
  };
  /* the arrows (and, far out, the boxes) of what is in view */
  const drawEdges = () => {
    const W = view.clientWidth, Hh = view.clientHeight, dpr = window.devicePixelRatio || 1, k = st.k;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
    const c = cx2, col = colors();
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
    c.setTransform(dpr * k, 0, 0, dpr * k, dpr * st.x, dpr * st.y);
    const vx0 = -st.x / k, vy0 = -st.y / k, vx1 = vx0 + W / k, vy1 = vy0 + Hh / k;
    if (curLod === 2) {
      c.strokeStyle = col.line; c.lineWidth = 1 / k;
      for (const [n, q] of POS) { if (q.x > vx1 || q.x + SW < vx0 || q.y > vy1 || q.y + q.h < vy0) continue; c.fillStyle = (st.sel && st.sel.s === n) || st.multi.has(n) || isUser(n) || hitSet.has(n) ? col.accent : col.surface; c.fillRect(q.x, q.y, SW, q.h); c.strokeRect(q.x, q.y, SW, q.h); }
    }
    const hot = [];
    const one = (e, isHot) => {
      const pts = edgePts(e); let x0 = 1e12, x1 = -1e12, y0 = 1e12, y1 = -1e12;
      for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      if (x1 + 60 < vx0 || x0 - 60 > vx1 || y1 < vy0 || y0 > vy1) return;
      const isSel = st.sel && (st.sel.s === e.a || st.sel.s === e.b);
      if (e.hub && (!isSel || (SHARED.has(st.sel.s) && !st.refs))) return;
      if (!isHot && isSel) { hot.push(e); return; }
      c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) { const A = pts[i - 1], B = pts[i], dx = B[0] > A[0] + 80 ? (B[0] - A[0]) / 2 : 60; c.bezierCurveTo(A[0] + dx, A[1], B[0] - dx, B[1], B[0], B[1]); }
      c.strokeStyle = isHot ? col.accent : col.muted; c.globalAlpha = isHot ? 1 : curLod === 2 ? 0.16 : e.kind === 'jump' ? 0.6 : 0.4; c.lineWidth = (isHot ? 2.4 : 1.6) / Math.min(k, 1);
      c.setLineDash(e.kind === 'call' ? [8 / k, 5 / k] : e.kind === 'fall' ? [2 / k, 5 / k] : []); c.stroke(); c.setLineDash([]);
      const [tx, ty] = pts[pts.length - 1], ah = 9 / Math.max(k, 0.3); c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx - ah, ty - ah * 0.45); c.lineTo(tx - ah, ty + ah * 0.45); c.closePath(); c.fillStyle = c.strokeStyle; c.fill();
    };
    for (const e of EDG) one(e, false);
    for (const e of hot) one(e, true);
    c.globalAlpha = 1;
  };
  /* make (and drop) the page elements of the scenes near the view, then draw the arrows */
  const renderView = force => {
    const W = view.clientWidth, Hh = view.clientHeight, k = st.k, lod = k < 0.1 ? 2 : k < 0.28 ? 1 : 0;
    if (force || lod !== curLod) { els.forEach(e => e.remove()); els.clear(); curLod = lod; }
    if (lod < 2) {
      const M = 300 / k, x0 = -st.x / k - M, y0 = -st.y / k - M, x1 = (W - st.x) / k + M, y1 = (Hh - st.y) / k + M;
      for (const s of D.scenes) {
        const q = POS.get(s.n), vis = q.x < x1 && q.x + SW > x0 && q.y < y1 && q.y + q.h > y0, have = els.get(s.n);
        if (vis && !have) { const el = sceneEl(s, q, lod); els.set(s.n, el); canvas.append(el); } else if (!vis && have) { have.remove(); els.delete(s.n); }
      }
    }
    drawEdges();
  };
  const queueRender = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderView(); }); };
  const queueEdges = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawEdges(); }); };
  const draw = full => {
    relayout(!!full); edited = new Set(P.map(p => p.key));
    renderView(true); drawPanel(); drawBar();
  };
  /* "+ N more" / "Show fewer": the boxes are laid out again, and the box you pressed stays where it is on the screen */
  const toggleOpen = (n, on) => {
    const q0 = POS.get(n); if (!q0) return;
    const sx = q0.x * st.k + st.x, sy = q0.y * st.k + st.y;
    on ? st.open.add(n) : st.open.delete(n);
    relayout(true);
    const q = POS.get(n); st.x = sx - q.x * st.k; st.y = sy - q.y * st.k;
    canvas.style.transform = `translate(${st.x}px,${st.y}px) scale(${st.k})`; renderView(true); drawBar();
  };
  const select = () => {
    $$('.mscene.sel, .mrow.sel', canvas).forEach(e => e.classList.remove('sel'));
    const se = st.sel && els.get(st.sel.s);
    if (se) { se.classList.add('sel'); if (st.sel.key) { const re = [...se.querySelectorAll('.mrow')].find(e => e.dataset.key === st.sel.key); re && re.classList.add('sel'); } }
    els.forEach((el, n) => el.classList.toggle('usr', isUser(n)));
    drawEdges(); drawPanel();
  };
  const applyView = () => { canvas.style.transform = `translate(${st.x}px,${st.y}px) scale(${st.k})`; const gs = GRID * st.k; view.style.backgroundImage = gs < 6 ? 'none' : ''; view.style.backgroundSize = `${gs}px ${gs}px`; view.style.backgroundPosition = `${st.x}px ${st.y}px`; queueRender(); };
  const zoomAt = (f, cx, cy) => { const k = Math.min(2.5, Math.max(0.02, st.k * f)), r = k / st.k; st.x = cx - (cx - st.x) * r; st.y = cy - (cy - st.y) * r; st.k = k; applyView(); };
  const bounds = () => { let x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12; for (const q of POS.values()) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + SW); y1 = Math.max(y1, q.y + q.h); } return { x0, y0, x1, y1 }; };
  const fit = () => { const b = view.getBoundingClientRect(), r = bounds(); st.k = Math.max(0.02, Math.min(1, (b.width - 40) / (r.x1 - r.x0), (b.height - 40) / (r.y1 - r.y0))); st.x = 20 - r.x0 * st.k; st.y = 20 - r.y0 * st.k; applyView(); };
  const focusOn = name => { const q = POS.get(name); if (!q) return; const b = view.getBoundingClientRect(); st.k = Math.max(st.k, 0.8); st.x = b.width / 2 - (q.x + SW / 2) * st.k; st.y = b.height / 3 - (q.y + 20) * st.k;   /* was clamped to at least 10, which left any scene far down the picture out of view */ applyView(); renderView(); };
  // move around: drag, wheel, pinch. A box is moved by dragging its title (all selected boxes move together). A rectangle drawn with
  // Shift held (or in Select mode) selects the boxes it touches; Shift/Ctrl-click on a box adds it to or takes it out of the selection.
  let lastP = [0, 0]; const pts = new Map(); let drag = null, pinch = null, boxDrag = null, marq = null, saveT = 0;
  const saveFlowPos = () => { clearTimeout(saveT); saveT = setTimeout(async () => { try { const g = await S.gal(gid); g.game.flowpos = Object.fromEntries(manual); await saveGallery(g); } catch (e) { } }, 500); };
  const paintMulti = () => { els.forEach((el, n) => el.classList.toggle('multi', st.multi.has(n))); drawEdges(); drawPanel(); drawBar(); };
  const toggleMulti = n => { if (st.multi.has(n)) st.multi.delete(n); else st.multi.add(n); paintMulti(); };
  const withKey = e => e.shiftKey || e.ctrlKey || e.metaKey || st.selMode;
  const clickScene = (e, s, key) => {
    if (suppress) return;
    if (withKey(e)) { if (!st.multi.size && st.sel && !st.sel.auto && st.sel.s !== s.n) st.multi.add(st.sel.s); toggleMulti(s.n); return; }
    if (st.multi.size) { st.multi.clear(); els.forEach(el => el.classList.remove('multi')); }
    st.sel = { s: s.n, key }; select();
  };
  function beginBox(e, s) {
    if (e.button > 0) return; e.stopPropagation();
    const names = st.multi.has(s.n) && st.multi.size > 1 ? [...st.multi] : [s.n];
    boxDrag = { x: e.clientX, y: e.clientY, moved: false, names: new Set(names), from: names.map(n => { const q = POS.get(n); return [n, q.x, q.y]; }), lead: names.indexOf(s.n) }; suppress = false;
  }
  view.addEventListener('pointerdown', e => {
    if (e.button === 1) e.preventDefault(); else if (e.button > 0) return;   // left: select, middle: move around
    pts.set(e.pointerId, [e.clientX, e.clientY]); suppress = false;
    if (pts.size === 2) { if (marq) { marq.el && marq.el.remove(); marq = null; } const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 }; drag = null; return; }
    if (e.button === 0 && (e.pointerType !== 'touch' || st.selMode)) { const r = view.getBoundingClientRect(); marq = { x: e.clientX - r.left, y: e.clientY - r.top, add: e.shiftKey || e.ctrlKey || e.metaKey, moved: false, el: null }; return; }
    if (e.button === 1) view.classList.add('panning'); drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY };
  });
  const onMove = e => {
    lastP = [e.clientX, e.clientY];
    if (boxDrag) {
      const dx = e.clientX - boxDrag.x, dy = e.clientY - boxDrag.y;
      if (!boxDrag.moved && Math.hypot(dx, dy) > 5) { boxDrag.moved = true; suppress = true; }
      if (boxDrag.moved) { const l0 = boxDrag.from[boxDrag.lead], ddx = snapV(l0[1] + dx / st.k, e.shiftKey) - l0[1], ddy = snapV(l0[2] + dy / st.k, e.shiftKey) - l0[2]; for (const [n, ox, oy] of boxDrag.from) { const q = POS.get(n), el = els.get(n); q.x = ox + ddx; q.y = oy + ddy; if (el) { el.style.left = q.x + 'px'; el.style.top = q.y + 'px'; } } queueEdges(); }
      return;
    }
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (marq) {
      const r = view.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (!marq.moved && Math.hypot(mx - marq.x, my - marq.y) > 5) { marq.moved = true; suppress = true; marq.el = h('div', { class: 'mmarq' }); view.append(marq.el); }
      if (marq.el) { marq.el.style.left = Math.min(mx, marq.x) + 'px'; marq.el.style.top = Math.min(my, marq.y) + 'px'; marq.el.style.width = Math.abs(mx - marq.x) + 'px'; marq.el.style.height = Math.abs(my - marq.y) + 'px'; marq.mx = mx; marq.my = my; }
      return;
    }
    if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, r = view.getBoundingClientRect(); zoomAt(d / pinch.d, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); pinch.d = d; suppress = true; }
    else if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (suppress || Math.hypot(dx, dy) > 5) { suppress = true; st.x += e.clientX - drag.lx; st.y += e.clientY - drag.ly; applyView(); } drag.lx = e.clientX; drag.ly = e.clientY; }   // (moves by what the pointer moved since last time, so zooming while moving works)
  };
  const onUp = e => {
    if (boxDrag) {
      if (boxDrag.moved) { for (const [n] of boxDrag.from) { const q = POS.get(n); manual.set(n, [q.x, q.y]); } saveFlowPos(); queueEdges(); }
      boxDrag = null; setTimeout(() => { suppress = false; }, 0); return;
    }
    if (marq && pts.has(e.pointerId)) {
      if (marq.moved && marq.mx != null) {
        const x0 = (Math.min(marq.x, marq.mx) - st.x) / st.k, x1 = (Math.max(marq.x, marq.mx) - st.x) / st.k, y0 = (Math.min(marq.y, marq.my) - st.y) / st.k, y1 = (Math.max(marq.y, marq.my) - st.y) / st.k;
        if (!marq.add) st.multi.clear();
        for (const [n, q] of POS) if (q.x < x1 && q.x + SW > x0 && q.y < y1 && q.y + q.h > y0) st.multi.add(n);
      } else if (!marq.add && st.multi.size) st.multi.clear();
      marq.el && marq.el.remove(); marq = null; paintMulti();
    }
    pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { drag = null; view.classList.remove('panning'); setTimeout(() => { suppress = false; }, 0); }
  };
  window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
  view.addEventListener('wheel', e => { e.preventDefault(); const r = view.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    if (boxDrag && boxDrag.moved) { boxDrag.x = lastP[0]; boxDrag.y = lastP[1]; boxDrag.from = boxDrag.from.map(([n]) => { const q = POS.get(n); return [n, q.x, q.y]; }); }   // zooming while moving boxes: carry on from here
  }, { passive: false });
  view.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
  // far out the boxes are only drawn: a tap on one zooms in on it (with Shift, or in Select mode, it selects it)
  view.addEventListener('click', e => {
    if (suppress || curLod !== 2) return;
    const r = view.getBoundingClientRect(), wx = (e.clientX - r.left - st.x) / st.k, wy = (e.clientY - r.top - st.y) / st.k;
    for (const [n, q] of POS) if (wx >= q.x && wx <= q.x + SW && wy >= q.y && wy <= q.y + q.h) {
      if (withKey(e)) { toggleMulti(n); return; }
      st.multi.clear(); st.sel = { s: n, key: null }; st.k = 0.8; focusOn(n); select(); return;
    }
  });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => queueRender()) : null; ro && ro.observe(view);

  /* ---- changes: kept in the mod, put to work in the running game ---- */
  const localApply = p => {
    const r = rowByKey(p.key); if (!r) return;
    if (p.op === 'say') { r.t = p.text; if ('who' in p) r.w = p.who || null; }
    else if (p.op === 'go') r.g = p.to;
    else if (p.op === 'choice') { if ('text' in p) r.t = p.text; if ('hide' in p) { r.h = !!p.hide; r.c = p.hide ? 'False' : (p.cond0 || 'True'); } }
  };
  if (legacy) {
    // Reapply saved simple patches to the canvas on reopen. Structural chart
    // drafts stay in P and are opened by the same Charts editor as modern games.
    P.filter(p=>['say','go','choice'].includes(p.op)).forEach(localApply);
    for (const p of P) if (p.op === 'scene' && !D.scenes.some(x=>x.n===p.name)) {
      const r=(p.lines||[]).map((l,i)=>({k:'say',key:'_draft:'+p.name+':'+i+':say',t:l.text,w:l.who||'',d:0}));
      if(p.to)r.push({k:'jump',key:'_draft:'+p.name+':end:jump',g:p.to,d:0});
      D.scenes.push({n:p.name,f:'Draft scene (not yet applied)',r,l:0,new:true});
    }
    D.labels=D.scenes.map(x=>x.n);
  }
  /* structural: the game's script is read again (new scenes and stand-in labels); live: the patches go straight into the running story */
  const commit = async (structural, live = []) => {
    busy('Saving…');
    try {
      if (legacy) {
        // Always draft first. Never hot-reload or call gamePy in legacy safe
        // boot: the runtime has no Python eval bridge and gameplay works now.
        await legacy.saveDraft(P);
        // Rebuild the visible scene rows from the original AST plus the
        // remaining drafts. An Undo/Take back all must restore the original
        // text as well as deleting the patch; never mutate the cached AST.
        D = JSON.parse(JSON.stringify(legacy.D));
        P.filter(p => ['say','go','choice'].includes(p.op)).forEach(localApply);
        for (const p of P) if (p.op === 'scene' && !D.scenes.some(x => x.n === p.name)) {
          const r = (p.lines || []).map((l, i) => ({ k:'say', key:'_draft:'+p.name+':'+i+':say', t:l.text, w:l.who || '', d:0 }));
          if (p.to) r.push({k:'jump',key:'_draft:'+p.name+':end:jump',g:p.to,d:0});
          D.scenes.push({n:p.name,f:'Draft scene (not yet applied)',r,l:0,new:true});
        }
        // Remove uncommitted synthetic scenes when their draft is undone.
        D.scenes = D.scenes.filter(x => !x.new || P.some(p => p.op === 'scene' && p.name === x.n));
        D.labels = D.scenes.map(x => x.n);
        toast(legacy.offline ? 'Offline draft saved · not applied to the game.' : 'Saved draft · not applied to the running game.', 2000);
      } else {
      const text = await flowSave(gid, P);
      if (structural) {
        busy('Applying to the game…');
        const ok = await fastReload(gid, [{ p: FLOW_FILE, text }]);
        if (!ok) toast('Saved in the “Story edits” mod. It shows from the next start of the game.', 5000);
        const d = await read(); if (d && d.scenes) D = d;
      } else {
        const bad = await gamePy(FLOW_PY + `\nresult = _tkbflow("apply", ${pyLit(live)})`, 20000);
        if (bad === null) toast('Saved in the “Story edits” mod. It shows from the next start of the game.', 4000);
        else if (bad.length) toast('Some of it could not be applied: ' + bad[0], 5000);
        live.forEach(localApply);
      }
      }
    } catch (e) { toast('That change could not be saved: ' + (e.message || e), 5000); }
    busy(null); draw();
  };
  const upsert = p => {
    const i = p.op === 'addchoice' || p.op === 'scene' ? -1 : P.findIndex(x => x.op === p.op && x.key === p.key);
    if (i >= 0) { p.id = P[i].id; P[i] = p; } else { p.id = ++nid; P.push(p); }
    return p;
  };
  const takeBack = async p => {
    const inv = flowInverse(p), structural = flowStructural(p) || !inv;
    P = P.filter(x => x !== p && !(p.op === 'scene' && x.to === p.name));
    await commit(structural, structural ? [] : [inv]);
  };
  const sayEdit = (r, text, who) => { const old = patchFor('say', r.key); const q = upsert({ op: 'say', key: r.key, text, who: who || '', was: old ? old.was : { t: r.t, w: r.w } }); return commit(false, [q]); };
  const goEdit = (r, to) => {
    if (!labelSet().has(to)) return toast(`There is no scene called “${to}”.`, 3500);
    const old = patchFor('go', r.key); const q = upsert({ op: 'go', key: r.key, to, was: old ? old.was : { g: r.g } }); return commit(false, [q]);
  };
  const choiceEdit = async (r, fields) => {
    const old = patchFor('choice', r.key), base = old ? { ...old } : { op: 'choice', key: r.key, was: { t: r.t, h: r.h, c: r.c } };
    Object.assign(base, fields); if ('hide' in fields) base.cond0 = base.was.c;
    const q = upsert(base); if (q.to) q.lab = '_tkbflow_g' + q.id;
    return commit(flowStructural(q), [q]);
  };
  /* the jump that ends a choice's lines (rewire that), if it has one */
  const choiceJump = (s, c) => { let last = null; for (let i = s.r.indexOf(c) + 1; i < s.r.length && s.r[i].d > c.d; i++) if (s.r[i].d === c.d + 1) last = s.r[i]; return last && last.k === 'jump' && last.g ? last : null; };
  const nameOk = n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !n.startsWith('_') && !labelSet().has(n);

  /* ---- dialogs ---- */
  const modal = (title, ...kids) => {
    $('#modmodal') && $('#modmodal').remove();
    const m = h('div', { id: 'modmodal', onclick: e => { if (e.target === m) m.remove(); } }, h('div', { class: 'box stack' }, h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('b', {}, title), h('button', { class: 'btn small ghost', 'aria-label': 'Close', onclick: () => m.remove() }, icon('x'))), ...kids));
    root.append(m); return m;
  };
  const labelInput = (v, ph) => h('input', { class: 'text', list: 'modlabels', autocomplete: 'off', spellcheck: 'false', placeholder: ph || 'Scene name', value: v || '', 'aria-label': ph || 'Scene name' });
  const whoSelect = v => { const sel = h('select', { class: 'text', 'aria-label': 'Who speaks' }, h('option', { value: '' }, 'Narrator (no name)'), D.chars.map(c => h('option', { value: c[0] }, `${c[1]} (${c[0]})`))); if (v && !D.chars.some(c => c[0] === v)) sel.append(h('option', { value: v }, v)); sel.value = v || ''; return sel; };
  const area = (v, ph) => h('textarea', { class: 'text', rows: '3', style: 'height:auto;padding:10px;resize:vertical', spellcheck: 'true', placeholder: ph || '', value: v || '' });
  const newScene = (name0, back, done) => {
    const name = h('input', { class: 'text', id: 'ns-name', autocomplete: 'off', spellcheck: 'false', placeholder: 'Name (letters, numbers, _)', value: name0 || '', 'aria-label': 'Scene name' });
    const lines = h('div', { class: 'stack' }), to = labelInput(back || '', 'Then go on to… (empty: the story ends)');
    const addLine = (who, text) => { const w = whoSelect(who), t = area(text, 'What is said'); const row = h('div', { class: 'stack mline', style: 'gap:6px' }, w, t, h('button', { class: 'btn small ghost', style: 'justify-self:start', onclick: () => row.remove() }, icon('trash'), 'Remove this line')); row._get = () => ({ who: w.value, text: t.value }); lines.append(row); };
    addLine('', 'New scene.');
    const save = h('button', { class: 'btn primary', id: 'ns-save', onclick: () => {
      const n = name.value.trim(); if (!nameOk(n)) return toast(labelSet().has(n) ? `There is already a scene called “${n}”.` : 'Use letters, numbers and _ for the name (it cannot start with _).', 4000);
      const tg = to.value.trim(); if (tg && !labelSet().has(tg)) return toast(`There is no scene called “${tg}” to go on to.`, 3500);
      const ls = [...lines.children].map(x => x._get()).filter(l => l.text.trim()); const p = { op: 'scene', name: n, lines: ls, to: tg };
      p.id = ++nid; P.push(p); $('#modmodal') && $('#modmodal').remove(); if (done) done(p); else commit(true).then(() => { st.sel = { s: n, key: null }; draw(); focusOn(n); select(); });
    } }, 'Make the scene');
    modal('New scene', h('p', { class: 'hint', style: 'margin:0' }, 'A scene is a part of the story with its own lines. Add choices or jumps that lead to it afterwards.'), name, lines,
      h('button', { class: 'btn small', onclick: () => addLine('', '') }, icon('plus'), 'Add a line'), h('label', { class: 'hint' }, 'When it ends'), to, save);
  };
  const addChoice = (s, mr) => {
    const text = h('input', { class: 'text', id: 'ac-text', autocomplete: 'off', placeholder: 'What the player reads', 'aria-label': 'Choice text' });
    const to = labelInput('', 'Where it leads (a scene name)'), note = h('p', { class: 'hint', style: 'margin:0' });
    to.addEventListener('input', () => { const v = to.value.trim(); note.textContent = !v || labelSet().has(v) ? '' : nameOk(v) ? `“${v}” does not exist yet: a new scene with that name is made, and it comes back to “${s.n}” when it ends.` : 'A scene name uses letters, numbers and _ only.'; });
    const save = h('button', { class: 'btn primary', id: 'ac-save', onclick: async () => {
      const t = text.value.trim(), v = to.value.trim(); if (!t) return toast('Write what the choice says.', 3000); if (!v) return toast('Choose where it leads.', 3000);
      const make = !labelSet().has(v); if (make && !nameOk(v)) return toast('Use letters, numbers and _ for a new scene\'s name.', 3500);
      if (make) P.push({ op: 'scene', id: ++nid, name: v, lines: [{ who: '', text: 'New scene.' }], to: s.n });
      const p = { op: 'addchoice', key: mr.key, text: t, to: v, cond: '' }; p.id = ++nid; p.lab = '_tkbflow_g' + p.id; P.push(p);
      $('#modmodal') && $('#modmodal').remove(); await commit(true); st.sel = { s: s.n, key: mr.key }; draw(); select();
    } }, 'Add the choice');
    modal('Add a choice', text, to, note, save);
  };
  const editsList = () => {
    const rows = P.map(p => {
      const r = p.key ? rowByKey(p.key) : null;
      const d = p.op === 'say' ? `Dialogue changed: “${trunc(p.text, 40)}”` : p.op === 'go' ? `Arrow changed: ${p.was && p.was.g ? p.was.g : '?'} → ${p.to}`
        : p.op === 'choice' ? `Choice “${trunc(r ? r.t : p.text || '', 30)}”${p.hide ? ' hidden' : ''}${p.text != null && p.was && p.text !== p.was.t ? ` renamed “${trunc(p.text, 30)}”` : ''}${p.to ? ' → ' + p.to : ''}`
        : p.op === 'addchoice' ? `Choice added: “${trunc(p.text, 30)}” → ${p.to}` : p.op === 'chart' ? (p.ov ? `Scene changed with nodes: ${p.name}` : `Chart: ${p.name}`) : `New scene: ${p.name}`;
      return h('div', { class: 'row', style: 'flex-wrap:nowrap;justify-content:space-between;gap:8px' }, h('span', { style: 'min-width:0' }, d), h('button', { class: 'btn small ghost', onclick: async () => { $('#modmodal') && $('#modmodal').remove(); await takeBack(p); } }, icon('undo'), 'Take back'));
    });
    modal(`Your changes (${P.length})`, P.length ? h('div', { class: 'stack', id: 'mod-edits' }, rows) : h('p', { class: 'hint' }, 'No changes yet.'),
      P.length ? h('button', { class: 'btn danger', onclick: async () => { if (!confirm('Take back every change?')) return; P = []; $('#modmodal') && $('#modmodal').remove(); await commit(true); } }, icon('trash'), 'Take back all') : null,
      h('p', { class: 'hint', style: 'margin:0' }, legacy ? 'These changes are local drafts only. Use Apply on next launch to create the Story edits mod.' : 'All of this is in the “Story edits” mod on the game\'s page. Switch it off there to play the game as it was.'));
  };

  /* ---- the panel under the picture ---- */
  const scenesLeadingTo = n => D.scenes.filter(s => s.n !== n && (s.fall === n || s.r.some(r => (r.k === 'jump' || r.k === 'call') && r.g === n))).map(s => s.n);
  const undoBtn = p => p ? h('button', { class: 'btn small ghost', onclick: () => takeBack(p) }, icon('undo'), 'Take back') : null;
  const setShared = async (n, v) => {
    sharedOv.set(n, v);
    try { const g = await S.gal(gid); g.game.flowshared = Object.fromEntries(sharedOv); await saveGallery(g); } catch (e) { }
    draw(true); st.sel = { s: n, key: null }; focusOn(n); select();
  };
  const sharedNote = n => { const us = [...USERS.get(n)]; return h('div', { class: 'stack', id: 'mp-shared' },
    h('p', { class: 'hint', style: 'margin:0' }, `A shared scene: ${us.length} scenes lead to it, so no arrows are drawn to it. The scenes that use it are outlined, and each one has a ƒ link to it. Used by:`),
    h('div', { class: 'row' }, us.slice(0, 14).map(u => h('button', { class: 'btn small', onclick: () => { st.sel = { s: u, key: null }; focusOn(u); select(); } }, u)), us.length > 14 ? h('span', { class: 'hint' }, `and ${us.length - 14} more`) : null)); };
  const sharedRow = n => SHARED.has(n)
    ? h('div', { class: 'row' }, h('button', { class: 'btn small', id: 'mp-refs', onclick: () => { st.refs = !st.refs; drawEdges(); drawPanel(); } }, st.refs ? 'Hide the arrows' : 'Show the arrows'), h('button', { class: 'btn small', id: 'mp-unshare', onclick: () => setShared(n, false) }, 'Draw it as a normal scene'))
    : h('div', { class: 'row' }, h('button', { class: 'btn small', id: 'mp-share', onclick: () => setShared(n, true) }, 'Make it a shared scene'));
  const gotoBtn = n => h('button', { class: 'btn small', onclick: () => { st.sel = { s: n, key: null }; focusOn(n); select(); } }, icon('move'), `Show ${n}`);
  function drawPanel() {
    panel.replaceChildren();
    if (st.multi.size > 1) {
      return panel.append(h('div', { class: 'stack', id: 'mp-multi' }, h('b', {}, `${st.multi.size} scenes selected`),
        h('p', { class: 'hint', style: 'margin:0' }, 'Drag the title of any selected box to move them all together (hold Shift to move without snapping to the grid). Ctrl-click a box to add or take out one; Esc clears the selection.'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', id: 'mp-multi-clear', onclick: () => { st.multi.clear(); paintMulti(); } }, 'Clear selection'),
          h('button', { class: 'btn small', id: 'mp-multi-tidy', onclick: () => { for (const n of st.multi) { manual.delete(n); const a = auto.get(n), q = POS.get(n), el = els.get(n); if (a && q) { q.x = a[0]; q.y = a[1]; if (el) { el.style.left = q.x + 'px'; el.style.top = q.y + 'px'; } } } saveFlowPos(); drawEdges(); } }, 'Put them back in their tidy places'))));
    }
    const sel = st.sel;
    if (!sel) return panel.append(h('p', { class: 'hint' }, 'Tap a scene or a line to see it here and change it. Drag a rectangle with the left button to select several boxes; hold the middle button (or use two fingers) to move around, and scroll to zoom. Boxes snap to a grid: hold Shift while dragging to move them freely. Arrows show where the story goes next. ' + (legacy ? 'Changes are saved as drafts until you apply them explicitly.' : 'Everything you change is kept in the “Story edits” mod.')));
    const s = D.scenes.find(x => x.n === sel.s); if (!s) return;
    const r = sel.key ? s.r.find(x => x.key === sel.key) : null;
    if (!r) {
      const from = scenesLeadingTo(s.n), nl = s.r.filter(x => x.k === 'say').length;
      return panel.append(h('div', { class: 'stack' }, h('b', {}, `Scene “${s.n}”`), SHARED.has(s.n) ? sharedNote(s.n) : null, h('p', { class: 'hint' }, `${nl} line${nl === 1 ? '' : 's'}, in ${s.f}${s.new ? ' (made here)' : ''}. ${from.length ? 'Reached from: ' + from.slice(0, 6).join(', ') + (from.length > 6 ? '…' : '') + '.' : 'Nothing leads here yet.'}`),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => newScene('', s.n) }, icon('plus'), 'New scene…'), h('button', { class: 'btn small', id: 'mp-play', onclick: () => playFrom(s.n) }, icon(legacy ? 'list' : 'play'), legacy ? 'Edit nodes' : 'Preview scene'), st.open.has(s.n) || s.r.length <= LIM ? null : h('button', { class: 'btn small', onclick: () => { toggleOpen(s.n, true); } }, 'Show all lines')), sharedRow(s.n)));
    }
    const pre = h('p', { class: 'hint', style: 'margin:0' }, `${s.n} · ${s.f} line ${r.l}`);
    if (r.k === 'say') {
      const old = patchFor('say', r.key), who = whoSelect(r.w), text = area(r.t, 'What is said');
      return panel.append(h('div', { class: 'stack', id: 'mp-say' }, pre, h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { style: 'flex:1;min-width:0' }, who)), text,
        h('p', { class: 'hint', style: 'margin:0' }, 'Text works as in the game\'s script: {i}…{/i}, [name] and so on.'),
        old ? h('p', { class: 'hint', style: 'margin:0' }, `Was: ${old.was.w ? charName(old.was.w) + ': ' : ''}“${trunc(old.was.t, 90)}”`) : null,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'mp-save', onclick: () => sayEdit(r, text.value, who.value) }, 'Save the line'), undoBtn(old))));
    }
    if (r.k === 'jump' || r.k === 'call') {
      const old = patchFor('go', r.key), to = labelInput(r.g || '', 'Scene it goes to');
      return panel.append(h('div', { class: 'stack', id: 'mp-go' }, pre, h('b', {}, r.k === 'jump' ? 'Goes to' : 'Plays, then comes back from'),
        r.g ? to : h('p', { class: 'hint' }, `It goes to a scene worked out while playing (${r.t}). Choose one to replace that.`), r.g ? null : to,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'mp-go-save', onclick: () => goEdit(r, to.value.trim()) }, 'Change where it goes'), r.g && labelSet().has(r.g) ? gotoBtn(r.g) : null, undoBtn(old))));
    }
    if (r.k === 'choice') {
      const old = patchFor('choice', r.key), cj = choiceJump(s, r), text = h('input', { class: 'text', id: 'mp-ctext', value: r.t, autocomplete: 'off', 'aria-label': 'Choice text' });
      const to = labelInput(cj ? cj.g : '', cj ? 'Where it leads' : 'Make it lead to… (replaces its own lines)');
      return panel.append(h('div', { class: 'stack', id: 'mp-choice' }, pre, h('b', {}, 'Choice'), text, h('b', {}, 'Leads to'), to,
        cj ? null : h('p', { class: 'hint', style: 'margin:0' }, 'This choice has no jump of its own: it carries on with the lines after the menu. Choosing a scene here makes it go there instead, and skips the choice\'s own lines.'),
        r.c && r.c !== 'True' && r.c !== 'False' ? h('p', { class: 'hint', style: 'margin:0' }, `Shown only if: ${r.c}`) : null,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'mp-csave', onclick: async () => {
          const t = text.value.trim() || r.t, v = to.value.trim(), f = {};
          if (t !== r.t) f.text = t;
          if (v && v !== (cj ? cj.g : '')) { if (!labelSet().has(v)) return toast(`There is no scene called “${v}”.`, 3500); if (cj) { if (Object.keys(f).length) await choiceEdit(r, f); return goEdit(cj, v); } f.to = v; }
          if (!Object.keys(f).length) return toast('Nothing changed.');
          return choiceEdit(r, f);
        } }, 'Save the choice'), h('button', { class: 'btn', id: 'mp-chide', onclick: () => choiceEdit(r, { hide: !r.h }) }, r.h ? 'Show this choice again' : 'Hide this choice'), undoBtn(old))));
    }
    if (r.k === 'menu') {
      const mine = s.r.filter(x => x.k === 'choice' && x.key.startsWith(r.key + '|'));
      return panel.append(h('div', { class: 'stack', id: 'mp-menu' }, pre, h('b', {}, 'Choice menu'), h('p', { class: 'hint', style: 'margin:0' }, mine.map(c => (c.h ? '(hidden) ' : '') + c.t).join(' · ')),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'mp-addchoice', onclick: () => addChoice(s, r) }, icon('plus'), 'Add a choice'))));
    }
    const info = r.k === 'branch' ? `Only if: ${r.t}` : r.k === 'python' ? `Code: ${r.t}` : r.k === 'stage' ? r.t : r.k === 'return' ? 'The story (or the scene that was called) ends here.' : r.k === 'if' ? 'A branch: the story goes one way or another.' : r.t;
    panel.append(h('div', { class: 'stack' }, pre, h('p', { style: 'margin:0;word-break:break-word' }, info), h('p', { class: 'hint', style: 'margin:0' }, 'This kind of line cannot be changed here.')));
  }
  const panel = h('div', { id: 'modpanel' });
  const find = h('input', { class: 'text', id: 'mod-find', type: 'search', list: 'modlabels', placeholder: 'Find a scene or a line', autocomplete: 'off', 'aria-label': 'Find a scene or a line' });
  /* search: every scene that matches is listed once (scene-name matches first, then by how many lines match), with a few of its lines;
     the scenes also light up on the picture. All the words typed have to be found. */
  const KINDS = [['all', 'Everything'], ['scene', 'Scene names'], ['say', 'Dialogue'], ['who', 'Who speaks'], ['choice', 'Choices'], ['go', 'Jumps & calls'], ['code', 'Code & conditions'], ['stage', 'Pictures & sounds']];
  const findKind = h('select', { class: 'text', id: 'mod-find-kind', 'aria-label': 'What to search', title: 'What to search in', style: 'width:auto', onchange: () => { runFind(); find.focus(); } }, KINDS.map(([v, t]) => h('option', { value: v }, t)));
  const rowText = (r, kind) => { switch (kind) {
    case 'say': return r.k === 'say' ? r.t : null;
    case 'who': return r.k === 'say' && r.w ? charName(r.w) + ' ' + r.w : null;
    case 'choice': return r.k === 'choice' || r.k === 'menu' ? r.t : null;
    case 'go': return (r.k === 'jump' || r.k === 'call') ? (r.g || r.t) : null;
    case 'code': return r.k === 'python' || r.k === 'branch' || r.k === 'if' || r.k === 'while' ? r.t : null;
    case 'stage': return r.k === 'stage' ? r.t : null;
    default: return (r.k === 'say' && r.w ? charName(r.w) + ' ' : '') + (r.t || '') + ' ' + (r.g || ''); } };
  const results = h('div', { id: 'modfind-results', hidden: true });
  const hitSet = new Set(); let hits = [], act = 0;
  const hideRes = () => { results.hidden = true; };
  const mark = (txt, terms) => { const low = txt.toLowerCase(), out = []; let i = 0;
    while (i < txt.length) { let best = -1, bl = 0; for (const w of terms) { const j = low.indexOf(w, i); if (j >= 0 && (best < 0 || j < best)) { best = j; bl = w.length; } }
      if (best < 0) { out.push(txt.slice(i)); break; } if (best > i) out.push(txt.slice(i, best)); out.push(h('mark', {}, txt.slice(best, best + bl))); i = best + bl; }
    return out; };
  const pick = x => {
    if (x.key) { const r = rowByKey(x.key), pq = POS.get(x.s); if (r && r.k === 'stage' && !st.stage) { st.stage = true; draw(true); } if (r && pq && !POS.get(x.s).idx.has(r)) toggleOpen(x.s, true); }
    st.sel = { s: x.s, key: x.key || null }; focusOn(x.s); select();
  };
  const paintHits = () => els.forEach((el, n) => el.classList.toggle('hit', hitSet.has(n)));
  const showRes = (terms, nLines) => {
    const r = find.getBoundingClientRect(); results.style.left = Math.max(8, Math.min(r.left, innerWidth - 400)) + 'px'; results.style.top = (r.bottom + 4) + 'px'; results.style.width = Math.min(innerWidth - 16, Math.max(380, r.width)) + 'px';
    const items = hits.slice(0, 40).map((x, i) => h('button', { type: 'button', class: 'fres' + (i === act ? ' act' : ''), onclick: () => { act = i; pick({ s: x.s, key: x.lines[0] ? x.lines[0].key : null }); hideRes(); } },
      h('b', {}, mark(x.s, terms), h('small', {}, x.lines.length ? ` · ${x.lines.length} match${x.lines.length === 1 ? '' : 'es'}` : ' · scene name')),
      ...x.lines.slice(0, 2).map(r => h('span', { class: 'fline', onclick: e => { e.stopPropagation(); act = i; pick({ s: x.s, key: r.key }); hideRes(); } }, mark(trunc((r.k === 'say' && r.w ? charName(r.w) + ': ' : '') + (r.t || r.g || ''), 90), terms)))));
    results.replaceChildren(h('div', { class: 'fhead' }, h('span', {}, `${hits.length} scene${hits.length === 1 ? '' : 's'}, ${nLines} line${nLines === 1 ? '' : 's'}`),
      hits.length > 1 ? h('button', { class: 'btn small', type: 'button', onclick: () => { st.multi = new Set(hitSet); hideRes(); paintMulti(); } }, 'Select them all') : null), ...items,
      hits.length > 40 ? h('p', { class: 'hint', style: 'margin:6px 10px' }, `and ${hits.length - 40} more scenes: type more of the word to narrow it down`) : null);
    results.hidden = false;
  };
  const runFind = () => {
    const q = find.value.trim().toLowerCase(); hitSet.clear(); hits = []; act = 0;
    if (!q) { hideRes(); paintHits(); drawEdges(); return; }
    const terms = [...new Set(q.split(/\s+/))]; let nLines = 0;
    for (const s of D.scenes) {
      const kind = findKind.value, nm = s.n.toLowerCase(), nameHit = (kind === 'all' || kind === 'scene') && terms.every(w => nm.includes(w)), lines = [];
      if (kind !== 'scene') for (const r of s.r) { if (kind === 'all' && !st.stage && r.k === 'stage') continue; const t0 = rowText(r, kind); if (t0 == null) continue; const t = t0.toLowerCase();
        if (terms.every(w => t.includes(w) || nm.includes(w)) && terms.some(w => t.includes(w))) lines.push(r); }
      if (nameHit || lines.length) { hits.push({ s: s.n, lines, nameHit }); nLines += lines.length; hitSet.add(s.n); }
    }
    hits.sort((a, b) => (b.nameHit - a.nameHit) || (b.lines.length - a.lines.length) || (a.s < b.s ? -1 : 1));
    paintHits(); drawEdges();
    if (!hits.length) { results.replaceChildren(h('p', { class: 'hint', style: 'margin:8px 10px' }, 'Nothing found.')); const r = find.getBoundingClientRect(); results.style.left = r.left + 'px'; results.style.top = (r.bottom + 4) + 'px'; results.style.width = '260px'; results.hidden = false; return; }
    showRes(terms, nLines);
  };
  let findT = 0;
  find.addEventListener('input', () => { clearTimeout(findT); findT = setTimeout(runFind, 150); });
  find.addEventListener('focus', () => { if (find.value.trim() && results.hidden) runFind(); });
  find.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (results.hidden || !hits.length) return; e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + Math.min(hits.length, 40)) % Math.min(hits.length, 40); [...results.querySelectorAll('.fres')].forEach((b, i) => b.classList.toggle('act', i === act)); const a = results.querySelectorAll('.fres')[act]; a && a.scrollIntoView({ block: 'nearest' }); return; }
    if (e.key !== 'Enter') return; e.preventDefault(); clearTimeout(findT);
    if (results.hidden) runFind(); const x = hits[act]; if (!x) return; pick({ s: x.s, key: x.lines[0] ? x.lines[0].key : null }); hideRes();
  });
  const findBlank = e => { if (!e.target.closest('#modfind-results') && e.target !== find) hideRes(); };
  const playFrom = n => { if (!n) return toast('Select a scene first.', 2500); charts(n); if (!legacy) openScenePreview(n); };
  const stageB = h('button', { class: 'btn small ghost', id: 'mod-stage', 'aria-pressed': 'false', onclick: () => { st.stage = !st.stage; draw(true); } }, 'Pictures & sounds');
  const selB = h('button', { class: 'btn small ghost', id: 'mod-select', 'aria-pressed': 'false', title: 'Select several boxes: drag a rectangle round them, or tap them', onclick: () => { st.selMode = !st.selMode; view.classList.toggle('selecting', st.selMode); drawBar(); } }, icon('check'), 'Select');
  const editsB = h('button', { class: 'btn small ghost', id: 'mod-edits-btn', onclick: editsList }, icon('list'), 'Changes');
  const drawBar = () => { stageB.setAttribute('aria-pressed', String(st.stage)); selB.setAttribute('aria-pressed', String(st.selMode)); editsB.lastChild.textContent = P.length ? `Changes (${P.length})` : 'Changes'; };
  let closed = false;
  const close = () => { if (closed) return; closed = true; if ($('#charts')) $('#charts').remove(); clearTimeout(ct); if (legacy) {legacy.saveDraft(P).catch(e=>console.error('Legacy drafts:',e)); legacy.pics.close();} window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); document.removeEventListener('keydown', onKey, true); ro && ro.disconnect(); cancelAnimationFrame(raf); imgCache.forEach(p => p.then(u => (u || []).forEach(x => URL.revokeObjectURL(x)))); root.remove(); syncGameAudio(true); try { GAME.frame && GAME.frame.focus(); } catch (e) { } };
  const onKey = e => { if (e.key !== 'Escape' || !$('#modder') || $('#charts')) return; e.preventDefault(); e.stopPropagation(); if ($('#modmodal')) $('#modmodal').remove(); else if (!results.hidden) hideRes(); else if (st.multi.size) { st.multi.clear(); paintMulti(); } else close(); };
  document.addEventListener('keydown', onKey, true);
  let ct = 0;
  const charts = start => { try { openCharts({ scenes: () => D.scenes, P: () => P, labels: labelSet,
    save: () => { clearTimeout(ct); ct = setTimeout(() => (legacy ? legacy.saveDraft(P) : flowSave(gid,P)).catch(e => console.error('Save graph draft:',e)), 350); },
    apply: legacy ? () => legacy.applyMod(P) : () => commit(true),
    resetScene: legacy ? async name => { const i=P.findIndex(p=>p.op==='chart'&&p.name===name);if(i>=0)P.splice(i,1);await legacy.saveDraft(P); } : null,
    applyLabel: legacy ? 'Apply on next launch' : undefined, offline: !!legacy?.offline, legacy: !!legacy,
    start, preview: legacy ? null : openScenePreview, image: imgFor, retryImage: legacy ? legacy.pics.retry : null,
    variants: variantsFor, chars: () => D.chars, imageInfo: legacy ? legacy.pics.imageInfo : n => imgInfo.get(String(n || '').replace(IMG_TAIL, '').trim()), assets: assetsFor }); }
    catch (e) { toast('Charts could not open (' + ENGINE_VERSION + '): ' + (e.message || e), 7000); console.error(e); } };
  canvas.addEventListener('dblclick', e => { const el = e.target.closest('.mscene'); if (el) { e.preventDefault(); charts(el.dataset.scene); } });
  const bar = h('div', { class: 'mtop' }, h('button', { class: 'btn small', id: 'mod-close', 'aria-label': 'Back to the game', onclick: close }, icon('back'), 'Game'), h('b', { class: 'mtitle' }, `Modding: ${g0.title} · ${ENGINE_VERSION}`),
    legacy ? h('small', { class:'hint', id:'mod-legacy-label', title:'Same node editor, with deferred script changes' }, legacy.offline ? 'Offline · drafts only' : 'Legacy · drafts only') : null, find, findKind, stageB, selB, h('button', { class: 'btn small ghost', id: 'mod-tidy', title: 'Put every box back in its tidy place', onclick: () => { manual.clear(); saveFlowPos(); draw(true); fit(); } }, icon('sort'), 'Tidy'), h('button', { class: 'btn small ghost', id: 'mod-charts', onclick: () => charts() }, icon('list'), 'Charts'), h('button', { class: 'btn small ghost', id: 'mod-new', onclick: () => newScene('', 'start') }, icon('plus'), 'New scene'), editsB, legacy ? h('button', { class:'btn small ghost', id:'mod-apply-legacy', onclick: () => legacy.applyMod(P) }, icon('play'), 'Apply next launch') : null, h('button', { class: 'btn small', id: 'mod-play', title: legacy ? 'Open the selected scene in the shared command-node editor' : 'Open a live game window and follow execution in the node chart', onclick: () => playFrom(st.sel && st.sel.s) }, icon(legacy ? 'list' : 'play'), legacy ? 'Edit nodes' : 'Preview scene'),
    h('button', { class: 'btn small ghost', 'aria-label': 'Zoom out', onclick: () => { const r = view.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); } }, icon('zoomout')),
    h('button', { class: 'btn small ghost', 'aria-label': 'Zoom in', onclick: () => { const r = view.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); } }, icon('zoomin')),
    h('button', { class: 'btn small ghost', id: 'mod-fit', 'aria-label': 'Show everything', onclick: fit }, icon('full')));
  root.replaceChildren(bar, ...(legacy ? [h('div', { id:'mod-legacy-banner', role:'status', style:'padding:6px 14px;font-size:12px;border-bottom:1px solid var(--line);background:var(--surface)' }, legacy.offline ? 'Offline snapshot mode · no Ren’Py runtime required · drafts saved locally until Apply next launch · compiled-only games need an initial snapshot · live trace unavailable' : 'Shared editor · legacy safe boot · changes are local drafts until Apply next launch · live trace/jump unavailable')] : []), view, panel, dl, results); root.addEventListener('pointerdown', findBlank, true);
  try {
    draw(true);
    if (D.scenes.length <= 12) fit(); else focusOn(POS.has('start') ? 'start' : D.scenes[0].n);
    if (window.TKB_DEBUG) window.TKB_FLOW = { pos: () => POS, st, manual, els: () => els, edges: () => EDG, shared: () => SHARED, users: () => USERS, wp: () => WP, paths: () => EDG.filter(e => !e.hub).map(e => ({ k: e.kind, a: e.a, b: e.b, p: edgePts(e) })) };
    const first = D.scenes.find(x => x.n === 'start') || D.scenes[0]; st.sel = { s: first.n, key: null, auto: true }; select();
  } catch (e) {   // show what went wrong instead of an empty picture
    console.error(e); busy(null);
    panel.replaceChildren(h('div', { class: 'stack', id: 'mod-fail' }, h('b', {}, `The flowchart could not be drawn (${ENGINE_VERSION}, ${D.scenes.length} scenes)`), h('pre', { style: 'white-space:pre-wrap;word-break:break-word;margin:0;font-size:12px' }, String(e && e.stack || e).slice(0, 900))));
    toast('The flowchart could not be drawn: ' + (e && e.message || e), 8000);
  }
  busy(null);
}
//<<
