/* ============================================================
   RECORDATO — Service Worker v3
   Network-first + notificaciones push
   ============================================================ */

const CACHE_NAME = 'recordato-v3';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_FILES).catch(err => {
        console.warn('Precache parcial:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (SHELL_FILES.some(f => url.pathname.endsWith(f) || url.pathname === '/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skip-waiting') {
    self.skipWaiting();
  }
  if (event.data && event.data.action === 'notificar-urgente') {
    const { texto } = event.data;
    self.registration.showNotification('⚠️ RECORDATORIO URGENTE', {
      body: texto,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'recordato-urgente',
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200]
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
