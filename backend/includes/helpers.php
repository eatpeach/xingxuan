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
    return $v !== false ? (string) $v : $default;
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
