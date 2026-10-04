// SpotiFree PWA Service Worker (V5 - Network-First, Zero-Ad Native Audio)
const CACHE_NAME = 'spotifree-v5-direct-native-engine';
const ASSETS_TO_CACHE = [
  './manifest.webmanifest',
  './icons/music-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Never cache audio streaming chunks or third-party APIs
  if (
    url.includes('googlevideo.com') ||
    url.includes('sndcdn.com') ||
    url.includes('audius.co') ||
    url.includes('invidious') ||
    url.includes('itunes.apple.com') ||
    url.includes('/api/')
  ) {
    return;
  }

  // Network-first strategy for HTML pages to guarantee users get immediate app updates
  if (event.request.mode === 'navigate' || event.request.destination === 'document' || url.endsWith('.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Stale-while-revalidate for static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
