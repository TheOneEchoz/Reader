// Run with: node tests/node-draft.test.js
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const records = new Map();
let prompts = [];
const ctx = vm.createContext({
  console, Date, JSON,
  ST: { get: async (_, key) => records.get(key), put: async (_, data) => { records.set(data.id, data); } },
  confirm: msg => { prompts.push(msg); return true; },
  toast() {},
  flowPatches: async () => [],
  Blob, URL, setTimeout,
  document: { createElement: () => ({ click(){}, remove(){} }), body: { append(){} } }
});
for (const file of ['75-nodes.js', '81-node-projects.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), ctx);
const game = { id: 'game1', title: 'Test', game: { ver: '7.4' } };
const draft = {
  format: 'tankobon-node-draft', schema: 1, game: { title: 'Test', version: '7.4' },
  patches: [{ op:'chart', name:'start', entry:'x', nodes:[{id:'x',k:'return'}] }]
};
const importDraft = async payload => vm.runInContext('tkbImportNodeProject', ctx)(game, {
  size: JSON.stringify(payload).length,
  text: async () => JSON.stringify(payload)
});
(async () => {
  assert.equal(await importDraft(draft), true);
  assert.equal(records.get('tkb-legacy-graph-drafts:game1').patches.length, 1);
  assert.equal(prompts.length, 1);
  assert.equal(records.has('tkb-story-snapshot:game1'), false, 'import must not introduce a fake original story snapshot');
  await assert.rejects(importDraft({...draft, format:'other'}), /Not a supported/);
  await assert.rejects(importDraft({...draft, patches:[{op:'script-hack'}]}), /unsupported patch operations/);
  await assert.rejects(importDraft({...draft, patches:[{op:'chart',name:'bad',entry:'x',nodes:[{id:'x',k:'jump',next:'missing',target:'main'},{id:'x',k:'return'}]}]}), /structural error/);
  assert.equal(records.get('tkb-legacy-graph-drafts:game1').patches.length, 1, 'invalid import must not change old draft');
  console.log('5 offline-draft import tests passed');
})().catch(e => { console.error(e); process.exitCode=1; });
