<?php

/**
 * 供应商门户账号批量生成（20260824）
 *
 * 老板的要求：给所有供应商统一开门户账号，命名规则简单好记。
 * 定的规则（他拍的板）：
 *   用户名 = 名字拼音 + 供应商编号   例：神州电缆(1001) → shenzhou1001
 *   密码   = 随机好读密码，首次登录强制改密   例：muka3721
 *
 * 为什么密码不用「固定规则 + 编号」：那样任何知道编号规律的人都能登录别家账号，
 * 看到甚至改掉别家的底价。随机密码 + 首次强制改密，代价只是老板要把清单发出去一次。
 *
 * 【公开仓库纪律】明文密码只在这一次响应里出现，不写库、不写日志、不落任何文件。
 * 库里只存 bcrypt hash。这个界面关掉，明文就没了，只能重置。
 */

require_once __DIR__ . '/../../includes/pinyin.php';

/** 公司名里对区分供应商没帮助的词，生成登录名前先摘掉 */
const _ACC_NOISE = [
    '股份有限公司', '有限责任公司', '有限公司', '集团有限公司', '实业有限公司',
    '贸易有限公司', '建材有限公司', '科技有限公司', '工程有限公司',
    '集团', '公司', '实业', '工贸', '商贸', '贸易', '建材', '材料', '工程', '厂',
    'PT.', 'PT ', 'CV.', 'CV ', 'UD.', 'UD ', 'Tbk',
];

/**
 * 供应商名 → 登录名前缀
 * 中文取前两个字的拼音（神州电缆 → shenzhou），印尼/英文名取第一个词（PT Maju Jaya → maju）
 */
function _accUsernameBase(string $name): string
{
    $n = trim($name);
    foreach (_ACC_NOISE as $w) {
        $n = str_replace($w, '', $n);
    }
    $n = trim($n);
    if ($n === '') $n = trim($name);

    // 中文：取前两个汉字
    if (preg_match_all('/[\x{4e00}-\x{9fa5}]/u', $n, $m) && count($m[0]) > 0) {
        $take = implode('', array_slice($m[0], 0, 2));
        $base = hanziToPinyin($take);
    } else {
        // 拉丁名：第一个词
        $parts = preg_split('/[^A-Za-z]+/', $n, -1, PREG_SPLIT_NO_EMPTY);
        $base = strtolower($parts[0] ?? '');
    }
    $base = preg_replace('/[^a-z]/', '', $base);
    if ($base === '') $base = 'gys';
    if (strlen($base) > 12) $base = substr($base, 0, 12);
    return $base;
}

/**
 * 随机好读密码：辅音+元音拼成两个音节 + 4 位数字，如 muka3721
 * 去掉 0/O、1/l/i 这类电话里念不清、抄写会错的字符
 */
function _accRandomPassword(): string
{
    $cons = ['b', 'd', 'f', 'g', 'h', 'j', 'k', 'm', 'n', 'p', 'r', 's', 't', 'w', 'z'];
    $vows = ['a', 'e', 'u', 'o'];
    $s = '';
    for ($i = 0; $i < 2; $i++) {
        $s .= $cons[random_int(0, count($cons) - 1)] . $vows[random_int(0, count($vows) - 1)];
    }
    for ($i = 0; $i < 4; $i++) {
        $s .= (string) random_int(2, 9);   // 不用 0 和 1
    }
    return $s;
}

/** 取现有用户名占用表（供重名避让） */
function _accTakenUsernames(PDO $pdo, int $exceptId = 0): array
{
    $st = $pdo->prepare("SELECT id, username FROM suppliers WHERE username != '' AND id != ?");
    $st->execute([$exceptId]);
    $t = [];
    foreach ($st->fetchAll() as $r) $t[strtolower((string) $r['username'])] = (int) $r['id'];
    return $t;
}

