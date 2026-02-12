<?php
require_once 'config.php';

enableCors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}

$input = json_decode(file_get_contents('php://input'), true);
$idToken = $input['token'] ?? null;

if (!$idToken) {
    jsonResponse(['error' => 'ID Token required'], 400);
}

// Verify Access Token via Google UserInfo Endpoint
$url = "https://www.googleapis.com/oauth2/v3/userinfo?access_token=" . $idToken;

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_USERAGENT, 'LineFake/1.0');
$response = curl_exec($ch);
if ($response === false) {
    jsonResponse(['error' => 'Google verification failed: ' . curl_error($ch)], 500);
}
curl_close($ch);

$payload = json_decode($response, true);

if (!$payload || isset($payload['error'])) {
    jsonResponse(['error' => 'Invalid Google Token'], 401);
}

$googleId = $payload['sub'];
$email = $payload['email'];
$name = $payload['name'];
$picture = $payload['picture'];

$pdo = getDbConnection();

// Check if user exists
$stmt = $pdo->prepare("SELECT * FROM users WHERE google_id = ?");
$stmt->execute([$googleId]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$user) {
    // Register new user
    $insert = $pdo->prepare("INSERT INTO users (google_id, email, name, avatar_url) VALUES (?, ?, ?, ?)");
    $insert->execute([$googleId, $email, $name, $picture]);
    $userId = $pdo->lastInsertId();
    $user = ['id' => $userId, 'name' => $name, 'avatar_url' => $picture, 'email' => $email];
} else if (empty($user['email'])) {
    // Update missing email
    $update = $pdo->prepare("UPDATE users SET email = ? WHERE id = ?");
    $update->execute([$email, $user['id']]);
    $user['email'] = $email;
}

// Check for invitations
if ($user) {
    // Establish contacts for any accepted invitations
    $stmtInv = $pdo->prepare("SELECT sender_id FROM invitations WHERE email = ? AND status = 'accepted'");
    $stmtInv->execute([$email]);
    while ($inv = $stmtInv->fetch(PDO::FETCH_ASSOC)) {
        $senderId = $inv['sender_id'];
        $recipientId = $user['id'];

        $pdo->prepare("INSERT IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?), (?, ?)")
            ->execute([$senderId, $recipientId, $recipientId, $senderId]);
    }
}

// In a real app, generate a session token here. Returning user ID directly for simplicity.
jsonResponse(['success' => true, 'user' => $user]);
