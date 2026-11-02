<?php
/**
 * 重置后台账号密码（忘了密码、又没有别的管理员能进后台时用）
 *
 * 规则与后台「用户管理 → 重置密码」（user_admin.php::handle_resetUserPassword）完全一致：
 *   - 现场生成一个好读的临时密码（去掉 0/O、1/l 这类电话里念不清、抄写会错的字符）
 *   - bcrypt 写入 password_hash；明文留在 initial_pwd（管理员后台「他又忘了」时能查到）
 *   - must_change_pwd=1：本人首次登录强制改密
 *   - 清掉该账号的登录限流记录（多半就是输错太多次才来重置的），写一条 op_logs
 * 临时密码只打印到终端，不写任何文件，看完就去登录改掉。
 *
 * 执行（服务器项目根目录）：
 *   php scripts/data-fixes/reset_user_password.php --user=admin           # dry-run：只看账号状态
 *   php scripts/data-fixes/reset_user_password.php --user=admin --apply   # 真正重置
 *
 * root 跑也没事：开库前先切到 db 文件的属主（线上是 www）。否则 root 建出来的
 * -wal / -shm 文件 PHP-FPM 写不了，站点会报 readonly database。
 */

$apply = in_array('--apply', $argv ?? [], true);
$username = '';
foreach ($argv ?? [] as $a) {
    if (str_starts_with($a, '--user=')) $username = trim(substr($a, 7));
}
if ($username === '') {
    fwrite(STDERR, "用法：php scripts/data-fixes/reset_user_password.php --user=<用户名> [--apply]\n");
    exit(1);
}

// 以 root 运行时降权到 db 文件属主，避免 WAL 附属文件落成 root 属主
$dbFile = dirname(__DIR__, 2) . '/backend/data/xingxuan.db';
if (is_file($dbFile) && function_exists('posix_geteuid') && posix_geteuid() === 0) {
    $uid = (int) fileowner($dbFile);
    $gid = (int) filegroup($dbFile);
    if ($uid > 0) {
        posix_setgid($gid);
        posix_setuid($uid);
        echo "已切换到 uid={$uid} gid={$gid}（db 文件属主）运行\n";
    }
}

require __DIR__ . '/../../backend/config/database.php';
$pdo = Database::getInstance()->getConnection();

$st = $pdo->prepare("SELECT id, username, name, role, is_active, must_change_pwd, updated_at FROM users WHERE username = ?");
$st->execute([$username]);
$u = $st->fetch();
if (!$u) {
    $names = $pdo->query("SELECT username FROM users ORDER BY id")->fetchAll(PDO::FETCH_COLUMN);
    fwrite(STDERR, "没有用户名为「{$username}」的账号。现有账号：" . implode(', ', $names) . "\n");
    exit(1);
}

$locks = $pdo->prepare("SELECT COUNT(*) FROM login_attempts WHERE username = ?");
$locks->execute([$username]);
$lockCnt = (int) $locks->fetchColumn();

echo $apply ? "== 执行模式 ==\n" : "== dry-run（加 --apply 才重置）==\n";
echo "账号：{$u['username']}（id={$u['id']}，{$u['name']}，角色 {$u['role']}）\n";
echo "状态：" . ((int) $u['is_active'] === 1 ? '启用' : '⚠ 已停用（重置密码后仍登不进，需先在后台启用）') . "\n";
echo "强制改密标记：{$u['must_change_pwd']}，最近更新：{$u['updated_at']}\n";
echo "登录失败记录：{$lockCnt} 条" . ($lockCnt > 0 ? '（重置时一并清掉）' : '') . "\n";

if (!$apply) {
    echo "\n未做任何修改。确认无误后加 --apply 重置。\n";
    exit(0);
}

// 与 user_admin.php::_userRandomPassword 同款字符表：2 组辅音+元音 + 4 位 2~9 数字
$cons = ['b', 'd', 'f', 'g', 'h', 'j', 'k', 'm', 'n', 'p', 'r', 's', 't', 'w', 'z'];
$vows = ['a', 'e', 'u', 'o'];
$pwd = '';
for ($i = 0; $i < 2; $i++) {
    $pwd .= $cons[random_int(0, count($cons) - 1)] . $vows[random_int(0, count($vows) - 1)];
}
for ($i = 0; $i < 4; $i++) $pwd .= (string) random_int(2, 9);

$pdo->beginTransaction();
try {
    $st = $pdo->prepare("UPDATE users SET password_hash = ?, initial_pwd = ?, must_change_pwd = 1,
        updated_at = datetime('now','localtime') WHERE id = ?");
    $st->execute([password_hash($pwd, PASSWORD_BCRYPT), $pwd, (int) $u['id']]);
    if ($st->rowCount() !== 1) {
        throw new RuntimeException('UPDATE 影响行数不是 1，已回滚');
    }

    $st = $pdo->prepare("DELETE FROM login_attempts WHERE username = ?");
    $st->execute([$username]);

    // 同 helpers.php::opLog，CLI 没有操作人，用 actor_label 标明来源；日志里不记密码
    $st = $pdo->prepare("INSERT INTO op_logs (user_id, actor_label, entity, entity_id, action, detail) VALUES (NULL, ?, 'user', ?, 'reset_password', ?)");
    $st->execute(['cli:reset_user_password', (int) $u['id'], $username]);

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "重置失败：" . $e->getMessage() . "\n");
    exit(1);
}

echo "\n✓ 已重置 {$u['username']}（id={$u['id']}）\n";
echo "  临时密码：{$pwd}\n";
echo "  首次登录会强制改密。此密码只显示这一次，不写任何文件。\n";
