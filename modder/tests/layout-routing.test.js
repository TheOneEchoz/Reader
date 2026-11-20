// node tests/layout-routing.test.js — regression examples from the screenshots
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../js/76-layout.js'), 'utf8');
const ctx = vm.createContext({console}); vm.runInContext(src, ctx);
const run = txt => JSON.parse(JSON.stringify(vm.runInContext(txt, ctx)));
const make = js => run(`(function(){let g=${js}; let before=JSON.stringify(g.nodes.map(n=>({id:n.id,next:n.next,arms:n.arms}))); TKB_LAYOUT.arrange(g); let es=TKB_LAYOUT.routes(g); return {g,es,unmodified:before===JSON.stringify(g.nodes.map(n=>({id:n.id,next:n.next,arms:n.arms})))}})()`);
const small = make(`{entry:'branch',nodes:[
 {id:'branch',k:'if',arms:[{cond:'steam == 0',to:'say'},{cond:'True',to:'set'}]},
 {id:'set',k:'set',next:'after'}, {id:'say',k:'say',next:'after'}, {id:'after',k:'return'}]}`);
assert.equal(small.unmodified, true, 'rearrangement must preserve all graph connections');
const at = id => small.g.nodes.find(n=>n.id===id);
assert.ok(at('set').y > at('branch').y, 'secondary branch below the main choice');
assert.equal(at('say').y,at('branch').y,'primary branch aligned with main input');
assert.equal(small.es.find(e=>e.from==='branch' && e.to==='say').kind, 'branch');
assert.equal(run('TKB_LAYOUT.out({x:0,y:100},0)[1]'),112);
assert.equal(run('TKB_LAYOUT.input({x:0,y:100})[1]'),112);
assert.equal(run('TKB_LAYOUT.out({x:0,y:100,arms:[{},{}]},0)[1]'),155,'first branching output stays next to its label');
assert.equal(run('TKB_LAYOUT.out({x:0,y:100,arms:[{},{}]},1)[1]'),177,'additional branching outputs appear lower');
const chain = make(`{entry:'v0',nodes:${JSON.stringify(Array.from({length:7},(_,i)=>({id:'v'+i,k:'set',next:i<6?'v'+(i+1):null})))}}`);
assert.equal(chain.g.nodes.map(n=>n.y).join(','),Array(7).fill(chain.g.nodes[0].y).join(','),'single long chain must be on one baseline');
assert.ok(chain.es.every(e=>e.kind==='straight'),'straight primary connectors for aligned nodes');
const choice = make(`{entry:'menu',nodes:[
 {id:'menu',k:'menu',arms:[{text:'NPC Alice',to:'alice1'},{text:'NPC Bob',to:'bob1'},{text:'Leave',to:'exit'}]},
 {id:'alice1',k:'say',next:'alice2'}, {id:'alice2',k:'say',next:'menu'},
 {id:'bob1',k:'say',next:'bob2'}, {id:'bob2',k:'say',next:'menu'},
 {id:'exit',k:'return'}]}`);
assert.equal(choice.g._choiceBands.length,2,'two returning NPC conversations recognized as separate lanes');
assert.ok(choice.g.nodes.find(n=>n.id==='bob1').y > choice.g.nodes.find(n=>n.id==='alice1').y);
assert.ok(choice.g.nodes.find(n=>n.id==='alice2').y===choice.g.nodes.find(n=>n.id==='alice1').y);
assert.equal(choice.g.nodes.find(n=>n.id==='exit').id,'exit','one-way exit stays out of return groups');
const noGroup = make(`{entry:'start',nodes:[{id:'start',k:'if',arms:[{to:'a'},{to:'b'}]},{id:'a',k:'return'},{id:'b',k:'return'}]}`);
assert.equal(noGroup.g._choiceBands.length,0,'ordinary conditionals must not be called returning menus');
const back = choice.es.filter(e=>e.to==='menu');
assert.equal(back.length,2);
assert.equal(new Set(back.map(e=>e.d)).size,2,'multiple returning edges must not share their full route');
const rails = make(`{entry:'x',nodes:[{id:'x',k:'menu',arms:[{to:'a'},{to:'b'},{to:'c'}]},{id:'a',k:'say',next:'x'},{id:'b',k:'say',next:'x'},{id:'c',k:'say',next:'x'}]}`);
assert.equal(new Set(rails.es.filter(e=>e.to==='x').map(e=>e.d)).size,3,'three return edges must remain visually distinct');
// Synthetic performance regression: common large games have thousands of nodes.
const large = make(`{entry:'v0',nodes:${JSON.stringify(Array.from({length:2200},(_,i)=>({id:'v'+i,k:'set',next:i<2199?'v'+(i+1):null})))}}`);
assert.equal(large.es.length,2199);
console.log('12 layout and edge routing checks passed');

// Even a wildly oversized separate scene must not move a return connector to
// a global bottom bus. Crossings are acceptable, co-linear overlapping isn't.
const localReturn = run(`(function(){const g={nodes:[{id:'m',k:'menu',x:50,y:50,arms:[{to:'a'},{to:'b'}]},
 {id:'a',k:'say',x:200,y:400,next:'m'}, {id:'b',k:'say',x:550,y:700,next:'m'},
 {id:'far',k:'say',x:900,y:99999}]};return TKB_LAYOUT.routes(g).filter(e=>e.to==='m').map(e=>({kind:e.kind,d:e.d}));})()`);
assert.equal(localReturn.length,2);
assert.ok(localReturn.every(e=>!e.d.includes('99999') && e.kind==='return'),'return paths must not use unrelated global bottom rails');
const overlapping = run(`(function(){const g={nodes:[
{id:'a',k:'say',x:0,y:100,next:'c'}, {id:'b',k:'say',x:300,y:100,next:'c'}, {id:'c',k:'return',x:700,y:100}]};
return TKB_LAYOUT.routes(g).map(e=>({kind:e.kind,d:e.d}));})()`);
assert.equal(overlapping.filter(e=>e.kind==='straight').length,1,'overlapping same-y routes must have distinct geometries');
assert.notEqual(overlapping[0].d,overlapping[1].d);
console.log('3 compact-routing regression checks passed');
