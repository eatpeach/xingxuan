<?php
/**
 * 只读排查：company_name / bank_* 等设置项从 2026-05-08 至今改过没有（20260809-07 第 1 步）
 *
 * 为什么要查：那 21 张历史发票的 invoice_entity_* 全空，打印页回落到**当前** system_settings。
 * 若这些设置项从没改过，当前值 = 开票当时的值，回填精确无损；
 * 改过，就得按时间线分段，回填口径要 CTO 重定。
 *
 * 本脚本**只读**，没有 --apply，不会写任何一张表（PRAGMA query_only=ON）。
 *
 * 证据有两条独立来源，互相印证：
 *   A. op_logs 里 entity='setting' 的记录 —— handle_updateSetting 从 80179c5（2026-05-08，
 *      PHP 迁移那一版）起就带 opLog，detail 形如 "key=新值"，覆盖了整个窗口
 *   B. system_settings.updated_at —— setSetting() 每次写都刷新它；从没被改过的项，
 *      updated_at 会停在建库 seed 的那一刻
 *
 * 用法（服务器上）：
 *   cd /www/wwwroot/www.xingxuan.cc && php scripts/data-fixes/audit_settings_change_history.php
 */

$dbPath = __DIR__ . '/../../backend/data/xingxuan.db';
if (!file_exists($dbPath)) {
    fwrite(STDERR, "找不到数据库：{$dbPath}\n");
    exit(1);
}

$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->exec('PRAGMA query_only=ON');

function h(string $t): void { echo "\n=== {$t} ===\n"; }
function one(PDO $p, string $sql): string { return (string) $p->query($sql)->fetchColumn(); }

/** 发票打印页会回落到这些设置项（InvoicePrint.tsx 的回落链） */
const WATCH_KEYS = [
    'company_name', 'company_address', 'company_phone', 'pdf_logo_path',
    'bank_name', 'bank_account_no', 'bank_account_name', 'bank_swift',
];

echo "设置项变更历史 · 只读排查（20260809-07 第 1 步）\n";
echo "库：{$dbPath}\n";
echo "时间：" . date('Y-m-d H:i:s') . "\n";

// ---------------------------------------------------------------- 1. 日志本身可不可信
h('1. op_logs 覆盖面（先证明日志是活的，否则「查不到」没有意义）');

$total = one($pdo, "SELECT COUNT(*) FROM op_logs");
$first = one($pdo, "SELECT MIN(created_at) FROM op_logs");
$last  = one($pdo, "SELECT MAX(created_at) FROM op_logs");
printf("op_logs 总条数：%s\n", $total);
printf("时间跨度      ：%s ~ %s\n", $first ?: '(空)', $last ?: '(空)');

