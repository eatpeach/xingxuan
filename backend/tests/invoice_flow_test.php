<?php
/**
 * 报价 → 开单 → 开票 → 改明细 → 重开 → 部分开票 → 改运费 → 追加物料 全流程金额测试
 * （20261113，INV20261110001 少开事故之后加的：同样的错误必须在上线前就被测出来）
 *
 * 在临时数据库上跑，不碰正式数据：php backend/tests/invoice_flow_test.php
 * 部署脚本 deploy.sh 会在上线前自动跑，失败就不上线。
 */
if (PHP_SAPI !== 'cli') exit;
$db = sys_get_temp_dir() . '/xx_test_' . getmypid() . '.db';
@unlink($db);
putenv("XX_DB_PATH={$db}");
$php = PHP_BINARY;
$call = function (string $fn, array $input, int $uid = 101) use ($php, $db) {
    $cmd = 'XX_DB_PATH=' . escapeshellarg($db) . ' ' . escapeshellarg($php) . ' ' . escapeshellarg(__DIR__ . '/_call.php') . ' '
        . escapeshellarg($fn) . ' ' . escapeshellarg(json_encode($input, JSON_UNESCAPED_UNICODE)) . ' ' . $uid . ' 2>&1';
    $out = (string) shell_exec($cmd);
    $j = json_decode(trim(substr($out, (int) strpos($out, '{'))), true);
    return is_array($j) ? $j : ['success' => false, 'message' => 'RAW: ' . $out];
};

require __DIR__ . '/../config/database.php';
require __DIR__ . '/../includes/helpers.php';
require __DIR__ . '/../includes/freight.php';
require __DIR__ . '/../includes/money_audit.php';
$d = Database::getInstance();
$d->initialize();
$pdo = $d->getConnection();

$fail = 0;
$ok = function (string $name, bool $cond, string $detail = '') use (&$fail) {
    echo ($cond ? '  ✓ ' : '  ✗ ') . $name . ($cond || $detail === '' ? '' : "  —— {$detail}") . "\n";
    if (!$cond) $fail++;
};
$q = fn () => $pdo->query("SELECT * FROM customer_quotes WHERE id = 1")->fetch();
$order = fn () => $pdo->query("SELECT * FROM orders WHERE quote_id = 1")->fetch();
$audit = fn () => moneyAudit($pdo, 1);

// ---- 准备数据：管理员 1、销售 2、客户、商机、报价单（喷涂机 1 × 4,300,000）
$pdo->exec("INSERT INTO users (id, username, password_hash, name, role) VALUES (101, 'admin_t', 'x', '管理员', 'admin'), (102, 'sales_t', 'x', '销售', 'sales')");
$pdo->exec("INSERT INTO customers (id, name) VALUES (1, '测试客户')");
$pdo->exec("INSERT INTO inquiries (id, no, customer_id, title, status, created_by, owner_id, tax_included, tax_rate, currency) VALUES (1, 'T-INQ1', 1, '喷涂机', 'quoted', 102, 102, 0, 0.11, 'IDR')");
$pdo->exec("INSERT INTO inquiry_items (id, inquiry_id, line_no, product_name, qty) VALUES (1, 1, 1, '喷涂机', 1)");
$pdo->exec("INSERT INTO customer_quotes (id, no, inquiry_id, customer_id, status, total, tax_included, tax_rate, currency) VALUES (1, 'T-Q1', 1, 1, 'draft', 4300000, 0, 0.11, 'IDR')");
$pdo->exec("INSERT INTO customer_quote_items (quote_id, inquiry_item_id, product_name, unit, qty, cost_price, sell_price) VALUES (1, 1, '喷涂机', '套', 1, 4000000, 4300000)");
quoteApplyFreight($pdo, 1);

echo "1. 首次开票（全额）\n";
$r = $call('handle_issueInvoice', ['id' => 1, 'payment_channel' => 'company']);
$ok('开票成功', !empty($r['success']), $r['message'] ?? '');
$ok('开票金额 = 4,300,000', abs((float) $q()['invoice_amount'] - 4300000) < 1, (string) $q()['invoice_amount']);

echo "2. 开单\n";
$r = $call('handle_setDealStatus', ['quote_id' => 1, 'status' => 'won']);
$ok('开单成功', !empty($r['success']), $r['message'] ?? '');
$ok('订单金额 = 4,300,000', abs((float) $order()['total_amount'] - 4300000) < 1);

echo "3. 加东西：明细改成 9,490,000（事故复现）\n";
$items = [
    ['inquiry_item_id' => 1, 'product_name' => '喷涂机', 'unit' => '套', 'qty' => 1, 'cost_price' => 4000000, 'sell_price' => 4700000],
    ['product_name' => '喷杆', 'unit' => '根', 'qty' => 2, 'sell_price' => 330000],
    ['product_name' => '炮钉枪', 'unit' => '把', 'qty' => 6, 'sell_price' => 180000],
    ['product_name' => '炮钉', 'unit' => '盒', 'qty' => 50, 'sell_price' => 61000],
];
$r = $call('handle_updateQuoteItems', ['quote_id' => 1, 'items' => $items, 'reason' => '加上炮钉枪和炮钉']);
$ok('管理员改明细成功', !empty($r['success']), $r['message'] ?? '');
$ok('报价总额 = 9,490,000', abs((float) $q()['total'] - 9490000) < 1, (string) $q()['total']);
$ok('订单金额同步 = 9,490,000', abs((float) $order()['total_amount'] - 9490000) < 1);
$ok('旧发票已作废', $q()['invoice_no'] === '');
$ok('作废后开票金额已清空（事故根源）', $q()['invoice_amount'] === null, var_export($q()['invoice_amount'], true));

