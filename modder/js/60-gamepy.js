/* Running Python in the game, writing files into it, fast reload */
//>> js/60-gamepy.js#0
const TRIAL_FILE = 'game/zzzz_tankobon_trial.rpy';
const trialText = scene => `init 1999 python:\n    def _tkb_trial_after():\n        store._tkb_cmd = ("jump", ${JSON.stringify(scene)})\n    config.after_load_callbacks.append(_tkb_trial_after)\n`;
function gameWrite(files, ms = 8000) {
  return new Promise(res => {
    if (!GAME.frame || !GAME.loaded) return res(false);
    GAME.pyq = GAME.pyq || new Map(); const q = Math.random().toString(36).slice(2);
    const t = setTimeout(() => { GAME.pyq.delete(q); res(false); }, ms);
    GAME.pyq.set(q, m => { clearTimeout(t); res(!!m.result); });
    GAME.frame.contentWindow.postMessage({ t: 'writefiles', q, files }, '*');
  });
}
/* the fixes mods' files as they are now (to write into the running game) */
async function fixFilesNow(gid) {
  const g = await S.gal(gid), out = [];
  for (const m of (g.game.mods || []).filter(x => x.fixes && x.on)) for (const f of (await rpyGetJSON(m.list)) || []) out.push({ p: f.p, text: new TextDecoder().decode(await rpyRead(f.c, f.s)) });
  return out;
}
/* Ren'Py reloads its script in place: much faster than starting the game again (nothing is read again) */
async function fastReload(gid, files) {
  if (!GAME.frame || !GAME.loaded || !GAME.g || GAME.g.id !== gid || !isRenpy(GAME.g)) return false;
  if (!(await gameWrite(files))) return false;
  await gameAutosave(); // (to come back to, if Ren'Py cannot put the game back where it was after reloading)
  const before = await gamePy('result = id(renpy.game.script)', 3000); if (before == null) return false;
  gameCmd(['reload']);
  let menuSince = 0, loaded = false;
  for (let k = 0; k < 90; k++) { // (until the reloaded game is back where it was)
    await new Promise(z => setTimeout(z, 500));
    const r = await gamePy('result = [id(renpy.game.script), renpy.get_screen("main_menu") is None and renpy.game.context().current is not None]', 2000);
    if (window.TKB_DEBUG) console.log('reload wait', k, JSON.stringify(r), before, menuSince, loaded);
    if (!r || r[0] === before) continue;
    if (r[1]) return true;
    // reloaded, but at the main menu (the place could not be found again, as when the script changed there): load the auto-save
    menuSince = menuSince || Date.now();
    if (!loaded && Date.now() - menuSince > 1500) { const g = await S.gal(gid), slot = await newestSlot((await rpyGetJSON(g.game.sv)) || {}); if (window.TKB_DEBUG) console.log('reload load', slot); if (!slot) return false; gameCmd(['load', slot]); loaded = true; }
  }
  return false;
}
/* ===== Modding mode: the story of a Ren'Py game as a flowchart that can be changed =====
   The game itself tells the story's structure (its compiled script: scenes = labels, lines, choices, jumps and calls). An edit
   is a small patch ({op, key, ...}) kept in the game's "Story edits" mod: the mod's file holds the patches, the scenes and
   choices they need (plain Ren'Py), and a few lines of Python that put the patches to work when the game starts. The game's own
   files are never changed: switch the mod off on the game's page to play the game as it was. */
//<<
