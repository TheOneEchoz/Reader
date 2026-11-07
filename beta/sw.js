// Tankōbon Reader service worker: keeps the app working offline.
const CACHE = 'tankobon-beta-v107';
const SHELL = ['./', './index.html', './Sortable.min.js', './apple-touch-icon.png', './capacitor.js', './icon-192.png', './icon-512.png', './jbig2.wasm', './jsQR.js', './jszip.min.js', './manifest.webmanifest', './maskable-512.png', './openjpeg.wasm', './p2p.js', './pdf.min.js', './pdf.worker.min.js', './qcms_bg.wasm', './qrcode.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k.startsWith('tankobon-beta-')).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Ren'Py for the game player is downloaded by the app itself and kept encrypted: never cached here
  if (url.pathname.includes('/renpy/')) return;
  if (url.origin === location.origin) {
    // App files: use the network when online so updates arrive, fall back to the cache offline.
    e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});
