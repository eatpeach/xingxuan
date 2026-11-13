<?php
/**
 * 测试辅助：在 XX_DB_PATH 指定的临时库上调用一个接口函数，输出它的 JSON。
 * 用法（只能命令行）：XX_DB_PATH=/tmp/x.db php backend/tests/_call.php <函数名> '<json>' <user_id>
 */
if (PHP_SAPI !== 'cli') exit;
if (!getenv('XX_DB_PATH')) { fwrite(STDERR, "必须设置 XX_DB_PATH，测试不能碰正式库\n"); exit(2); }
require __DIR__ . '/../config/database.php';
require __DIR__ . '/../includes/helpers.php';
foreach (glob(__DIR__ . '/../includes/*.php') as $f) require_once $f;
foreach (glob(__DIR__ . '/../api/handlers/*.php') as $f) require_once $f;
$db = Database::getInstance();
$db->initialize();
$pdo = $db->getConnection();
$fn = $argv[1];
$input = json_decode($argv[2] ?? '{}', true) ?: [];
$st = $pdo->prepare("SELECT * FROM users WHERE id = ?");
$st->execute([(int) ($argv[3] ?? 1)]);
$user = $st->fetch() ?: [];
$r = new ReflectionFunction($fn);
$n = $r->getNumberOfParameters();
if ($n === 3) $fn($pdo, $input, $user);
elseif ($n === 2) { $r->getParameters()[1]->getName() === 'user' ? $fn($pdo, $user) : $fn($pdo, $input); }
else $fn($pdo);
