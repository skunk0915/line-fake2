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

// Verify ID Token via Google Endpoint
$url = "https://oauth2.googleapis.com/tokeninfo?id_token=" . $idToken;
$response = file_get_contents($url);
$payload = json_decode($response, true);

if (!$payload || isset($payload['error_description'])) {
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
    $insert = $pdo->prepare("INSERT INTO users (google_id, name, avatar_url) VALUES (?, ?, ?)");
    $insert->execute([$googleId, $name, $picture]);
    $userId = $pdo->lastInsertId();
    $user = ['id' => $userId, 'name' => $name, 'avatar_url' => $picture];
}

// In a real app, generate a session token here. Returning user ID directly for simplicity.
jsonResponse(['success' => true, 'user' => $user]);
