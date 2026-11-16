<?php
/**
 * 历史补同步：把「改过报价单」的商机明细补成和报价单一致（20261116）
 *
 * 以前在「修改报价单」里加减货品只改了报价单，商机详情的明细没跟着变。新代码以后会自动同步，
 * 这个脚本处理存量：只处理改过明细的报价单（有 quote_revisions 记录的）。
 * 删除只删「历史上进过报价单、现在报价单里已经没有」的行；从没报过价的商机行不动。
 *
 *   php scripts/data-fixes/sync_inquiry_items_from_quotes.php            # dry-run：只列差异
 *   php scripts/data-fixes/sync_inquiry_items_from_quotes.php --apply    # 执行
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

$quotes = $pdo->query("SELECT q.id, q.no, q.inquiry_id, i.no AS inq_no FROM customer_quotes q JOIN inquiries i ON i.id = q.inquiry_id
    WHERE EXISTS (SELECT 1 FROM quote_revisions r WHERE r.quote_id = q.id)
      AND (SELECT COUNT(*) FROM customer_quotes q2 WHERE q2.inquiry_id = q.inquiry_id) = 1
    ORDER BY q.id")->fetchAll(PDO::FETCH_ASSOC);
echo ($apply ? '== 执行' : '== dry-run（加 --apply 才执行）') . '：改过明细的报价单 ' . count($quotes) . " 张 ==\n";
$n = 0;
foreach ($quotes as $q) {
    $qi = $pdo->query("SELECT product_name, spec, qty FROM customer_quote_items WHERE quote_id = {$q['id']} ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
    $ii = $pdo->query("SELECT product_name, spec, qty FROM inquiry_items WHERE inquiry_id = {$q['inquiry_id']} ORDER BY line_no, id")->fetchAll(PDO::FETCH_ASSOC);
    $sig = fn ($rows) => implode('|', array_map(fn ($r) => trim($r['product_name']) . '/' . trim((string) $r['spec']) . '/' . (float) $r['qty'], $rows));
    if ($sig($qi) === $sig($ii)) continue;
    $n++;
    echo "#{$q['inquiry_id']} {$q['inq_no']} / {$q['no']}：商机明细 " . count($ii) . " 行 → 报价单 " . count($qi) . " 行\n";
    if (!$apply) continue;
    // 历史上进过报价单的商机行（各版修改前的快照里出现过的）
    $was = [];
    foreach ($pdo->query("SELECT items_before FROM quote_revisions WHERE quote_id = {$q['id']}")->fetchAll(PDO::FETCH_COLUMN) as $json) {
        foreach ((array) json_decode((string) $json, true) as $it) $was[] = (int) ($it['inquiry_item_id'] ?? 0);
    }
    $pdo->beginTransaction();
    $r = quoteSyncInquiryItems($pdo, (int) $q['id'], $was);
    $pdo->commit();
    echo '   ' . json_encode($r, JSON_UNESCAPED_UNICODE) . "\n";
}
echo $n ? ($apply ? "✓ 已同步 {$n} 个商机\n" : "共 {$n} 个商机需要同步。确认无误后加 --apply 执行。\n") : "全部一致，不用处理\n";
