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

        // Get all subscriptions except sender
        $stmt = $pdo->prepare("SELECT * FROM push_subscriptions WHERE user_id != ?");
        $stmt->execute([$senderId]);
        $subscriptions = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($subscriptions)) {
            return ['sent' => 0, 'message' => 'No subscribers'];
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
        $body = ($message['type'] === 'image') ? '画像を送信しました' : ($message['content'] ?? '');
        $senderName = $message['sender_name'] ?? 'Someone';

        $payload = json_encode([
            'title' => $senderName,
            'body' => $body,
            'icon' => '/line-fake2/icon-192.png',
            'badge' => '/line-fake2/icon-192.png',
            'data' => ['url' => '/line-fake2/']
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
        $expiredEndpoints = [];

        foreach ($webPush->flush() as $report) {
            if ($report->isSuccess()) {
                $sent++;
            } else {
                $failed++;
                $endpoint = $report->getEndpoint();
                $statusCode = $report->getResponse() ? $report->getResponse()->getStatusCode() : null;

                // Remove expired/invalid subscriptions
                if (in_array($statusCode, [404, 410])) {
                    $expiredEndpoints[] = $endpoint;
                }

                error_log("Push failed for {$endpoint}: {$report->getReason()} (HTTP {$statusCode})");
            }
        }

        // Clean up expired subscriptions
        if (!empty($expiredEndpoints)) {
            $placeholders = implode(',', array_fill(0, count($expiredEndpoints), '?'));
            $deleteStmt = $pdo->prepare("DELETE FROM push_subscriptions WHERE endpoint IN ({$placeholders})");
            $deleteStmt->execute($expiredEndpoints);
            error_log("Removed " . count($expiredEndpoints) . " expired push subscriptions");
        }

        return ['sent' => $sent, 'failed' => $failed, 'expired_removed' => count($expiredEndpoints)];
    } catch (Exception $e) {
        error_log("Push notification error: " . $e->getMessage());
        return ['error' => $e->getMessage()];
    }
}
