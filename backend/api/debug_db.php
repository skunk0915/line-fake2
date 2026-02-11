<?php
require_once 'config.php';
header('Content-Type: text/plain');

try {
    $pdo = getDbConnection();

    echo "--- Last 5 messages ---\n";
    $stmt = $pdo->query("SELECT id, sender_id, recipient_id, content FROM messages ORDER BY id DESC LIMIT 5");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        print_r($row);
    }

    echo "\n--- Subscriptions count by user ---\n";
    $stmt = $pdo->query("SELECT user_id, COUNT(*) as count FROM push_subscriptions GROUP BY user_id");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        print_r($row);
    }
} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
