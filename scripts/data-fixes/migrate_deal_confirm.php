<?php
/**
 * 历史订单的「成交状态」迁移（配合 20261112「确认到账才算成交」）
 *
 * 新规则下，订单要有 deal_confirmed_at 才算成交。上线前开出来的单这一列全是空的，
 * 不处理的话工作台的累计成交、营收会一下子变成 0。这个脚本决定历史单怎么算。
 *
 * 两种方式：
 *   --mode=keep       （默认）保持现状：所有已开单的历史单都记为已成交，
 *                      成交时间 = 原开单时间，每单写一条「系统迁移」日志。工作台数字不变。
 *   --mode=paid_only  只有「有财务确认收款」或「订单已完成」的单记为已成交，
 *                      其余改成「待付款（未成交）」，商机状态同步改回待付款。
 *
 * 执行（服务器项目根目录）：
 *   php scripts/data-fixes/migrate_deal_confirm.php                    # dry-run：只列清单，不写库
 *   php scripts/data-fixes/migrate_deal_confirm.php --mode=paid_only   # dry-run 另一种方式
 *   php scripts/data-fixes/migrate_deal_confirm.php --apply            # 正式执行（默认 keep）
 *   php scripts/data-fixes/migrate_deal_confirm.php --rollback         # 预览撤回
 *   php scripts/data-fixes/migrate_deal_confirm.php --rollback --apply # 撤回：清掉迁移打的成交标记
 *
 * 只处理 deal_confirmed_at 还为空的单，重复执行不会重复打标。
 * 撤回只清「系统迁移」打的标记，不碰跟单手动确认的；日志表只许新增，撤回本身也会记一条。
 */

$args = $argv ?? [];
$apply = in_array('--apply', $args, true);
$rollback = in_array('--rollback', $args, true);
$mode = 'keep';
foreach ($args as $a) {
    if (str_starts_with($a, '--mode=')) $mode = substr($a, 7);
}
if (!in_array($mode, ['keep', 'paid_only'], true)) {
    fwrite(STDERR, "--mode 只能是 keep 或 paid_only\n");
    exit(1);
}

// 以 root 运行时降权到 db 文件属主，避免 WAL 附属文件落成 root 属主（站点会报 readonly database）
$dbFile = dirname(__DIR__, 2) . '/backend/data/xingxuan.db';
if ($apply && is_file($dbFile) && function_exists('posix_geteuid') && posix_geteuid() === 0) {
    $uid = (int) fileowner($dbFile);
    $gid = (int) filegroup($dbFile);
    if ($uid > 0) {
        posix_setgid($gid);
        posix_setuid($uid);
    }
}

require __DIR__ . '/../../backend/config/database.php';
require __DIR__ . '/../../backend/includes/helpers.php';
$db = Database::getInstance();
$pdo = $db->getConnection();

$ocols = array_column($pdo->query("PRAGMA table_info(orders)")->fetchAll(PDO::FETCH_ASSOC), 'name');
$hasCols = in_array('deal_confirmed_at', $ocols, true);
if ($apply) {
    // 正式执行前把表结构补齐（新代码上线后 initialize 也会做，这里保证顺序无关）
    $db->initialize();
    $hasCols = true;
    require __DIR__ . '/../../backend/api/handlers/inquiry.php';
    require __DIR__ . '/../../backend/api/handlers/deal_confirm.php';
}

$fmt = fn ($n, $cur) => ($cur === 'CNY' ? '¥' : 'Rp ') . number_format((float) $n, $cur === 'CNY' ? 2 : 0);