echo "4. 重开发票：不传金额必须是新的全额\n";
$r = $call('handle_issueInvoice', ['id' => 1, 'payment_channel' => 'company']);
$ok('重开成功', !empty($r['success']), $r['message'] ?? '');
$ok('开票金额 = 9,490,000（不是旧的 4,300,000）', abs((float) $q()['invoice_amount'] - 9490000) < 1, (string) $q()['invoice_amount']);
$ok('不是部分开票', (int) $q()['invoice_partial'] === 0);
$ok('对账 0 异常', count($audit()) === 0, json_encode($audit(), JSON_UNESCAPED_UNICODE));

echo "5. 事故状态必须被对账发现\n";
$pdo->exec("UPDATE customer_quotes SET invoice_amount = 4300000, invoice_partial = 0 WHERE id = 1");
$codes = array_column($audit(), 'code');
$ok('对账报出「部分开票未确认」', in_array('invoice_partial_unconfirmed', $codes, true), implode(',', $codes));
$pdo->exec("UPDATE customer_quotes SET invoice_amount = 9490000 WHERE id = 1");

echo "6. 部分开票必须确认\n";
$call('handle_updateQuoteItems', ['quote_id' => 1, 'items' => $items, 'reason' => '再保存一次']);
$r = $call('handle_issueInvoice', ['id' => 1, 'payment_channel' => 'company', 'invoice_amount' => 4745000]);
$ok('没确认的部分开票被拒绝', empty($r['success']), json_encode($r, JSON_UNESCAPED_UNICODE));
$ok('被拒绝时没开出发票', $q()['invoice_no'] === '');
$r = $call('handle_issueInvoice', ['id' => 1, 'payment_channel' => 'company', 'invoice_amount' => 4745000, 'confirm_partial' => 1]);
$ok('确认后部分开票成功', !empty($r['success']), $r['message'] ?? '');
$ok('标记为部分开票', (int) $q()['invoice_partial'] === 1);
$ok('对账 0 异常', count($audit()) === 0, json_encode($audit(), JSON_UNESCAPED_UNICODE));

echo "7. 改运费：加进单价 1,000,000\n";
$r = $call('handle_updateQuoteFreight', ['quote_id' => 1, 'freight_mode' => 'in_price', 'freight_amount' => 1000000, 'reason' => '加运费']);
$ok('改运费成功', !empty($r['success']), $r['message'] ?? '');
$ok('报价总额 = 10,490,000', abs((float) $q()['total'] - 10490000) < 1, (string) $q()['total']);
$ok('订单金额同步', abs((float) $order()['total_amount'] - 10490000) < 1);
$sum = (float) $pdo->query("SELECT SUM(line_total) FROM customer_quote_items WHERE quote_id = 1")->fetchColumn();
$ok('各行含运费小计合计 = 总额', abs($sum - 10490000) < 1, (string) $sum);
$ok('旧发票作废、开票金额清空', $q()['invoice_no'] === '' && $q()['invoice_amount'] === null);
$r = $call('handle_issueInvoice', ['id' => 1, 'payment_channel' => 'company']);
$ok('重开金额 = 10,490,000', abs((float) $q()['invoice_amount'] - 10490000) < 1, (string) $q()['invoice_amount']);
$ok('对账 0 异常', count($audit()) === 0, json_encode($audit(), JSON_UNESCAPED_UNICODE));

echo "8. 锁定后销售只能追加物料\n";
$r = $call('handle_updateQuoteItems', ['quote_id' => 1, 'items' => $items, 'reason' => 'x'], 2);
$ok('销售直接改被拦', empty($r['success']));
$r = $call('handle_appendQuoteItems', ['quote_id' => 1, 'items' => [['product_name' => '角码', 'qty' => 100, 'sell_price' => 2500]]], 102);
$ok('销售追加成功', !empty($r['success']), $r['message'] ?? '');
$ok('进入待审批', $q()['status'] === 'to_review');
$ok('追加后发票作废、开票金额清空', $q()['invoice_no'] === '' && $q()['invoice_amount'] === null);
$r = $call('handle_reviewQuoteAppend', ['quote_id' => 1, 'decision' => 'approve']);
$ok('管理员审批通过', !empty($r['success']), $r['message'] ?? '');
$ok('总额 = 10,490,000 + 250,000 = 10,740,000', abs((float) $q()['total'] - 10740000) < 1, (string) $q()['total']);
$ok('订单金额同步', abs((float) $order()['total_amount'] - 10740000) < 1);
$r = $call('handle_issueInvoice', ['id' => 1, 'payment_channel' => 'company']);
$ok('重开金额 = 10,740,000', abs((float) $q()['invoice_amount'] - 10740000) < 1, (string) $q()['invoice_amount']);
$ok('最终对账 0 异常', count($audit()) === 0, json_encode($audit(), JSON_UNESCAPED_UNICODE));

echo "9. 金额对不上时禁止开票\n";
$call('handle_updateQuoteItems', ['quote_id' => 1, 'items' => $items, 'reason' => '再改一次']);
$pdo->exec("UPDATE customer_quotes SET total = total - 100000 WHERE id = 1");
$r = $call('handle_issueInvoice', ['id' => 1, 'payment_channel' => 'company']);
$ok('报价总额和明细对不上时开票被拒绝', empty($r['success']), json_encode($r, JSON_UNESCAPED_UNICODE));

@unlink($db);
@unlink($db . '-wal');
@unlink($db . '-shm');
echo $fail ? "\n✗ {$fail} 项失败\n" : "\n✓ 全部通过\n";
exit($fail ? 1 : 0);
