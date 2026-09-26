/*
 * sw.js — Service worker ÉlectriCAD.
 * Stratégie « réseau d'abord, cache en secours » : les mises à jour arrivent
 * toujours quand on est en ligne, et l'application reste utilisable hors-ligne.
 */

const CACHE = 'electricad-v60';
const ASSETS = [
  'index.html', 'app.html',
  'css/styles.css', 'css/landing.css',
  'js/symbols.js', 'js/netlist.js', 'js/plan.js', 'js/simulate.js', 'js/digital.js',
  'js/svg.js', 'js/dxf.js', 'js/viz3d.js', 'js/gl3d.js', 'js/export3d.js', 'js/examples.js', 'js/houses.js', 'js/install.js', 'js/board.js', 'js/vdi.js', 'js/elev.js', 'js/day.js', 'js/materials.js', 'js/dossier.js',
  'js/editor.js', 'js/house-ui.js', 'js/board-ui.js', 'js/ui.js', 'js/landing.js', 'js/house-worker.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'fonts/ibm-plex-sans-latin-400-normal.woff2', 'fonts/ibm-plex-sans-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-600-normal.woff2', 'fonts/ibm-plex-sans-condensed-latin-600-normal.woff2',
  'fonts/ibm-plex-sans-condensed-latin-700-normal.woff2', 'fonts/ibm-plex-mono-latin-400-normal.woff2',
  'fonts/ibm-plex-mono-latin-500-normal.woff2', 'img/accueil/demo-t5.jpg',
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
  // Seulement les fichiers du site (pas l'API GitHub ni les téléchargements)
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
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
