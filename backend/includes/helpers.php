<?php
/**
 * 通用工具：JSON 响应 / Token / 鉴权 / 设置 / 号生成 / 加价计算 / 操作日志
 */

if (!defined('XX_TOKEN_SECRET')) {
    define('XX_TOKEN_SECRET', getenv('APP_SECRET') ?: 'change-me-in-production');
}

// ---------- 响应 ----------

function jsonResponse($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function jsonOk($data = null): void
{
    if ($data === null) {
        jsonResponse(['success' => true]);
    }
    if (is_array($data) && !isset($data['success'])) {
        $data = array_merge(['success' => true], $data);
    }
    jsonResponse($data);
}

function jsonError(string $msg, int $code = 400): void
{
    jsonResponse(['success' => false, 'message' => $msg], $code);
}

// ---------- Token (HMAC-signed JSON) ----------

function b64url_encode(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function b64url_decode(string $s): string
{
    $pad = strlen($s) % 4;
    if ($pad) $s .= str_repeat('=', 4 - $pad);
    return base64_decode(strtr($s, '-_', '+/'));
}

function makeToken(array $payload, int $ttlSeconds = 86400 * 30): string
{
    $payload['exp'] = time() + $ttlSeconds;
    $body = b64url_encode(json_encode($payload, JSON_UNESCAPED_UNICODE));
    $sig = b64url_encode(hash_hmac('sha256', $body, XX_TOKEN_SECRET, true));
    return $body . '.' . $sig;
}

function verifyTokenString(string $token): ?array
{
    if (!$token || !str_contains($token, '.')) return null;
    [$body, $sig] = explode('.', $token, 2);
    $expected = b64url_encode(hash_hmac('sha256', $body, XX_TOKEN_SECRET, true));
    if (!hash_equals($expected, $sig)) return null;
    $payload = json_decode(b64url_decode($body), true);
    if (!is_array($payload)) return null;
    if (!empty($payload['exp']) && $payload['exp'] < time()) return null;
    return $payload;
}

function getBearerToken(): ?string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['Authorization'] ?? '';
    if (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $h = $h ?: ($headers['Authorization'] ?? $headers['authorization'] ?? '');
    }
    if (!$h) return null;
    if (stripos($h, 'Bearer ') === 0) return substr($h, 7);
    return null;
}

function requireAuth(PDO $pdo): array
{
    $tok = getBearerToken();
    $payload = $tok ? verifyTokenString($tok) : null;
    if (!$payload || empty($payload['uid'])) {
        jsonError('未登录或令牌已过期', 401);
    }
    $st = $pdo->prepare("SELECT * FROM users WHERE id = ? AND is_active = 1");
    $st->execute([$payload['uid']]);
    $user = $st->fetch();
    if (!$user) jsonError('用户不存在或已禁用', 401);
    return $user;
}

/** 供应商门户鉴权：token payload role=vendor，uid=supplier_id */
function requireVendorAuth(PDO $pdo): array
{
    $tok = getBearerToken();
    $payload = $tok ? verifyTokenString($tok) : null;
    if (!$payload || ($payload['role'] ?? '') !== 'vendor' || empty($payload['uid'])) {
        jsonError('未登录或令牌已过期', 401);
    }
    $st = $pdo->prepare("SELECT * FROM suppliers WHERE id = ? AND is_active = 1 AND portal_enabled = 1");
    $st->execute([(int) $payload['uid']]);
    $s = $st->fetch();
    if (!$s) jsonError('账号不存在或已停用', 401);
    return $s;
}

function requireRole(PDO $pdo, array $roles): array
{
    $user = requireAuth($pdo);
    if (!in_array($user['role'], $roles, true)) {
        jsonError('无权限', 403);
    }
    return $user;
}

// ---------- 设置 ----------

function getSetting(PDO $pdo, string $key, string $default = ''): string
{
    $st = $pdo->prepare("SELECT value FROM system_settings WHERE key = ?");
    $st->execute([$key]);
    $v = $st->fetchColumn();
    return ($v !== false && $v !== null && $v !== '') ? (string) $v : $default;
}

function getSettingBool(PDO $pdo, string $key, bool $default = false): bool
{
    $v = strtolower(trim(getSetting($pdo, $key, $default ? 'true' : 'false')));
    return in_array($v, ['1', 'true', 'yes', 'on'], true);
}

function setSetting(PDO $pdo, string $key, string $value, string $description = ''): void
{
    $st = $pdo->prepare("INSERT INTO system_settings (key, value, description, updated_at)
        VALUES (?, ?, ?, datetime('now','localtime'))
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now','localtime')");
    $st->execute([$key, $value, $description]);
}

// ---------- 号生成 ----------

function nextNo(PDO $pdo, string $table, string $prefix): string
{
    $today = date('Ymd');
    $like = $prefix . $today . '%';
    $st = $pdo->prepare("SELECT MAX(no) FROM {$table} WHERE no LIKE ?");
    $st->execute([$like]);
    $last = $st->fetchColumn();
    $seq = $last ? ((int) substr($last, -3) + 1) : 1;
    return $prefix . $today . str_pad((string) $seq, 3, '0', STR_PAD_LEFT);
}

function nextInquiryNo(PDO $pdo): string { return nextNo($pdo, 'inquiries', 'XQ'); }
function nextSupplierQuoteNo(PDO $pdo): string { return nextNo($pdo, 'supplier_quotes', 'GB'); }
function nextCustomerQuoteNo(PDO $pdo): string { return nextNo($pdo, 'customer_quotes', 'BJ'); }

/** 供应商编号：1001 起递增（四位），跳过任何含数字 4 的编号（忌讳） */
function nextSupplierCode(PDO $pdo): string
{
    $max = (int) ($pdo->query("SELECT MAX(CAST(code AS INTEGER)) FROM suppliers WHERE code != ''")->fetchColumn() ?: 1000);
    $next = $max + 1;
    while (strpos((string) $next, '4') !== false) {
        $next++;
    }
    return (string) $next;
}

/** 客户编号：10001 起递增，跳过任何含数字 4 的编号（忌讳） */
function nextCustomerCode(PDO $pdo): string
{
    $max = (int) ($pdo->query("SELECT MAX(CAST(code AS INTEGER)) FROM customers WHERE code != ''")->fetchColumn() ?: 10000);
    $next = $max + 1;
    while (strpos((string) $next, '4') !== false) {
        $next++;
    }
    return (string) $next;
}

// ---------- 加价计算 ----------

/**
 * @param array $lines  每行：['inquiry_item_id','cost_price','qty','sell_price_override'?,'category'?]
 *                      会被就地加上 'sell_price' / 'markup_amount'
 * @param array $strategy ['type','value'?,'payload'?]
 * @return float 总价
 */
function applyMarkup(array &$lines, array $strategy): float
{
    $type = $strategy['type'] ?? 'flat_pct';
    $value = isset($strategy['value']) ? (float) $strategy['value'] : 0.0;
    $payload = $strategy['payload'] ?? [];

    $total = 0.0;
    foreach ($lines as &$ln) {
        $cost = (float) ($ln['cost_price'] ?? 0);
        $qty = (float) ($ln['qty'] ?? 1);

        if (isset($ln['sell_price_override']) && $ln['sell_price_override'] !== null && $ln['sell_price_override'] !== '') {
            $sell = (float) $ln['sell_price_override'];
        } elseif ($type === 'flat_pct') {
            $sell = $cost * (1 + $value / 100);
        } elseif ($type === 'per_item_pct') {
            $pct = (float) ($payload[(string) ($ln['inquiry_item_id'] ?? '')] ?? 0);
            $sell = $cost * (1 + $pct / 100);
        } elseif ($type === 'per_item_fixed') {
            $add = (float) ($payload[(string) ($ln['inquiry_item_id'] ?? '')] ?? 0);
            $sell = $cost + $add;
        } elseif ($type === 'category_pct') {
            $pct = (float) ($payload[$ln['category'] ?? ''] ?? 0);
            $sell = $cost * (1 + $pct / 100);
        } elseif ($type === 'stepped') {
            $pct = 0.0;
            foreach (($payload['ladders'] ?? []) as $lvl) {
                if (!isset($lvl['lt']) || $cost < (float) $lvl['lt']) {
                    $pct = (float) ($lvl['pct'] ?? 0);
                    break;
                }
            }
            $sell = $cost * (1 + $pct / 100);
        } else {
            $sell = $cost;
        }

        $sell = round($sell, 2);
        $ln['sell_price'] = $sell;
        $ln['markup_amount'] = round($sell - $cost, 2);
        $total += $sell * $qty;
    }
    unset($ln);
    return round($total, 2);
}

// ---------- 操作日志 ----------

function opLog(PDO $pdo, string $entity, ?int $entityId, string $action, string $detail = '', ?int $userId = null, string $actorLabel = ''): void
{
    $st = $pdo->prepare("INSERT INTO op_logs (user_id, actor_label, entity, entity_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)");
    $st->execute([$userId, $actorLabel, $entity, $entityId, $action, $detail]);
}

// ---------- 分页 ----------

function pageInt($v, int $def, int $min = 1, int $max = 1000): int
{
    $n = (int) $v;
    if ($n < $min) return $def;
    if ($n > $max) return $max;
    return $n;
}

function paginate(PDO $pdo, string $sql, array $params, int $page, int $pageSize, ?string $countSql = null): array
{
    if (!$countSql) {
        // 简单去除 ORDER BY 前的部分作为 count 语句
        $countSql = preg_replace('/SELECT .*? FROM/is', 'SELECT COUNT(*) FROM', $sql, 1);
        $countSql = preg_replace('/ORDER BY .*$/is', '', $countSql);
        $countSql = preg_replace('/LIMIT .*$/is', '', $countSql);
    }
    $st = $pdo->prepare($countSql);
    $st->execute($params);
    $total = (int) $st->fetchColumn();

    $offset = ($page - 1) * $pageSize;
    $st = $pdo->prepare($sql . " LIMIT {$pageSize} OFFSET {$offset}");
    $st->execute($params);
    $items = $st->fetchAll();
    return ['items' => $items, 'total' => $total, 'page' => $page, 'page_size' => $pageSize];
}

// ---------- Token (供应商无账号填报用) ----------

function genShareToken(int $bytes = 24): string
{
    return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
}

/* ===== 登录限流（20260824 重写，后台与供应商门户共用） =====
 *
 * 老版本：15 分钟内 `username = ? OR ip = ?` 失败满 5 次就锁。
 * 两个真实伤害：
 *  1. OR ip —— 印尼手机网络大量走运营商级 NAT，一堆供应商共用同一个出口 IP。
 *     A 家打错 5 次密码，同一个基站下的 B、C、D 全被锁 15 分钟，而且他们
 *     连自己被谁连累了都不知道。同理，办公室里几个人一起登也会互锁。
 *  2. 报错只说「请 15 分钟后再试」，不说还剩几分钟，用户只能反复试，
 *     而每次试都是白试（被拦下时不写新记录，所以不会延长，但他不知道）。
 *
 * 现在：账号维度 5 次锁（这才是真正要防的），IP 维度放到 30 次
 * （单机暴力破解照样拦得住，但拦不到共用出口的正常用户），并告知剩余分钟数。
 */
const LOGIN_LOCK_MINUTES = 15;
const LOGIN_FAIL_LIMIT_USER = 5;
const LOGIN_FAIL_LIMIT_IP = 30;

function loginClientIp(): string
{
    $ip = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '');
    return trim(explode(',', $ip)[0]);
}

/** 还要锁几分钟：取第 $limit 新的那条失败记录，它过期锁就解开 */
function _loginLockRemainMinutes(PDO $pdo, string $field, string $value, int $limit): int
{
    $st = $pdo->prepare("SELECT created_at FROM login_attempts
        WHERE {$field} = ? AND created_at > datetime('now','localtime','-" . LOGIN_LOCK_MINUTES . " minutes')
        ORDER BY created_at DESC LIMIT 1 OFFSET ?");
    $st->execute([$value, $limit - 1]);
    $at = $st->fetchColumn();
    if (!$at) return LOGIN_LOCK_MINUTES;
    $left = (int) ceil((strtotime((string) $at) + LOGIN_LOCK_MINUTES * 60 - time()) / 60);
    return max(1, min(LOGIN_LOCK_MINUTES, $left));
}

/** 登录前调用：被锁就直接 429 返回，带上还剩几分钟 */
function loginRateGuard(PDO $pdo, string $username, string $ip): void
{
    $pdo->exec("DELETE FROM login_attempts WHERE created_at < datetime('now','localtime','-1 day')");

    $st = $pdo->prepare("SELECT COUNT(*) FROM login_attempts
        WHERE username = ? AND created_at > datetime('now','localtime','-" . LOGIN_LOCK_MINUTES . " minutes')");
    $st->execute([$username]);
    if ((int) $st->fetchColumn() >= LOGIN_FAIL_LIMIT_USER) {
        $m = _loginLockRemainMinutes($pdo, 'username', $username, LOGIN_FAIL_LIMIT_USER);
        jsonError("这个账号连续输错太多次，还需等 {$m} 分钟。想立刻用，请联系星选建材帮你重置密码。", 429);
    }

    if ($ip !== '') {
        $st = $pdo->prepare("SELECT COUNT(*) FROM login_attempts
            WHERE ip = ? AND created_at > datetime('now','localtime','-" . LOGIN_LOCK_MINUTES . " minutes')");
        $st->execute([$ip]);
        if ((int) $st->fetchColumn() >= LOGIN_FAIL_LIMIT_IP) {
            $m = _loginLockRemainMinutes($pdo, 'ip', $ip, LOGIN_FAIL_LIMIT_IP);
            jsonError("当前网络失败次数过多，请等 {$m} 分钟，或换个网络（比如切到手机流量）再试。", 429);
        }
    }
}

/** 密码错了：记一笔，并告诉他还剩几次机会 —— 别让人闷头试到被锁 */
function loginRateFail(PDO $pdo, string $username, string $ip): string
{
    $pdo->prepare("INSERT INTO login_attempts (username, ip) VALUES (?, ?)")->execute([$username, $ip]);
    $st = $pdo->prepare("SELECT COUNT(*) FROM login_attempts
        WHERE username = ? AND created_at > datetime('now','localtime','-" . LOGIN_LOCK_MINUTES . " minutes')");
    $st->execute([$username]);
    $left = LOGIN_FAIL_LIMIT_USER - (int) $st->fetchColumn();
    return $left > 0 && $left <= 2 ? "用户名或密码错误（再错 {$left} 次会锁定 " . LOGIN_LOCK_MINUTES . " 分钟）" : '用户名或密码错误';
}

/** 登录成功：把这个账号和这个 IP 的失败记录都清掉 */
function loginRateClear(PDO $pdo, string $username, string $ip): void
{
    $pdo->prepare("DELETE FROM login_attempts WHERE username = ?")->execute([$username]);
    if ($ip !== '') {
        $pdo->prepare("DELETE FROM login_attempts WHERE ip = ?")->execute([$ip]);
    }
}

/* ===== 行级数据隔离（20260825）=====
 *
 * 老板招了销售之后，「能不能进客户管理」这种模块级权限不够用了 ——
 * 进去就是全部客户，等于把整个客户库摊开给每个人看。
 * 销售只能看自己名下的客户，以及这些客户的商机 / 报价 / 订单 / 看板数字。
 *
 * 归属的唯一依据是 customers.owner_id（商机的 owner_id 是公海/私海那套，另一回事）。
 * 管理员、财务、运营、法务不受限：他们本来就要看全局。
 */
function isSalesScoped(array $user): bool
{
    return ($user['role'] ?? '') === 'sales';
}

/**
 * 拼「只看自己客户」的 SQL 片段
 * @param string $customerIdExpr 当前查询里代表 customer_id 的表达式，如 'c.id' 或 'o.customer_id'
 * @return string 形如 " AND o.customer_id IN (SELECT id FROM customers WHERE owner_id = 12)"，不受限时返回 ''
 */
function salesScopeSql(array $user, string $customerIdExpr): string
{
    if (!isSalesScoped($user)) return '';
    $uid = (int) ($user['id'] ?? 0);
    return " AND {$customerIdExpr} IN (SELECT id FROM customers WHERE owner_id = {$uid})";
}

/** 直接判断某个客户是不是当前用户能看的 */
function canAccessCustomer(PDO $pdo, array $user, int $customerId): bool
{
    if (!isSalesScoped($user)) return true;
    $st = $pdo->prepare("SELECT owner_id FROM customers WHERE id = ?");
    $st->execute([$customerId]);
    return (int) $st->fetchColumn() === (int) ($user['id'] ?? 0);
}
