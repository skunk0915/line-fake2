<?php
require_once 'config.php';
header('Content-Type: text/plain');

try {
    $pdo = getDbConnection();

    echo "--- messages table schema ---\n";
    $stmt = $pdo->query("DESCRIBE messages");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        print_r($row);
    }
} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