echo "\n按 entity 分组：\n";
foreach ($pdo->query("SELECT entity, COUNT(*) AS n, MIN(created_at) AS f, MAX(created_at) AS l
                        FROM op_logs GROUP BY entity ORDER BY n DESC")->fetchAll() as $r) {
    printf("  %-18s %5d 条   %s ~ %s\n", $r['entity'], $r['n'], $r['f'], $r['l']);
}

echo "\n判读：若 setting 那一行有记录，说明日志确实在记设置变更；\n";
echo "      若 setting 为 0 但其它 entity 有大量记录，说明日志在工作、只是没人改过设置。\n";

// ---------------------------------------------------------------- 2. 设置类日志全量
h('2. entity = \'setting\' 的全部记录');

$st = $pdo->prepare("SELECT l.created_at, l.action, l.detail, l.user_id, u.username, u.name AS uname
                       FROM op_logs l
                       LEFT JOIN users u ON u.id = l.user_id
                      WHERE l.entity = 'setting'
                      ORDER BY l.created_at ASC");
$st->execute();
$settingLogs = $st->fetchAll();

if (!$settingLogs) {
    echo "（一条都没有）\n";
} else {
    printf("共 %d 条：\n", count($settingLogs));
    foreach ($settingLogs as $r) {
        $who = $r['uname'] ?: $r['username'] ?: ('user#' . $r['user_id']);
        // detail 形如 "key=value"，value 可能很长，截断展示
        $d = (string) $r['detail'];
        if (mb_strlen($d) > 90) $d = mb_substr($d, 0, 90) . '…';
        printf("  %s  %-12s  %-10s  %s\n", $r['created_at'], $r['action'], $who, $d);
    }
}

// ---------------------------------------------------------------- 3. 只看发票会用到的那几项
h('3. 只看发票回落用到的设置项（这几项变了，历史发票就会跟着变样）');

$hitAny = false;
foreach (WATCH_KEYS as $k) {
    $hits = [];
    foreach ($settingLogs as $r) {
        // detail 是 "key=value"，用 "key=" 前缀精确匹配，避免 bank_name 匹到 bank_name_xxx
        if (strpos((string) $r['detail'], $k . '=') === 0) $hits[] = $r;
    }
    if (!$hits) {
        printf("  %-20s 无变更记录\n", $k);
        continue;
    }
    $hitAny = true;
    printf("  %-20s 🔴 %d 次变更：\n", $k, count($hits));
    foreach ($hits as $r) {
        $v = substr((string) $r['detail'], strlen($k) + 1);
        if (mb_strlen($v) > 70) $v = mb_substr($v, 0, 70) . '…';
        printf("      %s  改成 → %s\n", $r['created_at'], $v === '' ? '(空)' : $v);
    }
}
echo $hitAny
    ? "\n🔴 有变更 → 当前值 ≠ 部分发票开票当时的值，回填口径必须由 CTO 重定。\n"
    : "\n✅ 这几项在 op_logs 里没有任何变更记录。\n";

// ---------------------------------------------------------------- 4. 第二条独立证据
h('4. system_settings.updated_at（独立于 op_logs 的第二条证据）');

$in = implode(',', array_fill(0, count(WATCH_KEYS), '?'));
$st = $pdo->prepare("SELECT key, value, updated_at FROM system_settings WHERE key IN ({$in}) ORDER BY key");
$st->execute(array_values(WATCH_KEYS));
$rows = $st->fetchAll();

printf("%-22s %-22s %s\n", 'key', 'updated_at', '当前值');
foreach ($rows as $r) {
    $v = (string) $r['value'];
    if (mb_strlen($v) > 40) $v = mb_substr($v, 0, 40) . '…';
    printf("%-22s %-22s %s\n", $r['key'], $r['updated_at'] ?: '(空)', $v === '' ? '(空)' : $v);
}
$found = array_column($rows, 'key');
foreach (array_diff(WATCH_KEYS, $found) as $miss) {
    printf("%-22s %-22s %s\n", $miss, '(库里没这一行)', '—');
}

echo "\n判读：seed 建库时这几项是 INSERT OR IGNORE，updated_at 停在建库那一刻；\n";
echo "      setSetting() 每次改都会把 updated_at 刷成改动时间。\n";
echo "      所以 updated_at 明显晚于建库时间 = 被改过（即使 op_logs 缺记录）。\n";

// ---------------------------------------------------------------- 5. 和发票时间线对照
h('5. 与 21 张历史发票的时间线对照');

$invMin = one($pdo, "SELECT MIN(invoice_issued_at) FROM customer_quotes WHERE IFNULL(invoice_no,'') <> ''");
$invMax = one($pdo, "SELECT MAX(invoice_issued_at) FROM customer_quotes WHERE IFNULL(invoice_no,'') <> ''");
$invCnt = one($pdo, "SELECT COUNT(*) FROM customer_quotes WHERE IFNULL(invoice_no,'') <> ''");
printf("已开发票 %s 张，开票时间 %s ~ %s\n", $invCnt, $invMin ?: '-', $invMax ?: '-');

$dbBirth = one($pdo, "SELECT MIN(created_at) FROM users");
printf("建库参考时间（最早的 users.created_at）：%s\n", $dbBirth ?: '(取不到)');

if ($settingLogs) {
    $lastSet = end($settingLogs)['created_at'];
    printf("最后一次设置变更：%s\n", $lastSet);
    printf("→ 若它晚于最早开票时间 %s，说明至少有一部分发票的「当时值」和现在不一样。\n", $invMin ?: '-');
}

// ---------------------------------------------------------------- 6. 这套排查查不到什么
h('6. 本次排查的盲区（必须一起报给 CTO）');

echo "  1. 直接用 sqlite3 / 宝塔数据库管理器改库 —— 绕过 setSetting()，\n";
echo "     op_logs 不会有记录，updated_at 也不会变。这条无法从库内自证。\n";
echo "  2. 2026-05-08 之前是 Python/FastAPI 版本，那一段没有 PHP 的 op_logs。\n";
echo "     不过第 5 节能看出最早开票时间是否落在窗口内。\n";
echo "  3. 「录入历史订单」补录出来的发票，invoice_issued_at 是**回填的旧日期**，\n";
echo "     不是真实开票时刻，拿它对时间线会误判。\n";

echo "\n排查完成（未做任何写操作）。\n";
