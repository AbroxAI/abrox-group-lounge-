// sw.js
const CACHE_NAME = 'abrox-chat-v1';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',

  '/message.js',
  '/ui-adapter.js',
  '/message-pool.js',
  '/simulation-engine.js',
  '/typing-engine.js',
  '/synthetic-people.js',

  '/styles.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(res => {
      return res || fetch(event.request);
    })
  );
});
