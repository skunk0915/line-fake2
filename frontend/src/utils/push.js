const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
};

/**
 * Check if running as iOS PWA (standalone mode)
 */
const isIOSStandalone = () => {
    return (
        ('standalone' in window.navigator && window.navigator.standalone) ||
        window.matchMedia('(display-mode: standalone)').matches
    );
};

export const registerPush = async (user_id) => {
    if (!('serviceWorker' in navigator)) {
        console.warn('Service workers not supported');
        return;
    }

    try {
        // Register or update the service worker
        const registration = await navigator.serviceWorker.register('/line-fake2/sw.js', {
            scope: '/line-fake2/'
        });

        // Wait for the service worker to be ready
        const swReady = await navigator.serviceWorker.ready;
        console.log('Service Worker ready:', swReady.scope);

        // Check if Push API is available
        if (!('PushManager' in window)) {
            console.warn('Push notifications not supported in this browser');
            // On iOS, PushManager is only available in standalone (PWA) mode
            if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
                if (!isIOSStandalone()) {
                    console.warn('On iOS, push notifications require the app to be added to Home Screen');
                }
            }
            return;
        }

        const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
        if (!vapidKey) {
            console.warn('VAPID key not configured');
            return;
        }

        let subscription = await swReady.pushManager.getSubscription();

        if (!subscription) {
            // Don't ask permission if the page is hidden
            if (document.hidden) {
                console.log('Page is hidden, deferring push subscription');
                return;
            }

            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.log('Notification permission denied');
                return;
            }

            subscription = await swReady.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidKey)
            });

            console.log('Push subscription created');
        } else {
            console.log('Existing push subscription found');
        }

        // Send subscription to backend
        const response = await fetch(`${import.meta.env.VITE_API_URL}/subscribe.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id, subscription })
        });

        if (response.ok) {
            console.log('Push subscription sent to server');
        } else {
            console.error('Failed to send subscription:', response.status);
        }

    } catch (error) {
        console.error('Push registration error:', error);
    }
};
