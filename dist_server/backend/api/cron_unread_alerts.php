<?php
// Run naturally via CLI or Web
require_once 'config.php';

// Allow execution from CLI or simple fetch
if (php_sapi_name() !== 'cli') {
	enableCors();
}

$pdo = getDbConnection();

// 1. Ensure alert tracking table exists (Self-migration just in case)
function ensureAlertTable($pdo)
{
	try {
		$pdo->exec("CREATE TABLE IF NOT EXISTS message_alerts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            message_id INT NOT NULL,
            user_id INT NOT NULL,
            alerted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY msg_user_alert (message_id, user_id),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )");
	} catch (Exception $e) {
		// Ignore if error, subsequent queries will fail and log normally
	}
}
ensureAlertTable($pdo);

// 2. Main Logic: Find unread messages older than 10 mins that haven't been alerted
// For 1-on-1: recipient_type='user' AND is_read=0
// For Group: recipient_type='group' AND created_at > last_read_at (of member)

$sql = "
SELECT
    m.id as message_id,
    m.created_at,
    m.content,
    m.recipient_type,
    m.sender_id,
    s.name as sender_name,
    u.id as recipient_user_id,
    u.email as recipient_email,
    u.name as recipient_name,
    CASE 
        WHEN m.recipient_type = 'user' THEN 'プライベートチャット'
        WHEN m.recipient_type = 'group' THEN g.name
    END as source_name
FROM messages m
JOIN users s ON m.sender_id = s.id
LEFT JOIN chat_groups g ON m.recipient_type = 'group' AND m.recipient_id = g.id
LEFT JOIN chat_group_members cgm ON m.recipient_type = 'group' AND m.recipient_id = cgm.group_id
LEFT JOIN users u ON 
    (m.recipient_type = 'user' AND m.recipient_id = u.id) 
    OR
    (m.recipient_type = 'group' AND cgm.user_id = u.id)
WHERE
    m.recipient_type IN ('user', 'group')
    AND m.sender_id != u.id -- Don't alert sender
    AND m.created_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
    AND (
        (m.recipient_type = 'user' AND m.is_read = 0)
        OR
        (m.recipient_type = 'group' AND m.created_at > cgm.last_read_at)
    )
    AND NOT EXISTS (
        SELECT 1 FROM message_alerts ma 
        WHERE ma.message_id = m.id AND ma.user_id = u.id
    )
ORDER BY u.id, m.created_at ASC
";

try {
	$stmt = $pdo->prepare($sql);
	$stmt->execute();
	$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

	if (empty($rows)) {
		if (php_sapi_name() === 'cli') echo "No unread messages to alert.\n";
		else jsonResponse(['status' => 'No alerts needed']);
		exit;
	}

	// Group by Recipient
	$alertsByUser = [];
	foreach ($rows as $row) {
		$uid = $row['recipient_user_id'];
		if (!isset($alertsByUser[$uid])) {
			$alertsByUser[$uid] = [
				'email' => $row['recipient_email'],
				'name' => $row['recipient_name'],
				'messages' => []
			];
		}
		$alertsByUser[$uid]['messages'][] = $row;
	}

	$sentCount = 0;

	// Process each user
	foreach ($alertsByUser as $uid => $userData) {
		$email = $userData['email'];
		$name = $userData['name'];
		$msgs = $userData['messages'];

		if (empty($email)) {
			// Cannot send email, but maybe we should mark as alerted to avoid infinite loop?
			// Or just skip. If we mark as alerted, they never get email even if they add it later.
			// Let's skip.
			continue;
		}

		// Prepare for Japanese Email
		mb_language("Japanese");
		mb_internal_encoding("UTF-8");

		// Construct Email
		$subject = "【Line風】未読メッセージのお知らせ";
		$body = "{$name} さん\n\n";
		$body .= "10分以上未読のメッセージがあります。\n\n";

		// Group by Source (Sender or Group)
		$sources = [];
		foreach ($msgs as $msg) {
			$src = $msg['source_name'];
			if ($msg['recipient_type'] === 'user') {
				$src = $msg['sender_name'];
			}
			if (!isset($sources[$src])) {
				$sources[$src] = 0;
			}
			$sources[$src]++;
		}

		foreach ($sources as $srcName => $count) {
			$body .= "- {$srcName}: {$count}件\n";
		}

		$body .= "\n確認はこちら: " . getBaseUrl() . "\n";

		// Proper Headers for Sakura / Gmail
		$fromEmail = "no-reply@" . $_SERVER['HTTP_HOST'];
		$headers = "From: " . mb_encode_mimeheader("LineFake 通知") . " <{$fromEmail}>\r\n";
		$headers .= "Reply-To: {$fromEmail}\r\n";
		$headers .= "X-Mailer: PHP/" . phpversion();

		// Try to send email with -f option for better delivery
		$mailSent = mb_send_mail($email, $subject, $body, $headers, "-f " . $fromEmail);

		if ($mailSent) {
			// Mark all included messages as alerted for this user
			$insertSql = "INSERT IGNORE INTO message_alerts (message_id, user_id) VALUES ";
			$params = [];
			$placeholders = [];

			foreach ($msgs as $msg) {
				$placeholders[] = "(?, ?)";
				$params[] = $msg['message_id'];
				$params[] = $uid;
			}

			if (!empty($params)) {
				$insertStmt = $pdo->prepare($insertSql . implode(',', $placeholders));
				$insertStmt->execute($params);
			}
			$sentCount++;
		}
	}

	if (php_sapi_name() === 'cli') {
		echo "Valid alerts sent to {$sentCount} users.\n";
	} else {
		jsonResponse(['success' => true, 'sent_count' => $sentCount]);
	}
} catch (Exception $e) {
	if (php_sapi_name() === 'cli') {
		echo "Error: " . $e->getMessage() . "\n";
	} else {
		jsonResponse(['error' => $e->getMessage()], 500);
	}
}
