<?php
/**
 * 只读盘点：重新生成对客报价是否已经删过订单/收款/返佣（20260808-05 第 4 步）
 *
 * 本脚本**只读**，没有 --apply，开了 PRAGMA query_only=ON，不会写任何一张表。
 *
 * 用法（服务器上）：
 *   cd /www/wwwroot/www.xingxuan.cc && php scripts/data-fixes/audit_quote_cascade_risk.php
 *
 * ── 为什么这个盘点是可判定的（不靠猜） ──────────────────────────
 * 两条日志正好构成完整证据链：
 *   1. 建单：order.php:47   opLog('order', $oid, 'create_from_quote', 订单号)
 *   2. 覆盖：customer_quote.php:888  opLog('customer_quote', $qid, 'build', '新单号 覆盖:旧单号,...')
 * 所以「op_logs 里 create_from_quote 记过、但 orders 表里已经查不到」的订单
 * = 被删过，这是事实不是推断。第 1 节就查这个。
 *
 * ── 风险窗口（git 考古，2026-08-09 由开发人员A 确认） ────────────
 *   2026-05-08 13:17  80179c5  迁到 PHP，database.php 开 PRAGMA foreign_keys=ON（级联从此真会触发）
 *   ……此间 buildCustomerQuote 一直带保护：已开票 / 已成单的旧报价跳过不删……
 *   2026-08-06 23:52  2b0eda3  「对客报价改为无条件覆盖」——**保护被主动删除**，洞从此开
 *   2026-08-09 00:55  4fe1ed7  20260808-05 硬拦上线，洞关闭
 * → 只有 2b0eda3 部署上线 ~ 4fe1ed7 部署上线之间产生的操作才可能出事，
 *   不到 3 天。第 1 节若为 0，即可结论「未发生」。
 */

$dbPath = __DIR__ . '/../../backend/data/xingxuan.db';
if (!file_exists($dbPath)) {
    fwrite(STDERR, "找不到数据库：{$dbPath}\n");
    exit(1);
}

$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->exec('PRAGMA query_only=ON');   // 只读，写操作会直接报错

function h(string $t): void { echo "\n=== {$t} ===\n"; }

echo "对客报价级联删单 · 只读盘点（20260808-05 第 4 步）\n";
echo "库：{$dbPath}\n";
echo "时间：" . date('Y-m-d H:i:s') . "\n";

$hasOpLogs = (int) $pdo->query(
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='op_logs'")->fetchColumn();

// ══════════════════════════════════════════════════════ 1. 决定性检测
h('1. 【决定性】曾经建过、现在已消失的订单');

if (!$hasOpLogs) {
    echo "没有 op_logs 表，无法判定，本节跳过。\n";
    $vanished = [];
} else {
    $vanished = $pdo->query(
        "SELECT l.created_at, l.entity_id AS order_id, l.detail AS order_no, l.user_id
           FROM op_logs l
          WHERE l.entity = 'order' AND l.action = 'create_from_quote'
            AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = l.entity_id)
          ORDER BY l.created_at"
    )->fetchAll();

    $totalCreated = (int) $pdo->query(
        "SELECT COUNT(*) FROM op_logs WHERE entity='order' AND action='create_from_quote'")->fetchColumn();

    echo "历史上通过「标记成交」建过的订单：{$totalCreated} 笔\n";
    echo "其中现在已从 orders 表消失的：" . count($vanished) . " 笔\n";

    if (!$vanished) {
        echo "\n✅ 没有任何订单消失过 —— 级联删除**从未真实发生**。\n";
    } else {
        echo "\n🔴 以下订单被删过（建单日志还在，订单没了）：\n";
        foreach ($vanished as $v) {
            printf("  %s  订单 %s (id=%s)  操作人 user#%s\n",
                $v['created_at'], $v['order_no'], $v['order_id'], $v['user_id'] ?? '-');
        }
        echo "\n注：bulkDeleteOrders（后台批量删订单）也会造成同样现象，";
        echo "需用第 3 节的日志区分是「误覆盖」还是「主动批量删」。\n";
    }
}

// ══════════════════════════════════════════════════════ 2. 覆盖动作明细
h('2. 历史上所有「生成报价并覆盖了旧报价」的动作');

