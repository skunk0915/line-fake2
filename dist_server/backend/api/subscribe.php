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

// Check if subscription exists for user
$stmt = $pdo->prepare("SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?");
$stmt->execute([$userId, $endpoint]);
$existing = $stmt->fetch();

if (!$existing) {
    $insert = $pdo->prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)");
    $insert->execute([$userId, $endpoint, $p256dh, $auth]);
} else {
    // Optionally update keys
    $update = $pdo->prepare("UPDATE push_subscriptions SET p256dh = ?, auth = ? WHERE id = ?");
    $update->execute([$p256dh, $auth, $existing['id']]);
}

jsonResponse(['success' => true]);
