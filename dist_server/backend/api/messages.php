<?php
require_once 'config.php';

enableCors();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // Fetch last 50 messages for 1-on-1 chat
    $senderId = $_GET['sender_id'] ?? 0;
    $recipientId = $_GET['recipient_id'] ?? 0;

    $pdo = getDbConnection();

    // For 1-on-1, fetch messages where (sender=A and recipient=B) OR (sender=B and recipient=A)
    // If recipient is 0, it's a global chat
    if ($recipientId == 0) {
        $sql = "SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar 
                FROM messages m
                JOIN users u ON m.sender_id = u.id
                WHERE m.recipient_id = 0
                ORDER BY m.created_at ASC
                LIMIT 50";
        $stmt = $pdo->query($sql);
    } else {
        $sql = "SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar 
                FROM messages m
                JOIN users u ON m.sender_id = u.id
                WHERE (m.sender_id = ? AND m.recipient_id = ?) 
                   OR (m.sender_id = ? AND m.recipient_id = ?)
                ORDER BY m.created_at ASC
                LIMIT 50";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$senderId, $recipientId, $recipientId, $senderId]);
    }

    $messages = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Make image URLs absolute if they start with /backend/
    foreach ($messages as &$msg) {
        if ($msg['image_url'] && strpos($msg['image_url'], '/backend/') === 0) {
            $msg['image_url'] = getBaseUrl() . str_replace('/backend', '', $msg['image_url']);
        }
    }

    jsonResponse(['messages' => $messages]);
}

if ($method === 'POST') {
    // Send message (text or image)
    $senderId = $_POST['sender_id'] ?? null;
    $recipientId = $_POST['recipient_id'] ?? 0; // Default to 0 for global
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
            // Store as /backend/uploads/... for compatibility, but we return absolute URL
            $imageUrl = '/backend/uploads/' . $fileName;
        } else {
            jsonResponse(['error' => 'Failed to upload image'], 500);
        }
    } else {
        if (!$content) {
            jsonResponse(['error' => 'Content Required'], 400);
        }
    }

    $pdo = getDbConnection();
    $stmt = $pdo->prepare("INSERT INTO messages (sender_id, recipient_id, type, content, image_url) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$senderId, $recipientId, $type, $content, $imageUrl]);

    $messageId = $pdo->lastInsertId();

    // Fetch the inserted message with user info for broadcasting
    $fetchSql = "SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar 
                 FROM messages m
                 JOIN users u ON m.sender_id = u.id
                 WHERE m.id = ?";
    $stmt = $pdo->prepare($fetchSql);
    $stmt->execute([$messageId]);
    $newMessage = $stmt->fetch(PDO::FETCH_ASSOC);

    // Make image URL absolute for the response
    if ($newMessage['image_url'] && strpos($newMessage['image_url'], '/backend/') === 0) {
        $newMessage['image_url'] = getBaseUrl() . str_replace('/backend', '', $newMessage['image_url']);
    }

    // Send push notifications
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
