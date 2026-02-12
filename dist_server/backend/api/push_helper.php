<?php

/**
 * Web Push notification helper
 * Sends push notifications directly from PHP without external notification server
 */
require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/config.php';

use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;

// VAPID keys - same as notification-server/.env
define('VAPID_PUBLIC_KEY', 'BG2U4Q7q8FsZ1V0aCsz6CodXwN8mSWdX7QX8Hg8mmaBTCUhgczrmvVf7AVJiWyg2C4UGp6BUetjrsH9Ce8aVBaY');
define('VAPID_PRIVATE_KEY', 'v0RjkuH1syE2Z1nRxidHB-N1nm5th0UN7gWP7ayWX7s');
define('VAPID_EMAIL', 'mailto:skunk0915@gmail.com');

/**
 * Send push notifications to all subscribers except the sender
 *
 * @param array $message  The message data (from DB)
 * @param int   $senderId The sender's user ID (to exclude from notifications)
 */
function sendPushNotifications($message, $senderId)
{
    try {
        $pdo = getDbConnection();

        // Determine who to notify
        $recipientId = (int)($message['recipient_id'] ?? 0);
        $recipientType = $message['recipient_type'] ?? 'user';
        $senderIdInt = (int)$senderId;

        if ($recipientType === 'global') {
            // Global chat: notify everyone except sender
            $stmt = $pdo->prepare("SELECT * FROM push_subscriptions WHERE user_id != ?");
            $stmt->execute([$senderIdInt]);
            $url = '/line-fake2/?chat_with=0';
        } elseif ($recipientType === 'group') {
            // Group chat: notify all members except sender
            $stmt = $pdo->prepare("SELECT ps.* FROM push_subscriptions ps 
                                   JOIN chat_group_members cgm ON ps.user_id = cgm.user_id 
                                   WHERE cgm.group_id = ? AND ps.user_id != ?");
            $stmt->execute([$recipientId, $senderIdInt]);
            $url = "/line-fake2/?chat_with={$recipientId}&type=group";
        } else {
            // 1-on-1 chat: notify only the recipient
            if ($recipientId === $senderIdInt) {
                return ['sent' => 0, 'message' => 'Sender is recipient'];
            }
            $stmt = $pdo->prepare("SELECT * FROM push_subscriptions WHERE user_id = ?");
            $stmt->execute([$recipientId]);
            $url = "/line-fake2/?chat_with={$senderIdInt}";
        }
        $subscriptions = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($subscriptions)) {
            return ['sent' => 0, 'message' => 'No subscribers found'];
        }

        // Set up WebPush
        $auth = [
            'VAPID' => [
                'subject' => VAPID_EMAIL,
                'publicKey' => VAPID_PUBLIC_KEY,
                'privateKey' => VAPID_PRIVATE_KEY,
            ],
        ];

        $webPush = new WebPush($auth, [], 30); // 30 second timeout

        // Prepare notification payload
        $body = ($message['type'] === 'image') ? '画像を送信しました' : (($message['type'] === 'video') ? '動画を送信しました' : (($message['type'] === 'audio') ? 'ボイスメッセージを送信しました' : (($message['type'] === 'file') ? 'ファイルを送信しました' : ($message['content'] ?? ''))));

        $senderName = $message['sender_name'] ?? 'Someone';

        $payload = json_encode([
            'title' => $senderName,
            'body' => $body,
            'icon' => getBaseUrl() . '/favicon/icon-192.png',
            'badge' => getBaseUrl() . '/favicon/icon-192.png',
            'data' => ['url' => $url]
        ]);

        // Queue all notifications
        foreach ($subscriptions as $sub) {
            $subscription = Subscription::create([
                'endpoint' => $sub['endpoint'],
                'keys' => [
                    'p256dh' => $sub['p256dh'],
                    'auth' => $sub['auth'],
                ],
            ]);

            $webPush->queueNotification($subscription, $payload);
        }

        // Send all queued notifications
        $sent = 0;
        $failed = 0;
        foreach ($webPush->flush() as $report) {
            if ($report->isSuccess()) {
                $sent++;
            } else {
                $failed++;
            }
        }

        // Notify Socket.io server if running locally
        try {
            $ch = curl_init('http://localhost:3000/broadcast');
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
                'message' => $message,
                'subscriptions' => $subscriptions
            ]));
            curl_setopt($ch, CURLOPT_TIMEOUT, 1); // Small timeout
            curl_exec($ch);
            curl_close($ch);
        } catch (Exception $e) {
            // Ignore socket server errors
        }

        return ['sent' => $sent, 'failed' => $failed];
    } catch (Exception $e) {
        error_log("Push notification error: " . $e->getMessage());
        return ['error' => $e->getMessage()];
    }
}

/**
 * Broadcast a generic event to the socket server
 */
function broadcastEvent($eventType, $data)
{
    try {
        $ch = curl_init('http://localhost:3000/broadcast');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
            'message' => [
                'event_type' => $eventType,
                'data' => $data
            ]
        ]));
        curl_setopt($ch, CURLOPT_TIMEOUT, 1);
        curl_exec($ch);
        curl_close($ch);
    } catch (Exception $e) {
        error_log("Broadcast error: " . $e->getMessage());
    }
}
