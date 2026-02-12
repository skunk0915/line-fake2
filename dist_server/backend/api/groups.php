<?php
require_once 'config.php';
enableCors();

$method = $_SERVER['REQUEST_METHOD'];
$pdo = getDbConnection();

if ($method === 'GET') {
	$userId = $_GET['user_id'] ?? null;

	if ($userId) {
		// Fetch groups the user belongs to and calculate unread messages
		$stmt = $pdo->prepare("SELECT g.*, 
                               (SELECT COUNT(*) FROM messages m 
                                WHERE m.recipient_id = g.id AND m.recipient_type = 'group' 
                                AND m.created_at > gm.last_read_at AND m.is_deleted = FALSE) as unread_count
                               FROM chat_groups g 
                               JOIN chat_group_members gm ON g.id = gm.group_id 
                               WHERE gm.user_id = ?");
		$stmt->execute([$userId]);
		$groups = $stmt->fetchAll(PDO::FETCH_ASSOC);
		jsonResponse(['groups' => $groups]);
	} else {
		// Fetch all groups (for selection)
		$stmt = $pdo->query("SELECT *, 0 as unread_count FROM chat_groups");
		$groups = $stmt->fetchAll(PDO::FETCH_ASSOC);
		jsonResponse(['groups' => $groups]);
	}
}

if ($method === 'POST') {
	$input = json_decode(file_get_contents('php://input'), true);
	$name = $input['name'] ?? $_POST['name'] ?? '無題のグループ';
	$userIds = $input['user_ids'] ?? $_POST['user_ids'] ?? []; // Array of user IDs

	if (is_string($userIds)) {
		$userIds = json_decode($userIds, true);
	}

	if (empty($userIds)) {
		jsonResponse(['error' => 'メンバーを選択してください'], 400);
	}

	$pdo->beginTransaction();
	try {
		$stmt = $pdo->prepare("INSERT INTO chat_groups (name) VALUES (?)");
		$stmt->execute([$name]);
		$groupId = $pdo->lastInsertId();

		$stmt = $pdo->prepare("INSERT INTO chat_group_members (group_id, user_id) VALUES (?, ?)");
		foreach ($userIds as $uid) {
			$stmt->execute([$groupId, $uid]);
		}

		$pdo->commit();

		$stmt = $pdo->prepare("SELECT * FROM chat_groups WHERE id = ?");
		$stmt->execute([$groupId]);
		$group = $stmt->fetch(PDO::FETCH_ASSOC);

		jsonResponse(['success' => true, 'group' => $group]);
	} catch (Exception $e) {
		$pdo->rollBack();
		jsonResponse(['error' => $e->getMessage()], 500);
	}
}
