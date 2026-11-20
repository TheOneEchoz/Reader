// node tests/audio-visibility.test.js — no playback from hidden game surfaces
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/40-play.js'), 'utf8');
const code = source.slice(source.indexOf('function gameReallyShown()'), source.indexOf('function syncGameAudio('));
const state = { hidden: false, chart: false, modder: false, sheet: false, docked: false, display:'block', covered:false, connected:true };
const gamebox = {
  isConnected: true,
  classList:{ contains: k => k === 'preview-docked' && state.docked },
  contains: target => target === frame || target === gamebox,
  getBoundingClientRect:() => ({left:0,top:0,right:800,bottom:600,width:800,height:600})
};
const frame = {};
const document = {
  get hidden() { return state.hidden; },
  getElementById: id => (id === 'charts' ? state.chart : state[id]) ? {} : null,
  querySelector: sel => sel === '#sheet:not([hidden])' && state.sheet ? {} : null,
  elementFromPoint: () => state.covered ? {other:true} : frame
};
const ctx = vm.createContext({ document, SCENE_PREVIEW: { get active(){ return state.docked; } }, GAME: {box:gamebox,frame}, getComputedStyle:()=>({display:state.display,visibility:'visible',opacity:'1'}), innerWidth:1280,innerHeight:800 });
vm.runInContext(code,ctx); const shown=()=>vm.runInContext('gameReallyShown()',ctx);
assert.equal(shown(),true,'game in front is audible');
state.chart=true; assert.equal(shown(),false,'editor without preview must be silent');
state.docked=true; assert.equal(shown(),true,'visible docked preview should be audible');
state.sheet=true; assert.equal(shown(),false,'a modal sheet mutes preview');
state.sheet=false; state.modder=true; assert.equal(shown(),true,'docked preview remains audible above modder');
state.docked=false; assert.equal(shown(),false,'undocked game is hidden behind modder');
state.modder=false;state.chart=false;state.covered=true; assert.equal(shown(),false,'covered game mutes regardless of editor state');
state.covered=false;state.hidden=true; assert.equal(shown(),false,'background tab mutes');
state.hidden=false;state.display='none';assert.equal(shown(),false,'display-none game mutes');
state.display='block';assert.equal(shown(),true,'audio permitted again after revealing game');
console.log('10 hidden-audio visibility checks passed');
