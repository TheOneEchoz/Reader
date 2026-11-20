/* Automatic, read-only discovery of possible scene prerequisites.
   Examines Ren'Py AST statements available in the imported game. This is a
   conservative hint system, not a replacement for executing prior story code. */
//>> js/79-setup-analysis.js#0
const TKB_SCENE_SCAN_PY = String.raw`
import ast as _tkba_ast
import builtins as _tkba_builtins
import re as _tkba_re

def _tkba_scan_scene(scene):
    result = {'scene': scene, 'found': False, 'variables': [], 'visited': 0, 'notes': [], 'calls': [], 'images': [], 'screens': []}
    try:
        S = renpy.game.script
        root = S.namemap.get(scene)
        if root is None:
            try:
                root = S.lookup(scene)
            except Exception:
                pass
        if root is None:
            result['notes'].append('No compiled label is available for this scene.')
            return result
        result['found'] = True
        data = {}
        built = set(dir(_tkba_builtins)) | set(['renpy', 'store', 'persistent', 'config', 'self', 'True', 'False', 'None', 'Exception'])
        def track(name, why, read=False, value=None):
            if not isinstance(name, str) or not _tkba_re.match(r'^[A-Za-z][A-Za-z_0-9]*$', name):
                return
            if name in built or name.startswith('_'):
                return
            d = data.setdefault(name, {'name': name, 'used': False, 'reasons': [], 'choices': []})
            if read:
                d['used'] = True
            if why not in d['reasons'] and len(d['reasons']) < 5:
                d['reasons'].append(why)
            if value is not None and value not in d['choices'] and len(d['choices']) < 12:
                d['choices'].append(value)
        def literal(n):
            try:
                v = _tkba_ast.literal_eval(n)
                if type(v) in (str, bool, int, float, type(None)) and len(repr(v)) <= 100:
                    return repr(v)
            except Exception:
                pass
            return None
        def expression(src, why):
            if not isinstance(src, str) or not src.strip():
                return
            try:
                tree = _tkba_ast.parse(src)
            except Exception:
                try:
                    tree = _tkba_ast.parse(src, mode='eval')
                except Exception:
                    return
            for n in _tkba_ast.walk(tree):
                if isinstance(n, _tkba_ast.Name):
                    track(n.id, why, isinstance(n.ctx, _tkba_ast.Load))
                elif isinstance(n, _tkba_ast.Compare):
                    left = n.left
                    for right in n.comparators:
                        if isinstance(left, _tkba_ast.Name):
                            track(left.id, why, True, literal(right))
                        if isinstance(right, _tkba_ast.Name):
                            track(right.id, why, True, literal(left))
                        left = right
                elif isinstance(n, (_tkba_ast.Assign, _tkba_ast.AnnAssign)):
                    value = literal(n.value)
                    targets = n.targets if hasattr(n, 'targets') else [n.target]
                    for t in targets:
                        if isinstance(t, _tkba_ast.Name):
                            track(t.id, 'Assigned in script', False, value)
        def interpolated(src, why):
            if not isinstance(src, str):
                return
            for name in _tkba_re.findall(r'\[([A-Za-z][A-Za-z_0-9]*)\]', src):
                track(name, why, True)
        # Follow the statements in the selected label, plus directly called
        # local labels (bounded) to find setup used by helper scenes.
        pending = [(root, 0)]
        seen = set()
        while pending and len(seen) < 1000:
            n, level = pending.pop()
            if n is None or id(n) in seen:
                continue
            if n is not root and type(n).__name__ == 'Label':
                continue  # Don't spill into unrelated labels.
            seen.add(id(n))
            typ = type(n).__name__
            tag = typ + ' statement'
            try:
                if typ == 'Python':
                    expression(str(getattr(getattr(n, 'code', None), 'source', '') or ''), tag)
                elif typ in ('If', 'While'):
                    expression(str(getattr(n, 'condition', '') or ''), tag)
                    for e in getattr(n, 'entries', []) or []:
                        if len(e):
                            expression(str(e[0]), 'Branch condition')
                elif typ == 'Menu':
                    for e in getattr(n, 'items', []) or []:
                        if len(e) > 1:
                            expression(str(e[1]), 'Choice condition')
                elif typ == 'Say':
                    interpolated(getattr(n, 'what', ''), 'Dialogue interpolation')
                elif typ == 'UserStatement':
                    line = str(getattr(n, 'line', ''))
                    interpolated(line, 'Statement interpolation')
                    screen_match = _tkba_re.match(r'\s*(?:show|call)\s+screen\s+([A-Za-z_][A-Za-z_0-9]*)', line)
                    if screen_match and screen_match.group(1) not in result['screens'] and len(result['screens']) < 20:
                        result['screens'].append(screen_match.group(1))
                if typ in ('Scene', 'Show', 'Hide'):
                    im = getattr(n, 'imspec', None)
                    if im:
                        interpolated(str(im[0]), 'Image interpolation')
                        image_name = ' '.join(str(x) for x in im[0])
                        if image_name and image_name not in result['images'] and len(result['images']) < 20:
                            result['images'].append(image_name)
                if typ == 'Call' and not getattr(n, 'expression', False):
                    target = str(getattr(n, 'label', ''))
                    if target and target not in result['calls'] and len(result['calls']) < 20:
                        result['calls'].append(target)
                    if level < 2:
                        other = S.namemap.get(target)
                        if other is not None:
                            pending.append((other, level + 1))
            except Exception:
                pass
            for key in ('next', 'block'):
                v = getattr(n, key, None)
                if isinstance(v, (list, tuple)):
                    pending.extend((x, level) for x in v if x is not None)
                elif v is not None:
                    pending.append((v, level))
            # Follow nested branches but not raw strings, variables or objects.
            for key in ('entries', 'items'):
                v = getattr(n, key, None)
                if isinstance(v, (list, tuple)):
                    for e in v:
                        if isinstance(e, (list, tuple)):
                            for child in e:
                                if getattr(type(child), '__module__', '').startswith('renpy.ast'):
                                    pending.append((child, level))
        result['visited'] = len(seen)
        for name, item in data.items():
            try:
                value = getattr(renpy.store, name)
                item['present'] = True
                if type(value) in (str, int, float, bool, type(None)):
                    item['current'] = repr(value)[:100]
                    if item['current'] not in item['choices']:
                        item['choices'].insert(0, item['current'])
                else:
                    item['current'] = '<' + type(value).__name__ + '>'
            except Exception:
                item['present'] = False
                item['current'] = None
        result['variables'] = sorted(data.values(), key=lambda d: (d['present'], not d['used'], d['name']))[:70]
    except Exception as error:
        result['notes'].append(type(error).__name__ + ': ' + str(error)[:160])
    return result
`;
async function tkbAnalyzeScene(scene) {
  const response = await tkbGamePyChecked(TKB_SCENE_SCAN_PY + '\nresult = _tkba_scan_scene(' + JSON.stringify(String(scene || '')) + ')', 10000);
  if (!response.ok) return { scene, found: false, variables: [], notes: [response.error || 'Scene analysis unavailable'] };
  return response.result && typeof response.result === 'object' ? response.result :
    { scene, found: false, variables: [], notes: ['No analysis returned by Ren\'Py'] };
}
function tkbSceneErrorVariables() {
  const seen = new Set(), found = [];
  for (const error of (GAME.errors || []).slice(-12)) {
    const text = String(error.full || error.short || '');
    const rx = /NameError:\s*name\s+['"]([A-Za-z_][A-Za-z_0-9]*)['"]\s+is not defined/g;
    let m;
    while ((m = rx.exec(text)) && found.length < 8) {
      if (!seen.has(m[1])) { seen.add(m[1]); found.push(m[1]); }
    }
  }
  return found;
}
//<<
