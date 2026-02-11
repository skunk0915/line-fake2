<?php
require_once 'config.php';
header('Content-Type: text/plain');

try {
    $pdo = getDbConnection();

    echo "Starting migration v2...\n";

    // 1. Create groups table
    $sqlGroups = "CREATE TABLE IF NOT EXISTS `groups` (
        `id` INT AUTO_INCREMENT PRIMARY KEY,
        `name` VARCHAR(255) NOT NULL,
        `avatar_url` VARCHAR(255),
        `created_by` INT NOT NULL,
        `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    $pdo->exec($sqlGroups);
    echo "Created groups table.\n";

    // 2. Create group_members table
    $sqlMembers = "CREATE TABLE IF NOT EXISTS `group_members` (
        `group_id` INT NOT NULL,
        `user_id` INT NOT NULL,
        PRIMARY KEY (`group_id`, `user_id`),
        FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE,
        FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    $pdo->exec($sqlMembers);
    echo "Created group_members table.\n";

    // 3. Add recipient_type to messages
    // Check if column exists first
    $stmt = $pdo->query("SHOW COLUMNS FROM messages LIKE 'recipient_type'");
    if (!$stmt->fetch()) {
        $pdo->exec("ALTER TABLE messages ADD COLUMN recipient_type VARCHAR(20) DEFAULT 'user' AFTER recipient_id");
        echo "Added recipient_type column to messages.\n";
    } else {
        echo "recipient_type column already exists.\n";
    }

    echo "Migration v2 completed successfully.\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
    http_response_code(500);
}
