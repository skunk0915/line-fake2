<?php
require_once 'config.php';

enableCors();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // Fetch last 50 messages for 1-on-1 chat

    // Fetch last 50 messages for 1-on-1 chat or group chat
    $senderId = $_GET['sender_id'] ?? 0;
    $recipientId = $_GET['recipient_id'] ?? 0;
    $recipientType = $_GET['recipient_type'] ?? 'user'; // 'user' or 'group'

    $pdo = getDbConnection();

    // Determine query based on recipient_type
    $sql = "SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar 
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE ";
    $params = [];

    if ($recipientId == 0) { // Global Chat (legacy check, could use recipient_type = 'global')
        $sql .= "m.recipient_id = 0";
    } elseif ($recipientType === 'group') {
        // Group Chat: Messages sent successfully to this group ID
        $sql .= "m.recipient_id = ? AND m.recipient_type = 'group'";
        $params[] = $recipientId;
    } else {
        // 1-on-1 Chat
        $sql .= "( (m.sender_id = ? AND m.recipient_id = ? AND m.recipient_type = 'user') 
                   OR (m.sender_id = ? AND m.recipient_id = ? AND m.recipient_type = 'user') )";
        $params[] = $senderId;
        $params[] = $recipientId;
        $params[] = $recipientId;
        $params[] = $senderId;
    }

    $sql .= " ORDER BY m.created_at ASC LIMIT 50";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $messages = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Make image/audio/video URLs absolute if they start with /backend/
    foreach ($messages as &$msg) {
        if (!empty($msg['image_url']) && strpos($msg['image_url'], '/backend/') === 0) {
            $msg['image_url'] = getBaseUrl() . str_replace('/backend', '', $msg['image_url']);
        }
    }

    jsonResponse(['messages' => $messages]);
}

if ($method === 'POST') {
    // Send message (text, image, audio, video)
    $senderId = $_POST['sender_id'] ?? null;
    $recipientId = $_POST['recipient_id'] ?? 0;
    $recipientType = $_POST['recipient_type'] ?? 'user';
    $content = $_POST['content'] ?? null;
    $type = 'text'; // Start with text
    $mediaUrl = null;

    if (!$senderId) {
        jsonResponse(['error' => 'Sender ID Required'], 400);
    }

    // Handle File Uploads (image, audio, video)
    // We reuse 'image' key or detect type
    if (isset($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['file'];
        $mime = mime_content_type($file['tmp_name']);

        if (strpos($mime, 'image') === 0) {
            $type = 'image';
        } elseif (strpos($mime, 'audio') === 0) {
            $type = 'audio';
        } elseif (strpos($mime, 'video') === 0) {
            $type = 'video';
        } else {
            // Default or error? Assume file/image
            $type = 'image';
        }

        $uploadDir = '../uploads/';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
        if (!$ext) {
            // Try to guess extension from mime
            if ($type == 'audio') $ext = 'webm'; // likely from MediaRecorder
            if ($type == 'video') $ext = 'webm';
            if ($type == 'image') $ext = 'jpg';
        }

        $fileName = uniqid() . '.' . $ext;
        $targetPath = $uploadDir . $fileName;

        if (move_uploaded_file($file['tmp_name'], $targetPath)) {
            // Store as /backend/uploads/... 
            $mediaUrl = '/backend/uploads/' . $fileName;
        } else {
            jsonResponse(['error' => 'Failed to upload file'], 500);
        }
    } elseif (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
        // Legacy support for 'image' field
        $type = 'image';
        $uploadDir = '../uploads/';
        if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
        $fileName = uniqid() . '_' . basename($_FILES['image']['name']);
        $targetPath = $uploadDir . $fileName;
        if (move_uploaded_file($_FILES['image']['tmp_name'], $targetPath)) {
            $mediaUrl = '/backend/uploads/' . $fileName;
        }
    }

    // Prepare insert
    // Note: older messages table had 'image_url', let's use that for all media URLs for now
    // Or if checking schema, migrate_v2 didn't change media column name, just recipient_type.
    // So distinct audio/video url columns don't exist yet. We reuse image_url as media_url.

    // We should ideally rename column image_url -> media_url but that requires extra migration.
    // I'll stick with image_url column but store audio/video path there.

    $pdo = getDbConnection();
    // Check if recipient_type column exists (should be added by migration)
    // Assuming migration ran or will run. But fallback if fail?
    // We assume backend is updated.

    $stmt = $pdo->prepare("INSERT INTO messages (sender_id, recipient_id, recipient_type, type, content, image_url) VALUES (?, ?, ?, ?, ?, ?)");
    $stmt->execute([$senderId, $recipientId, $recipientType, $type, $content, $mediaUrl]);

    $messageId = $pdo->lastInsertId();

    // Fetch the inserted message
    $fetchSql = "SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar 
                 FROM messages m
                 JOIN users u ON m.sender_id = u.id
                 WHERE m.id = ?";
    $stmt = $pdo->prepare($fetchSql);
    $stmt->execute([$messageId]);
    $newMessage = $stmt->fetch(PDO::FETCH_ASSOC);

    // Make media URL absolute
    if (!empty($newMessage['image_url']) && strpos($newMessage['image_url'], '/backend/') === 0) {
        $newMessage['image_url'] = getBaseUrl() . str_replace('/backend', '', $newMessage['image_url']);
    }

    // Send push notifications
    $pushResult = null;
    try {
        require_once 'push_helper.php';
        // Updated push helper needs to handle recipient_type logic if needed (e.g. notify group members)
        // I need to update push_helper.php too!
        $pushResult = sendPushNotifications($newMessage, $senderId);
    } catch (Exception $e) {
        error_log("Push notification error: " . $e->getMessage());
        $pushResult = ['error' => $e->getMessage()];
    }

    jsonResponse(['success' => true, 'message' => $newMessage, 'push_result' => $pushResult]);
}
