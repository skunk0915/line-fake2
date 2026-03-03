<?php
require_once 'config.php';
enableCors();

$method = $_SERVER['REQUEST_METHOD'];
$pdo = getDbConnection();

if ($method === 'POST') {
	// Send invitation
	$input = json_decode(file_get_contents('php://input'), true);
	$senderId = $input['sender_id'] ?? null;
	$email = $input['email'] ?? null;

	if (!$senderId || !$email) {
		jsonResponse(['error' => 'Sender ID and Email are required'], 400);
	}

	// Generate token
	$token = bin2hex(random_bytes(16));

	try {
		$stmt = $pdo->prepare("INSERT INTO invitations (sender_id, email, token) VALUES (?, ?, ?)");
		$stmt->execute([$senderId, $email, $token]);

		// Email Content
		$subject = "Line Fake - トークへの招待";
		$approveUrl = (isset($_SERVER['HTTPS']) ? "https://" : "http://") . $_SERVER['HTTP_HOST'] . dirname($_SERVER['PHP_SELF']) . "/invitations.php?token=" . $token;
		$message = "招待が届きました。\n\n以下のリンクをクリックして承認してください：\n" . $approveUrl;

		// Proper Headers for Japanese/UTF-8 Email
		mb_language("uni");
		mb_internal_encoding("UTF-8");

		$headers = "From: " . mb_encode_mimeheader("Line Fake", "UTF-8") . " <no-reply@" . $_SERVER['HTTP_HOST'] . ">\r\n";
		$headers .= "MIME-Version: 1.0\r\n";
		$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
		$headers .= "Content-Transfer-Encoding: 8bit\r\n";

		// Try to send email
		$mailSent = mb_send_mail($email, $subject, $message, $headers);

		jsonResponse([
			'success' => true,
			'message' => '招待メールを送信しました',
			'token' => $token, // Return token for debugging/demo purposes
			'approve_url' => $approveUrl,
			'mail_sent' => $mailSent
		]);
	} catch (Exception $e) {
		jsonResponse(['error' => 'Failed to create invitation: ' . $e->getMessage()], 500);
	}
} elseif ($method === 'GET') {
	// Handle approval link
	$token = $_GET['token'] ?? null;

	if (!$token) {
		die("Invalid token");
	}

	$stmt = $pdo->prepare("SELECT * FROM invitations WHERE token = ? AND status = 'pending'");
	$stmt->execute([$token]);
	$invitation = $stmt->fetch(PDO::FETCH_ASSOC);

	if (!$invitation) {
		die("招待が見つからないか、既に承認されています。");
	}

	// Mark as accepted
	$update = $pdo->prepare("UPDATE invitations SET status = 'accepted' WHERE id = ?");
	$update->execute([$invitation['id']]);

	// Check if recipient user already exists
	$stmtUser = $pdo->prepare("SELECT id FROM users WHERE email = ?");
	$stmtUser->execute([$invitation['email']]);
	$recipientUser = $stmtUser->fetch(PDO::FETCH_ASSOC);

	if ($recipientUser) {
		// Establish contact both ways
		$senderId = $invitation['sender_id'];
		$recipientId = $recipientUser['id'];

		$pdo->prepare("INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?), (?, ?)")
			->execute([$senderId, $recipientId, $recipientId, $senderId]);

		// Redirect to chat
		header("Location: " . getBaseUrl() . "/");
		exit;
	} else {
		// Recipient doesn't exist yet. 
		// We'll link them when they log in for the first time.
		// For now, redirect to the app root.
		header("Location: " . getBaseUrl() . "/?invitation_token=" . $token);
		exit;
	}
}
