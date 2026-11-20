/* Tankōbon compatibility platform — version profiles, NOT a new Ren'Py interpreter.
   A 6.99 game runs in a Python 2 web runtime from Ren'Py 7.x as a best-effort
   experiment. There is no official 6.99 browser runtime. Keep existing
   installed runtime files and never replace or alter original game archives. */
//>> js/15-compat.js#0
const TKB_COMPAT = Object.freeze({
  profile(game) {
    const v = String((game && game.ver) || '').trim();
    if (/^6\.99(?:\.|$)/.test(v)) return { id: 'legacy-6.99', name: 'Legacy Ren\'Py 6.99 (experimental)',
      state: 'experimental', explanation: 'Runs the original 6.99 game under a newer Python 2 web runtime. This is not a native 6.99 port and may fail.',
      preferred: '7.4.11', alternatives: ['7.3.5', '7.5.3', '7.6.3', '7.7.3', '7.8.7'], defaultBoot: 'safe' };
    if (/^6\./.test(v) || v && vcmp(v, '7.3.0') < 0) return { id: 'legacy-other', name: 'Pre-web Ren\'Py (experimental)',
      state: 'experimental', explanation: 'Pre-7.3 games were not built for the browser. Browser playback depends on a newer compatible Python 2 runtime.',
      preferred: '7.4.11', alternatives: ['7.3.5', '7.5.3', '7.6.3', '7.7.3', '7.8.7'], defaultBoot: 'safe' };
    if (v.startsWith('7.')) return { id: 'renpy-7', name: 'Ren\'Py 7.x web runtime', state: 'supported',
      explanation: 'Uses the existing Ren\'Py 7.x Python 2 web runtimes.', defaultBoot: 'full' };
    if (v.startsWith('8.')) return { id: 'renpy-8', name: 'Ren\'Py 8.x web runtime', state: 'supported',
      explanation: 'Uses the existing Ren\'Py 8.x Python 3 web runtimes.', defaultBoot: 'full' };
    return { id: 'unknown', name: 'Unidentified Ren\'Py version', state: 'unverified',
      explanation: 'Choose a runtime after identifying the game. No compatibility is guaranteed.', defaultBoot: 'full' };
  },
  bootMode(game) { const p = this.profile(game); return game && ['safe','full'].includes(game.bootMode) ? game.bootMode : p.defaultBoot; },
  describe(game) {
    const p = this.profile(game), mode = this.bootMode(game);
    return p.name + ' · ' + (mode === 'safe' ? 'Safe boot (no editor hooks)' : 'Full editor hooks') + ' · ' + p.state;
  },
  runtimeNote(game, runtime) {
    const p = this.profile(game), r = RPY_RUNTIMES.find(x => x.v === runtime);
    if (!r) return 'This runtime is not in the installed runtime catalogue.';
    if (p.state === 'experimental') return 'Experimental legacy adapter via Ren\'Py ' + runtime + '. Original game compatibility is not verified.';
    if (game && game.ver && (game.ver[0] === '8') !== (r.py !== '2.7'))
      return 'Warning: this runtime uses a different Python generation than the game.';
    return 'Standard web runtime selection. Existing games keep their original saved choices.';
  }
});
//<<
