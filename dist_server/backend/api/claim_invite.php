<?php
require_once 'config.php';
enableCors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
	jsonResponse(['error' => 'Method not allowed'], 405);
}

$input = json_decode(file_get_contents('php://input'), true);
$userId = $input['user_id'] ?? null;
$token = $input['token'] ?? null;

if (!$userId || !$token) {
	jsonResponse(['error' => 'User ID and Token required'], 400);
}

try {
	$pdo = getDbConnection();

	// Find the invitation by token
	// We allow 'accepted' status because invitations.php (GET) sets it to accepted before redirection
	$stmt = $pdo->prepare("SELECT * FROM invitations WHERE token = ?");
	$stmt->execute([$token]);
	$invitation = $stmt->fetch(PDO::FETCH_ASSOC);

	if (!$invitation) {
		jsonResponse(['error' => 'Invitation not found'], 404);
	}

	$senderId = $invitation['sender_id'];
	$recipientId = $userId;

	if ((string)$senderId === (string)$recipientId) {
		jsonResponse(['message' => 'Cannot invite yourself', 'success' => false]);
	}

	// Create contacts (bidirectional)
	$sql = "INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?), (?, ?)";
	$stmtIns = $pdo->prepare($sql);
	$stmtIns->execute([$senderId, $recipientId, $recipientId, $senderId]);

	// Update user's email if missing, trusting the invitation email
	if (!empty($invitation['email'])) {
		$stmtUser = $pdo->prepare("UPDATE users SET email = ? WHERE id = ? AND (email IS NULL OR email = '')");
		$stmtUser->execute([$invitation['email'], $recipientId]);
	}

	// Also update invitation to point to this user if somehow helpful (not in schema currently)

	jsonResponse(['success' => true, 'message' => 'Contact added successfully']);
} catch (Exception $e) {
	error_log("Claim invite error: " . $e->getMessage());
	jsonResponse(['error' => 'Server error'], 500);
}
