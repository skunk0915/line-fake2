<?php
require_once 'config.php';
if (php_sapi_name() === 'cli') {
	$_SERVER['REQUEST_METHOD'] = 'GET';
} else {
	enableCors();
}

try {
	$pdo = getDbConnection();

	// 1. Add is_read to messages (for 1-on-1)
	$columns = $pdo->query("SHOW COLUMNS FROM messages")->fetchAll(PDO::FETCH_COLUMN);
	if (!in_array('is_read', $columns)) {
		$pdo->exec("ALTER TABLE messages ADD COLUMN is_read BOOLEAN DEFAULT FALSE AFTER is_deleted");
		echo "Column 'is_read' added to 'messages'.<br>";
	}

	// 2. Add last_read_at to chat_group_members (for groups)
	$columns = $pdo->query("SHOW COLUMNS FROM chat_group_members")->fetchAll(PDO::FETCH_COLUMN);
	if (!in_array('last_read_at', $columns)) {
		$pdo->exec("ALTER TABLE chat_group_members ADD COLUMN last_read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER user_id");
		echo "Column 'last_read_at' added to 'chat_group_members'.<br>";
	}

	echo "Migration V3 Completed Successfully.";
} catch (Exception $e) {
	echo "Error during migration V3: " . $e->getMessage();
}
