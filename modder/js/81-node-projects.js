/* Portable graph drafts. The project export intentionally contains no original
   game assets, scripts, compiled AST snapshot, saves, or personal runtime data.
   Import stages drafts only; it NEVER enables a mod or runs Ren'Py. */
const TKB_NODE_PROJECT_FORMAT = 'tankobon-node-draft';
async function tkbExportNodeProject(game) {
  const id = 'tkb-legacy-graph-drafts:' + game.id;
  const draft = await ST.get('meta', id).catch(() => null);
  const patches = Array.isArray(draft?.patches) ? draft.patches : await flowPatches(game.id);
  const data = {
    format: TKB_NODE_PROJECT_FORMAT, schema: 1, editor: ENGINE_VERSION,
    exportedAt: new Date().toISOString(),
    game: { title: game.title, version: game.game?.ver || null },
    patches: JSON.parse(JSON.stringify(patches))
  };
  const name = String(game.title || 'game').replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 65) || 'game';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name + '-tankobon-draft.json';
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  toast('Downloaded a portable node draft. Original game data was not included.', 5000);
}
async function tkbImportNodeProject(game, file) {
  if (!file) return false;
  if (file.size > 16 * 1024 * 1024) throw new Error('The draft exceeds the 16 MB import limit.');
  const doc = JSON.parse(await file.text());
  if (!doc || doc.format !== TKB_NODE_PROJECT_FORMAT || doc.schema !== 1 || !Array.isArray(doc.patches))
    throw new Error('Not a supported Tankōbon node draft.');
  if (doc.patches.length > 15000) throw new Error('Too many patches in this project.');
  const accepted = new Set(['chart', 'say', 'go', 'choice', 'addchoice', 'scene']);
  if (!doc.patches.every(p => p && typeof p === 'object' && accepted.has(p.op)))
    throw new Error('The draft contains unsupported patch operations.');
  for (const p of doc.patches) {
    if (p.op === 'chart' && (!p.name || !Array.isArray(p.nodes) || p.nodes.length > 30000))
      throw new Error('The draft contains an invalid or oversized chart.');
  }
  const issues = tkbValidatePatches(doc.patches, []);
  const failures = issues.filter(i => i.level === 'error');
  if (failures.length) throw new Error('Draft has ' + failures.length + ' structural error(s): ' + failures[0].message);
  const same = doc.game?.title === game.title && String(doc.game?.version || '') === String(game.game?.ver || '');
  const summary = 'Source project: ' + String(doc.game?.title || '(unknown)') +
    ' · Ren’Py ' + String(doc.game?.version || '(unknown)') + '\n' +
    'Current game: ' + game.title + ' · Ren’Py ' + (game.game?.ver || '(unknown)') + '\n' +
    doc.patches.length + ' patches · ' + issues.length + ' structural warning(s).\n\n' +
    (same ? '' : 'WARNING: The project targets a different game or version! Labels and sources may not match.\n\n') +
    'Replace your CURRENT saved drafts with these? This does not apply them to the game. Export your current draft first if you want a backup. Imported code may be executed only if you later choose Apply.';
  if (!confirm(summary)) return false;
  await ST.put('meta', { id: 'tkb-legacy-graph-drafts:' + game.id,
    patches: JSON.parse(JSON.stringify(doc.patches)), updated: Date.now() });
  toast('Imported ' + doc.patches.length + ' draft patches. Open Offline nodes to inspect them before applying.', 6000);
  return true;
}
