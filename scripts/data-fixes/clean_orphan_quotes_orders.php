<?php
/**
 * 清理孤儿报价单 / 订单（商机已删但它们还留着）
 *
 * 用法：
 *   php scripts/data-fixes/clean_orphan_quotes_orders.php          # dry-run
 *   php scripts/data-fixes/clean_orphan_quotes_orders.php --apply  # 真删
 *
 * 背景：customer_quotes.inquiry_id 和 supplier_quotes.inquiry_id 上没有外键约束，
 * 旧版 deleteInquiry 只 DELETE FROM inquiries，于是报价单连同它下面的订单、合同、
 * 收款、返佣、退款全留在库里，Dashboard 和财务管理照样统计得到——「删了还有残留」。
 * deleteInquiry 已修（显式删报价单），这个脚本负责收拾此前留下的。
 *
 * 🔴 有收款 / 返佣的孤儿不会删，会单独列出来让人工判断——那是资金数据。
 */

$root = dirname(__DIR__, 2);
require_once $root . '/backend/config/database.php';

$apply = in_array('--apply', $argv, true);
$pdo = Database::getInstance()->getConnection();
$pdo->exec('PRAGMA foreign_keys = ON');

/** 商机已经不存在的客户报价 */
$orphanQuotes = $pdo->query("
    SELECT q.id, q.no, q.inquiry_id, q.total, q.currency, q.invoice_no,
           (SELECT COUNT(*) FROM orders o WHERE o.quote_id = q.id) AS order_cnt,
           (SELECT COUNT(*) FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.quote_id = q.id) AS pay_cnt,
           (SELECT COUNT(*) FROM commissions cm JOIN orders o ON o.id = cm.order_id WHERE o.quote_id = q.id) AS comm_cnt
      FROM customer_quotes q
     WHERE NOT EXISTS (SELECT 1 FROM inquiries i WHERE i.id = q.inquiry_id)
     ORDER BY q.id
")->fetchAll();

/** 商机已经不存在的供应商报价 */
$orphanSupplierQuotes = $pdo->query("
    SELECT sq.id, sq.inquiry_id
      FROM supplier_quotes sq
     WHERE NOT EXISTS (SELECT 1 FROM inquiries i WHERE i.id = sq.inquiry_id)
     ORDER BY sq.id
")->fetchAll();

/** 报价单也没了的订单（更深一层的孤儿） */
$orphanOrders = $pdo->query("
    SELECT o.id, o.no, o.total_amount, o.currency,
           (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.id) AS pay_cnt,
           (SELECT COUNT(*) FROM commissions cm WHERE cm.order_id = o.id) AS comm_cnt
      FROM orders o
     WHERE NOT EXISTS (SELECT 1 FROM customer_quotes q WHERE q.id = o.quote_id)
     ORDER BY o.id
")->fetchAll();

$safeQuotes = [];
$moneyQuotes = [];
foreach ($orphanQuotes as $q) {
    if ((int) $q['pay_cnt'] > 0 || (int) $q['comm_cnt'] > 0) $moneyQuotes[] = $q;
    else $safeQuotes[] = $q;
}
$safeOrders = [];
$moneyOrders = [];
foreach ($orphanOrders as $o) {
    if ((int) $o['pay_cnt'] > 0 || (int) $o['comm_cnt'] > 0) $moneyOrders[] = $o;
    else $safeOrders[] = $o;
}

echo $apply ? "== 执行清理 ==\n\n" : "== DRY-RUN（加 --apply 才真删）==\n\n";

echo "孤儿客户报价（商机已删）：" . count($orphanQuotes) . " 条\n";
foreach ($safeQuotes as $q) {
    printf("  可删  %-16s 商机#%-5s %s %s%s  订单 %d\n",
        $q['no'], $q['inquiry_id'], $q['currency'], number_format((float) $q['total']),
        $q['invoice_no'] ? " 发票{$q['invoice_no']}" : '', (int) $q['order_cnt']);
}
foreach ($moneyQuotes as $q) {
    printf("  ⚠保留 %-16s 商机#%-5s 有收款 %d 笔 / 返佣 %d 条，需人工处理\n",
        $q['no'], $q['inquiry_id'], (int) $q['pay_cnt'], (int) $q['comm_cnt']);
}

echo "\n孤儿供应商报价：" . count($orphanSupplierQuotes) . " 条\n";

echo "\n孤儿订单（报价单也没了）：" . count($orphanOrders) . " 条\n";
foreach ($safeOrders as $o) {
    printf("  可删  %-16s %s %s\n", $o['no'], $o['currency'], number_format((float) $o['total_amount']));
}
foreach ($moneyOrders as $o) {
    printf("  ⚠保留 %-16s 有收款 %d 笔 / 返佣 %d 条，需人工处理\n",
        $o['no'], (int) $o['pay_cnt'], (int) $o['comm_cnt']);
}

$delQ = count($safeQuotes);
$delSQ = count($orphanSupplierQuotes);
$delO = count($safeOrders);
echo "\n合计可删：客户报价 {$delQ} 条、供应商报价 {$delSQ} 条、订单 {$delO} 条\n";
if ($moneyQuotes || $moneyOrders) {
    echo "另有 " . (count($moneyQuotes) + count($moneyOrders)) . " 条带资金记录，已跳过。\n";
}

if ($delQ + $delSQ + $delO === 0) {
    echo "\n没有需要清理的孤儿数据。\n";
    exit(0);
}

if (!$apply) {
    echo "\n确认后执行：\n";
    echo "  cp backend/data/xingxuan.db backend/data/xingxuan.db.bak_\$(date +%Y%m%d%H%M)\n";
    echo "  php scripts/data-fixes/clean_orphan_quotes_orders.php --apply\n";
    exit(0);
}

$pdo->beginTransaction();
try {
    foreach ($safeQuotes as $q) {
        // 订单/合同/收款/返佣/退款 靠 CASCADE 带走
        $pdo->prepare("DELETE FROM customer_quotes WHERE id = ?")->execute([(int) $q['id']]);
    }
    foreach ($orphanSupplierQuotes as $sq) {
        $pdo->prepare("DELETE FROM supplier_quotes WHERE id = ?")->execute([(int) $sq['id']]);
    }
    foreach ($safeOrders as $o) {
        $pdo->prepare("DELETE FROM orders WHERE id = ?")->execute([(int) $o['id']]);
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "失败已回滚：" . $e->getMessage() . "\n");
    exit(1);
}

echo "\n已清理。\n";
