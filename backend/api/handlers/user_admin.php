<?php
/**
 * 系统设置 · 账户管理 / 权限管理（仅 admin）
 * 权限矩阵存 system_settings.role_permissions（JSON：{role: [module, ...]}）
 * 未配置的角色默认全部模块可见；admin 恒定全部。
 */

function _requireAdmin(array $user): void
{
    if (($user['role'] ?? '') !== 'admin') jsonError('仅管理员可操作', 403);
}

function handle_listUsers(PDO $pdo, array $user): void
{
    _requireAdmin($user);
    $rows = $pdo->query("SELECT id, username, name, role, phone, is_active, created_at
        FROM users ORDER BY is_active DESC, id ASC")->fetchAll();
    jsonOk(['items' => $rows]);
}

function handle_saveUser(PDO $pdo, array $input, array $user): void
{
    _requireAdmin($user);
    $id = (int) ($input['id'] ?? 0);
    $name = trim((string) ($input['name'] ?? ''));
    $role = trim((string) ($input['role'] ?? 'sales'));
    $phone = trim((string) ($input['phone'] ?? ''));
    if ($role === '') $role = 'sales';

    if ($id) {
        // 不允许把最后一个管理员改成非管理员
        if ($role !== 'admin') {
            $st = $pdo->prepare("SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?");
            $st->execute([$id]);
            $stMe = $pdo->prepare("SELECT role FROM users WHERE id = ?");
            $stMe->execute([$id]);
            $cur = $stMe->fetch();
            if ($cur && $cur['role'] === 'admin' && (int) $st->fetchColumn() === 0) {
                jsonError('至少保留一个启用中的管理员');
            }
        }
        $st = $pdo->prepare("UPDATE users SET name=?, role=?, phone=?, updated_at=datetime('now','localtime') WHERE id=?");
        $st->execute([$name, $role, $phone, $id]);
        jsonOk(['id' => $id]);
    }

    $username = trim((string) ($input['username'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    if ($username === '') jsonError('请输入用户名');
    if (!preg_match('/^[a-zA-Z0-9_\-.]{2,32}$/', $username)) jsonError('用户名仅限字母数字-_.（2~32位）');
    if (mb_strlen($password) < 6) jsonError('初始密码至少 6 位');

    $st = $pdo->prepare("SELECT id FROM users WHERE username = ?");
    $st->execute([$username]);
    if ($st->fetch()) jsonError('用户名已存在');

    $st = $pdo->prepare("INSERT INTO users (username, password_hash, name, role, phone) VALUES (?, ?, ?, ?, ?)");
    $st->execute([$username, password_hash($password, PASSWORD_BCRYPT), $name, $role, $phone]);
    jsonOk(['id' => (int) $pdo->lastInsertId()]);
}

function handle_resetUserPassword(PDO $pdo, array $input, array $user): void
{
    _requireAdmin($user);
    $id = (int) ($input['id'] ?? 0);
    $pwd = (string) ($input['new_password'] ?? '');
    if (!$id) jsonError('参数缺失');
    if (mb_strlen($pwd) < 6) jsonError('新密码至少 6 位');
    $st = $pdo->prepare("UPDATE users SET password_hash=?, updated_at=datetime('now','localtime') WHERE id=?");
    $st->execute([password_hash($pwd, PASSWORD_BCRYPT), $id]);
    // 顺带解锁该用户的登录限流
    $st = $pdo->prepare("DELETE FROM login_attempts WHERE username = (SELECT username FROM users WHERE id = ?)");
    $st->execute([$id]);
    jsonOk();
}

function handle_toggleUserActive(PDO $pdo, array $input, array $user): void
{
    _requireAdmin($user);
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    if ($id === (int) ($user['id'] ?? 0)) jsonError('不能停用自己');
    $pdo->prepare("UPDATE users SET is_active = 1 - is_active, updated_at=datetime('now','localtime') WHERE id=?")
        ->execute([$id]);
    jsonOk();
}

function handle_deleteUser(PDO $pdo, array $input, array $user): void
{
    _requireAdmin($user);
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    if ($id === (int) ($user['id'] ?? 0)) jsonError('不能删除自己');
    $pdo->prepare("DELETE FROM users WHERE id = ?")->execute([$id]);
    jsonOk();
}

// ---------------- 权限矩阵 ----------------

function handle_getRolePermissions(PDO $pdo): void
{
    $st = $pdo->prepare("SELECT value FROM system_settings WHERE key = 'role_permissions'");
    $st->execute();
    $row = $st->fetch();
    $perms = $row ? json_decode((string) $row['value'], true) : null;
    jsonOk(['permissions' => is_array($perms) ? $perms : (object) []]);
}

function handle_saveRolePermissions(PDO $pdo, array $input, array $user): void
{
    _requireAdmin($user);
    $perms = $input['permissions'] ?? null;
    if (!is_array($perms)) jsonError('permissions 格式错误');
    $json = json_encode($perms, JSON_UNESCAPED_UNICODE);
    $pdo->prepare("INSERT INTO system_settings (key, value, description) VALUES ('role_permissions', ?, '角色-模块权限矩阵')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value")->execute([$json]);
    jsonOk();
}
