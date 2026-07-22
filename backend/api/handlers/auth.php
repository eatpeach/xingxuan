<?php

function handle_login(PDO $pdo, array $input): void
{
    $username = trim((string) ($input['username'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    if (!$username || !$password) jsonError('用户名和密码不能为空');

    // 防暴力破解：15 分钟内同用户名或同 IP 失败满 5 次则临时锁定
    $ip = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '');
    $ip = trim(explode(',', $ip)[0]);
    $pdo->exec("DELETE FROM login_attempts WHERE created_at < datetime('now','localtime','-1 day')");
    $st = $pdo->prepare("SELECT COUNT(*) FROM login_attempts
        WHERE (username = ? OR ip = ?) AND created_at > datetime('now','localtime','-15 minutes')");
    $st->execute([$username, $ip]);
    if ((int) $st->fetchColumn() >= 5) {
        jsonError('失败次数过多，已临时锁定，请 15 分钟后再试', 429);
    }

    $st = $pdo->prepare("SELECT * FROM users WHERE username = ? AND is_active = 1");
    $st->execute([$username]);
    $u = $st->fetch();
    if (!$u || !password_verify($password, $u['password_hash'])) {
        $pdo->prepare("INSERT INTO login_attempts (username, ip) VALUES (?, ?)")->execute([$username, $ip]);
        jsonError('用户名或密码错误', 401);
    }
    $pdo->prepare("DELETE FROM login_attempts WHERE username = ?")->execute([$username]);
    $token = makeToken(['uid' => (int) $u['id'], 'role' => $u['role']]);
    jsonOk([
        'access_token' => $token,
        'token_type' => 'bearer',
        'name' => $u['name'] ?: $u['username'],
        'role' => $u['role'],
        'user_id' => (int) $u['id'],
    ]);
}

function handle_me(PDO $pdo, array $user): void
{
    unset($user['password_hash']);
    jsonOk(['user' => $user]);
}

function handle_changePassword(PDO $pdo, array $input, array $user): void
{
    $oldPwd = (string) ($input['old_password'] ?? '');
    $newPwd = (string) ($input['new_password'] ?? '');
    if (!$oldPwd || !$newPwd) jsonError('请输入当前密码和新密码');
    if (strlen($newPwd) < 6) jsonError('新密码至少 6 位');
    if (!password_verify($oldPwd, $user['password_hash'])) {
        jsonError('当前密码不正确', 401);
    }
    $hash = password_hash($newPwd, PASSWORD_BCRYPT);
    $st = $pdo->prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now','localtime') WHERE id = ?");
    $st->execute([$hash, (int) $user['id']]);
    opLog($pdo, 'user', (int) $user['id'], 'change_password', '', (int) $user['id']);
    jsonOk();
}

function handle_updateProfile(PDO $pdo, array $input, array $user): void
{
    $name = trim((string) ($input['name'] ?? ''));
    $phone = trim((string) ($input['phone'] ?? ''));
    if ($name === '') jsonError('姓名不能为空');
    $st = $pdo->prepare("UPDATE users SET name = ?, phone = ?, updated_at = datetime('now','localtime') WHERE id = ?");
    $st->execute([$name, $phone, (int) $user['id']]);
    opLog($pdo, 'user', (int) $user['id'], 'update_profile', '', (int) $user['id']);
    jsonOk();
}
