/*
 * Piqeras service worker.
 *
 * Two jobs, one worker: an offline app shell, and background push. They share
 * a registration because a page can only have one controlling service worker
 * at a given scope — registering Firebase's default
 * `/firebase-messaging-sw.js` alongside a caching worker would leave whichever
 * registered second in charge.
 *
 * Caching strategy is deliberately conservative. The app's data comes from
 * Firestore, which has its own IndexedDB cache, so this worker only needs to
 * make sure the shell itself boots with no network.
 */

const VERSION = 'piqeras-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {
        /* a failed precache must not block activation */
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache Firebase traffic

  // Navigations: network first, cache as the offline fallback. This keeps a
  // deployed update visible on the next load instead of pinning an old shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Hashed build assets are immutable: cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});

/* ------------------------------------------------------------------ push */

// Loaded from the CDN because a service worker cannot import the app's bundled
// modules. Wrapped so that a CDN failure degrades to "no background push"
// rather than breaking the offline shell above.
try {
  importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js');

  firebase.initializeApp({
    apiKey: 'AIzaSyCGnkqp3OxzAZ_bAXW3gHvlW43UTnb0APE',
    authDomain: 'piqeras.firebaseapp.com',
    projectId: 'piqeras',
    storageBucket: 'piqeras.firebasestorage.app',
    messagingSenderId: '461077055119',
    appId: '1:461077055119:web:764d22f3b1c48e89d3d2fa',
  });

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title ?? 'Piqeras';
    // `tag` collapses repeats of the same event into one notification, which
    // is the browser-side half of the server's idempotency ledger.
    self.registration.showNotification(title, {
      body: payload.notification?.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.data?.eventKey ?? payload.data?.tripId ?? 'piqeras',
      data: payload.data ?? {},
    });
  });
} catch (err) {
  // No push in this environment; the app still works.
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});
