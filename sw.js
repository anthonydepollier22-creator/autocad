/*
 * sw.js — Service worker ÉlectriCAD.
 * Stratégie « réseau d'abord, cache en secours » : les mises à jour arrivent
 * toujours quand on est en ligne, et l'application reste utilisable hors-ligne.
 */

const CACHE = 'electricad-v1';
const ASSETS = [
  'index.html', 'app.html',
  'css/styles.css', 'css/landing.css',
  'js/symbols.js', 'js/netlist.js', 'js/simulate.js', 'js/digital.js',
  'js/svg.js', 'js/viz3d.js', 'js/examples.js', 'js/editor.js', 'js/ui.js',
  'js/landing.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then((hit) => hit || caches.match('app.html'))
      )
  );
});
