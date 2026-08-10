/* =====================================================================
   Sky Team Ife — service worker.

   Only the shell is cached: the HTML, the CSS, the scripts and the two
   vendored libraries. Every call to Supabase goes to the network and is
   never cached, because attendance and reports must be live.

   Bump CACHE when the shell changes and the old one is thrown away on
   the next activate.
   ===================================================================== */
const CACHE = 'sti-shell-v13';

const SHELL = [
  './',
  './index.html',
  './scan.html',
  './config.js',
  './css/styles.css',
  './js/ui.js',
  './js/api.js',
  './js/views.js',
  './js/app.js',
  './js/scan.js',
  './js/vendor/supabase.js',
  './js/vendor/qrcode.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      /* One bad URL must not sink the whole install. */
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Anything that is not ours — Supabase, Google Fonts — goes straight
     to the network. Never serve stale data from the database. */
  if (url.origin !== self.location.origin) return;

  /* Navigations: try the network so a deploy is picked up straight away,
     and fall back to the cached page when the phone is offline. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  /* Everything else in the shell: cache first, refresh in the background
     so the next load has the new file. */
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req)
        .then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
