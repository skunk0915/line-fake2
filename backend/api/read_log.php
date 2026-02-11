<?php
header('Content-Type: text/plain');
$logFile = __DIR__ . '/push_log.txt';
if (file_exists($logFile)) {
    echo file_get_contents($logFile);
} else {
    echo "Log file not found.";
}
