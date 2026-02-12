<?php
require_once 'config.php';
if (php_sapi_name() === 'cli') {
	$_SERVER['REQUEST_METHOD'] = 'GET';
} else {
	enableCors();
}

try {
	$pdo = getDbConnection();

	// 1. Add email to users table
	$columns = $pdo->query("SHOW COLUMNS FROM users")->fetchAll(PDO::FETCH_COLUMN);
	if (!in_array('email', $columns)) {
		$pdo->exec("ALTER TABLE users ADD COLUMN email VARCHAR(255) AFTER google_id");
		$pdo->exec("CREATE INDEX idx_email ON users(email)");
		echo "Column 'email' added to 'users'.<br>";
	}

	// 2. Create contacts table
	$pdo->exec("CREATE TABLE IF NOT EXISTS contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        contact_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY user_contact (user_id, contact_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES users(id) ON DELETE CASCADE
    )");
	echo "Table 'contacts' checked/created.<br>";

	// 3. Create invitations table
	$pdo->exec("CREATE TABLE IF NOT EXISTS invitations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL,
        email VARCHAR(255) NOT NULL,
        token VARCHAR(255) UNIQUE NOT NULL,
        status ENUM('pending', 'accepted') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    )");
	echo "Table 'invitations' checked/created.<br>";

	// 4. (Optional) Auto-populate contacts for existing users if you want them to keep seeing each other
	// For now, let's just make it so they have to add each other or we keep the list open but limited.
	// Actually, to satisfy the requirement "トークルームが成立する", we should probably use the contacts table.

	echo "Migration V4 Completed Successfully.";
} catch (Exception $e) {
	echo "Error during migration V4: " . $e->getMessage();
}
