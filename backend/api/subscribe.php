<?php
require_once 'config.php';

enableCors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}

$input = json_decode(file_get_contents('php://input'), true);
$userId = $input['user_id'] ?? null;
$subscription = $input['subscription'] ?? null;

if (!$userId || !$subscription) {
    jsonResponse(['error' => 'User ID and Subscription data required'], 400);
}

$endpoint = $subscription['endpoint'];
$keys = $subscription['keys'];
$p256dh = $keys['p256dh'];
$auth = $keys['auth'];

$pdo = getDbConnection();

// Check if subscription exists for this endpoint
$stmt = $pdo->prepare("SELECT id FROM push_subscriptions WHERE endpoint = ?");
$stmt->execute([$endpoint]);
$existing = $stmt->fetch();

if (!$existing) {
    $insert = $pdo->prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)");
    $insert->execute([$userId, $endpoint, $p256dh, $auth]);
} else {
    // Update both user_id and keys for existing endpoint
    $update = $pdo->prepare("UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ? WHERE id = ?");
    $update->execute([$userId, $p256dh, $auth, $existing['id']]);
}

jsonResponse(['success' => true]);
