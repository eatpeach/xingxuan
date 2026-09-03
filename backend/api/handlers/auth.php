<?php

function handle_login(PDO $pdo, array $input): void
{
    $username = trim((string) ($input['username'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    if (!$username || !$password) jsonError('用户名和密码不能为空');

    // 防暴力破解：账号维度 5 次锁 15 分钟；IP 维度放宽到 30 次（见 helpers.php 里的说明）
    $ip = loginClientIp();
    loginRateGuard($pdo, $username, $ip);

    $st = $pdo->prepare("SELECT * FROM users WHERE username = ? AND is_active = 1");
    $st->execute([$username]);
    $u = $st->fetch();
    if (!$u || !password_verify($password, $u['password_hash'])) {
        jsonError(loginRateFail($pdo, $username, $ip), 401);
    }
    loginRateClear($pdo, $username, $ip);
    $token = makeToken(['uid' => (int) $u['id'], 'role' => $u['role']]);
    jsonOk([
        'access_token' => $token,
        'token_type' => 'bearer',
        'name' => $u['name'] ?: $u['username'],
        'role' => $u['role'],
        'user_id' => (int) $u['id'],
        'must_change_pwd' => (int) ($u['must_change_pwd'] ?? 0),
    ]);
}

function handle_me(PDO $pdo, array $user): void
{
    // initial_pwd 是系统下发密码的明文，绝不能随 me 接口发到前端
    unset($user['password_hash'], $user['initial_pwd']);
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
    // 首次强制改密要是能填回原密码，这道闸门就白设了
    if ($newPwd === $oldPwd) jsonError('新密码不能和当前密码一样');
    $hash = password_hash($newPwd, PASSWORD_BCRYPT);
    // 清掉系统下发的明文：从这一刻起密码是本人选的，后台不该再留着
    $st = $pdo->prepare("UPDATE users SET password_hash = ?, initial_pwd = '', must_change_pwd = 0,
        updated_at = datetime('now','localtime') WHERE id = ?");
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
