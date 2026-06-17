/* ============================================================
   RECORDATO — Service Worker
   Cache-first para la shell, notificaciones periódicas
   ============================================================ */

const CACHE_NAME = 'recordato-v1';
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
        // No fallar el install si algún recurso falta
      });
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate: limpiar caches viejos ────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Fetch: cache-first para shell, network-first para el resto ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Solo interceptar requests del mismo origen
  if (url.origin !== self.location.origin) return;

  // Para la shell: cache-first (carga instantánea)
  if (SHELL_FILES.some(f => url.pathname.endsWith(f) || url.pathname === '/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          // Actualizar cache en segundo plano
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
  }
});

// ─── Notificaciones periódicas (si el navegador lo soporta) ──
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'recordato-urgente-check') {
    event.waitUntil(verificarUrgentes());
  }
});

async function verificarUrgentes() {
  // En el SW no tenemos acceso a IndexedDB directamente de forma sencilla,
  // pero podemos enviar un mensaje a los clients para que verifiquen
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ action: 'verificar-urgentes' });
  });
}

// ─── Escuchar mensajes del cliente ──────────────────────────
self.addEventListener('message', (event) => {
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
      // Si ya hay una ventana abierta, enfocarla
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no, abrir una nueva
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
