/* Scene preview setup and recovery, nodes-2.8.
   Setup is stored with the imported game, keyed by Ren'Py label, not character.
   A reset rebuilds the game iframe without replacing the chart editor or deleting saves. */
//>> js/78-scene-setup.js#0
let TKB_RESET_BUSY = false;
async function resetRunningGame() {
  if (TKB_RESET_BUSY) return false;
  const id = (GAME.g && GAME.g.id) || GAME.lastGameId ||
    (typeof CUR !== 'undefined' && CUR.params && CUR.params.id);
  if (!id) { toast('Choose a game before resetting it.', 3500); return false; }
  if (!confirm(GAME.frame ? 'Reset the running game?\n\nThis starts a fresh Ren\'Py session at the main menu. Unsaved progress will be lost, but existing save files and scene setup settings are kept.' : 'The game is closed. Reopen it from the main menu? Existing save files will be kept.')) return false;
  const docked = typeof SCENE_PREVIEW !== 'undefined' && SCENE_PREVIEW.active;
  const target = docked ? SCENE_PREVIEW.target : '';
  TKB_RESET_BUSY = true;
  window.dispatchEvent(new CustomEvent('tkb:game-reset', { detail: { game: id } }));
  document.querySelector('.preview-setup-shade')?.remove();
  try {
    // Do not autosave a broken execution context. Reopen with cont=false.
    GAME.afterReady = () => {
      if (target) openScenePreview(target);
      toast('Game restarted. Reach the scene normally, or configure Scene setup before jumping.', 4500);
    };
    // openGame checks the active route; a game may have exited to the
    // library, leaving its chart/editor and the last imported game behind.
    if (typeof CUR !== 'undefined' && (CUR.view !== 'game' || CUR.params?.id !== id)) {
      CUR = { view: 'game', params: { id } };
    }
    await openGame(id, false);
    if (!GAME.frame) { toast('Could not restart the game. Try opening it from the library.', 4500); return false; }
    return true;
  } catch (err) {
    console.error('Tankōbon game reset failed', err);
    toast('Reset failed: ' + String(err && err.message || err), 6000);
    return false;
  } finally { TKB_RESET_BUSY = false; }
}

