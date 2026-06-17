/* ============================================================
   RECORDATO — Service Worker v2
   Network-first: siempre versión fresca, cache solo offline
   ============================================================ */

const CACHE_NAME = 'recordato-v2';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// ─── Install: precache de la shell ───────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_FILES).catch(err => {
        console.warn('Precache parcial:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate: limpiar caches viejos, tomar control inmediato ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Fetch: network-first con fallback a cache ────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Solo interceptar requests del mismo origen
  if (url.origin !== self.location.origin) return;

  // Para la shell: network-first (siempre intenta versión fresca)
  if (SHELL_FILES.some(f => url.pathname.endsWith(f) || url.pathname === '/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Actualizar cache con la versión fresca
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Sin conexión → servir del cache
          return caches.match(event.request);
        })
    );
  }
});

// ─── Mensaje: forzar skipWaiting desde el cliente ─────────────
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

// ─── Click en notificación → abrir la app ───────────────────
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
