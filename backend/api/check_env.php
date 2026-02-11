<?php
// Quick check for required extensions
header('Content-Type: application/json');
echo json_encode([
    'php_version' => PHP_VERSION,
    'gmp' => extension_loaded('gmp'),
    'openssl' => extension_loaded('openssl'),
    'curl' => extension_loaded('curl'),
    'mbstring' => extension_loaded('mbstring'),
    'autoload_exists' => file_exists(__DIR__ . '/../vendor/autoload.php'),
]);
