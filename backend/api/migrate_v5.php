<?php
require_once 'config.php';

if (php_sapi_name() === 'cli') {
	// Valid for CLI
} else {
	// If run via browser (optional security check usually needed, but for dev ok)
	enableCors();
}

try {
	$pdo = getDbConnection();

	// Create message_alerts table
	// Stores which user has been alerted about which message
	$pdo->exec("CREATE TABLE IF NOT EXISTS message_alerts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        message_id INT NOT NULL,
        user_id INT NOT NULL,
        alerted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY msg_user_alert (message_id, user_id),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )");

	echo "Migration V5 Completed: 'message_alerts' table created.<br>";
} catch (Exception $e) {
	echo "Error during migration V5: " . $e->getMessage();
}
