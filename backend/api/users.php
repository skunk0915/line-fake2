<?php
require_once 'config.php';
require_once 'push_helper.php';
enableCors();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $pdo = getDbConnection();
    $myId = $_GET['my_id'] ?? 0;

    // 連絡先（contacts）に登録されているユーザーのみ取得
    if ($myId) {
        $sql = "SELECT u.id, u.name, u.avatar_url,
                (SELECT COUNT(*) FROM messages 
                 WHERE sender_id = u.id AND recipient_id = ? AND recipient_type = 'user' AND is_read = FALSE AND is_deleted = FALSE) as unread_count
                FROM users u 
                INNER JOIN contacts c ON (u.id = c.contact_id AND c.user_id = ?)
                ORDER BY name ASC";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$myId, $myId]);
    } else {
        $stmt = $pdo->query("SELECT id, name, avatar_url, 0 as unread_count FROM users ORDER BY name ASC");
    }

    $users = $stmt->fetchAll(PDO::FETCH_ASSOC);
    jsonResponse(['users' => $users]);
}

if ($method === 'POST') {
    $pdo = getDbConnection();
    $userId = $_POST['user_id'] ?? null;
    $name = $_POST['name'] ?? null;
    $avatarUrl = null;

    if (!$userId) {
        jsonResponse(['error' => 'User ID is required'], 400);
    }

    // Handle avatar upload
    if (isset($_FILES['avatar']) && $_FILES['avatar']['error'] === UPLOAD_ERR_OK) {
        $uploadDir = '../uploads/avatars/';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0777, true);
        }
        $ext = pathinfo($_FILES['avatar']['name'], PATHINFO_EXTENSION);
        $fileName = 'user_' . $userId . '_' . time() . '.' . $ext;
        $uploadFile = $uploadDir . $fileName;

        if (move_uploaded_file($_FILES['avatar']['tmp_name'], $uploadFile)) {
            $avatarUrl = 'uploads/avatars/' . $fileName;
            // Get full URL if possible
            $protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http';
            $host = $_SERVER['HTTP_HOST'];
            $scriptPath = dirname($_SERVER['SCRIPT_NAME']);
            $basePath = dirname($scriptPath);
            $avatarUrl = $protocol . "://" . $host . $basePath . '/' . $avatarUrl;
        }
    }

    try {
        if ($name && $avatarUrl) {
            $stmt = $pdo->prepare("UPDATE users SET name = ?, avatar_url = ? WHERE id = ?");
            $stmt->execute([$name, $avatarUrl, $userId]);
        } elseif ($name) {
            $stmt = $pdo->prepare("UPDATE users SET name = ? WHERE id = ?");
            $stmt->execute([$name, $userId]);
        } elseif ($avatarUrl) {
            $stmt = $pdo->prepare("UPDATE users SET avatar_url = ? WHERE id = ?");
            $stmt->execute([$avatarUrl, $userId]);
        }

        // Fetch updated user
        $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        broadcastEvent('user_updated', $user);
        jsonResponse(['success' => true, 'user' => $user]);
    } catch (Exception $e) {
        jsonResponse(['error' => $e->getMessage()], 500);
    }
}