if ($hasOpLogs) {
    $builds = $pdo->query(
        "SELECT created_at, entity_id AS quote_id, detail, user_id
           FROM op_logs
          WHERE entity = 'customer_quote' AND action = 'build' AND detail LIKE '%覆盖:%'
          ORDER BY created_at"
    )->fetchAll();
    echo "发生过覆盖的生成动作：" . count($builds) . " 次\n";
    foreach ($builds as $b) {
        printf("  %s  %s  操作人 user#%s\n", $b['created_at'], $b['detail'], $b['user_id'] ?? '-');
    }
    if (!$builds) echo "  （无。说明从来没有过「覆盖旧报价」的操作）\n";
} else {
    echo "没有 op_logs 表，跳过。\n";
}

// ══════════════════════════════════════════════════════ 3. 排除批量删订单
h('3. 排除项：后台「批量删除订单」的记录');

if ($hasOpLogs) {
    $bulk = $pdo->query(
        "SELECT created_at, detail, user_id FROM op_logs
          WHERE entity='order' AND action='bulk_delete' ORDER BY created_at")->fetchAll();
    echo "批量删订单操作：" . count($bulk) . " 次\n";
    foreach ($bulk as $b) {
        printf("  %s  %s  操作人 user#%s\n", $b['created_at'], $b['detail'], $b['user_id'] ?? '-');
    }
    if (!$bulk) echo "  （无。若第 1 节有消失的订单，则不可能是批量删造成的）\n";
} else {
    echo "没有 op_logs 表，跳过。\n";
}

// ══════════════════════════════════════════════════════ 4. 孤儿检测
h('4. 孤儿数据（FK 若曾被关闭，级联不生效会留下孤儿）');

foreach ([
    ['孤儿订单（quote_id 指向已删报价）',
     "SELECT COUNT(*) FROM orders o WHERE o.quote_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM customer_quotes q WHERE q.id = o.quote_id)"],
    ['孤儿收款', "SELECT COUNT(*) FROM payments p
        WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = p.order_id)"],
    ['孤儿返佣', "SELECT COUNT(*) FROM commissions c
        WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = c.order_id)"],
    ['孤儿合同', "SELECT COUNT(*) FROM contracts ct
        WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = ct.order_id)"],
] as [$label, $sql]) {
    printf("  %-32s %d\n", $label, (int) $pdo->query($sql)->fetchColumn());
}
echo "  ⚠ FK 开着时级联会删干净，孤儿为 0 **不能**证明没发生过——以第 1 节为准。\n";

// ══════════════════════════════════════════════════════ 5. 当前风险面
h('5. 当前「报价已成单」的商机（硬拦上线后，这些就是会被拦下的场景）');

$risk = $pdo->query(
    "SELECT i.no AS inquiry_no, q.no AS quote_no, o.no AS order_no, o.currency,
            (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.id) AS pay_cnt,
            (SELECT IFNULL(SUM(p.amount),0) FROM payments p WHERE p.order_id = o.id) AS paid_sum,
            (SELECT COUNT(*) FROM commissions c WHERE c.order_id = o.id) AS commission_cnt
       FROM customer_quotes q
       JOIN orders o ON o.quote_id = q.id
       JOIN inquiries i ON i.id = q.inquiry_id
      ORDER BY i.id"
)->fetchAll();

if (!$risk) {
    echo "无。当前没有任何『报价已成单』的商机。\n";
} else {
    printf("  %-16s %-16s %-16s %8s %16s %6s\n",
        '商机号', '报价号', '订单号', '收款笔', '已收金额', '返佣');
    foreach ($risk as $r) {
        printf("  %-16s %-16s %-16s %8d %16s %6d\n",
            $r['inquiry_no'], $r['quote_no'], $r['order_no'], (int) $r['pay_cnt'],
            ($r['currency'] === 'CNY' ? '¥' : 'Rp') . number_format((float) $r['paid_sum']),
            (int) $r['commission_cnt']);
    }
    echo "\n合计 " . count($risk) . " 条。硬拦上线前，这些一次误点就会全没。\n";
}

// ══════════════════════════════════════════════════════ 结论
h('结论');
if (!$hasOpLogs) {
    echo "无 op_logs，无法判定，需人工核对。\n";
} elseif (empty($vanished)) {
    echo "✅ 未发生。历史上没有任何「建过又消失」的订单，\n";
    echo "   即重新生成报价从未真的删掉过订单 / 收款 / 返佣。\n";
} else {
    echo "🔴 已发生 " . count($vanished) . " 笔订单消失，见第 1 节。\n";
    echo "   先用第 3 节排除「批量删订单」，剩下的就是本 bug 造成的，需要追账。\n";
}
echo "\n本脚本只读（PRAGMA query_only=ON），未改任何数据。\n";
