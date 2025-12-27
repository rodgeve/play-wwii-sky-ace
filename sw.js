const CACHE_VERSION = 'wwii-sky-ace-v4-destroyed-overlays';
const ASSET_CACHE_VERSION = 'wwii-assets-v2';

// Static assets to precache
const CACHE_ASSETS = [
  '/',
  '/index.html',
  '/index.tsx',
  '/App.tsx',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Critical game assets to precache for fast loading
const CRITICAL_ASSETS = [
  '/api/asset/titleScreen',
  '/api/asset/player',
  '/api/asset/ocean1'
];

// Install event - cache static assets and critical game assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing v3 (optimized)...');
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(CACHE_VERSION).then((cache) => {
        console.log('[Service Worker] Caching app shell');
        return cache.addAll(CACHE_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      }),
      // Precache critical game assets
      caches.open(ASSET_CACHE_VERSION).then((cache) => {
        console.log('[Service Worker] Precaching critical game assets');
        return Promise.allSettled(
          CRITICAL_ASSETS.map(url =>
            fetch(url).then(response => {
              if (response.ok) {
                return cache.put(url, response);
              }
            }).catch(err => console.log('[SW] Precache failed for:', url, err))
          )
        );
      })
    ]).catch((error) => {
      console.error('[Service Worker] Install failed:', error);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  const validCaches = [CACHE_VERSION, ASSET_CACHE_VERSION];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!validCaches.includes(cacheName)) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - different strategies for different resources
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // ═══════════════════════════════════════════
  // STRATEGY 1: Cache-First for Game Assets
  // Fast load from cache, update in background
  // ═══════════════════════════════════════════
  if (url.includes('/api/asset/')) {
    event.respondWith(
      caches.open(ASSET_CACHE_VERSION).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            console.log('[SW] Cache hit:', url.split('/').pop());
            return cachedResponse;
          }

          // Not in cache, fetch and cache for next time
          console.log('[SW] Cache miss, fetching:', url.split('/').pop());
          return fetch(event.request).then((response) => {
            if (response.ok) {
              // Clone and cache the response
              cache.put(event.request, response.clone());
              console.log('[SW] Cached:', url.split('/').pop());
            }
            return response;
          });
        });
      }).catch(() => {
        // Network failed, return placeholder or error
        console.error('[SW] Failed to fetch asset:', url);
        return new Response('Asset unavailable', { status: 503 });
      })
    );
    return;
  }

  // ═══════════════════════════════════════════
  // STRATEGY 2: Network-First for API calls
  // Always get fresh data, fallback to cache
  // ═══════════════════════════════════════════
  if (url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => response)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ═══════════════════════════════════════════
  // STRATEGY 3: Stale-While-Revalidate for Static Assets
  // Serve from cache immediately, update in background
  // ═══════════════════════════════════════════
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Update cache in background
        if (networkResponse.ok && event.request.method === 'GET' &&
            !url.includes('chrome-extension')) {
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
        }
        return networkResponse;
      });

      // Return cached response immediately, or wait for network
      return cachedResponse || fetchPromise;
    }).catch(() => {
      // Offline fallback
      return caches.match('/index.html');
    })
  );
});
