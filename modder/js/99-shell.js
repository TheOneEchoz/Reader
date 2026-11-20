/* THE ENGINE'S OWN PAGE (not from the app): add a game from a folder or a zip, play it, open the flowchart, delete it. */
(async () => {
  $('#sheet .scrim').addEventListener('click', closeSheet);
  $('#sheetClose').append(icon('x')); $('#sheetClose').addEventListener('click', closeSheet);
  const box = $('#games');
  const status = h('div', { class: 'engineinfo', id: 'addstatus', role: 'status' });
  const pickDir = h('input', { type: 'file', webkitdirectory: '', multiple: '', id: 'pick-dir' });
  const pickZip = h('input', { type: 'file', accept: '.zip,.apk', multiple: '', id: 'pick-zip' });
  const add = async files => {
    try {
      status.textContent = 'Reading…'; status.style.color = '';
      const { games } = await rpyGamesIn([...files]);
      if (!games.length) { status.textContent = 'No Ren\'Py game found in that.'; return; }
      for (const gm of games) {
        gm.det = await rpyVersion(gm.found).catch(() => ({})); const pick = rpyChoose(gm.det);
        // Import and file analysis work without any web runtime download. Old games
        // need an explicitly selected compatible runtime only when actually played.
        if (pick.old) status.textContent = `Legacy game: Ren'Py ${gm.det.v}. Importing files for inspection; browser playback may be incompatible.`;
        status.textContent = `Adding “${gm.title}”…`;
        await rpyImport(gm.found, gm.title, gm.det, pick.rt, (d, t) => { status.textContent = `Adding “${gm.title}”: ${Math.round(100 * d / t)}%`; });
      }
      status.textContent = 'Added.'; await draw();
    } catch (e) { status.textContent = 'Could not add: ' + (e.message || e); status.style.color = 'var(--accent)'; toast(status.textContent, 6000); console.error(e); }
  };
  pickDir.onchange = () => add(pickDir.files); pickZip.onchange = () => add(pickZip.files);
  // Legacy Ren'Py 7.4 web builds lack window.renpy_exec. Compiled graphs
  // arrive through the separate filesystem snapshot bridge, not gamePy().
  const storyReady = async (legacy = false) => {
    if (legacy) {
      for (let k = 0; k < 60; k++) {
        if (!GAME.frame) return false;
        if (GAME.legacyGraphReady) return true;
        if (GAME.legacyGraphError) { console.warn('Legacy graph:', GAME.legacyGraphError); return false; }
        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    }
    for (let k = 0; k < 120; k++) {
      if (!GAME.frame) return false;
      if (await gamePy('result = len(renpy.game.script.namemap) > 0', 2500) === true) return true;
      await new Promise(r => setTimeout(r, 750));
    }
    return false;
  };
  const play = (g, modding) => {
    // Legacy safe boot extracts the compiled AST without injecting the
    // optional tracing/editing hooks. The node editor can save local drafts;
    // only explicit Apply on next launch generates a Story edits mod.
    // Normal Play remains exactly the tested legacy safe-boot path.
    GAME.legacyNodesRequested = !!(modding && TKB_COMPAT.bootMode(g.game) === 'safe' && TKB_COMPAT.profile(g.game).id === 'legacy-6.99');
    CUR = { view: 'game', params: { id: g.id } };
    GAME.afterReady = modding ? async () => {
      const legacy = TKB_COMPAT.bootMode(g.game) === 'safe' && TKB_COMPAT.profile(g.game).id === 'legacy-6.99';
      if (await storyReady(legacy)) openModder(g.id);
      else toast(legacy ? 'The legacy story snapshot was not available. Try Play + nodes again or check startup diagnostics.' : 'The story could not be read from this game.', 6000);
    } : null;
    openGame(g.id);
  };
  // This inspector deliberately doesn't start Ren'Py: useful for 6.x games
  // and for examining source scripts, pictures and archives offline.
  async function inspectFiles(g) {
    const list = await gameFileList(g);
    const view = h('div', { class: 'tkb-inspect-view' });
    const note = h('div', { class: 'engineinfo' }, `${list.length} stored files. Text scripts can be read without launching Ren'Py; .rpyc is compiled and needs a compatible interpreter for story graphs.`);
    const inp = h('input', { type: 'search', placeholder: 'Find a file or image…', class: 'tkb-file-search' });
    const rows = h('div', { class: 'tkb-file-results' });
    const preview = h('div', { class: 'tkb-file-preview' }, 'Select a file to inspect it.');
    let indexed = list.filter(f => !/\.rpa$/i.test(f.p)).map(f => ({ name: f.p.replace(/^game\//i, ''), size: f.s }));
    const objects = [];
    const reader = async name => {
      const f = await gameFileReader(list, name);
      if (!f) throw new Error('Unable to read the selected file from this archive.');
      return new Uint8Array(await f());
    };
    const show = async f => {
      preview.replaceChildren(h('span', {}, 'Reading ' + f.name + '…'));
      try {
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        if (/^(rpy|rpym|txt|json|md|ini|cfg|log|csv)$/.test(ext)) {
          const bytes = await reader(f.name);
          preview.replaceChildren(h('pre', { class: 'tkb-file-code' }, new TextDecoder().decode(bytes.subarray(0, 400000)) + (bytes.length > 400000 ? '\n… (first 400 KB shown)' : '')));
        } else if (/^(png|jpe?g|webp|gif|bmp|svg)$/.test(ext)) {
          const bytes = await reader(f.name); const url = URL.createObjectURL(new Blob([bytes])); objects.push(url);
          preview.replaceChildren(h('img', { src: url, alt: f.name, class: 'tkb-inspect-img' }));
        } else preview.replaceChildren(h('div', { class: 'engineinfo' }, "This file is binary or compiled. Its name and size can be inspected, but a Ren'Py runtime is needed to decode the script statements."));
      } catch (e) { preview.replaceChildren(h('div', { class: 'engineinfo' }, String(e.message || e))); }
    };
    const renderRows = () => {
      const q = inp.value.toLowerCase().trim();
      const found = indexed.filter(f => f.name.toLowerCase().includes(q));
      rows.replaceChildren(...found.slice(0, 120).map(f =>
        h('button', { type: 'button', class: 'tkb-file-item', onclick: () => show(f) },
          f.name, h('span', { class: 'engineinfo' }, f.size == null ? '' : mb(f.size)))));
      note.textContent = `${list.length} stored files · ${found.length} matching filenames` + (found.length > 120 ? ' (showing first 120)' : '');
    };
    const scan = h('button', { type: 'button', class: 'btn', onclick: async () => {
      scan.disabled = true; scan.textContent = 'Indexing .rpa archives…';
      let count = 0;
      try {
        for (const archive of list.filter(x => /\.rpa$/i.test(x.p))) {
          const idx = await rpaIndex(archive);
          if (idx) for (const [name, spec] of idx) {
            indexed.push({ name, size: spec.l }); count++;
          }
        }
        scan.textContent = `${count} archive entries indexed`;
        renderRows();
      } catch (e) { scan.textContent = `Archive scan error: ${String(e.message || e).slice(0, 90)}`; }
    } }, 'List files inside .rpa archives');
    inp.addEventListener('input', renderRows);
    view.append(note, inp, scan, h('div', { class: 'tkb-file-columns' }, rows, preview));
    openSheet('Inspect files — ' + g.title, view, () => objects.forEach(URL.revokeObjectURL));
    renderRows();
  }
  async function runtimeSettings(g) {
    const profile = TKB_COMPAT.profile(g.game);
    const desc = h('div', { class: 'engineinfo' }, `Game was built with Ren'Py ${g.game.ver || 'unknown'}. ${profile.name}. ${profile.explanation}`);
    const bootLabel = h('div', { class: 'engineinfo' }, 'Boot behavior (per game)');
    const boot = h('select', { class: 'tkb-runtime-select' },
      h('option', { value: 'safe' }, 'Legacy safe boot — no optional tracing/editing hooks'),
      h('option', { value: 'full' }, 'Full editor boot — tracing, modifications, live graph'));
    boot.value = TKB_COMPAT.bootMode(g.game);
    const compatibilityNote = h('div', { class: 'engineinfo', role: 'status' }, '');
    const refreshNote = () => compatibilityNote.textContent = TKB_COMPAT.runtimeNote(g.game, selected.value) +
      (boot.value === 'safe' ? ' In safe boot, live trace and modding are intentionally disabled.' : ' Full boot includes the regular editor hooks.');

    const selected = h('select', { class: 'tkb-runtime-select' }, ...RPY_RUNTIMES.map(r => h('option', { value: r.v },
      `Ren'Py ${r.v}${r.experimental ? ' (early web, experimental)' : ''}`)));
    selected.value = g.game.rt || rpyChoose({ v: g.game.ver, py: g.game.py }).rt;
    selected.addEventListener('change', refreshNote); boot.addEventListener('change', refreshNote); refreshNote();
    const state = h('div', { class: 'engineinfo', role: 'status' }, 'Select a version and click Check availability.');
    const check = h('button', { class: 'btn', type: 'button', onclick: async () => {
      state.textContent = `Checking Ren'Py ${selected.value}…`;
      const r = await RPY.check(selected.value);
      state.textContent = r.reason + (r.installed ? ' — Ready to use.' : '');
    } }, 'Check availability');
    const save = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      const fresh = await S.gal(g.id); fresh.game.rt = selected.value; fresh.game.bootMode = boot.value;
      await saveGallery(fresh); state.textContent = `Selected Ren'Py ${selected.value} with ${boot.value} boot. This does not download the runtime.`; await draw();
    } }, 'Use this runtime');
    const dl = h('button', { class: 'btn', type: 'button', onclick: async () => {
      const v = selected.value; dl.disabled = true; state.textContent = `Checking Ren'Py ${v}…`;
      try {
        const ck = await RPY.check(v);
        if (!ck.available) { state.textContent = ck.reason; return; }
        if (ck.installed) { state.textContent = "Ren'Py " + v + ' is already downloaded.'; return; }
        if (!confirm(`Download Ren'Py ${v} web runtime from the configured server?`)) return;
        await RPY.download(v, (done, total) => { state.textContent = `Downloading Ren'Py ${v}: ${mb(done)} / ${mb(total)}`; });
        state.textContent = `Ren'Py ${v} downloaded successfully.`; await draw();
      } catch (e) { state.textContent = String(e.message || e); }
      finally { dl.disabled = false; }
    } }, 'Download selected runtime');
    const packPicker = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, 'aria-label': 'Choose exported RenPy runtime test pack' });
    const exportPack = h('button', { class: 'btn', type: 'button', onclick: async () => {
      const v = selected.value;
      exportPack.disabled = true;
      state.textContent = `Preparing installed Ren'Py ${v} runtime test pack…`;
      try {
        const blob = await RPY.exportPack(v, (done, total) => {
          state.textContent = `Exporting Ren'Py ${v}: ${mb(done)} / ${mb(total)}`;
        });
        const url = URL.createObjectURL(blob);
        const link = h('a', { href: url, download: `tankobon-renpy-${v}-runtime-test.zip` });
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        state.textContent = `Saved runtime test pack for Ren'Py ${v}. It contains no game files or saves.`;
      } catch (e) { state.textContent = String(e.message || e); }
      finally { exportPack.disabled = false; }
    } }, 'Export installed runtime (test pack)');
    const importPack = h('button', { class: 'btn', type: 'button', onclick: () => packPicker.click() }, 'Install runtime test pack');
    packPicker.addEventListener('change', async () => {
      const file = packPicker.files && packPicker.files[0], v = selected.value;
      if (!file) return;
      packPicker.value = '';
      if (!confirm(`Only import browser runtime ZIPs exported from a trusted Tankōbon installation. Runtime packs contain executable JS/WASM. Install Ren'Py ${v} from this file?`)) return;
      importPack.disabled = true;
      try {
        await RPY.installPack(v, file, (done, total) => {
          state.textContent = `Installing Ren'Py ${v}: ${mb(done)} / ${mb(total || done)}`;
        });
        state.textContent = `Ren'Py ${v} installed from the test pack.`;
        await draw();
      } catch (e) { state.textContent = String(e.message || e); }
      finally { importPack.disabled = false; }
    });
    openSheet("Ren'Py compatibility — " + g.title, h('div', { class: 'stack' }, desc, selected, bootLabel, boot, compatibilityNote,
      h('div', { class: 'addbox' }, check, save, dl, exportPack, importPack, packPicker), state,
      h('p', { class: 'engineinfo' }, 'Runtime test packs contain the selected installed web runtime ONLY, never DDLC, character files, saves, or library data. This is useful for reproducing a launch when the runtime download server is inaccessible. Import only packs you trust.'),
      h('p', { class: 'engineinfo' }, "Ren'Py 7.3.5 web support was released officially, but this downloader requires a compatible prepackaged runtime.json on your configured runtime server. If not hosted, selecting it cannot make it downloadable."),
      h('a', { href: 'https://www.renpy.org/release/7.3.5', target: '_blank', rel: 'noopener noreferrer' }, "Official Ren'Py 7.3.5 release details")));
  }
  // Offline reinstall: the imported game chunks are the permanent source.
  // DDLC's deletes and edits live only in a separate writable overlay.
  async function reinstallGame(g) {
    const body = h('div', { class: 'stack' });
    const state = h('p', { class: 'engineinfo', role: 'status' }, 'Choose how much to reset.');
    const note = h('p', { class: 'engineinfo' },
      'Restores all original game files, including characters deleted by the story, from the copy already stored in Tankōbon. No download, original ZIP, or runtime reinstall is needed. Your imported game, graph edits, and installed runtimes remain.');
    const actions = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px' });
    const reset = async keepSaves => {
      const heading = keepSaves ? 'Restore original files?' : 'Start completely fresh?';
      const explanation = keepSaves
        ? 'Discard all virtual-file edits and deletions, including story changes. Existing saves and Ren’Py persistent data are kept.'
        : 'Discard all virtual-file edits and deletions AND permanently delete this game’s stored Ren’Py saves and persistent data. Your original imported game remains installed.';
      if (!(await askYes(heading, explanation, keepSaves ? 'Restore files' : 'Reinstall fresh'))) return;
      for (const button of actions.querySelectorAll('button')) button.disabled = true;
      state.textContent = 'Restoring from the locally stored original files…';
      try {
        const result = await TKB_VFS.reinstall(g.id, { keepSaves });
        closeSheet();
        await draw();
        toast(`Restored ${result.restored} original game files. ${keepSaves ? 'Saves kept.' : 'Saves and story progress reset.'}`, 5000);
      } catch (err) {
        state.textContent = 'Reinstall failed: ' + String(err.message || err);
        for (const button of actions.querySelectorAll('button')) button.disabled = false;
      }
    };
    actions.append(
      h('button', { class: 'btn', type: 'button', onclick: () => reset(true) }, 'Restore game files · keep saves'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => reset(false) }, 'Fresh reinstall · erase saves'));
    body.append(note, actions, state);
    openSheet('Reinstall “' + g.title + '” offline', body);
  }
  async function draw() {
    const gs = (await S.gals()).filter(isGame);
    box.replaceChildren(
      h('div', { class: 'addbox' }, h('label', { class: 'btn primary', for: 'pick-dir' }, 'Add a game folder'), h('label', { class: 'btn', for: 'pick-zip' }, 'Add a zip'), pickDir, pickZip, status),
      ...gs.map(g => h('div', { class: 'gamecard', 'data-id': g.id }, h('div', { class: 'grow' }, h('b', {}, g.title),
          h('span', { class: 'sub' }, `${g.fromTkb ? 'From Tankōbon · ' : ''}Game: Ren'Py ${g.game.ver || 'unknown'} · Browser runtime: ${g.game.rt} · ${g.game.files} files`),
          g.game.ver && vcmp(g.game.ver, '7.3.0') < 0 ? h('span', { class: 'sub', style: 'color:#edab72;white-space:normal' }, `Experimental legacy compatibility · ${TKB_COMPAT.bootMode(g.game)} boot · no 6.99 web runtime`) : null),
        g.fromTkb ? h('button', { class: 'btn primary', title: 'Send the Story edits made here to Tankōbon, as a mod on this game', onclick: () => TKB_LINK.send(g.id) }, 'Send to Tankōbon') : null,
        h('button', { class: g.fromTkb ? 'btn' : 'btn primary', onclick: () => play(g) }, 'Play'),
        h('button', { class: 'btn', onclick: () => play(g, true) }, TKB_COMPAT.bootMode(g.game) === 'safe' ? 'Play + nodes (edit drafts)' : 'Play + flowchart'),
        h('button', { class: 'btn', title: 'Edit a saved story snapshot without starting Ren’Py. An existing compiled-story snapshot is required.', onclick: () => openOfflineNodes(g.id) }, 'Offline nodes'),
        h('button', { class: 'btn ghost', title: 'Export node changes only; no original game scripts or assets', onclick: () => tkbExportNodeProject(g).catch(e => toast('Draft export failed: ' + (e.message || e), 5500)) }, 'Export draft'),
        h('label', { class: 'btn ghost', title: 'Import portable graph changes as drafts; this will not start or modify the game' }, 'Import draft',
          h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: async e => {
            try { await tkbImportNodeProject(g, e.target.files?.[0]); }
            catch(err) { toast('Draft import failed: ' + (err.message || err), 7000); }
            finally { e.target.value = ''; }
          } })),
        h('button', { class: 'btn', onclick: () => openVirtualFiles(g) }, 'Virtual files'),
        h('button', { class: 'btn', onclick: () => inspectFiles(g) }, 'Inspect archives'),
        h('button', { class: 'btn', onclick: () => runtimeSettings(g) }, 'Runtime / Compatibility…'),
        h('button', { class: 'btn', onclick: () => reinstallGame(g) }, 'Reinstall offline…'),
        (g.game.mods || []).some(m=>m.flow) ? h('button', { class: 'btn ghost', title: 'Disable or re-enable the generated Story edits mod without launching a broken game', onclick: async () => {
          const mod=(g.game.mods||[]).find(m=>m.flow);
          if (!mod) return;
          if (mod.on && !confirm('Disable Story edits for '+g.title+'? Your saved node drafts and the mod will be kept. The original scenes will run the next time you launch.')) return;
          await setModOn(g.id,mod.id,!mod.on); await draw();
          toast(mod.on ? 'Story edits enabled for next launch.' : 'Story edits disabled for next launch.',3300);
        } }, (g.game.mods||[]).find(m=>m.flow)?.on ? 'Disable Story edits' : 'Enable Story edits') : null,
        h('button', { class: 'btn ghost', onclick: async () => { if (!(await askYes('Delete this game?', g.title, 'Delete'))) return; await ST.delMany('images', await rpyIds(g)); await ST.del('galleries', g.id); draw(); } }, 'Delete'))),
      ...(gs.length ? [] : [h('p', { class: 'hint' }, 'No games yet. Add a Ren\'Py game (a folder or a zip), or use “Mod this game” in Tankōbon.')]));
    const reg = await RPY.reg(); $('#runtimeinfo').textContent = 'Runtime from ' + RPY_BASE + (Object.keys(reg).length ? ' · have ' + Object.keys(reg).join(', ') : '');
    probeRuntime();
  }
  /* Runtime availability only gates playback, not importing or inspecting game files. */
  async function probeRuntime() {
    let ok = false;
    try { ok = (await fetch(RPY_BASE + 'versions.txt', { cache: 'no-store' })).ok || (await fetch(RPY_BASE + '8.4.1/runtime.json', { cache: 'no-store' })).ok; } catch (e) { }
    const old = $('#rtwarn'); if (old) old.remove();
    if (ok) return;
    const inp = h('input', { type: 'text', placeholder: 'https://your.site/   (the folder that holds renpy/)', style: 'flex:1;min-width:220px;padding:8px 10px;border:1.5px solid var(--line);border-radius:10px;background:var(--surface);color:inherit' });
    const save = () => { const v = inp.value.trim(); try { v ? localStorage.setItem('engine.site', v) : localStorage.removeItem('engine.site'); } catch (e) { } location.reload(); };
    box.prepend(h('div', { id: 'rtwarn', class: 'gamecard', style: 'flex-wrap:wrap' },
      h('div', { class: 'grow', style: 'min-width:100%' }, h('b', { style: 'white-space:normal' }, 'The Ren\'Py runtime could not be found.'),
        h('span', { class: 'sub', style: 'white-space:normal' }, `Nothing answered at ${RPY_BASE}. Game files can still be imported and inspected; playing and live flowcharts need a hosted web runtime. To change the runtime source, provide a site containing renpy/versions.txt and renpy/<version>/runtime.json:`)),
      inp, h('button', { class: 'btn primary', onclick: save }, 'Use this address')));
  }
  window.ENGINE = { draw, add, play };
  await draw();
})();
