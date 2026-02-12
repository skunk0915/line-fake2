<?php
require_once 'config.php';
header('Content-Type: text/plain');

try {
	$pdo = getDbConnection();

	echo "--- Users ---\n";
	$stmt = $pdo->query("SELECT id, name, email FROM users");
	while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
		print_r($row);
	}

	echo "\n--- Invitations ---\n";
	$stmt = $pdo->query("SELECT * FROM invitations");
	while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
		print_r($row);
	}

	echo "\n--- Contacts ---\n";
	$stmt = $pdo->query("SELECT * FROM contacts");
	while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
		print_r($row);
	}
} catch (Exception $e) {
	echo "Error: " . $e->getMessage();
}
