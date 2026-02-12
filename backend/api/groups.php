<?php
require_once 'config.php';
require_once 'push_helper.php';
enableCors();

$method = $_SERVER['REQUEST_METHOD'];
$pdo = getDbConnection();

if ($method === 'GET') {
	$userId = $_GET['user_id'] ?? null;
	$groupId = $_GET['group_id'] ?? null;

	if ($groupId) {
		// Fetch members of a specific group
		$stmt = $pdo->prepare("SELECT u.id, u.name, u.avatar_url FROM users u JOIN chat_group_members gm ON u.id = gm.user_id WHERE gm.group_id = ?");
		$stmt->execute([$groupId]);
		$members = $stmt->fetchAll(PDO::FETCH_ASSOC);
		jsonResponse(['members' => $members]);
	} elseif ($userId) {
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
	$groupId = $input['group_id'] ?? $_POST['group_id'] ?? null;
	$name = $input['name'] ?? $_POST['name'] ?? null;
	$userIds = $input['user_ids'] ?? $_POST['user_ids'] ?? null; // Array of user IDs

	if (is_string($userIds)) {
		$userIds = json_decode($userIds, true);
	}

	if ($groupId) {
		// Update existing group
		$avatarUrl = null;
		if (isset($_FILES['avatar']) && $_FILES['avatar']['error'] === UPLOAD_ERR_OK) {
			$uploadDir = '../uploads/groups/';
			if (!is_dir($uploadDir)) {
				mkdir($uploadDir, 0777, true);
			}
			$ext = pathinfo($_FILES['avatar']['name'], PATHINFO_EXTENSION);
			$fileName = 'group_' . $groupId . '_' . time() . '.' . $ext;
			$uploadFile = $uploadDir . $fileName;

			if (move_uploaded_file($_FILES['avatar']['tmp_name'], $uploadFile)) {
				$avatarUrl = 'uploads/groups/' . $fileName;
				$protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http';
				$host = $_SERVER['HTTP_HOST'];
				$scriptPath = dirname($_SERVER['SCRIPT_NAME']);
				$basePath = dirname($scriptPath);
				$avatarUrl = $protocol . "://" . $host . $basePath . '/' . $avatarUrl;
			}
		}

		$pdo->beginTransaction();
		try {
			if ($name && $avatarUrl) {
				$stmt = $pdo->prepare("UPDATE chat_groups SET name = ?, avatar_url = ? WHERE id = ?");
				$stmt->execute([$name, $avatarUrl, $groupId]);
			} elseif ($name) {
				$stmt = $pdo->prepare("UPDATE chat_groups SET name = ? WHERE id = ?");
				$stmt->execute([$name, $groupId]);
			} elseif ($avatarUrl) {
				$stmt = $pdo->prepare("UPDATE chat_groups SET avatar_url = ? WHERE id = ?");
				$stmt->execute([$avatarUrl, $groupId]);
			}

			// Update members if user_ids is provided
			if ($userIds !== null) {
				$stmt = $pdo->prepare("DELETE FROM chat_group_members WHERE group_id = ?");
				$stmt->execute([$groupId]);

				$stmt = $pdo->prepare("INSERT INTO chat_group_members (group_id, user_id) VALUES (?, ?)");
				foreach ($userIds as $uid) {
					$stmt->execute([$groupId, $uid]);
				}
			}

			$pdo->commit();

			$stmt = $pdo->prepare("SELECT * FROM chat_groups WHERE id = ?");
			$stmt->execute([$groupId]);
			$group = $stmt->fetch(PDO::FETCH_ASSOC);
			broadcastEvent('group_updated', $group);
			jsonResponse(['success' => true, 'group' => $group]);
		} catch (Exception $e) {
			$pdo->rollBack();
			jsonResponse(['error' => $e->getMessage()], 500);
		}
		exit;
	}

	// Create new group
	if (empty($userIds)) {
		jsonResponse(['error' => 'メンバーを選択してください'], 400);
	}

	$pdo->beginTransaction();
	try {
		$stmt = $pdo->prepare("INSERT INTO chat_groups (name) VALUES (?)");
		$stmt->execute([$name ?: '無題のグループ']);
		$groupId = $pdo->lastInsertId();

		$stmt = $pdo->prepare("INSERT INTO chat_group_members (group_id, user_id) VALUES (?, ?)");
		foreach ($userIds as $uid) {
			$stmt->execute([$groupId, $uid]);
		}

		$pdo->commit();

		$stmt = $pdo->prepare("SELECT * FROM chat_groups WHERE id = ?");
		$stmt->execute([$groupId]);
		$group = $stmt->fetch(PDO::FETCH_ASSOC);

		broadcastEvent('group_updated', $group);
		jsonResponse(['success' => true, 'group' => $group]);
	} catch (Exception $e) {
		$pdo->rollBack();
		jsonResponse(['error' => $e->getMessage()], 500);
	}
}

if ($method === 'DELETE') {
	$groupId = $_GET['id'] ?? null;
	if (!$groupId) {
		jsonResponse(['error' => 'No group ID provided'], 400);
	}

	try {
		$pdo->beginTransaction();
		// Delete members
		$stmt = $pdo->prepare("DELETE FROM chat_group_members WHERE group_id = ?");
		$stmt->execute([$groupId]);
		// Delete messages (optional, maybe better to keep them or mark as deleted? For now let's just delete the group)
		// Usually deleting a group should at least remove the group record.
		$stmt = $pdo->prepare("DELETE FROM chat_groups WHERE id = ?");
		$stmt->execute([$groupId]);
		$pdo->commit();

		broadcastEvent('group_updated', ['deleted_id' => $groupId]);
		jsonResponse(['success' => true]);
	} catch (Exception $e) {
		$pdo->rollBack();
		jsonResponse(['error' => $e->getMessage()], 500);
	}
}
