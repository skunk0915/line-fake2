<?php
require_once 'config.php';
enableCors();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $pdo = getDbConnection();
    $myId = $_GET['my_id'] ?? 0;

    // 連絡先（contacts）に登録されているユーザーのみ取得
    // my_id が指定されている場合は、そのユーザーと接点があるユーザーのみ
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
