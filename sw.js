const CACHE_NAME = "inventori-v58"; // <-- Ubah angka versinya setiap kali kode di-update
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "https://unpkg.com/dexie/dist/dexie.js"
];

self.addEventListener("install", event => {
  self.skipWaiting(); // Memaksa Service Worker baru segera siap dipakai
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim()) // Langsung ambil kendali halaman aktif
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
