const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname,'../js/78-scene-setup.js'),'utf8');
const code = src.slice(src.indexOf('let TKB_RESET_BUSY = false;'),src.indexOf('const TKB_SETUP_MAX ='));
let opened=null, notice='';
const game={frame:null,g:null,lastGameId:'saved-game'};
const ctx=vm.createContext({GAME:game,CUR:{view:'detail',params:{}},SCENE_PREVIEW:{active:false},
  confirm:()=>true,toast:t=>{notice=t},openGame:async (id,cont)=>{opened={id,cont};game.frame={}},
  document:{querySelector:()=>null},window:{dispatchEvent:()=>{}},CustomEvent:class{constructor(t,o){this.type=t;this.detail=o.detail}},console});
vm.runInContext(code,ctx);
(async()=>{
  assert.equal(await vm.runInContext('resetRunningGame()',ctx),true,'reset reopens a closed game');
  assert.deepEqual(opened,{id:'saved-game',cont:false},'reopens last game without resuming stale runtime state');
  assert.equal(ctx.CUR.view,'game','route is switched to game before launching');
  assert.equal(ctx.CUR.params.id,'saved-game');
  assert.ok(game.frame,'new iframe is created by openGame');
  console.log('5 closed-game reset tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
