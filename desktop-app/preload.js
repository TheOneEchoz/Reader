// The small set of computer features the web app may use.
const { contextBridge, ipcRenderer } = require('electron');
let progress = null, lanProg = null;
ipcRenderer.on('lan:progress', (e, d, t) => { if (lanProg) lanProg(d, t); });
ipcRenderer.on('upd:progress', (e, i, n) => { if (progress) progress(i, n); });
contextBridge.exposeInMainWorld('TkbDesktop', {
  libInfo: () => ipcRenderer.invoke('lib:info'),
  write: (rel, data) => ipcRenderer.invoke('lib:write', rel, data),
  mkdir: rel => ipcRenderer.invoke('lib:mkdir', rel),
  del: rel => ipcRenderer.invoke('lib:del', rel),
  list: rel => ipcRenderer.invoke('lib:list', rel),
  readInfo: () => ipcRenderer.invoke('info:read'),
  writeInfo: obj => ipcRenderer.invoke('info:write', obj),
  pickFolder: () => ipcRenderer.invoke('pick:folder'),
  readPicked: abs => ipcRenderer.invoke('pick:read', abs),
  saveFile: (name, data) => ipcRenderer.invoke('save:file', name, data),
  setSecure: on => ipcRenderer.invoke('sec:set', on),
  fetchJSON: url => ipcRenderer.invoke('net:json', url),
  async downloadVersion(ver, files, site, onProgress) {
    progress = onProgress || null;
    try { return await ipcRenderer.invoke('upd:download', ver, files, site); } finally { progress = null; }
  },
  useVersion: ver => ipcRenderer.invoke('upd:use', ver),
  useBuiltIn: () => ipcRenderer.invoke('upd:builtin'),
  cleanupVersions: keep => ipcRenderer.invoke('upd:cleanup', keep),
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
  onOpenUpdates: cb => ipcRenderer.on('open-updates', () => cb()),
  takeIncoming: () => ipcRenderer.invoke('incoming:take'),
  onIncoming: cb => ipcRenderer.on('incoming', () => cb()),
  focus: () => ipcRenderer.invoke('win:focus'),
  lanServe: token => ipcRenderer.invoke('lan:serve', token),
  lanStop: () => ipcRenderer.invoke('lan:stop'),
  async lanFetch(bases, token, rels, parallel, onProgress) {
    lanProg = onProgress || null;
    try { return await ipcRenderer.invoke('lan:fetch', bases, token, rels, parallel); } finally { lanProg = null; }
  },
});
