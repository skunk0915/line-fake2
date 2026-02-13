<?php
require_once 'config.php';
enableCors();
$pdo = getDbConnection();

// Reset Alert History for Testing
if (isset($_GET['reset_alerts'])) {
    $pdo->exec("DELETE FROM message_alerts");
    header("Location: debug_cron.php?message=Alerts+reset");
    exit;
}

echo "<h1>Debug: Unread Alerts Logic</h1>";
if (isset($_GET['message'])) echo "<p style='color:green'>" . htmlspecialchars($_GET['message']) . "</p>";
echo "<p><a href='debug_cron.php?reset_alerts=1' style='background: #ff4d4f; color: white; padding: 10px; text-decoration: none; border-radius: 5px; font-weight: bold;'>アラート履歴をすべて消去する（テスト再送用）</a></p>";

// Check User Emails
echo "<h2>1. User Emails</h2>";
$users = $pdo->query("SELECT id, name, email FROM users")->fetchAll(PDO::FETCH_ASSOC);
echo "<table border=1><tr><th>ID</th><th>Name</th><th>Email</th></tr>";
foreach ($users as $u) {
    $emailDisplay = $u['email'] ? htmlspecialchars($u['email']) : '<span style="color:red">NULL</span>';
    echo "<tr><td>{$u['id']}</td><td>" . htmlspecialchars($u['name']) . "</td><td>{$emailDisplay}</td></tr>";
}
echo "</table>";

// Check Unread Messages (Without 10min limit)
echo "<h2>2. Potential Unread Messages (Ignoring 10min limit)</h2>";

// Modified SQL to show status
$sql = "
SELECT
    m.id as message_id,
    m.created_at,
    m.content,
    m.recipient_type,
    m.recipient_id,
    m.sender_id,
    s.name as sender_name,
    u.id as target_user_id,
    u.name as target_user_name,
    cgm.last_read_at as group_last_read,
    m.is_read as p2p_is_read,
    
    -- Time Check
    CASE WHEN m.created_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE) THEN 'YES' ELSE 'NO (Too New)' END as is_old_enough,
    
    -- Read Status
    CASE 
        WHEN m.recipient_type = 'user' AND m.is_read = 0 THEN 'UNREAD'
        WHEN m.recipient_type = 'user' AND m.is_read = 1 THEN 'READ'
        WHEN m.recipient_type = 'group' AND m.created_at > cgm.last_read_at THEN 'UNREAD'
        WHEN m.recipient_type = 'group' AND m.created_at <= cgm.last_read_at THEN 'READ'
        ELSE 'UNKNOWN'
    END as status_check,

    -- Alert Status
    (SELECT COUNT(*) FROM message_alerts ma WHERE ma.message_id = m.id AND ma.user_id = u.id) as alert_count

FROM messages m
JOIN users s ON m.sender_id = s.id
LEFT JOIN chat_group_members cgm ON m.recipient_type = 'group' AND m.recipient_id = cgm.group_id
LEFT JOIN users u ON 
    (m.recipient_type = 'user' AND m.recipient_id = u.id) 
    OR
    (m.recipient_type = 'group' AND cgm.user_id = u.id)
WHERE
    m.recipient_type IN ('user', 'group')
    AND m.sender_id != u.id
    -- AND m.created_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE) -- REMOVED FOR DEBUG
    -- Check only recent 50 messages to avoid huge list
ORDER BY m.created_at DESC
LIMIT 50
";

try {
    $stmt = $pdo->prepare($sql);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo "<table border=1>
    <tr>
        <th>Msg ID</th>
        <th>Time</th>
        <th>Type</th>
        <th>Sender</th>
        <th>Target User</th>
        <th>User Read Time / IsRead</th>
        <th>Is > 10min?</th>
        <th>Unread Status</th>
        <th>Alerted?</th>
        <th>Content</th>
    </tr>";

    foreach ($rows as $r) {
        $readInfo = $r['recipient_type'] == 'group' ? $r['group_last_read'] : ($r['p2p_is_read'] ? 'TRUE' : 'FALSE');

        // Highlight logic
        $rowStyle = "";
        if ($r['is_old_enough'] === 'YES' && $r['status_check'] === 'UNREAD' && $r['alert_count'] == 0) {
            $rowStyle = "style='background-color: #ffcccc; font-weight:bold;'"; // Should be alerted
        }

        echo "<tr {$rowStyle}>
            <td>{$r['message_id']}</td>
            <td>{$r['created_at']}</td>
            <td>{$r['recipient_type']}</td>
            <td>" . htmlspecialchars($r['sender_name']) . "</td>
            <td>" . htmlspecialchars($r['target_user_name']) . " (ID:{$r['target_user_id']})</td>
            <td>{$readInfo}</td>
            <td>{$r['is_old_enough']}</td>
            <td>{$r['status_check']}</td>
            <td>{$r['alert_count']}</td>
            <td>" . htmlspecialchars(mb_strimwidth($r['content'], 0, 30, '...')) . "</td>
        </tr>";
    }
    echo "</table>";
    echo "<p>Rows highlighted in RED should have been alerted.</p>";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