const TKB_SETUP_MAX = 40;
const tkbSetupKey = name => String(name || '').trim();
async function getSceneSetup(scene) {
  const id = GAME.g && GAME.g.id;
  if (!id || !scene) return { variables: '', python: '' };
  const g = await S.gal(id);
  const data = g?.game?.sceneSetups?.[tkbSetupKey(scene)];
  return { variables: String(data?.variables || ''), python: String(data?.python || '') };
}
async function putSceneSetup(scene, data) {
  const id = GAME.g && GAME.g.id;
  if (!id) throw new Error('No game is currently open');
  const g = await S.gal(id);
  if (!g || !g.game) throw new Error('The game record was not found');
  g.game.sceneSetups = g.game.sceneSetups || {};
  if (data.variables.trim() || data.python.trim()) {
    g.game.sceneSetups[scene] = { variables: data.variables, python: data.python };
  } else delete g.game.sceneSetups[scene];
  await saveGallery(g);
  if (GAME.g && GAME.g.id === id) GAME.g.game.sceneSetups = g.game.sceneSetups;
}
function parseSceneVars(input) {
  const vals = [], errors = [], seen = new Set();
  String(input || '').split(/\r?\n/).forEach((row, i) => {
    const line = row.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.+)$/.exec(line);
    if (!m) { errors.push('Line ' + (i + 1) + ': use variable = value'); return; }
    const name = m[1];
    if (name.startsWith('_tkb') || ['store', 'renpy', 'config', 'persistent'].includes(name)) {
      errors.push('Line ' + (i + 1) + ': reserved variable ' + name); return;
    }
    if (seen.has(name)) { errors.push('Line ' + (i + 1) + ': ' + name + ' is already assigned'); return; }
    seen.add(name); vals.push([name, m[2]]);
  });
  if (vals.length > TKB_SETUP_MAX) errors.push('Use at most ' + TKB_SETUP_MAX + ' assignments per scene.');
  if (input.length > 12000) errors.push('The variable setup is too long.');
  return { vals, errors };
}
// Unlike gamePy(), this distinguishes Python errors from timeouts, so jumping is
// blocked if prerequisites cannot be applied. The receiver is already in 90-open.js.
function tkbGamePyChecked(code, ms = 8000) {
  return new Promise(resolve => {
    if (!GAME.frame || !GAME.loaded) return resolve({ ok: false, error: 'The game is not ready. Reset or start it first.' });
    const frame = GAME.frame;
    GAME.pyq = GAME.pyq || new Map();
    const q = 'setup_' + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { GAME.pyq.delete(q); resolve({ ok: false, error: 'The game did not respond (it may be stopped on an error screen). Use Reset game.' }); }, ms);
    GAME.pyq.set(q, m => {
      clearTimeout(timer);
      if (GAME.frame !== frame) return resolve({ ok: false, error: 'The game was restarted while setting up the scene.' });
      resolve({ ok: !m.err, error: m.err || null, result: m.result });
    });
    try { frame.contentWindow.postMessage({ t: 'pyq', q, code }, '*'); }
    catch (err) { clearTimeout(timer); GAME.pyq.delete(q); resolve({ ok: false, error: String(err) }); }
  });
}
function tkbSceneSetupCode(entries, advanced, scene) {
  // Literal values are validated all at once before changing any store variable.
  // Explicit custom Python runs only if the user opted to write it.
  return `import ast as _tkbs_ast\n_tkbs_vals = []\nfor _tkbs_name, _tkbs_src in ${JSON.stringify(entries)}:\n    _tkbs_vals.append((_tkbs_name, _tkbs_ast.literal_eval(_tkbs_src)))\nif not renpy.has_label(${JSON.stringify(scene)}):\n    raise ValueError("Scene label not found: " + ${JSON.stringify(scene)})\nfor _tkbs_name, _tkbs_value in _tkbs_vals:\n    setattr(renpy.store, _tkbs_name, _tkbs_value)\n${advanced.trim() ? `exec(compile(${JSON.stringify(advanced)}, '<scene setup>', 'exec'), renpy.store.__dict__)` : 'pass'}\nresult = {'applied': len(_tkbs_vals), 'label': ${JSON.stringify(scene)}}`;
}
async function previewJumpToScene(scene) {
  scene = tkbSetupKey(scene);
  if (!scene || !GAME.frame || !GAME.loaded) { toast('Start the game before jumping to a scene.', 4500); return false; }
  const saved = await getSceneSetup(scene);
  const parsed = parseSceneVars(saved.variables);
  if (parsed.errors.length) { toast('Scene setup is invalid: ' + parsed.errors[0], 4500); openSceneSetup(scene); return false; }
  // Missing prerequisites detected by the compiled script and previous
  // NameErrors must be explicitly supplied before an unsafe direct jump.
  try {
    const scan = await tkbAnalyzeScene(scene);
    const required = (scan.variables || []).filter(v => !v.present && v.used &&
      (v.reasons || []).some(r => /condition|interpolation/i.test(r))).map(v => v.name);
    for (const name of tkbSceneErrorVariables()) if (!required.includes(name)) required.push(name);
    const configured = new Set(parsed.vals.map(([name]) => name));
    const missing = required.filter(name => !configured.has(name));
    if (missing.length && !saved.python.trim()) {
      toast('Scene needs values for: ' + missing.slice(0, 5).join(', ') + '. Choose them in Scene setup.', 5000);
      await openSceneSetup(scene);
      return false;
    }
  } catch (e) { console.warn('Scene prerequisite scan unavailable', e); }
  const hasSetup = !!(parsed.vals.length || saved.python.trim());
  if (!hasSetup) {
    const ok = confirm('Jump to “' + scene + '” without scene setup?\n\nThis skips prior story execution. Missing variables (such as textbox) or missing context can crash Ren\'Py.\n\nUse Scene setup first to provide the values this scene needs.');
    if (!ok) return false;
  }
  // Run even an empty setup to check the label before sending an async jump.
  const applied = await tkbGamePyChecked(tkbSceneSetupCode(parsed.vals, saved.python, scene), 8000);
  if (!applied.ok) {
    toast('Scene setup failed: ' + applied.error, 6500);
    console.warn('Tankōbon scene setup failed', scene, applied.error);
    return false;
  }
  gameCmd(['jump', scene]);
  window.dispatchEvent(new CustomEvent('tkb:preview-jump', { detail: { scene } }));
  toast('Jump requested: ' + scene + (hasSetup ? ' (setup applied)' : ''), 2500);
  return true;
}
function tkbMissingFromError() {
  const errors = GAME.errors || [];
  for (let i = errors.length - 1; i >= 0; i--) {
    const txt = String(errors[i].full || errors[i].short || '');
    const m = /NameError:\s*name\s+['"]([A-Za-z_][A-Za-z_0-9]*)['"]\s+is not defined/.exec(txt);
    if (m) return m[1];
  }
  return '';
}
async function openSceneSetup(scene) {
  scene = tkbSetupKey(scene);
  if (!scene || !GAME.g) { toast('Start a game and choose a scene first.', 3500); return; }
  document.querySelector('.preview-setup-shade')?.remove();
  const saved = await getSceneSetup(scene);
  const shade = h('div', { class: 'preview-setup-shade', role: 'presentation' });
  const body = h('section', { class: 'preview-setup-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Scene setup for ' + scene });
  const title = h('h2', {}, 'Scene setup · ' + scene);
  const status = h('p', { class: 'preview-setup-status', role: 'status' }, 'Scanning the scene for variables and possible values…');
  const discovered = h('div', { class: 'preview-setup-found' });
  const variables = h('textarea', { class: 'preview-setup-input', rows: 5,
    placeholder: 'textbox = 2\nrubb = 1\nplayer_name = "Ruby"' });
  variables.value = saved.variables;
  const advanced = h('textarea', { class: 'preview-setup-input', rows: 4,
    placeholder: '# Optional Ren\'Py Python code to run before the jump' });
  advanced.value = saved.python;
  const rowInputs = new Map();
  const btn = (label, cb, extra) => h('button', { type: 'button', class: 'preview-game-action ' + (extra || ''), onclick: cb }, label);
  const save = async () => {
    const parsed = parseSceneVars(variables.value);
    if (parsed.errors.length) { status.textContent = parsed.errors.join(' · '); return false; }
    const values = new Map(parsed.vals);
    for (const [name, input] of rowInputs) {
      values.delete(name);
      if (input.value.trim()) values.set(name, input.value.trim());
    }
    const compiled = [...values].map(([name, value]) => name + ' = ' + value).join('\n');
    const validation = parseSceneVars(compiled);
    if (validation.errors.length) { status.textContent = validation.errors.join(' · '); return false; }
    try {
      await putSceneSetup(scene, { variables: compiled, python: advanced.value });
      variables.value = compiled;
      status.textContent = 'Saved ' + values.size + ' variable values for ' + scene + '. Existing game saves are unchanged.';
      return true;
    } catch (err) { status.textContent = 'Could not save: ' + String(err); return false; }
  };
  const renderAnalysis = scan => {
    const old = new Map(parseSceneVars(variables.value).vals);
    const rows = new Map((scan.variables || []).map(v => [v.name, v]));
    for (const name of tkbSceneErrorVariables()) {
      if (!rows.has(name)) rows.set(name, { name, present: false, used: true, choices: [], reasons: ['Previously reported missing by Ren\'Py'] });
      else { const v = rows.get(name); if (!v.reasons.includes('Previously reported missing by Ren\'Py')) v.reasons.unshift('Previously reported missing by Ren\'Py'); }
    }
    for (const name of old.keys()) if (!rows.has(name)) rows.set(name, { name, present: true, used: false, choices: [], reasons: ['Previously saved setting'] });
    const arr = [...rows.values()].sort((a, b) => Number(a.present) - Number(b.present) || Number(!a.used) - Number(!b.used) || a.name.localeCompare(b.name));
    const elements = [];
    rowInputs.clear();
    for (const v of arr.slice(0, 45)) {
      const choiceId = 'tkb-choice-' + v.name;
      const known = [...new Set((v.choices || []).filter(x => typeof x === 'string'))].slice(0, 12);
      const input = h('input', { class: 'preview-setup-value', 'aria-label': 'Value for ' + v.name,
        placeholder: v.present ? 'Leave empty to keep current value' : 'Enter a Python value (e.g. 2 or "text")',
        list: known.length ? choiceId : undefined });
      input.value = old.get(v.name) || '';
      rowInputs.set(v.name, input);
      const reason = (v.reasons || []).join(' · ');
      const note = (v.present ? 'Currently ' + (v.current || 'defined') : 'Missing in game state') +
        (known.length ? ' · Possible values: ' + known.join(', ') : ' · No reliable values identified');
      elements.push(h('div', { class: 'preview-setup-var' },
        h('div', { class: 'preview-setup-varhead' }, h('b', {}, v.name), h('small', { class: v.present ? 'preview-setup-defined' : 'preview-setup-missing' }, v.present ? 'available' : 'missing')),
        h('small', { class: 'preview-setup-context' }, reason),
        h('small', { class: 'preview-setup-context' }, note),
        input,
        known.length ? h('datalist', { id: choiceId }, known.map(x => h('option', { value: x }, x))) : null,
        v.present && v.current && !v.current.startsWith('<') ?
          btn('Use current value', () => { input.value = v.current; }, 'preview-setup-small') : null));
    }
    if (!elements.length) elements.push(h('p', { class: 'preview-setup-tip' },
      'No variables could be inferred from the compiled scene. This may depend on earlier labels, screens or custom Python. Use manual assignments below if needed.'));
    if (arr.length > 45) elements.push(h('small', { class: 'preview-setup-context' }, 'Showing 45 of ' + arr.length + ' variables. Use manual assignments for others.'));
    const deps = [];
    if (scan.calls?.length) deps.push('Calls used by this scene: ' + scan.calls.join(', '));
    if (scan.screens?.length) deps.push('Screens used: ' + scan.screens.join(', '));
    if (scan.images?.length) deps.push('Images referenced: ' + scan.images.join(', '));
    if (deps.length) elements.push(h('div', { class: 'preview-setup-var' },
      h('b', {}, 'Other scene dependencies (informational)'),
      ...deps.map(text => h('small', { class: 'preview-setup-context' }, text))));
    discovered.replaceChildren(...elements);
    const missing = arr.filter(v => !v.present && v.used).length;
    status.textContent = 'Inspected ' + (scan.visited || 0) + ' compiled statements · ' + arr.length + ' possible variables' +
      (missing ? ' · ' + missing + ' currently missing' : '') +
      ((scan.notes || []).length ? ' · ' + scan.notes.join('; ') : '') +
      '. Suggestions are inferred; some dependencies may be hidden in screens or earlier choices.';
  };
  const refresh = async () => {
    status.textContent = 'Inspecting Ren\'Py scripts and current values…';
    try { renderAnalysis(await tkbAnalyzeScene(scene)); }
    catch (err) { status.textContent = 'Automatic analysis unavailable: ' + String(err); }
  };
  const copy = async () => {
    const names = [...new Set([...rowInputs.keys(), ...parseSceneVars(variables.value).vals.map(x => x[0])])].slice(0, TKB_SETUP_MAX);
    if (!names.length) { status.textContent = 'No variables are listed to capture.'; return; }
    const code = `result = {}\nfor _tkbs_name in ${JSON.stringify(names)}:\n    if hasattr(renpy.store, _tkbs_name):\n        _tkbs_value = getattr(renpy.store, _tkbs_name)\n        if type(_tkbs_value) in (str, int, float, bool, type(None)):\n            result[_tkbs_name] = repr(_tkbs_value)`;
    const res = await tkbGamePyChecked(code, 6000);
    if (!res.ok || !res.result) { status.textContent = res.error || 'Could not read the game variables.'; return; }
    for (const [name, literal] of Object.entries(res.result)) {
      if (rowInputs.has(name)) rowInputs.get(name).value = literal;
      else variables.value += (variables.value.trim() ? '\n' : '') + name + ' = ' + literal;
    }
    status.textContent = 'Copied ' + Object.keys(res.result).length + ' current values. Review and save before jumping.';
  };
  body.append(
    h('div', { class: 'preview-setup-head' }, title, btn('Close', () => shade.remove())),
    h('p', { class: 'preview-setup-tip' }, 'Detected scene inputs are listed below. Choose values only when needed; a blank value keeps an existing game variable unchanged. Values must be Python literals, such as 2, False or "Ruby".'),
    h('div', { class: 'preview-setup-head' }, h('b', {}, 'Detected variables and possible values'), btn('Scan again', refresh)),
    discovered,
    btn('Copy available values from the running game', copy),
    h('details', { class: 'preview-setup-advanced' },
      h('summary', {}, 'Advanced: manual variables and initialization code'),
      h('p', { class: 'preview-setup-tip' }, 'Manual assignments use variable = value on each line. Use this when the analyzer misses an input.'),
      h('label', { class: 'preview-setup-label' }, 'Manual assignments', variables),
      h('p', { class: 'preview-setup-tip' }, 'Optional Python runs inside Ren\'Py and can modify game state. Use only code you trust.'),
      h('label', { class: 'preview-setup-label' }, 'Additional Python', advanced)),
    status,
    h('div', { class: 'preview-setup-actions' },
      btn('Save setup', save),
      btn('Save and jump', async () => { if (await save()) { shade.remove(); await previewJumpToScene(scene); } }, 'primary'),
      btn('Cancel', () => shade.remove())));
  shade.append(body);
  shade.addEventListener('pointerdown', e => { if (e.target === shade) shade.remove(); });
  shade.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); shade.remove(); } });
  document.body.append(shade);
  await refresh();
}
//<<
