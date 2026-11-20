const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/40-play.js'), 'utf8');
const code = source.slice(source.indexOf('  const ACTX = [];'), source.indexOf('  window.__tkbAudio = ACTX;'));
class AudioContextMock {
  constructor() { this.state='running'; this.resumes=0; this.suspends=0; }
  resume() { this.resumes++; this.state='running'; return Promise.resolve(); }
  suspend() { this.suspends++; this.state='suspended'; return Promise.resolve(); }
}
class MediaMock {
  constructor() { this.paused=true; this.playCalls=0; }
  play() { this.playCalls++; this.paused=false; return Promise.resolve(); }
  pause() { this.paused=true; }
}
const media = new MediaMock(), win = {AudioContext: AudioContextMock,HTMLMediaElement:MediaMock};
const ctx = vm.createContext({window:win, document:{querySelectorAll:()=>[media]},setInterval:()=>{},Promise});
vm.runInContext(code + '\nthis.audio={ ACTX, nativeResume, get allowed(){return gameSoundOn}, set allowed(v){gameSoundOn=v}};',ctx);
const c = new win.AudioContext();
assert.equal(ctx.audio.allowed,false,'game starts silent until parent confirms visibility');
assert.equal(c.state,'suspended','new audio contexts start suspended while hidden');
c.resume();
assert.equal(c.resumes,0,'a hidden game cannot restart audio repeatedly and stutter');
media.play();
assert.equal(media.playCalls,0,'HTML media cannot play while game is hidden');
assert.equal(media.__tkbPaused,true,'a suppressed play is queued for later');
ctx.audio.allowed=true;
ctx.audio.nativeResume.get(c)();
media.play();
assert.equal(c.resumes,1,'audible contexts can be resumed when shown');
assert.equal(media.playCalls,1,'visible media can play normally');
ctx.audio.allowed=false;
c.suspend();
c.resume();
assert.equal(c.resumes,1,'resuming hidden context remains blocked after it was once audible');
assert.equal(c.state,'suspended');
console.log('8 audio gate regression checks passed');
