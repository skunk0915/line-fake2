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

        if ($recipientId === 0) {
            // Global chat: notify everyone except sender
            $stmt = $pdo->prepare("SELECT ps.* FROM push_subscriptions ps WHERE ps.user_id != ?");
            $stmt->execute([$senderIdInt]);
        } elseif ($recipientType === 'group') {
            // Group chat: notify all members except sender
            // Need to join group_members to find users, then push_subscriptions
            $sql = "SELECT ps.* FROM push_subscriptions ps
                    JOIN group_members gm ON ps.user_id = gm.user_id
                    WHERE gm.group_id = ? AND ps.user_id != ?";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$recipientId, $senderIdInt]);
        } else {
            // 1-on-1 chat: notify only the recipient
            if ($recipientId === $senderIdInt) {
                return ['sent' => 0, 'message' => 'Sender is recipient'];
            }
            $stmt = $pdo->prepare("SELECT * FROM push_subscriptions WHERE user_id = ?");
            $stmt->execute([$recipientId]);
        }
        $subscriptions = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($subscriptions)) {
            return ['sent' => 0, 'message' => 'No subscribers found for recipient ' . $recipientId];
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
        $body = $message['content'] ?? '';
        if ($message['type'] === 'image') $body = '画像を送信しました';
        if ($message['type'] === 'audio') $body = '音声を送信しました';
        if ($message['type'] === 'video') $body = '動画を送信しました';

        $senderName = $message['sender_name'] ?? 'Someone';

        // Create URL with query params
        $chatUrl = '/line-fake2/';
        if ($recipientType === 'group') {
            // For group, open the group chat
            $chatUrl .= '?recipient_id=' . $recipientId . '&recipient_type=group';
        } elseif ($recipientId !== 0) {
            // For 1-on-1, open chat with the sender
            $chatUrl .= '?recipient_id=' . $senderIdInt;
        }

        $payload = json_encode([
            'title' => $senderName,
            'body' => $body,
            'icon' => '/line-fake2/favicon/icon-192.png',
            'badge' => '/line-fake2/favicon/icon-192.png',
            'data' => [
                'url' => $chatUrl
            ]
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
