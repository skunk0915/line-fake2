<?php
require_once 'config.php';

enableCors();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $senderId = $_GET['sender_id'] ?? 0;
    $recipientId = $_GET['recipient_id'] ?? 0;
    $recipientType = $_GET['recipient_type'] ?? 'user';


    $pdo = getDbConnection();

    if ($recipientType === 'global') {
        $sql = "SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar 
                FROM messages m
                JOIN users u ON m.sender_id = u.id
                WHERE m.recipient_type = 'global'
                ORDER BY m.created_at ASC
                LIMIT 100";
        $stmt = $pdo->query($sql);
    } elseif ($recipientType === 'group') {
        $sql = "SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar 
                FROM messages m
                JOIN users u ON m.sender_id = u.id
                WHERE m.recipient_id = ? AND m.recipient_type = 'group'
                ORDER BY m.created_at ASC
                LIMIT 100";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$recipientId]);
    } else {
        // 1-on-1
        $sql = "SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar 
                FROM messages m
                JOIN users u ON m.sender_id = u.id
                WHERE ((m.sender_id = ? AND m.recipient_id = ?) 
                   OR (m.sender_id = ? AND m.recipient_id = ?))
                   AND m.recipient_type = 'user'
                ORDER BY m.created_at ASC
                LIMIT 100";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$senderId, $recipientId, $recipientId, $senderId]);
    }

    $messages = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($messages as &$msg) {
        // Compatibility for old image_url and new file_url
        $url = $msg['file_url'] ?: ($msg['image_url'] ?? null);
        if ($url && strpos($url, '/backend/') === 0) {
            $url = getBaseUrl() . str_replace('/backend', '', $url);
        }
        $msg['file_url'] = $url;
        $msg['image_url'] = ($msg['type'] === 'image') ? $url : null;

        if ($msg['is_deleted']) {
            $msg['content'] = 'メッセージが削除されました';
            $msg['file_url'] = null;
            $msg['image_url'] = null;
        }
    }

    jsonResponse(['messages' => $messages]);
}

if ($method === 'POST') {
    $senderId = $_POST['sender_id'] ?? null;
    $recipientId = $_POST['recipient_id'] ?? 0;
    $recipientType = $_POST['recipient_type'] ?? 'user';
    $content = $_POST['content'] ?? null;
    $type = $_POST['type'] ?? 'text'; // From frontend: text, image, video, audio, file

    if ($recipientType === 'global' || (int)$recipientId === 0) {
        $recipientType = 'global';
    }

    if (!$senderId) {
        jsonResponse(['error' => 'Sender ID Required'], 400);
    }

    $fileUrl = null;
    $fileName = null;
    $fileSize = 0;

    // Handle File Upload
    if (isset($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
        $uploadDir = '../uploads/';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        $originalName = $_FILES['file']['name'];
        $fileName = uniqid() . '_' . basename($originalName);
        $targetPath = $uploadDir . $fileName;

        if (move_uploaded_file($_FILES['file']['tmp_name'], $targetPath)) {
            $fileUrl = '/backend/uploads/' . $fileName;
            $fileName = $originalName;
            $fileSize = $_FILES['file']['size'];

            // Detect type if not provided or to be sure
            $mime = function_exists('mime_content_type') ? mime_content_type($targetPath) : '';
            if (!$mime) {
                $ext = strtolower(pathinfo($targetPath, PATHINFO_EXTENSION));
                $mimes = [
                    'jpg' => 'image/jpeg',
                    'jpeg' => 'image/jpeg',
                    'png' => 'image/png',
                    'gif' => 'image/gif',
                    'mp4' => 'video/mp4',
                    'mov' => 'video/quicktime',
                    'mp3' => 'audio/mpeg',
                    'wav' => 'audio/wav',
                    'pdf' => 'application/pdf'
                ];
                $mime = $mimes[$ext] ?? 'application/octet-stream';
            }

            if (strpos($mime, 'image/') === 0) $type = 'image';
            else if (strpos($mime, 'video/') === 0) $type = 'video';
            else if (strpos($mime, 'audio/') === 0) $type = 'audio';
            else $type = 'file';

            if (!$content) {
                if ($type === 'image') $content = '[画像]';
                else if ($type === 'video') $content = '[動画]';
                else if ($type === 'audio') $content = '[音声]';
                else $content = '[ファイル]';
            }
        } else {
            jsonResponse(['error' => 'Failed to upload file. Error code: ' . $_FILES['file']['error']], 500);
        }
    } else if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
        // Backward compatibility for image field
        $type = 'image';
        $uploadDir = '../uploads/';
        if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
        $fName = uniqid() . '_' . basename($_FILES['image']['name']);
        if (move_uploaded_file($_FILES['image']['tmp_name'], $uploadDir . $fName)) {
            $fileUrl = '/backend/uploads/' . $fName;
            $fileName = $_FILES['image']['name'];
        }
    }

    $pdo = getDbConnection();
    $stmt = $pdo->prepare("INSERT INTO messages (sender_id, recipient_id, recipient_type, type, content, file_url, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([$senderId, $recipientId, $recipientType, $type, $content, $fileUrl, $fileName, $fileSize]);

    $messageId = $pdo->lastInsertId();

    $fetchSql = "SELECT m.*, u.name as sender_name, u.avatar_url as sender_avatar 
                 FROM messages m
                 JOIN users u ON m.sender_id = u.id
                 WHERE m.id = ?";
    $stmt = $pdo->prepare($fetchSql);
    $stmt->execute([$messageId]);
    $newMessage = $stmt->fetch(PDO::FETCH_ASSOC);

    // Normalize URLs
    $url = $newMessage['file_url'];
    if ($url && strpos($url, '/backend/') === 0) {
        $url = getBaseUrl() . str_replace('/backend', '', $url);
    }
    $newMessage['file_url'] = $url;
    $newMessage['image_url'] = ($newMessage['type'] === 'image') ? $url : null;

    // Ensure file_name is not null for frontend
    if (!$newMessage['file_name'] && $newMessage['file_url']) {
        $newMessage['file_name'] = basename($newMessage['file_url']);
    }

    // Push Notifications
    try {
        require_once 'push_helper.php';
        sendPushNotifications($newMessage, $senderId);
    } catch (Exception $e) {
        error_log("Push error: " . $e->getMessage());
    }

    jsonResponse(['success' => true, 'message' => $newMessage]);
}

if ($method === 'DELETE' || ($method === 'POST' && isset($_GET['action']) && $_GET['action'] === 'delete')) {
    // Soft delete
    $messageId = $_GET['id'] ?? $_POST['id'] ?? null;
    $userId = $_GET['user_id'] ?? $_POST['user_id'] ?? null;

    if (!$messageId || !$userId) {
        jsonResponse(['error' => 'Missing message_id or user_id'], 400);
    }

    $pdo = getDbConnection();
    // Check ownership
    $stmt = $pdo->prepare("SELECT sender_id FROM messages WHERE id = ?");
    $stmt->execute([$messageId]);
    $msg = $stmt->fetch();

    if (!$msg || (string)$msg['sender_id'] !== (string)$userId) {
        jsonResponse(['error' => 'Unauthorized or not found'], 403);
    }

    $stmt = $pdo->prepare("UPDATE messages SET is_deleted = TRUE WHERE id = ?");
    $stmt->execute([$messageId]);

    jsonResponse(['success' => true]);
}
