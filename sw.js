// Service Worker — Fotoalbum PWA
const CACHE_NAME = 'fotoalbum-v2';

// App shell — these get cached on install
const APP_SHELL = [
  '/Fotoalbum/',
  '/Fotoalbum/index.html',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Sora:wght@300;400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Install: cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API/Supabase, cache-first for app shell
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache Supabase API calls or signed photo URLs
  if (url.hostname.includes('supabase') && !url.pathname.includes('supabase-js')) {
    return; // let browser handle normally
  }

  // For app shell: try cache first, then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful GET responses for fonts/scripts
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback: return cached index.html for navigation
      if (event.request.mode === 'navigate') {
        return caches.match('/Fotoalbum/index.html');
      }
    })
  );
});
