<?php

function handle_login(PDO $pdo, array $input): void
{
    $username = trim((string) ($input['username'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    if (!$username || !$password) jsonError('用户名和密码不能为空');

    $st = $pdo->prepare("SELECT * FROM users WHERE username = ? AND is_active = 1");
    $st->execute([$username]);
    $u = $st->fetch();
    if (!$u || !password_verify($password, $u['password_hash'])) {
        jsonError('用户名或密码错误', 401);
    }
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
