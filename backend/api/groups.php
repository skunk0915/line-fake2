<?php
require_once 'config.php';

enableCors();

$method = $_SERVER['REQUEST_METHOD'];

// GET: Fetch groups for a user
if ($method === 'GET') {
    $userId = $_GET['user_id'] ?? 0;

    if (!$userId) {
        jsonResponse(['error' => 'User ID Required'], 400);
    }

    $pdo = getDbConnection();
    // Get groups where the user is a member
    $sql = "SELECT g.* FROM `groups` g
            JOIN `group_members` gm ON g.id = gm.group_id
            WHERE gm.user_id = ?
            ORDER BY g.created_at DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$userId]);
    $groups = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Get members for each group? Optional, but good for display
    foreach ($groups as &$group) {
        $mStmt = $pdo->prepare("SELECT u.id, u.name, u.avatar_url FROM users u 
                                JOIN group_members gm ON u.id = gm.user_id 
                                WHERE gm.group_id = ?");
        $mStmt->execute([$group['id']]);
        $group['members'] = $mStmt->fetchAll(PDO::FETCH_ASSOC);
    }

    jsonResponse(['groups' => $groups]);
}

// POST: Create a new group
if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);

    $name = $data['name'] ?? '';
    $creatorId = $data['created_by'] ?? 0;
    $memberIds = $data['members'] ?? []; // Array of user IDs

    if (!$name || !$creatorId || empty($memberIds)) {
        jsonResponse(['error' => 'Name, creator, and at least one member required'], 400);
    }

    // Ensure creator is in members
    if (!in_array($creatorId, $memberIds)) {
        $memberIds[] = $creatorId;
    }

    $pdo = getDbConnection();
    try {
        $pdo->beginTransaction();

        // 1. Create Group
        $stmt = $pdo->prepare("INSERT INTO `groups` (name, created_by) VALUES (?, ?)");
        $stmt->execute([$name, $creatorId]);
        $groupId = $pdo->lastInsertId();

        // 2. Add Members
        $sqlValues = [];
        $sqlParams = [];
        foreach ($memberIds as $uid) {
            $sqlValues[] = "(?, ?)";
            $sqlParams[] = $groupId;
            $sqlParams[] = $uid;
        }

        $sql = "INSERT INTO `group_members` (group_id, user_id) VALUES " . implode(',', $sqlValues);
        $stmt = $pdo->prepare($sql);
        $stmt->execute($sqlParams);

        $pdo->commit();

        jsonResponse(['success' => true, 'group_id' => $groupId, 'name' => $name]);
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonResponse(['error' => $e->getMessage()], 500);
    }
}
