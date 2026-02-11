// Service Worker for Push Notifications and Offline Support
const CACHE_NAME = 'chat-cache-v2';

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
        icon: data.icon || '/line-fake2/favicon/icon-192.png',
        badge: data.badge || '/line-fake2/favicon/icon-192.png',
        tag: 'chat-notification-' + Date.now(),
        renotify: true,
        data: data.data || { url: '/line-fake2/' }
    };

    event.waitUntil(
        Promise.all([
            // Show the notification
            self.registration.showNotification(title, options),

            // Set app badge (iOS requires this in the SW push handler)
            self.navigator.setAppBadge
                ? self.navigator.setAppBadge().catch(() => { })
                : Promise.resolve(),

            // Notify open clients to refresh messages
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
                clientList.forEach(client => {
                    client.postMessage({ type: 'NEW_MESSAGE', data: data });
                });
            })
        ])
    );
});

// Notification click handler
self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    event.waitUntil(
        Promise.all([
            // Clear app badge when user taps notification
            self.navigator.clearAppBadge
                ? self.navigator.clearAppBadge().catch(() => { })
                : Promise.resolve(),

            // Focus or open window
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
                for (const client of clientList) {
                    if (client.url.includes('/line-fake2/') && 'focus' in client) {
                        // Tell client to clear badge too
                        client.postMessage({ type: 'CLEAR_BADGE' });
                        return client.focus();
                    }
                }
                return clients.openWindow(event.notification.data.url || '/line-fake2/');
            })
        ])
    );
});

// When all notifications are dismissed (notificationclose)
self.addEventListener('notificationclose', function (event) {
    // Check if there are any remaining notifications
    event.waitUntil(
        self.registration.getNotifications().then(notifications => {
            if (notifications.length === 0) {
                // No more notifications, clear badge
                if (self.navigator.clearAppBadge) {
                    return self.navigator.clearAppBadge().catch(() => { });
                }
            }
        })
    );
});

// Fetch handler - network first, fallback to cache for app shell
self.addEventListener('fetch', (event) => {
    if (!event.request.url.startsWith(self.location.origin)) return;
    if (event.request.url.includes('/api/') || event.request.url.includes('/broadcast')) return;

    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
