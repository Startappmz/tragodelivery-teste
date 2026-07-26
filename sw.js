const CACHE_NAME = 'trago-client-v21-7';
const CACHE_PREFIX = 'trago-';

function isRuntimeRequest(url) {
  return url.pathname.startsWith('/api/')
    || url.pathname.includes('/functions/v1/')
    || url.pathname.startsWith('/uploads/')
    || url.pathname.startsWith('/socket.io/');
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);

    if (response.ok && response.type === 'basic') {
      // A resposta tem de ser clonada antes de ser devolvida ao browser.
      // Clonar dentro de uma Promise posterior faz o corpo já estar consumido.
      const cacheCopy = response.clone();
      void caches.open(CACHE_NAME)
        .then((cache) => cache.put(request, cacheCopy))
        .catch(() => undefined);
    }

    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const fallback = await caches.match('./cliente.html')
        || await caches.match('./index.html');
      if (fallback) return fallback;
    }

    throw error;
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isRuntimeRequest(url)) return;

  event.respondWith(networkFirst(request));
});
