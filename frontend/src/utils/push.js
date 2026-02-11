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
 * Check if push notifications are supported in this environment
 */
export const isPushSupported = () => {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
};

/**
 * Get current notification permission status
 * Returns: 'granted', 'denied', 'default', or 'unsupported'
 */
export const getNotificationStatus = () => {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
};

/**
 * Check if already subscribed to push
 */
export const checkExistingSubscription = async () => {
    if (!('serviceWorker' in navigator)) return false;
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        return !!subscription;
    } catch {
        return false;
    }
};

/**
 * Register service worker only (no permission request)
 * Called automatically on app load
 */
export const registerServiceWorker = async () => {
    if (!('serviceWorker' in navigator)) return null;

    try {
        const registration = await navigator.serviceWorker.register('/line-fake2/sw.js', {
            scope: '/line-fake2/'
        });
        console.log('Service Worker registered:', registration.scope);
        return registration;
    } catch (error) {
        console.error('SW registration error:', error);
        return null;
    }
};

/**
 * Subscribe to push notifications - MUST be called from a user gesture (click/tap)
 * This is critical for iOS PWA support
 */
export const subscribePush = async (user_id) => {
    if (!isPushSupported()) {
        console.warn('Push notifications not supported');
        return { success: false, reason: 'unsupported' };
    }

    try {
        const swReady = await navigator.serviceWorker.ready;

        // Request permission - MUST be triggered by user gesture on iOS
        const permission = await Notification.requestPermission();
        console.log('Notification permission:', permission);

        if (permission !== 'granted') {
            return { success: false, reason: 'denied' };
        }

        const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
        if (!vapidKey) {
            return { success: false, reason: 'no_vapid_key' };
        }

        // Check for existing subscription first
        let subscription = await swReady.pushManager.getSubscription();

        if (!subscription) {
            subscription = await swReady.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidKey)
            });
            console.log('New push subscription created');
        } else {
            console.log('Using existing push subscription');
        }

        // Send subscription to backend
        const response = await fetch(`${import.meta.env.VITE_API_URL}/subscribe.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id, subscription: subscription.toJSON() })
        });

        if (response.ok) {
            console.log('Push subscription sent to server');
            return { success: true };
        } else {
            console.error('Failed to send subscription:', response.status);
            return { success: false, reason: 'server_error' };
        }

    } catch (error) {
        console.error('Push subscription error:', error);
        return { success: false, reason: error.message };
    }
};

/**
 * Try to silently re-register an existing subscription (no permission prompt)
 * Safe to call from useEffect since it won't show any prompt
 */
export const silentResubscribe = async (user_id) => {
    if (!isPushSupported()) return;
    if (Notification.permission !== 'granted') return;

    try {
        const swReady = await navigator.serviceWorker.ready;
        const subscription = await swReady.pushManager.getSubscription();

        if (subscription) {
            // Re-send existing subscription to backend (in case server lost it)
            await fetch(`${import.meta.env.VITE_API_URL}/subscribe.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id, subscription: subscription.toJSON() })
            });
            console.log('Existing subscription re-sent to server');
        }
    } catch (error) {
        console.error('Silent resubscribe error:', error);
    }
};
