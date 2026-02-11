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

export const registerPush = async (user_id) => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('Push notifications not supported');
        return;
    }

    try {
        const registration = await navigator.serviceWorker.register('/line-fake2/sw.js', {
            scope: '/line-fake2/'
        });
        await navigator.serviceWorker.ready;
        const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

        if (!vapidKey) return;

        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            if (document.hidden) {
                // Can't ask permission if hidden
                return;
            }

            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return;

            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidKey)
            });
        }

        // Send subscription to backend
        await fetch(`${import.meta.env.VITE_API_URL}/subscribe.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id, subscription })
        });

    } catch (error) {
        console.error('Push error:', error);
    }
};
