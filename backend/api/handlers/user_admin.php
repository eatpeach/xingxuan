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
    // 销售也要读这个表 —— 客户列表要显示「归属销售」是谁。
    // 给他们的是脱敏版：只有 id 和显示名，看不到角色/电话/启用状态，
    // 更不可能看到密码相关字段。
    if (($user['role'] ?? '') !== 'admin') {
        $rows = $pdo->query("SELECT id, name, username FROM users WHERE is_active = 1 ORDER BY id ASC")->fetchAll();
        foreach ($rows as &$r) $r['is_active'] = 1;
        unset($r);
        jsonOk(['items' => $rows]);
    }
    $rows = $pdo->query("SELECT id, username, name, role, phone, is_active, created_at,
            (initial_pwd != '') AS pwd_viewable, must_change_pwd
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
    // 不填就现场生成一个好读的，省得管理员自己想
    if ($pwd === '') $pwd = _userRandomPassword();
    if (mb_strlen($pwd) < 6) jsonError('新密码至少 6 位');

    // 【20260825 补】原来只改 password_hash：
    //   ① 不打强制改密标记 —— 管理员设的密码可能被人看到，本人不改就一直用着
    //   ② 不留 initial_pwd —— 「他又忘了」时管理员查不到，只能反复重置
    // 与批量开号、供应商门户保持同一套规则。
    $st = $pdo->prepare("UPDATE users SET password_hash=?, initial_pwd=?, must_change_pwd=1,
        updated_at=datetime('now','localtime') WHERE id=?");
    $st->execute([password_hash($pwd, PASSWORD_BCRYPT), $pwd, $id]);

    // 顺带解锁该用户的登录限流（多半就是输错太多次才来找重置的）
    $st = $pdo->prepare("DELETE FROM login_attempts WHERE username = (SELECT username FROM users WHERE id = ?)");
    $st->execute([$id]);

    $st = $pdo->prepare("SELECT username, name FROM users WHERE id = ?");
    $st->execute([$id]);
    $u = $st->fetch() ?: [];
    opLog($pdo, 'user', $id, 'reset_password', (string) ($u['username'] ?? ''), (int) $user['id']);
    // 回传明文：管理员要当场告诉本人。日志里不记密码
    jsonOk(['username' => $u['username'] ?? '', 'name' => $u['name'] ?? '', 'password' => $pwd]);
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

/* ===== 批量开销售账号（20260825）=====
 *
 * 老板一次招四个销售，一个个手建太慢，而且初始密码还得自己想。
 * 规则与供应商门户保持一致（他已经习惯那套）：
 *   用户名 = 名字拼音（重名自动加数字）
 *   密码   = 随机好读密码，首次登录强制改
 * 明文只在这一次响应里出现，库里存 bcrypt + initial_pwd（本人改密后清空）。
 */

require_once __DIR__ . '/../../includes/pinyin.php';

function _userRandomPassword(): string
{
    // 与供应商那套同款：去掉 0/O、1/l 这类电话里念不清、抄写会错的字符
    $cons = ['b', 'd', 'f', 'g', 'h', 'j', 'k', 'm', 'n', 'p', 'r', 's', 't', 'w', 'z'];
    $vows = ['a', 'e', 'u', 'o'];
    $s = '';
    for ($i = 0; $i < 2; $i++) {
        $s .= $cons[random_int(0, count($cons) - 1)] . $vows[random_int(0, count($vows) - 1)];
    }
    for ($i = 0; $i < 4; $i++) $s .= (string) random_int(2, 9);
    return $s;
}

/**
 * 入参：names（换行/逗号分隔的姓名）或 items:[{name, username?, role?}]
 * 出参：明文账号清单，老板照着逐个发
 */
function handle_batchCreateUsers(PDO $pdo, array $input, array $user): void
{
    _requireAdmin($user);

    $items = $input['items'] ?? [];
    if (!is_array($items) || empty($items)) {
        $raw = (string) ($input['names'] ?? '');
        $items = [];
        foreach (preg_split('/[\r\n,，、;；]+/u', $raw) as $n) {
            $n = trim($n);
            if ($n !== '') $items[] = ['name' => $n];
        }
    }
    if (empty($items)) jsonError('请填写姓名');
    if (count($items) > 50) jsonError('一次最多 50 个');

    $role = (string) ($input['role'] ?? 'sales');
    if (!in_array($role, ['sales', 'ops', 'finance', 'legal', 'admin'], true)) $role = 'sales';

    // 现有用户名占用表
    $taken = [];
    foreach ($pdo->query("SELECT username FROM users")->fetchAll(PDO::FETCH_COLUMN) as $u) {
        $taken[strtolower((string) $u)] = 1;
    }

    $plan = [];
    foreach ($items as $it) {
        $name = trim((string) ($it['name'] ?? ''));
        if ($name === '') continue;
        $base = trim((string) ($it['username'] ?? ''));
        if ($base === '') {
            // 中文转拼音；本来就是拉丁名的原样用
            $base = preg_replace('/[^a-z0-9]/', '', strtolower(hanziToPinyin($name)));
        } else {
            $base = preg_replace('/[^a-z0-9_.\-]/', '', strtolower($base));
        }
        if ($base === '') $base = 'user';
        if (strlen($base) < 2) $base .= 'x';

        // 重名避让：xiran、xiran2、xiran3 …（老板这批里就有「雨露」和「露雨」，
        // 拼音不同不会撞；但同音同姓的迟早会遇上）
        $try = $base;
        $n = 1;
        while (isset($taken[strtolower($try)])) {
            $n++;
            $try = $base . $n;
        }
        $taken[strtolower($try)] = 1;

        $plan[] = [
            'name' => $name,
            'username' => $try,
            'password' => (string) ($it['password'] ?? '') ?: _userRandomPassword(),
            'role' => (string) ($it['role'] ?? $role),
            'phone' => (string) ($it['phone'] ?? ''),
        ];
    }
    if (empty($plan)) jsonError('没有有效的姓名');

    $ins = $pdo->prepare("INSERT INTO users (username, password_hash, name, role, phone, initial_pwd, must_change_pwd)
        VALUES (?, ?, ?, ?, ?, ?, 1)");
    $out = [];
    $pdo->beginTransaction();
    try {
        foreach ($plan as $p) {
            if (mb_strlen($p['password']) < 6) jsonError('密码至少 6 位');
            $ins->execute([
                $p['username'],
                password_hash($p['password'], PASSWORD_BCRYPT),
                $p['name'],
                $p['role'],
                $p['phone'],
                $p['password'],
            ]);
            $p['id'] = (int) $pdo->lastInsertId();
            $out[] = $p;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        jsonError('创建失败：' . $e->getMessage());
    }

    // 日志只记开了谁的号，绝不记密码
    foreach ($out as $p) {
        opLog($pdo, 'user', $p['id'], 'batch_create', "{$p['username']} ({$p['name']}/{$p['role']})", (int) $user['id']);
    }
    jsonOk(['items' => $out, 'count' => count($out)]);
}

/** 看某个账号的初始密码（本人改过就没有了，只能重置） */
function handle_getUserCredential(PDO $pdo, array $input, array $user): void
{
    _requireAdmin($user);
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT id, username, name, role, initial_pwd, must_change_pwd FROM users WHERE id = ?");
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u) jsonError('用户不存在', 404);
    if (trim((string) $u['initial_pwd']) !== '') {
        opLog($pdo, 'user', $id, 'view_pwd', (string) $u['username'], (int) $user['id']);
    }
    jsonOk([
        'id' => (int) $u['id'],
        'username' => $u['username'],
        'name' => $u['name'],
        'role' => $u['role'],
        'password' => (string) $u['initial_pwd'],
        'self_changed' => trim((string) $u['initial_pwd']) === '' ? 1 : 0,
        'must_change_pwd' => (int) $u['must_change_pwd'],
    ]);
}
