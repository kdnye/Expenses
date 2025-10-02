const CACHE_VERSION = 'expenses-cache-v3';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/fsi-logo.png',
  '/src/constants.js',
  '/src/main.js',
  '/src/storage.js',
  '/src/utils.js',
];

const precacheCoreAssets = async () => {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(PRECACHE_URLS);
};

self.addEventListener('install', (event) => {
  event.waitUntil(precacheCoreAssets());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

const shouldHandleFetch = (request) => {
  if (request.method !== 'GET') {
    return false;
  }

  const requestURL = new URL(request.url);
  return requestURL.origin === self.location.origin;
};

self.addEventListener('fetch', (event) => {
  if (!shouldHandleFetch(event.request)) {
    return;
  }

  const isDocumentRequest =
    event.request.mode === 'navigate' || event.request.destination === 'document';

  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }

      try {
        const networkResponse = await fetch(event.request);
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === 'basic'
        ) {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(event.request, networkResponse.clone());
        }

        return networkResponse;
      } catch (error) {
        if (isDocumentRequest) {
          const fallback = await caches.match('/index.html');
          if (fallback) {
            return fallback;
          }
        }

        return new Response(null, {
          status: 503,
          statusText: 'Service Unavailable',
        });
      }
    })()
  );
});
