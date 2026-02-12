<?php
require_once 'config.php';
header('Content-Type: text/plain'); // Plain text for easy reading

$myId = $_GET['my_id'] ?? 2; // Default to 2 based on user report

try {
	$pdo = getDbConnection();
	echo "Connected to DB\n";

	// 1. Check if table exists
	echo "Checking contacts table...\n";
	$stmt = $pdo->query("DESCRIBE contacts");
	$columns = $stmt->fetchAll(PDO::FETCH_COLUMN);
	echo "Contacts columns: " . implode(', ', $columns) . "\n";

	// 2. Run the query from users.php
	echo "Running users query for my_id = $myId...\n";
	$sql = "SELECT u.id, u.name, u.avatar_url,
            (SELECT COUNT(*) FROM messages 
             WHERE sender_id = u.id AND recipient_id = ? AND recipient_type = 'user' AND is_read = FALSE AND is_deleted = FALSE) as unread_count
            FROM users u 
            INNER JOIN contacts c ON (u.id = c.contact_id AND c.user_id = ?)
            ORDER BY name ASC";

	$stmt = $pdo->prepare($sql);
	$stmt->execute([$myId, $myId]);
	$users = $stmt->fetchAll(PDO::FETCH_ASSOC);

	echo "Query successful. Found " . count($users) . " users.\n";
	print_r($users);
} catch (Exception $e) {
	echo "ERROR: " . $e->getMessage() . "\n";
	echo "Trace:\n" . $e->getTraceAsString();
}
