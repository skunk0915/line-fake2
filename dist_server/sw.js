self.addEventListener('push', function (event) {
    if (event.data) {
        const data = event.data.json();
        const title = data.title || 'New Message';
        const options = {
            body: data.body,
            icon: data.icon || '/line-fake2/icon-192.png',
            badge: data.badge || '/line-fake2/badge.png',
            data: data.data || { url: '/line-fake2/' }
        };

        event.waitUntil(self.registration.showNotification(title, options));

        // Update badge if supported
        if (navigator.setAppBadge) {
            navigator.setAppBadge().catch((error) => {
                console.error(error);
            });
        }
    }
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) {
                        client = clientList[i];
                    }
                }
                return client.focus();
            }
            return clients.openWindow(event.notification.data.url || '/line-fake2/');
        })
    );

    if (navigator.clearAppBadge) {
        navigator.clearAppBadge().catch((error) => {
            console.error(error);
        });
    }
});