/**
 * 预览：算出每家的用户名和密码，但【不落库】。
 * 老板可以在界面上逐个改用户名（多音字如「重庆」会转成 zhongqing，得能手改），
 * 确认后再调 generateSupplierAccounts 写入。
 *
 * 入参 scope: 'missing'（默认，只给还没账号的生成）| 'all'（全部重置）
 *      ids: 指定供应商 id 数组（给了就只处理这些）
 */
function handle_previewSupplierAccounts(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可批量生成门户账号', 403);

    $scope = (string) ($input['scope'] ?? 'missing');
    $ids = array_values(array_filter(array_map('intval', (array) ($input['ids'] ?? []))));

    $where = ['is_active = 1'];
    $params = [];
    if ($ids) {
        $where[] = 'id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')';
        $params = $ids;
    } elseif ($scope === 'missing') {
        // 没用户名 或 没密码 的都算「还没账号」
        $where[] = "(username = '' OR username IS NULL OR password_hash = '' OR password_hash IS NULL)";
    }
    $st = $pdo->prepare("SELECT id, code, name, phone, contact, username, password_hash, portal_enabled
        FROM suppliers WHERE " . implode(' AND ', $where) . " ORDER BY CAST(code AS INTEGER) ASC, id ASC");
    $st->execute($params);
    $rows = $st->fetchAll();

    $taken = _accTakenUsernames($pdo);
    $planned = [];   // 本批次内也要互相避让
    $out = [];
    foreach ($rows as $r) {
        $sid = (int) $r['id'];
        $code = trim((string) $r['code']);
        $hasAccount = trim((string) $r['username']) !== '' && trim((string) $r['password_hash']) !== '';

        $base = _accUsernameBase((string) $r['name']);
        $username = $base . ($code !== '' ? $code : (string) $sid);
        // 极端情况：两家名字拼音一样且编号缺失，后面加 a/b/c
        $try = $username;
        $suffix = 'a';
        while ((isset($taken[strtolower($try)]) && $taken[strtolower($try)] !== $sid) || isset($planned[strtolower($try)])) {
            $try = $username . $suffix;
            $suffix++;
        }
        $username = $try;
        $planned[strtolower($username)] = $sid;

        $out[] = [
            'supplier_id' => $sid,
            'code' => $code,
            'name' => $r['name'],
            'contact' => $r['contact'],
            'phone' => $r['phone'],
            'username' => $username,
            'password' => _accRandomPassword(),
            'had_account' => $hasAccount ? 1 : 0,
            'old_username' => (string) $r['username'],
        ];
    }

    jsonOk([
        'items' => $out,
        'scope' => $ids ? 'ids' : $scope,
        'rule' => [
            'username' => '名字拼音 + 供应商编号，如 神州电缆(1001) → shenzhou1001',
            'password' => '随机好读密码（无 0/1/O/l），首次登录强制改密',
        ],
    ]);
}

/**
 * 落库：把（可能被改过的）用户名 / 密码写进去，顺手开门户 + 打上首次改密标记。
 * 返回的还是明文清单——老板要拿去逐家发，这是明文唯一一次出现的地方。
 */
