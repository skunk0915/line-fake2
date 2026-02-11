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

    // Send push notifications directly from PHP (no external server needed)
    $pushResult = null;
    try {
        require_once 'push_helper.php';
        $pushResult = sendPushNotifications($newMessage, $senderId);
    } catch (Exception $e) {
        error_log("Push notification error: " . $e->getMessage());
        $pushResult = ['error' => $e->getMessage()];
    }

    jsonResponse(['success' => true, 'message' => $newMessage, 'push_result' => $pushResult]);
}
