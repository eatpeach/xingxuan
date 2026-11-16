<?php
/**
 * 补回报价单明细的供货来源（20261116）
 *
 * 旧代码在「修改报价单」保存时把每行的 source_supplier_quote_item_id 清成了 NULL，
 * 「这行是哪家供应商供的」的记录就丢了。这里按「同一行货品 + 成本价和供应商报价一样」补回来：
 * 只有唯一匹配（只有一家的报价等于这行成本价）才补，拿不准的不动。
 *
 *   php scripts/data-fixes/relink_quote_supplier_source.php            # dry-run
 *   php scripts/data-fixes/relink_quote_supplier_source.php --apply
 */
if (PHP_SAPI !== 'cli') exit;
$apply = in_array('--apply', $argv ?? [], true);
$dbFile = dirname(__DIR__, 2) . '/backend/data/xingxuan.db';
if ($apply && is_file($dbFile) && function_exists('posix_geteuid') && posix_geteuid() === 0) {
    posix_setgid((int) filegroup($dbFile));
    posix_setuid((int) fileowner($dbFile));
}
require __DIR__ . '/../../backend/config/database.php';
require __DIR__ . '/../../backend/includes/helpers.php';
foreach (glob(__DIR__ . '/../../backend/includes/*.php') as $f) require_once $f;
foreach (glob(__DIR__ . '/../../backend/api/handlers/*.php') as $f) require_once $f;
$pdo = Database::getInstance()->getConnection();

$rows = $pdo->query("SELECT qi.id, qi.quote_id, qi.inquiry_item_id, qi.product_name, qi.cost_price, q.no
    FROM customer_quote_items qi JOIN customer_quotes q ON q.id = qi.quote_id
    WHERE qi.source_supplier_quote_item_id IS NULL AND qi.cost_price > 0 AND qi.inquiry_item_id > 0
      AND EXISTS (SELECT 1 FROM quote_revisions r WHERE r.quote_id = qi.quote_id)")->fetchAll(PDO::FETCH_ASSOC);
$find = $pdo->prepare("SELECT si.id, s.name FROM supplier_quote_items si
    JOIN supplier_quotes sq ON sq.id = si.quote_id JOIN suppliers s ON s.id = sq.supplier_id
    WHERE si.inquiry_item_id = ? AND sq.status IN ('submitted','adopted','rejected') AND ABS(si.supplier_price - ?) < 0.01");
$upd = $pdo->prepare("UPDATE customer_quote_items SET source_supplier_quote_item_id = ? WHERE id = ?");
echo ($apply ? '== 执行' : '== dry-run（加 --apply 才执行）') . '：没有供货来源的报价行 ' . count($rows) . " 行 ==\n";
$n = 0;
$touched = [];
foreach ($rows as $r) {
    $find->execute([(int) $r['inquiry_item_id'], (float) $r['cost_price']]);
    $m = $find->fetchAll(PDO::FETCH_ASSOC);
    if (count($m) !== 1) continue; // 没有或不止一家同价：不猜
    $n++;
    echo "  {$r['no']} {$r['product_name']} → {$m[0]['name']}\n";
    if ($apply) { $upd->execute([(int) $m[0]['id'], (int) $r['id']]); $touched[(int) $r['quote_id']] = true; }
}
if ($apply) {
    foreach (array_keys($touched) as $qid) {
        $pdo->prepare("UPDATE orders SET supplier_name = ? WHERE quote_id = ?")->execute([_supplierSummaryText(_quoteSupplierBreakdown($pdo, $qid)), $qid]);
    }
}
echo $apply ? "✓ 已补回 {$n} 行\n" : "可补回 {$n} 行。确认无误后加 --apply 执行。\n";
