<?php
require_once 'config.php';
if (php_sapi_name() === 'cli') {
	$_SERVER['REQUEST_METHOD'] = 'GET';
} else {
	enableCors();
}

try {
	$pdo = getDbConnection();

	// 1. Create chat_groups table
	$pdo->exec("CREATE TABLE IF NOT EXISTS chat_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )");
	echo "Table 'chat_groups' checked/created.<br>";

	// 2. Create chat_group_members table
	$pdo->exec("CREATE TABLE IF NOT EXISTS chat_group_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )");
	echo "Table 'chat_group_members' checked/created.<br>";

	// 3. Update messages table
	$columns = $pdo->query("SHOW COLUMNS FROM messages")->fetchAll(PDO::FETCH_COLUMN);

	if (!in_index('recipient_type', $columns)) {
		$pdo->exec("ALTER TABLE messages ADD COLUMN recipient_type ENUM('user', 'group', 'global') DEFAULT 'user' AFTER recipient_id");
		$pdo->exec("UPDATE messages SET recipient_type = 'global' WHERE recipient_id = 0");
		$pdo->exec("UPDATE messages SET recipient_type = 'user' WHERE recipient_id != 0");
		echo "Column 'recipient_type' added.<br>";
	}

	if (!in_index('file_url', $columns)) {
		$pdo->exec("ALTER TABLE messages ADD COLUMN file_url TEXT AFTER content");
		// Migration of image_url to file_url
		if (in_index('image_url', $columns)) {
			$pdo->exec("UPDATE messages SET file_url = image_url WHERE image_url IS NOT NULL");
		}
		echo "Column 'file_url' added.<br>";
	}

	if (!in_index('file_name', $columns)) {
		$pdo->exec("ALTER TABLE messages ADD COLUMN file_name VARCHAR(255) AFTER file_url");
		echo "Column 'file_name' added.<br>";
	}

	if (!in_index('file_size', $columns)) {
		$pdo->exec("ALTER TABLE messages ADD COLUMN file_size INT AFTER file_name");
		echo "Column 'file_size' added.<br>";
	}

	if (!in_index('is_deleted', $columns)) {
		$pdo->exec("ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE AFTER file_size");
		echo "Column 'is_deleted' added.<br>";
	}

	// Update ENUM for type
	$pdo->exec("ALTER TABLE messages MODIFY COLUMN type ENUM('text', 'image', 'video', 'audio', 'file') DEFAULT 'text'");
	echo "Column 'type' ENUM updated.<br>";

	echo "Migration Completed Successfully.";
} catch (Exception $e) {
	echo "Error during migration: " . $e->getMessage();
}

function in_index($needle, $haystack)
{
	return in_array($needle, $haystack);
}
