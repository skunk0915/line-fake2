<?php
require_once 'config.php';
enableCors();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $pdo = getDbConnection();
    // 全ユーザーを取得
    $stmt = $pdo->query("SELECT id, name, avatar_url FROM users ORDER BY name ASC");
    $users = $stmt->fetchAll(PDO::FETCH_ASSOC);

    jsonResponse(['users' => $users]);
}
