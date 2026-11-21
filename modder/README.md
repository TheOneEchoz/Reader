# Tankōbon Modder (beta)

A separate app from Tankōbon, with its own updates: playing Ren'Py games in the browser, Python inside the running game, live mods,
and the modding flowchart (with shared scenes). No library, login, encryption, sync or comics. It lives on the Tankōbon website
at `modder/` (https://theoneechoz.github.io/Reader/modder/) and can be installed on its own (manifest.webmanifest, sw.js).

## With Tankōbon
- In Tankōbon: Settings › Add-ons › Modder › **Get**. Each Ren'Py game's page then has **Mod this game**.
- That opens this page as `modder/?tkb=<game id>` (in Tankōbon's desktop app: inside its window, with `window.TKB_GAME`).
  `js/01-remote.js` then routes the modder's storage of games and pieces to Tankōbon on the BroadcastChannel `tankobon-modder`:
  nothing is copied, there is no library, and the flowchart opens at once (`TKB_LINK.panel` in js/95-tankobon.js).
  The Story edits mod the flowchart makes is written straight onto Tankōbon's game. Tankōbon must be open and unlocked.
- Releases: bump `ENGINE_VERSION` (js/75-nodes.js), the `?v=` in index.html, `CACHE` in sw.js, and add an entry to changelog.json.
  Tankōbon's own builds never touch this folder.

## Run it
    python3 serve.py          then open http://localhost:8765/
Add a game (folder or zip) → **Play** or **Play + flowchart**. Games and your edits are kept in this browser (IndexedDB).

**Ren'Py runtime** (the web build of Ren'Py, about 40 MB per version): the page looks for a `renpy/` folder next to `index.html`
(the same folder as in the app's website, with `8.4.1/`, `versions.txt`, …). If there is none, it downloads from the app's website.
If the runtime can't be found, the page now says so at the top and has a box to type another address. To use another place: in the browser console, `localStorage.setItem('engine.site','https://your.site/')` and reload
(the runtime is then read from `https://your.site/renpy/`).

## What is where
    index.html            the page (also has the #sheet, #toast, #shield elements the engine code looks for)
    css/app.css           the app's stylesheet, copied whole (trim what the engine does not use, later)
    css/engine.css        styles of the engine's own little page only
    js/00-shim.js         STAND-INS for what the app has around the engine: storage (plain IndexedDB, no encryption),
                          Crypt, S/ST/DB, Sync, routing (go/back/CUR), sheets, a few "not in the engine" buttons
    js/99-shell.js        the engine's own page: add a game, play, delete   (not from the app)
    js/05 … js/90         THE ENGINE: cut word for word from the app's source, in this order:
      05-helpers          h(), icons, toast, game file list, ...
      10-basics           what a game is, finding its parts, choosing a Ren'Py version, storage pieces
      20-runtime          downloading a Ren'Py version
      30-import           adding a game from a folder or zip
      35-archives         reading inside the game's files (.rpa, pieces, pictures/sounds on demand)
      40-play             the sealed frame (rpyDoc) and what runs inside it (rpyBoot), autosave
      50-livemods         mods while the game runs, hooks, errors, gamePy
      60-gamepy           running Python in the game, writing files into it, fast reload
      70-flow             the flowchart's data: FLOW_PY (reads the game's scenes), the edits file, taking edits back
      75-nodes            NEW, not in tools/parts.json yet: node kinds (basic operations), rows -> nodes, nodes -> Ren'Py
      76-charts           NEW: chart editor (charts inside charts)
      77-trace            NEW: the Trace window (corner panel in the running game: node that ran, its data, variables it changed)
      80-modder           the flowchart screen: layout, shared scenes, drawing, multi-select, editing
      90-open             the player screen (openGame) and saves
    lib/jszip.min.js      for zips
    tools/parts.py        the copy tool;  tools/parts.json  which part of the app goes in which file

## Old: putting it back in the app (no longer used: the modder is its own app now)
1. Edit anything in `js/05` … `js/90`. Keep the `//>> name` and `//<<` lines: they mark the regions.
2. Try it in the browser (reload; nothing to build).
3. Put it into the app:  `python3 tools/parts.py back /path/to/_dev/app.html`
   → writes `app.html.new` next to it. Look at `diff app.html app.html.new`, then replace `app.html`, add a changelog entry, build.
   Only the regions you changed differ (a round trip with no changes gives an identical file).
4. If the app changed since (new version): `python3 tools/parts.py extract /path/to/_dev/app.html` re-cuts js/05 … js/90 from it
   (this overwrites them, so put your changes back first, or keep them as a patch).

Things to know
- A new function the engine needs from the app (something not cut here) shows up as "X is not defined": add a stand-in in `js/00-shim.js`,
  or add its region to `tools/parts.json` (`["first line starts with", "stops before the line that starts with"]`; `"+2"` = just 2 lines).
- Do not edit `00-shim.js` or `99-shell.js` expecting it to go back: they are not part of the app.
- Code for the flowchart's Python side (`FLOW_PY`) is a template string inside `70-flow.js`.

Character + Variant (nodes-1.7): Show / Scene nodes have a **Character** (image tag) and a **Variant** field, each with a Browse button; Hide has Character only.
The variant picker lists a layered image's groups (pick one per group; defaults are marked) with a live preview, or the `image tag variant` definitions,
or (game not running) the picture file names. Say's *Appearance* has the same picker, for the speaking character's image tag. The node still stores one
`img` text ("eileen formal happy"), and anything after it (`at left`, `as`, `behind`, `onlayer`…) is kept. The preview (`_tkbimg` in js/80-modder.js) now
works out which layers show: chosen attributes + defaults of untouched groups, and the `if_all` / `if_any` / `if_not` / `condition` of each layer.

Trace window: in a running game, tap the pulse-line button (top right). Nodes from the flowchart report themselves (graphToRpy adds a
`_tkb_trace(...)` line per node, plus which branch / menu choice was taken); the game's own lines (say, jump, call, menu, python…) are
reported by a statement callback. Variables (numbers, text, True/False) that changed after a step are shown on that step. Nothing is sent
while the window is off. Python side: `RPY_TRACE` in js/77-trace.js, written into the game as game/zzzz_tankobon_trace.rpy.

Engine version is shown in the page header (ENGINE_VERSION in js/75-nodes.js; bump it per release). serve.py sends no-store so the browser never keeps old JS.

Made from app version 1.23.0-beta.44 (the shared-scenes build).


## nodes-2.7: Scene preview and live graph cursor

In Charts, **Preview scene** docks the existing running game in a small, interactive window while the chart stays visible. The highlighted node follows real Ren'Py trace events. Source file/line references are retained for unmodified scenes, and compiled charts use their exact node IDs. Nodes without a corresponding source statement are labeled accordingly. **Jump to scene** in the preview toolbar is deliberately separate: it skips earlier story state and can raise errors when variables (such as `textbox`) have not been initialized. Reach the scene normally or load a save to reproduce the original state. Closing the preview does not stop the game.

The image inspector's dynamic-image regex escaping has also been corrected; previews use read-only object traversal, while the normal Ren'Py runtime handles actual playback.


## nodes-2.8: Crash recovery and per-scene setup

**Reset game** is available from the main game controls, the chart editor, and the docked Scene Preview. It recreates the game runtime in a new iframe without requiring a full browser reload, preserving imported games, saved games, the chart editor and per-scene setup. Reset starts at the game's main menu and does **not** autosave an error-screen state. Unsaved progress is lost.

**Scene setup** (in Charts or the docked preview) stores per-label Python literal assignments such as `textbox = 2`, `rubb = 1`, `player_name = "Ruby"`. Save, then use **Jump to scene**; the engine first validates/evaluates values in the live Ren'Py store and checks the destination label, and only queues the jump if setup succeeds. Advanced initialization code is optional and runs in the game with full Python privileges; do not enter untrusted scripts. **Copy current values** reads named primitive variables from the currently running game. If an error reports a missing variable, the editor offers a shortcut to add it, but the correct value must still be chosen. Setups persist with the imported game in browser storage and are removed by clearing the editor and saving.

A direct jump still cannot reconstruct the complete preceding story history (e.g. call stack, prior screens, player choices and other state). To reproduce the original scene exactly, reach it normally or load an appropriate save. Setup values are helpful for missing variables and some other explicitly supplied prerequisites, not a guarantee that all scenes can be started independently.

## nodes-2.9: Automatic scene setup suggestions and execution diagnostics

- Scene setup now **inspects the live game's compiled Ren'Py AST** for variables read in conditions and dialogue, as well as literal values used in comparisons and assignments. It shows current store values, missing names, and per-variable possible values. The latest reported `NameError` is also included in suggestions. Suggestions must be reviewed: the engine cannot reliably reconstruct every prior story choice, screen evaluation, or Python side effect from a label alone.
- Setup stays **per scene** and is saved along with the game's library record. Leave a field blank to keep an existing variable unchanged; use the Advanced section for manual assignments or optional Python. A direct jump blocks on reliably detected missing prerequisites until the user supplies them. A game reset does not delete these settings.
- The runtime tracer now reports original Ren'Py `UserStatement` commands (which the chart importer already represented), and records unrecognized statements with their source filename and line instead of silently dropping them.
- In Charts, **Last node** recenters the graph on the most recently *confirmed* executed node. **Unmatched** lists real execution events that cannot be assigned to an existing chart node, including their source and code description, and offers a copyable diagnostic.
- A dark node means the tracker has not confirmed it ran; this is **not** proof it was skipped. Only recorded graph edges are marked visited. Ren'Py label entries are excluded from the unmatched list because they are not chart boxes.
- The version displayed in the editor and all cache-busting script references is `nodes-2.9`.


### nodes-3.0 trace diagnostics

Unmatched trace results are now classified by AST not represented, missing flow import rows, other chart, ambiguous line and graph-source mismatch. Source-file matching tolerates .rpy/.rpyc differences when the location is unambiguous. The unmatched window summarizes categories and source files; the copied JSON includes imported row information. This is a diagnostic release: it does not invent missing chart nodes.


### Transition Containers (nodes-3.3)

On the Charts page, use **+ Add node → Transition Container** to create an
open transition frame. Drag compatible, already wired commands inside; the frame
expands to contain them and its header moves all members together. Choose:

- **Once after group**: emit a single `with <transition>` after each consecutive
  run of container commands (the original Ren'Py grouped transition semantics).
- **After each**: emit a `with <transition>` immediately after every included
  command.

The container changes no wires or execution order. Existing `with` nodes are
preserved until you opt in using **Compact transitions**. The conversion only
absorbs a standalone `with` when it has a single ordinary predecessor and no
branch-edge incoming connection. Branch-sensitive transitions remain separate.
The container can be converted back to explicit `with` nodes. Scene preview
tracing continues to identify the original source statements. Save and Apply to
game to make chart edits affect the running game.

### nodes-3.4: Compact transitions fix
- The chart toolbar displays a live count of safely compactable standalone transitions. Compact + tidy also reflows the graph to close gaps.
- Clicking the button now displays a persistent result/explanation, including skipped transition reasons.
- Transitions after `Call` and inline chart-call nodes are supported where the incoming graph edge is unambiguous.
- Existing connections and execution order remain unchanged; branching/shared transitions are left intact.
- Converted frames default to **Once after group**, switchable to **After each** in the frame header.

### nodes-3.5: debugger preview / overlay hotfix
- Compact result messages are dismissible cards below the chart toolbar, not text overlapping the buttons.
- Compiler-inserted `Pass` no-op statements are omitted from the unmatched-trace diagnostic.
- Scene preview: experimental statement-level Step mode, Next and Continue. Pauses before the next Ren'Py statement; clicks/wheel inside preview release a waiting gate, while normal dialogue and choices remain interactive between gates.
- Stepping is opt-in, disabled by default, and stops when the preview closes. A game reset also clears the debugger.
- Some games may not support statement-level pauses; use Continue/Reset game if a particular Ren'Py runtime behaves unexpectedly.

### nodes-3.7: automatic transition containers on scene import
- Freshly imported Ren'Py scenes now start with safe `with` statements already converted to open Transition Containers. The default mode is **Once after group**, preserving each source `with` at its original position. The editor still lets creators switch to **After each** explicitly.
- Complex transitions or ambiguous branches stay standalone instead of risking changed game logic.
- Existing saved edited charts are not automatically rewritten. Use **Compact + tidy** manually to convert those.
- The chart reports how many containers were generated on import.
- Includes nodes-3.5 experimental step-by-step debugger, fixed overlay text, and filtered no-op Pass events.

### Nodes 3.8: Readable flow and screen/audio fixes

Newly imported charts default to **Story flow** rows, following source order with a
compact left-to-right sequence. Use the layout selector to switch to the original
**Dense graph** if preferred, and **Tidy** to recalculate. Previously saved manual
positions remain unchanged until Tidy or an explicit layout switch. Large scenes
start zoomed near their first node rather than fitting all commands as tiny dots.

`show screen vnui` and `hide screen ...` import as **Screen** operations, not Show
image nodes. Already saved imported Show-image nodes containing `screen ...` are
converted when loaded. Internal Ren'Py `Init` statements are excluded from unmatched
execution results.

Embedded game sound is automatically suspended when hidden under Charts/Modder,
when the scene preview is closed, or when the tab is hidden, and resumed when the
game or a docked preview becomes visible. The game state and track positions are
not intentionally reset by this feature.

### nodes-4.0: Legacy web runtime selection and offline inspection

- Ren'Py 7.3.5 is now in the per-game runtime selector. The engine checks the configured runtime server for a *compatible packaged* `runtime.json` before offering to download it. The official Ren'Py 7.3.5 web support ZIP exists, but does **not** automatically fulfill that server format. If it is not hosted, the UI says so instead of silently attempting a broken download.
- Imported game files no longer trigger a runtime download. Users can import pre-web 6.x games and inspect the file list, readable `.rpy` scripts, images, and contents of indexed `.rpa` archives without starting Ren'Py. Compiled `.rpyc` is not decompiled and the interactive graph still needs a compatible runtime.
- Each game card has Runtime… for manual runtime selection, checking and downloading. Selecting a runtime does not guarantee backward compatibility. Missing runtimes are downloaded on demand when playing (with confirmation).

## nodes-4.1 — Compatibility platform foundation

**Preserves all previously supported web runtimes (7.3.5, 7.4–7.8, 8.1–8.5).**

The compatibility profile is based on the original game version, independent of the selected browser runtime.
Ren'Py 6.99 receives an experimental legacy profile using a newer Python 2 web runtime (default 7.4.11); there is no official 6.99 browser runtime.

Per game: **Runtime / Compatibility…** selects the web runtime and the boot mode. **Safe boot** starts without Tankōbon tracing and editing hooks, which helps isolate old-game compatibility issues; **Full editor boot** retains the normal chart and tracing features. Changes never rewrite original game archives.

If a legacy runtime exits during startup, the game remains on a recoverable diagnostics screen. **Copy diagnostics** includes compatibility profile, boot mode, and recent runtime errors. This is a compatibility TEST framework, not a claim that 6.99 games run successfully. Native 6.99 browser playback requires additional porting or verified adapters.

## nodes-4.3: Virtual game files (experimental)

- **Virtual files** in the library opens a per-game editor even without a working web runtime. The running game also has a folder button on its top bar. You can browse root folders (including DDLC `characters/`), create folders and files, edit text, upload/replace small binary files, rename/move files, delete items, and download copies.
- Files in the original imported ZIP are never edited. Changes are stored as per-game overlays, including deletion markers, and reapplied at the next launch.
- While Ren'Py runs, the panel works against the same in-memory Emscripten filesystem used by the interpreter. High-level/stream writes, renames and deletes are recorded and sent back to per-game storage after a brief debounce. Ren'Py save files remain in the existing save system.
- Added import of `characters/` and other explicitly recognized sidecar data files outside `game/`. Reimport a previously imported game if you need those files added; the importer cannot retroactively extract them from the original ZIP after import.
- Limits: editor is designed for files up to 16 MB and text editing up to 2 MB; browser-runtime behavior depends on the Ren'Py build. Game-initiated changes to files larger than 16 MB are reported as unsupported. This feature does **not** make Ren'Py 6.99 games run on a 7.4 web runtime.


Standalone storage is local browser IndexedDB (not encrypted); the eventual host app may supply encryption through its storage adapter.

## nodes-4.4 – Actual DDLC import and Virtual Files fix
- Live file view lists only the game filesystem roots, not Python/runtime libraries.
- Restore missing game files from the original ZIP into an existing import without replacing virtual edits or saves.
- Filter Python verbose import messages from significant startup diagnostics.
- Real DDLC-1.1.1-pc ZIP used for importer regression checks. Ren'Py 6.99 browser playback is still experimental.

### nodes-4.5 — Reproducible runtime launch tests
- **Export installed runtime (test pack)** from a game's Runtime / Compatibility settings. Produces a portable ZIP containing **only** the installed browser engine (no game files, saves, characters, or workspace data). This lets a developer reproduce a game launch when the runtime server is blocked.
- **Install runtime test pack** uses an exported ZIP from a trusted installation, without reaching the external runtime host. Browser runtimes execute JS/WASM; do not import packs from untrusted sources.
- **Live runtime probe** when using **Copy diagnostics**: reports WASM execution status, Python bridge availability, canvas count, and whether the game's archive and sidecar files were mounted. Captures runtime log files while a game is stuck, not only after shutdown.
- Avoids misidentifying ordinary Python module imports such as `renpy.error` as startup failures.
- Still does not implement Ren'Py 6.99 web compatibility. To verify DDLC gameplay, testing requires a real web runtime, not merely a successful import.


### nodes-4.6 — Persistent startup failure diagnostics
- Fix: subsequent loading status events cannot hide a startup recovery panel.
- View startup diagnostics at any time; an on-page text area supports manual selection, Copy text, and Save .txt (even without clipboard permission).
- Preserve diagnostic UI on unexpected iframe navigation instead of silently returning to the game library.
- In legacy safe boot, presplash removal is not interpreted as successful playback without a live canvas and a short stable period.
- Recognize Python interpreter cleanup as evidence of probable shutdown and ignore Python verbose import/traceback cleanup chatter as fatal errors.
- Existing Ren'Py 7.x/8.x boot behavior and imported-game data are preserved.


### nodes-4.7 — DDLC Python 2 fcntl compatibility adapter

The startup report from DDLC 1.1.1 identified `ImportError: No module named fcntl` in `game/python-packages/singleton.py`, called from `game/definitions.rpy` line 7. On **legacy-6.99 only**, the browser runtime now installs a narrow Python 2 `fcntl.lockf` replacement into `/lib/python2.7/fcntl.py` just before starting Ren'Py. It supports exclusive locks, nonblocking lock contention, and unlock within one game interpreter. It does **not** emulate OS-level locks between tabs or implement the rest of the Unix `fcntl` API. The imported game archive and the per-game virtual overlay remain unchanged.

The diagnostics report whether the adapter was installed, already provided by the runtime, or failed. Ren'Py 7.x/8.x nonlegacy profiles are untouched. This specifically addresses the observed import failure, **not** full 6.99 gameplay compatibility; further errors may appear.


## nodes-4.8 — Offline reinstall and graceful game exit

- Game-directed Ren’Py shutdown no longer leaves an unresponsive player frame. On a normal post-start exit, the engine waits for pending virtual-file mutations/saves and returns to the game library; startup errors still retain the diagnostics screen.
- Pending virtual filesystem changes and available save data are flushed before the web runtime reports exit, including Ren’Py 6.99's story-driven file deletions.
- New **Reinstall offline…** action on each game: restore original files while keeping saves, or reinstall fresh and reset saved/persistent Ren’Py state. Uses the encrypted/plain chunk records already imported; doesn't download the game or runtime and doesn't overwrite the original source.
- The original imported game files, selected runtime, mods, and edited graphs are retained.


## nodes-4.9 — DDLC compiled story node explorer
- Legacy safe boot now supports **Play + nodes (read-only)** without enabling optional trace/edit hooks.
- Reads compiled Ren'Py AST through the already running interpreter; works with .rpyc in scripts.rpa.
- Searchable scene label selector (80 matching results at a time), read-only graph nodes and safe navigation.
- Existing full editor boot, normal games, virtual file manager and offline reinstall are unchanged.
- Tested against actual DDLC .rpa AST with supplied Ren'Py 7.4.11 WASM runtime: 283 labels / 16,146 statement rows.
- This version does NOT promise live tracing or editable DDLC charts in safe boot.


## nodes-5.0 — Legacy graph transport fix
- Fixed **Play + nodes (read-only)** for Ren'Py 6.99 under the 7.4.11 WebAssembly runtime. The old runtime does not expose `window.renpy_exec`, which prevented nodes-4.9 from reading the story even though the compiled AST was available.
- Legacy safe boot now writes a read-only compiled graph snapshot to the game's virtual `/tmp` during initialization and exposes it through the existing isolated iframe message bridge.
- Other Ren'Py versions, normal playback, the full editor, virtual files, and offline reinstall are unchanged.
- Reports snapshot generation errors explicitly instead of timing out on an unavailable Python bridge.


### nodes-5.1: Legacy node handoff repair

DDLC's Ren'Py 7.4.11 web runtime sometimes cannot read the `/tmp` story snapshot
from JavaScript even after Python writes it. Legacy safe boot now transfers the
compiled, read-only scene JSON to the editor directly in bounded postMessage
chunks, independently of the Emscripten filesystem bridge; the `/tmp` handoff
remains a fallback. The transfer is validated before allowing Charts to open.
Regular Play does not transmit graphs, and the standard 7.x/8.x edit hooks are
unchanged. Startup diagnostics show transfer status.

## nodes-5.2 — Legacy Python stdout graph transport

- Fixes graph snapshots in Ren'Py 7.4.11: earlier builds relied on an unreliable Python `emscripten.run_script` → parent event handoff and a cross-frame filesystem reader. In the standalone runtime the old code could write the file, but the integrated app did not retrieve it.
- The late-init graph exporter now writes the filesystem fallback independently and streams framed JSON through Python stdout, which the existing game iframe forwards to the chart editor.
- Graph transfer progress and the actual Python exception are preserved in runtime diagnostics. This applies only to Legacy safe boot with Play + nodes.

- Temporary Tankōbon-generated `.rpyc` files are excluded from the per-game writable overlay, and stale compiled editor hooks from earlier builds are ignored on load. This prevents an old graph snapshot from leaking into ordinary Play.

## nodes-5.3 — Legacy scene map and image previews

- **Play + nodes (Legacy safe boot)** now starts at an interactive **Scene map** of compiled labels, with Jump, Call, and fall-through connections. Click a scene to inspect its original command graph; **Scene map** returns to the overview, not to gameplay. Search and zoom/pan navigate large maps. Dynamic-expression targets are not guessed.
- Legacy read-only Show and Scene nodes display artwork directly from the original imported game files and indexed `.rpa` archives. Registered image filenames are included in the safe-boot graph snapshot; filename-based fallback previews work when metadata is unavailable. Multi-part/conditional sprites may be approximate.
- Image loading is lazy near the visible graph viewport and cached until the graph viewer closes. The game, its file overlay, runtime selection, save data and reinstall behavior are unchanged.

## nodes-5.4 — Legacy registered-image and archive-folder previews

- The safe-boot chart viewer is intentionally a read-only scene map and command explorer; it differs from Full editor boot to avoid startup modifications to legacy games. Scene navigation is unchanged.
- Registered image names need not match physical image filenames. Resolve uniquely named files across archive folders, and image sequences stored in folders named for the registration (DDLC: `show y_kill` -> `images/cg/y_kill/1a.png`).
- Show only a representative frame for a registered animation, not all frames overlaid. Preserve layered sprite previews where the registered definition supplies multiple layers. Image preview tooltips explain approximations.
- Validate the resolver against the real DDLC `images.rpa` index and PNG bytes: `y_kill`, `s_kill`, `bg club_day`, `sayori 1a`. This validates browser image lookup/decoding, not full in-game image compositing.


## nodes-5.5 — Legacy editable node drafts and image lookup recovery

- Legacy safe boot uses the normal writable command-node UI while preserving the working Python-2 startup path. Edits are stored as **per-game local drafts** (IndexedDB); they do not rewrite the running game or the original ZIP. The scene map and Transition Containers remain available.
- **Apply on next launch** is opt-in and experimental: after confirmation it compiles drafts as the existing Story edits mod. The runtime reads that mod at its next launch. Use **Disable Story edits** in the game library to recover if a modified legacy script fails to start. Live statement tracing, step-by-step debugging and hot-swapping a scene are not yet available in safe boot.
- Legacy image resolver indexes image-named `.rpa` archives first; it indexes unrelated archives only if a requested picture was not found. This avoids blocking common backgrounds on unrelated archive reads. Images remain lazy-loaded near the viewport even in the editable legacy graph.
- A stalled image lookup now times out with diagnostic text and a **Retry** button instead of displaying `looking…` forever. Archive lookups are cached while the chart is open. Registered sprites and animations still show best-effort static previews.
- Verified against DDLC's real image bytes and a Chromium editor smoke test covering scene navigation, editing, automatic draft persistence, explicit apply, and discarding a draft. This does not prove all DDLC scene modifications execute correctly in real gameplay.


### nodes-5.6 — Unified Modding editor for legacy games
- Legacy safe boot now opens the **same** primary Modding scene-flow canvas as other games, instead of a separate scene-map UI. Search/filter, scene boxes, selection, Changes and Charts/command-node editing share one interface.
- Legacy changes stay in **per-game local drafts**. Apply next launch explicitly generates an experimental Story edits mod. Live Python evaluation, jump-to-scene and live trace remain disabled for the older web runtime.
- Legacy command-node image previews keep their archive-backed resolver and Retry support. Existing native runtime Modding behavior is unchanged.

## nodes-5.7 — Offline graph drafts, structural checks and undo/redo

This is the **first incremental step** toward a game-independent, runtime-free
Ren'Py modding workflow. It does not claim to decompile `.rpyc` or to fully
reproduce Ren'Py parsing outside the game.

### New workflow

- **Offline nodes** on an imported game's library card opens the shared Modding
  editor **without booting Ren'Py**, when a previously saved compiled-story
  snapshot exists for that same imported game. The first time you open Modding
  from a *running* game (including the legacy safe-boot graph), Tankōbon saves a
  local AST snapshot for subsequent offline editing. It records the original
  story view separately from editable draft patches.
- A **fresh compiled-only game without a cached snapshot** cannot yet open its
  node graph offline. The button explains this limitation. **Inspect archives**
  and **Virtual files** still work without a runtime for readable text sources.
  Full standalone `.rpy`/`.rpyc` parsing is follow-up work.
- **Export draft** saves a portable `.json` file containing only the node patch
  data and game title/version metadata. It excludes original game archives,
  compiled story snapshots, images, saves, and runtime files. Export before
  importing a replacement draft to preserve your previous changes.
- **Import draft** validates the schema and structural graph basics, warns on
  a different game/version, and asks before **replacing** the current game's
  local draft. Import never executes code, enables a mod or starts Ren'Py.
  Only a later explicit **Apply on next launch** enables Story edits.
- When generated Story edits are written in online mode, the local draft is
  synchronized so offline editing does not start with an outdated patch set.

### Graph editing and validation

- Graph toolbar has **Undo** and **Redo**, also Ctrl/Cmd+Z and Ctrl/Cmd+Y or
  Ctrl/Cmd+Shift+Z. Input fields retain native text undo while focused. Graph
  history stores up to 30 steps **per top-level chart during the current editor
  session**; it is not persisted through page refreshes. Undoing the first edit
  to an original scene removes its new override patch rather than leaving an
  unnecessary entire-scene replacement.
- **Validate** reports duplicate node IDs, dangling wires, absent start nodes,
  impossible branch/loop structures, unreferenced labels (warning), unreachable
  nodes (warning), and raw multiline code that cannot be emitted safely.
  Apply is blocked on structural **errors**; warnings require acknowledgment.
  The same error checks run when applying drafts from the outer Modding screen.
  This is **not** a Ren'Py syntax or Python validator; compatibility and
  behavior still need tests in the original game/version.
- Imported `return expression` and `jump/call expression` statements now retain
  their arguments when converted to command nodes, rather than silently
  discarding them. This is an incremental importer fix, **not** a claim of a
  lossless AST round trip. In particular, the runtime's Python rows still
  provide only an excerpt of source text.

### Development and verification

Run `node tests/graph-validation.test.js` and
`node tests/node-draft.test.js` for dependency-free regression checks; validate
all JavaScript files with `node --check js/*.js` (or a shell loop).
The visual UI and actual mod execution should still be tested in a browser
against a range of Ren'Py games/versions before release. There is no automated
full-game compatibility suite in this package.

**Standalone/app integration:** The `index.html` script list includes the new
`js/81-node-projects.js`. `tools/parts.json` is the old original-app extractor
manifest and does not yet embed new standalone-only modules; when porting these
changes into an existing host app, copy/load the new script and the matching
updated code rather than assuming the old extractor will carry it over.


## nodes-5.8 — branch-aware layout and hidden-game audio

Use **Tidy** in Charts to reflow an existing scene. (Imported charts with no saved
coordinates are laid out automatically.) Story flow now prioritizes the first
outgoing path, keeps the **ordinary node input and output on the node header baseline**,
and places branching output pins beside their corresponding option labels, with secondary paths in lower rows. Sequences of connected nodes
are placed on a straight line until the row reaches eight nodes. Tidy preserves
node IDs, connection targets, source code, and saved changes; it only replaces
positions, and existing Undo can reverse it.

A menu with at least **two branches that visibly return via node connections**
to that menu gets a separate labeled choice lane for each returning conversation.
The grouping is presentation-only: it does not create, rewrite, or flatten any
Ren'Py subscene. Indirect Python / call / jump transitions are not inferred.
Other conditionals and unsupported branches are still shown as ordinary graph
nodes. **Dense graph** remains selectable in the layout dropdown.

Connections now use header-aligned straight wires where possible, separate
elbow/return tracks when necessary, and are emphasized when hovering a node.
Return tracks are dashed to distinguish them from normal forward story flow.
The drawing avoids running an aligned edge through an intervening node.
Large-graph routing uses spatial buckets rather than scanning every other node
for each connection.

Game sound is permitted only while the game is actually visible: hidden tabs,
editor overlays without a docked preview, app sheets, offscreen/covered game
iframes, and invisible game containers are muted. The game's playback position
is preserved and sound is restored when the game becomes visible again.
Visibility is rechecked automatically, including when an overlay forgets to
signal a UI state change.

Code integration note: `js/76-layout.js` is a **new standalone module** loaded
before `js/76-charts.js` via `index.html`. If integrating these changes back
into a different host app, load it in the host too; the old `tools/parts.py`
map does not automatically copy this new module. The tests can be run using
`node tests/layout-routing.test.js` and the other test scripts.


## nodes-5.9 — compact routes, large-scene rendering, audio gating, reopen
- Compact return curves replace scene-wide bottom routing rails; crossings are allowed, overlapping straight segments are not. Control-flow edges are unchanged.
- Click an edge to pin its highlight; click it again or click the background to clear it. Hover still highlights connections. Wider transparent hit-targets improve edge selection.
- Large charts (>320 nodes) create only viewport-near node elements and viewport-near SVG paths; the graph data is retained intact. Routing is cached on pan and redrawn at most once per animation frame while nodes move.
- Hidden-game audio begins muted, intercepts Web Audio resume() and media play() while the game is not visible, and resumes only when the parent confirms visibility. This avoids repeated suspend/resume audio stutter.
- Reset game remembers the last opened game ID and can reopen a closed game from the editor, retaining saves.

These changes are editor presentation and runtime controls. They do not rewrite the game's story. Live Ren'Py 6.99 gameplay is not automatically covered by the synthetic regression tests.

## nodes-5.9.1 — top-left game preview resizing
- The docked game preview now has a dedicated resize grip in its top-left corner instead of the browser's bottom-right resize control. Drag up and left to enlarge; drag down and right to shrink.
- The preview remains anchored at its bottom-right corner without reloading the Ren'Py iframe. The native bottom-right grip is disabled.
- The grip supports touch/pointer dragging, keyboard arrow keys (Shift for larger steps), and viewport size limits. Closing the preview removes inline sizing so the full-screen game can open normally.


## nodes-5.10 — its own app, linked with Tankōbon
- Lives on the Tankōbon website as `modder/`, with its own manifest, service worker, version and changelog.json.
- Games come from Tankōbon (“Mod this game”), and the Story edits go back with Send to Tankōbon (js/95-tankobon.js).
- The Ren'Py runtime is found next to this page or one folder up (the website's renpy/), else on the Tankōbon website.

## nodes-5.11 — no copy
- “Mod this game” opens the flowchart at once, working on Tankōbon's own game through js/01-remote.js; Ren'Py's runtime is
  Tankōbon's too. Games copied here by nodes-5.10 keep Send to Tankōbon.