function handle_generateSupplierAccounts(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可批量生成门户账号', 403);

    $items = $input['items'] ?? [];
    if (!is_array($items) || empty($items)) jsonError('没有要生成的账号');

    // 先整体校验，别写了一半才发现重名
    $taken = _accTakenUsernames($pdo);
    $seen = [];
    $clean = [];
    foreach ($items as $it) {
        $sid = (int) ($it['supplier_id'] ?? 0);
        $username = strtolower(trim((string) ($it['username'] ?? '')));
        $password = (string) ($it['password'] ?? '');
        if (!$sid) continue;
        if (!preg_match('/^[a-z0-9_.-]{3,32}$/', $username)) {
            jsonError("用户名「{$username}」不合法：只能用小写字母 / 数字 / . _ -，3~32 位");
        }
        if (strlen($password) < 6) jsonError("「{$username}」的密码至少 6 位");
        if (isset($seen[$username])) jsonError("用户名「{$username}」在本次名单里重复了");
        if (isset($taken[$username]) && $taken[$username] !== $sid) {
            jsonError("用户名「{$username}」已被其他供应商占用");
        }
        $seen[$username] = 1;
        $clean[] = ['supplier_id' => $sid, 'username' => $username, 'password' => $password];
    }
    if (empty($clean)) jsonError('没有有效的账号行');

    // initial_pwd 存的是我们下发的这个密码，供应商自己改过就清空（见 vendorChangePassword）
    $upd = $pdo->prepare("UPDATE suppliers
        SET username = ?, password_hash = ?, initial_pwd = ?, portal_enabled = 1, must_change_pwd = 1,
            updated_at = datetime('now','localtime')
        WHERE id = ?");

    $pdo->beginTransaction();
    try {
        foreach ($clean as $c) {
            $upd->execute([
                $c['username'],
                password_hash($c['password'], PASSWORD_BCRYPT),
                $c['password'],
                $c['supplier_id'],
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        jsonError('生成失败：' . $e->getMessage());
    }

    // 日志只记「给谁开了号」，绝不记密码
    foreach ($clean as $c) {
        opLog($pdo, 'supplier', $c['supplier_id'], 'gen_portal_account', $c['username'], (int) $user['id']);
    }

    // 回带联系人/电话，老板照着这张表逐家发
    $ids = array_column($clean, 'supplier_id');
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT id, code, name, contact, phone FROM suppliers WHERE id IN ({$ph})");
    $st->execute($ids);
    $info = [];
    foreach ($st->fetchAll() as $r) $info[(int) $r['id']] = $r;

    $out = [];
    foreach ($clean as $c) {
        $i = $info[$c['supplier_id']] ?? [];
        $out[] = [
            'supplier_id' => $c['supplier_id'],
            'code' => $i['code'] ?? '',
            'name' => $i['name'] ?? '',
            'contact' => $i['contact'] ?? '',
            'phone' => $i['phone'] ?? '',
            'username' => $c['username'],
            'password' => $c['password'],
        ];
    }
    jsonOk(['items' => $out, 'count' => count($out)]);
}

/**
 * 看某家（或全部）的门户账号密码（20260824）
 *
 * 老板的诉求：供应商忘了密码，他要能当场告诉人家。
 * 能给的只有【系统下发的那个密码】：
 *   - 供应商还没自己改过 → 直接给明文，念给他听就行
 *   - 已经自己改过       → 明文已按设计清空，给不了；界面上引导「重置密码」
 * bcrypt 不可逆，这不是权限问题，是算不出来。
 *
 * 每次查看都记日志（谁、什么时候、看了哪家）——密码明文的查看要留痕。
 */
function handle_getSupplierCredential(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可查看门户密码', 403);

    $sid = (int) ($input['supplier_id'] ?? 0);
    if (!$sid) jsonError('请指定供应商');

    $st = $pdo->prepare("SELECT id, code, name, contact, phone, username, password_hash,
        initial_pwd, portal_enabled, must_change_pwd, last_login_at FROM suppliers WHERE id = ?");
    $st->execute([$sid]);
    $s = $st->fetch();
    if (!$s) jsonError('供应商不存在', 404);

    $hasAccount = trim((string) $s['username']) !== '' && trim((string) $s['password_hash']) !== '';
    $initial = (string) $s['initial_pwd'];
    $selfChanged = $hasAccount && $initial === '';

    if ($initial !== '') {
        opLog($pdo, 'supplier', $sid, 'view_portal_pwd', (string) $s['username'], (int) $user['id']);
    }

    // 是不是正被登录限流锁着——供应商打电话来多半就是为这个
    $locked = 0;
    $failCount = 0;
    if (trim((string) $s['username']) !== '') {
        $stF = $pdo->prepare("SELECT COUNT(*) FROM login_attempts
            WHERE username = ? AND created_at > datetime('now','localtime','-" . LOGIN_LOCK_MINUTES . " minutes')");
        $stF->execute([$s['username']]);
        $failCount = (int) $stF->fetchColumn();
        $locked = $failCount >= LOGIN_FAIL_LIMIT_USER ? 1 : 0;
    }

    jsonOk([
        'supplier_id' => $sid,
        'code' => $s['code'],
        'name' => $s['name'],
        'contact' => $s['contact'],
        'phone' => $s['phone'],
        'username' => $s['username'],
        'has_account' => $hasAccount ? 1 : 0,
        'portal_enabled' => (int) $s['portal_enabled'],
        'password' => $initial,              // 空 = 供应商已自行改密，给不了
        'self_changed' => $selfChanged ? 1 : 0,
        'must_change_pwd' => (int) $s['must_change_pwd'],
        'last_login_at' => $s['last_login_at'],
        'locked' => $locked,
        'fail_count' => $failCount,
    ]);
}

/**
 * 一键重置密码：现场生成一个新的好读密码，立刻返回明文告诉供应商。
 * 供应商已自行改密的情况，唯一正确的帮法就是这个——不是去读他的密码。
 */
function handle_resetSupplierPassword(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可重置门户密码', 403);

    $sid = (int) ($input['supplier_id'] ?? 0);
    if (!$sid) jsonError('请指定供应商');

    $st = $pdo->prepare("SELECT id, code, name, contact, phone, username FROM suppliers WHERE id = ?");
    $st->execute([$sid]);
    $s = $st->fetch();
    if (!$s) jsonError('供应商不存在', 404);
    if (trim((string) $s['username']) === '') {
        jsonError('这家还没有登录用户名，请先用「批量生成门户账号」或在门户账号里开通');
    }

    // 允许指定密码（老板想给个自己顺口的），没给就随机
    $pwd = trim((string) ($input['password'] ?? ''));
    if ($pwd === '') {
        $pwd = _accRandomPassword();
    } elseif (strlen($pwd) < 6) {
        jsonError('密码至少 6 位');
    }

    $pdo->prepare("UPDATE suppliers
        SET password_hash = ?, initial_pwd = ?, must_change_pwd = 1, portal_enabled = 1,
            updated_at = datetime('now','localtime')
        WHERE id = ?")
        ->execute([password_hash($pwd, PASSWORD_BCRYPT), $pwd, $sid]);

    // 供应商多半是「输错几次被锁了」才来找老板，重置密码就顺手把锁解掉，
    // 否则给了新密码他还得干等 15 分钟
    loginRateClear($pdo, (string) $s['username'], '');

    opLog($pdo, 'supplier', $sid, 'reset_portal_pwd', (string) $s['username'], (int) $user['id']);

    jsonOk([
        'supplier_id' => $sid,
        'name' => $s['name'],
        'username' => $s['username'],
        'password' => $pwd,
    ]);
}

/**
 * 解除某家供应商的登录锁定（20260824）
 * 密码没忘、只是输错次数超了的情况——不用重置密码，解锁就能立刻登。
 */
function handle_unlockSupplierLogin(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可解除登录锁定', 403);
    $sid = (int) ($input['supplier_id'] ?? 0);
    if (!$sid) jsonError('请指定供应商');

    $st = $pdo->prepare("SELECT username FROM suppliers WHERE id = ?");
    $st->execute([$sid]);
    $username = (string) $st->fetchColumn();
    if ($username === '') jsonError('这家还没有登录用户名');

    $del = $pdo->prepare("DELETE FROM login_attempts WHERE username = ?");
    $del->execute([$username]);
    opLog($pdo, 'supplier', $sid, 'unlock_login', $username, (int) $user['id']);
    jsonOk(['username' => $username]);
}
