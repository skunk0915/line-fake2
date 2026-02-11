// Service Worker for Push Notifications and Offline Support
const CACHE_NAME = 'chat-cache-v1';

// Install event - activate immediately
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Activate event - claim all clients immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Push notification handler
self.addEventListener('push', function (event) {
    if (!event.data) return;

    const data = event.data.json();
    const title = data.title || 'New Message';
    const options = {
        body: data.body,
        icon: data.icon || '/line-fake2/icon-192.png',
        badge: data.badge || '/line-fake2/badge.png',
        tag: 'chat-notification',
        renotify: true,
        data: data.data || { url: '/line-fake2/' }
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );

    // Notify all open clients to refresh messages
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            clientList.forEach(client => {
                client.postMessage({ type: 'NEW_MESSAGE', data: data });
            });
        })
    );
});

// Notification click handler
self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            // Try to focus an existing window
            for (const client of clientList) {
                if (client.url.includes('/line-fake2/') && 'focus' in client) {
                    return client.focus();
                }
            }
            // If no existing window, open a new one
            return clients.openWindow(event.notification.data.url || '/line-fake2/');
        })
    );
});

// Fetch handler - network first, fallback to cache for app shell
self.addEventListener('fetch', (event) => {
    // Only handle same-origin requests
    if (!event.request.url.startsWith(self.location.origin)) return;

    // Skip API calls
    if (event.request.url.includes('/api/') || event.request.url.includes('/broadcast')) return;

    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
