<?php
require_once 'config.php';
enableCors();

try {
    $pdo = getDbConnection();

    // Check if recipient_id column exists
    $stmt = $pdo->query("SHOW COLUMNS FROM messages LIKE 'recipient_id'");
    $column = $stmt->fetch();

    if (!$column) {
        // Add recipient_id column
        $pdo->exec("ALTER TABLE messages ADD COLUMN recipient_id INT DEFAULT 0 AFTER sender_id");
        echo "Successfully added recipient_id column.<br>";
    } else {
        echo "recipient_id column already exists.<br>";
    }

    // Verify image_url update
    echo "Migration completed.";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
