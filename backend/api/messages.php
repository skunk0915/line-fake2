<?php
require_once 'config.php';

enableCors();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // Fetch last 50 messages
    $pdo = getDbConnection();
    $sql = "SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar 
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            ORDER BY m.created_at ASC
            LIMIT 50";
    $stmt = $pdo->query($sql);
    $messages = $stmt->fetchAll(PDO::FETCH_ASSOC);
    jsonResponse(['messages' => $messages]);
}

if ($method === 'POST') {
    // Send message (text or image)
    $senderId = $_POST['sender_id'] ?? null;
    $content = $_POST['content'] ?? null;
    $type = 'text';
    $imageUrl = null;

    if (!$senderId) {
        jsonResponse(['error' => 'Sender ID Required'], 400);
    }

    // Handle Image Upload
    if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
        $type = 'image';
        $uploadDir = '../uploads/';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }
        $fileName = uniqid() . '_' . basename($_FILES['image']['name']);
        $targetPath = $uploadDir . $fileName;

        if (move_uploaded_file($_FILES['image']['tmp_name'], $targetPath)) {
            $imageUrl = '/backend/uploads/' . $fileName; // Adjust path for production
        } else {
            jsonResponse(['error' => 'Failed to upload image'], 500);
        }
    } else {
        if (!$content) {
            jsonResponse(['error' => 'Content Required'], 400);
        }
    }

    $pdo = getDbConnection();
    $stmt = $pdo->prepare("INSERT INTO messages (sender_id, type, content, image_url) VALUES (?, ?, ?, ?)");
    $stmt->execute([$senderId, $type, $content, $imageUrl]);

    $messageId = $pdo->lastInsertId();

    // Fetch the inserted message with user info for broadcasting
    $fetchSql = "SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar 
                 FROM messages m
                 JOIN users u ON m.sender_id = u.id
                 WHERE m.id = ?";
    $stmt = $pdo->prepare($fetchSql);
    $stmt->execute([$messageId]);
    $newMessage = $stmt->fetch(PDO::FETCH_ASSOC);

    // Broadcast setup: Get subscriptions except sender
    $subStmt = $pdo->prepare("SELECT * FROM push_subscriptions WHERE user_id != ?");
    $subStmt->execute([$senderId]);
    $subscriptions = $subStmt->fetchAll(PDO::FETCH_ASSOC);

    $formattedSubs = [];
    foreach ($subscriptions as $sub) {
        $formattedSubs[] = [
            'endpoint' => $sub['endpoint'],
            'keys' => [
                'p256dh' => $sub['p256dh'],
                'auth' => $sub['auth']
            ]
        ];
    }

    // Call Render Node Server
    $broadcastPayload = json_encode(['message' => $newMessage, 'subscriptions' => $formattedSubs]);

    $ch = curl_init(RENDER_URL . '/broadcast');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $broadcastPayload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);

    // Don't wait too long for render response to keep PHP fast
    curl_setopt($ch, CURLOPT_TIMEOUT_MS, 2000);

    $result = curl_exec($ch);
    $error = curl_error($ch);
    curl_close($ch);

    jsonResponse(['success' => true, 'message' => $newMessage, 'broadcast_result' => $result, 'broadcast_error' => $error]);
}
