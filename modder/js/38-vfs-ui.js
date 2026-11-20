/* Files: browsable per-game virtual workspace, available with or without playback. */
async function openVirtualFiles(gameOrId) {
  const g = typeof gameOrId === 'string' ? await S.gal(gameOrId) : await S.gal(gameOrId.id);
  if (!isGame(g)) return;
  let current = '', selected = null, rows = [], closed = false, busy = false;
  const urls = [];
  const root = h('div', { class: 'tkb-vfs' });
  const caption = h('div', { class: 'engineinfo' }, 'This is an isolated copy of the game files. The imported ZIP is never changed.');
  const location = h('div', { class: 'tkb-vfs-path' });
  const search = h('input', { type: 'search', placeholder: 'Search filenames…', class: 'tkb-file-search', 'aria-label': 'Search virtual files' });
  const status = h('div', { class: 'engineinfo', role: 'status' });
  const listBox = h('div', { class: 'tkb-file-results tkb-vfs-list' });
  const content = h('div', { class: 'tkb-file-preview tkb-vfs-preview' }, 'Choose a file to view or edit it.');
  const tb = h('div', { class: 'tkb-vfs-actions' });
  const nav = h('div', { class: 'tkb-vfs-actions' });
  const upload = h('input', { type: 'file', multiple: '', 'aria-label': 'Add files', hidden: true });
  const restoreZip = h('input', { type: 'file', accept: '.zip', 'aria-label': 'Choose original game ZIP to restore missing files', hidden: true });
  const btn = (text, cb) => h('button', { class: 'btn small', type: 'button', onclick: cb }, text);
  const feedback = message => { status.textContent = String(message || ''); };
  async function action(cb) {
    if (busy || closed) return;
    busy = true;
    try { await cb(); } catch (e) { feedback('Could not change the file: ' + String(e.message || e)); }
    finally { busy = false; }
  }
  function clearUrls() { for (const u of urls.splice(0)) URL.revokeObjectURL(u); }
  function inDir(p) { return (current ? p.startsWith(current + '/') : true) && p !== current; }
  function parent(p) { return p.split('/').slice(0,-1).join('/'); }
  function fileName(p) { return p.split('/').pop(); }
  const fullName = raw => TKB_VFS.path([current, raw].filter(Boolean).join('/'));
  async function refresh() {
    if (closed) return;
    rows = await TKB_VFS.list(g);
    const mode = TKB_VFS.live(g.id) ? 'LIVE — game files in Ren\'Py\'s running filesystem (engine libraries hidden)' : 'Saved game files — changes apply when you next start the game';
    caption.textContent = `${mode}. Edits are saved for this game only; its original imported ZIP is unchanged.`;
    render();
  }
  function render() {
    if (closed) return;
    location.replaceChildren(btn('Root', () => { current = ''; search.value = ''; render(); }),
      ...current.split('/').filter(Boolean).map((part, idx, all) => h('span', { class: 'tkb-vfs-crumb' }, ' / ',
        btn(part, () => { current = all.slice(0, idx+1).join('/'); search.value=''; render(); }))));
    const query = search.value.toLowerCase().trim();
    let displayed;
    if (query) displayed = rows.filter(e => e.p.toLowerCase().includes(query));
    else displayed = rows.filter(e => parent(e.p) === current);
    displayed.sort((a, b) => Number(b.dir) - Number(a.dir) || a.p.localeCompare(b.p));
    listBox.replaceChildren(...displayed.slice(0, 800).map(e => h('button', { type: 'button', class: 'tkb-file-item', onclick: () => {
      if (e.dir) { current = e.p; search.value = ''; selected = null; content.textContent = 'Select a file to inspect or edit.'; render(); }
      else show(e).catch(err => feedback(String(err.message || err)));
    } }, h('span', {}, (e.dir ? '📁 ' : '📄 ') + (query ? e.p : fileName(e.p))),
    h('span', { class: 'engineinfo' }, e.dir ? '' : mb(e.size || 0)))));
    status.textContent = `${displayed.length} items${displayed.length > 800 ? ' (first 800 shown)' : ''} · ${rows.length} entries total`;
  }
  async function show(entry) {
    clearUrls(); selected = entry; const p = entry.p;
    content.replaceChildren(h('div', { class: 'engineinfo' }, 'Reading ' + p + '…'));
    const buf = await TKB_VFS.read(g, p);
    if (closed || selected !== entry) return;
    const bytes = new Uint8Array(buf), ext = (p.split('.').pop() || '').toLowerCase();
    const displayActions = h('div', { class: 'tkb-vfs-actions' });
    displayActions.append(btn('Download copy', () => {
      const url = URL.createObjectURL(new Blob([bytes])); urls.push(url);
      const a = document.createElement('a'); a.href = url; a.download = fileName(p); a.click();
    }), btn('Rename / move', () => action(async () => {
      const dest = prompt('New virtual path (relative to the game root):', p);
      if (!dest || dest === p) return;
      await TKB_VFS.rename(g, p, dest, false); selected = null; content.textContent = 'File renamed.'; await refresh();
    })), btn('Delete', () => action(async () => {
      if (!confirm(`Delete ${p} from this game's virtual workspace? The original imported file stays intact.`)) return;
      await TKB_VFS.remove(g, p, false); selected = null; content.textContent = 'File deleted.'; await refresh();
    })));
    const header = h('b', { class: 'tkb-vfs-title' }, p + ' · ' + mb(bytes.byteLength));
    if (/^(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(ext)) {
      const url = URL.createObjectURL(new Blob([bytes])); urls.push(url);
      content.replaceChildren(header, displayActions, h('img', { src: url, class: 'tkb-inspect-img', alt: p }));
    } else if (/^(?:rpy|rpym|txt|json|ini|cfg|csv|md|log|py|xml|html|css|js|yaml|yml|toml)$/i.test(ext) || (bytes.length <= 256 * 1024 && !bytes.subarray(0,Math.min(4096,bytes.length)).some(x => x === 0))) {
      if (bytes.byteLength > 2 * 1024 * 1024) {
        content.replaceChildren(header, displayActions, h('p', {}, 'This file is too large for text editing (2 MB limit). You can download it.'));
        return;
      }
      const editor = h('textarea', { class: 'tkb-vfs-editor', spellcheck: 'false', 'aria-label': 'Virtual file contents' });
      editor.value = new TextDecoder().decode(bytes);
      const save = btn('Save changes', () => action(async () => {
        if (!selected || selected.p !== p) throw new Error('Select the file again before saving.');
        await TKB_VFS.write(g, p, new TextEncoder().encode(editor.value));
        feedback(`Saved ${p} to this game's virtual workspace.`);
        await refresh();
      }));
      content.replaceChildren(header, displayActions, editor, save);
    } else content.replaceChildren(header, displayActions, h('p', {}, 'Binary file. You can download, replace, rename, or delete it.'));
  }
  const newFile = btn('New file', () => action(async () => {
    const name = prompt('New file name in ' + (current || '/'), 'notes.txt'); if (!name) return;
    const p = fullName(name); if (rows.some(x => x.p === p)) throw new Error('A file already exists at this path.');
    await TKB_VFS.write(g, p, new Uint8Array()); await refresh();
  }));
  const newDir = btn('New folder', () => action(async () => {
    const name = prompt('New folder name in ' + (current || '/'), 'new-folder'); if (!name) return;
    await TKB_VFS.mkdir(g, fullName(name)); await refresh();
  }));
  const dirActions = btn('Rename / delete folder', () => action(async () => {
    if (!current || current === 'game') return feedback('Choose a subfolder first. The game root is protected.');
    const choice = prompt('Type R to rename this folder, or D to delete it:', 'R');
    if (!choice) return;
    if (choice.toUpperCase() === 'D') {
      if (!confirm(`Delete the folder ${current} and all its contents in this game workspace? Original imported files stay intact.`)) return;
      await TKB_VFS.remove(g, current, true); current = parent(current); selected = null; content.textContent = 'Folder deleted.';
    } else if (choice.toUpperCase() === 'R') {
      const dest = prompt('New virtual folder path:', current); if (!dest || dest === current) return;
      await TKB_VFS.rename(g, current, dest, true); current = TKB_VFS.path(dest); selected = null; content.textContent = 'Folder renamed.';
    }
    await refresh();
  }));
  const restoreButton = btn('Restore missing from ZIP', () => restoreZip.click());
  restoreZip.addEventListener('change', () => action(async () => {
    const archive = restoreZip.files && restoreZip.files[0];
    restoreZip.value = '';
    if (!archive) return;
    feedback('Checking the original ZIP for missing game files…');
    const result = await rpyRestoreMissing(g.id, archive, (done, total) => {
      feedback(`Restoring missing files: ${total ? Math.round(done / total * 100) : 100}%`);
    });
    await refresh();
    feedback(result.count
      ? `Restored ${result.count} missing game file(s) (${result.names.slice(0, 5).join(', ')}${result.count > 5 ? ', …' : ''}). Original ZIP and saved edits preserved. ${TKB_VFS.live(g.id) ? 'Restart the game to load the restored files.' : ''}`
      : 'All supported game files from that ZIP are already present. Existing workspace edits were preserved.');
  }));
  const reload = btn('Refresh', () => action(refresh));
  const addFiles = btn('Upload files', () => upload.click());
  upload.addEventListener('change', () => action(async () => {
    for (const file of upload.files || []) {
      if (file.size > TKB_VFS.MAX_FILE) throw new Error(file.name + ' exceeds the 16 MB editing limit.');
      await TKB_VFS.write(g, fullName(file.name), new Uint8Array(await file.arrayBuffer()));
    }
    upload.value = ''; await refresh();
  }));
  search.addEventListener('input', render);
  tb.append(newFile, newDir, addFiles, dirActions, reload, restoreButton, upload, restoreZip);
  root.append(caption, nav, location, search, tb, h('div', { class: 'tkb-file-columns' }, listBox, content), status);
  const onUpdate = e => { if (e.detail && e.detail.gid === g.id && !busy && !closed) refresh().catch(err => feedback(String(err.message || err))); };
  window.addEventListener('tkb:vfs-changed', onUpdate);
  openSheet('Virtual files — ' + g.title, root, () => { closed = true; window.removeEventListener('tkb:vfs-changed', onUpdate); clearUrls(); });
  await refresh();
}