/* ---------------- 撤回 ---------------- */
if ($rollback) {
    if (!$hasCols) { echo "还没有成交字段，无需撤回。\n"; exit(0); }
    $rows = $pdo->query("SELECT o.*, q.inquiry_id FROM orders o LEFT JOIN customer_quotes q ON q.id = o.quote_id
        WHERE o.deal_last_action = 'migrate' AND o.deal_confirmed_at IS NOT NULL ORDER BY o.id")->fetchAll(PDO::FETCH_ASSOC);
    echo ($apply ? "== 执行撤回 ==\n" : "== 撤回预览（加 --apply 才执行）==\n");
    echo "将清掉系统迁移打的成交标记：" . count($rows) . " 单\n";
    foreach ($rows as $r) echo "  {$r['no']}  " . $fmt($r['total_amount'], $r['currency']) . "\n";
    if (!$apply) exit(0);
    $now = date('Y-m-d H:i:s');
    $pdo->beginTransaction();
    foreach ($rows as $r) {
        $pdo->prepare("UPDATE orders SET deal_confirmed_at = NULL, deal_confirmed_by = NULL,
            deal_last_action = 'migrate_rollback', deal_last_action_at = ?, deal_last_action_by = NULL WHERE id = ?")
            ->execute([$now, (int) $r['id']]);
        _dealWriteLog($pdo, $r, 'migrate_rollback', null, '撤回系统迁移', $now);
    }
    $pdo->commit();
    echo "✓ 已撤回 " . count($rows) . " 单\n";
    exit(0);
}

/* ---------------- 迁移 ---------------- */
$confirmedFilter = $hasCols ? 'AND o.deal_confirmed_at IS NULL' : '';
$rows = $pdo->query("
    SELECT o.id, o.no, o.status, o.total_amount, o.currency, o.created_at, o.completed_at,
           q.inquiry_id, i.status AS inquiry_status,
           COALESCE(NULLIF(c.short_name, ''), c.name) AS customer,
           (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id AND p.status = 'confirmed') AS paid
    FROM orders o
    LEFT JOIN customer_quotes q ON q.id = o.quote_id
    LEFT JOIN inquiries i ON i.id = q.inquiry_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.status IN ('in_progress','completed','pending_contract') {$confirmedFilter}
    ORDER BY o.id
")->fetchAll(PDO::FETCH_ASSOC);

$toConfirm = [];
$toPending = [];
foreach ($rows as $r) {
    $paidOrDone = (float) $r['paid'] > 0 || $r['status'] === 'completed';
    if ($mode === 'keep' || $paidOrDone) $toConfirm[] = $r;
    else $toPending[] = $r;
}

$sum = function (array $list) {
    $by = [];
    foreach ($list as $r) {
        $c = $r['currency'] ?: 'IDR';
        $by[$c] = ($by[$c] ?? 0) + (float) $r['total_amount'];
    }
    return $by;
};
$label = ['pending_contract' => '待签合同', 'in_progress' => '进行中', 'completed' => '已完成'];

echo ($apply ? "== 正式执行" : "== dry-run（不写库，加 --apply 才执行）") . " · 方式：{$mode} ==\n";
if (!$hasCols) echo "（新代码还没上线，成交字段尚未创建；以下按「全部未确认」预览）\n";
echo "待处理订单：" . count($rows) . " 单\n\n";

echo "→ 记为【已成交】：" . count($toConfirm) . " 单";
foreach ($sum($toConfirm) as $c => $t) echo "  " . $fmt($t, $c);
echo "\n";
foreach ($toConfirm as $r) {
    printf("  %-14s %-18s %16s  %-6s 已确认收款 %s  开单 %s\n",
        $r['no'], mb_strimwidth((string) $r['customer'], 0, 18, '…'), $fmt($r['total_amount'], $r['currency']),
        $label[$r['status']] ?? $r['status'], $fmt($r['paid'], $r['currency']), substr((string) $r['created_at'], 0, 10));
}
echo "\n→ 改为【待付款（未成交）】：" . count($toPending) . " 单";
foreach ($sum($toPending) as $c => $t) echo "  " . $fmt($t, $c);
echo "\n";
foreach ($toPending as $r) {
    printf("  %-14s %-18s %16s  %-6s 开单 %s\n",
        $r['no'], mb_strimwidth((string) $r['customer'], 0, 18, '…'), $fmt($r['total_amount'], $r['currency']),
        $label[$r['status']] ?? $r['status'], substr((string) $r['created_at'], 0, 10));
}

if (!$apply) {
    echo "\n未做任何修改。确认无误后加 --apply 执行。\n";
    exit(0);
}

$pdo->beginTransaction();
try {
    foreach ($toConfirm as $r) {
        // 成交时间：用原开单时间，历史各月的营收不会挪到今天
        _dealMarkConfirmed($pdo, (int) $r['id'], null, 'migrate', (string) $r['created_at'],
            $mode === 'keep' ? '系统迁移：保持原成交状态' : '系统迁移：已有确认收款或已完成');
    }
    foreach ($toPending as $r) {
        if ($r['inquiry_id'] && $r['inquiry_status'] === 'won') {
            _setInquiryStatus($pdo, (int) $r['inquiry_id'], 'pending_payment', null);
        }
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "执行失败，已回滚，没有任何修改：" . $e->getMessage() . "\n");
    exit(1);
}
echo "\n✓ 完成：已成交 " . count($toConfirm) . " 单，改为待付款 " . count($toPending) . " 单\n";
