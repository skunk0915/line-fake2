<?php
require_once 'config.php';
header('Content-Type: text/plain');

try {
    $pdo = getDbConnection();

    echo "--- push_subscriptions schema ---\n";
    $stmt = $pdo->query("DESCRIBE push_subscriptions");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        print_r($row);
    }

    echo "\n--- users table sample ---\n";
    $stmt = $pdo->query("SELECT id, name FROM users LIMIT 3");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        print_r($row);
    }
} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
