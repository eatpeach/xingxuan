<?php
/**
 * 把以前开在「商机管理」里的服务费挪到服务费板块（20261118）
 *
 * 判定：商机标题或货品名里有「服务」「service」字样，并且这张单的每一行都是服务（纯服务费）。
 * 建材和服务混在一张单里的不动，只列出来。
 * 挪的做法：在 service_invoices 里建一条（沿用原发票号 —— 客户手里那张发票不用换；金额、PPN、PPh、
 * 客户抬头、开票主体、收款账户、开票日期全部照搬；原商机 / 报价单 / 订单的完整内容存进 legacy_json 留底），
 * 然后把原商机删掉。删掉后工作台的成交、营收里就没有这几笔了。
 * 到账状态：原来只有「跟单手动确认过到账」的才记为已到账；系统迁移时自动算成交的，一律按待收款，由人核对后再点确认。
 * 有收款 / 返佣记录的单不自动挪（钱的记录不能丢），列出来人工处理。
 *
 *   php scripts/data-fixes/move_service_fees.php            # dry-run：只列清单
 *   php scripts/data-fixes/move_service_fees.php --apply    # 执行
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
$db = Database::getInstance();
$db->initialize();
$pdo = $db->getConnection();

$isSvc = fn (string $s): bool => (bool) preg_match('/服务|service|servis|jasa/iu', $s);
$all = fn (string $sql, array $p = []) => (function () use ($pdo, $sql, $p) { $st = $pdo->prepare($sql); $st->execute($p); return $st->fetchAll(PDO::FETCH_ASSOC); })();

$inqs = $all("SELECT i.*, COALESCE(NULLIF(c.short_name, ''), c.name) AS cust FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id ORDER BY i.id");
$todo = [];
$skipped = [];
foreach ($inqs as $inq) {
    $iid = (int) $inq['id'];
    $items = $all("SELECT * FROM inquiry_items WHERE inquiry_id = ?", [$iid]);
    $quotes = $all("SELECT * FROM customer_quotes WHERE inquiry_id = ? ORDER BY id", [$iid]);
    $qItems = $quotes ? $all("SELECT * FROM customer_quote_items WHERE quote_id = ? ORDER BY id", [(int) end($quotes)['id']]) : [];
    $names = array_merge(array_column($items, 'product_name'), array_column($qItems, 'product_name'));
    $hit = $isSvc((string) $inq['title']) || array_filter($names, $isSvc);
    if (!$hit) continue;
    $label = "#{$iid} {$inq['no']}「{$inq['title']}」{$inq['cust']}";
    if (array_filter($names, fn ($n) => !$isSvc((string) $n))) { $skipped[] = "{$label}：建材和服务混在一张单里（" . implode(' / ', $names) . '）'; continue; }
    if (count($quotes) !== 1) { $skipped[] = "{$label}：有 " . count($quotes) . ' 张报价单，不是标准的一单一报价'; continue; }
    $q = $quotes[0];
    $orders = $all("SELECT * FROM orders WHERE quote_id = ?", [(int) $q['id']]);
    $pays = $orders ? (int) $all("SELECT COUNT(*) n FROM payments WHERE order_id = ?", [(int) $orders[0]['id']])[0]['n'] : 0;
    $comms = $orders ? (int) $all("SELECT COUNT(*) n FROM commissions WHERE order_id = ?", [(int) $orders[0]['id']])[0]['n'] : 0;
    if ($pays || $comms) { $skipped[] = "{$label}：有收款 {$pays} 笔 / 返佣 {$comms} 条，钱的记录不能自动挪"; continue; }
    $todo[] = compact('inq', 'items', 'q', 'qItems', 'orders', 'label');
}

echo ($apply ? '== 执行' : '== dry-run（加 --apply 才执行）') . '：要挪到服务费板块的 ' . count($todo) . " 张 ==\n";
$fmt = fn ($n, $cur) => ($cur === 'CNY' ? '¥' : 'Rp ') . number_format((float) $n);
foreach ($todo as $t) {
    $o = $t['orders'][0] ?? null;
    $manual = $o && !empty($o['deal_confirmed_at']) && ($o['deal_last_action'] ?? '') === 'confirm';
    echo "  {$t['label']}  " . $fmt($t['q']['total'], $t['q']['currency']) . '  发票 ' . ($t['q']['invoice_no'] ?: '未开')
        . '  → ' . ($manual || !empty($t['q']['paid_at']) ? '已到账' : '待收款') . "\n";
}
if ($skipped) { echo "\n不自动挪、需要人工看的：\n"; foreach ($skipped as $s) echo "  {$s}\n"; }
if (!$apply) { echo "\n未做任何修改。\n"; exit(0); }

$pdo->beginTransaction();
try {
    foreach ($todo as $t) {
        $q = $t['q'];
        $inq = $t['inq'];
        $o = $t['orders'][0] ?? null;
        $manual = $o && !empty($o['deal_confirmed_at']) && ($o['deal_last_action'] ?? '') === 'confirm';
        $paid = $manual || !empty($q['paid_at']);
        $paidAt = !empty($q['paid_at']) ? $q['paid_at'] : ($manual ? $o['deal_confirmed_at'] : null);
        $no = $q['invoice_no'] ?: _svcNextNo($pdo); // 开过票的沿用原发票号；没开过的给一个 SVC 号
        $amount = $q['invoice_amount'] !== null && (float) $q['invoice_amount'] > 0 ? (float) $q['invoice_amount'] : (float) $q['total'];
        $st = $pdo->prepare("SELECT name, company, tax_no, address, phone FROM customers WHERE id = ?");
        $st->execute([(int) $q['customer_id']]);
        $c = $st->fetch() ?: [];
        $pdo->prepare("INSERT INTO service_invoices
            (no, customer_id, title, currency, tax_rate, total, pph_rate, pph_amount, payment_channel, lang, status, issued_at, due_at, paid_at, paid_by, remark,
             customer_name, customer_tax_no, customer_address, customer_phone,
             entity_id, entity_name, entity_tax_no, entity_address, entity_phone, entity_logo_path,
             account_id, bank_name, bank_account_no, bank_account_name, bank_swift, bank_branch,
             legacy_source, legacy_json, created_by, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?)")
            ->execute([
                $no, (int) $q['customer_id'], (string) $inq['title'], $q['currency'] ?: 'IDR', (float) $q['tax_rate'], $amount,
                (float) ($q['invoice_pph_rate'] ?? 0), (float) ($q['invoice_pph_amount'] ?? 0),
                normPaymentChannel($q['payment_channel'] ?? '', (string) $q['currency']) ?: 'company', $q['invoice_lang'] ?: 'cn',
                $paid ? 'paid' : 'issued', $q['invoice_issued_at'] ?: $q['created_at'], $q['invoice_due_at'], $paidAt, $paid ? ($o['deal_confirmed_by'] ?? null) : null, (string) ($q['remark'] ?? ''),
                $q['invoice_customer_name'] ?: (($c['company'] ?? '') ?: ($c['name'] ?? '')), $q['invoice_customer_tax_no'] ?: ($c['tax_no'] ?? ''),
                $q['invoice_customer_address'] ?: ($c['address'] ?? ''), $q['invoice_customer_phone'] ?: ($c['phone'] ?? ''),
                $q['invoice_entity_id'], (string) $q['invoice_entity_name'], (string) $q['invoice_entity_tax_no'], (string) $q['invoice_entity_address'],
                (string) $q['invoice_entity_phone'], (string) $q['invoice_entity_logo_path'],
                $q['invoice_account_id'], (string) $q['invoice_bank_name'], (string) $q['invoice_bank_account_no'], (string) $q['invoice_bank_account_name'],
                (string) $q['invoice_bank_swift'], (string) $q['invoice_bank_branch'],
                "商机 #{$inq['id']} {$inq['no']} / 报价 {$q['no']}" . ($o ? " / 订单 {$o['no']}" : ''),
                json_encode(['inquiry' => $inq, 'inquiry_items' => $t['items'], 'quote' => $q, 'quote_items' => $t['qItems'], 'orders' => $t['orders']], JSON_UNESCAPED_UNICODE),
                $inq['created_by'], $q['created_at'],
            ]);
        $sid = (int) $pdo->lastInsertId();
        $ins = $pdo->prepare("INSERT INTO service_invoice_items (invoice_id, product_name, spec, unit, qty, sell_price, name_id, spec_id, trans_id_status, name_en, spec_en, trans_en_status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
        $sum = 0.0;
        foreach ($t['qItems'] as $it) {
            $sum += (float) $it['qty'] * (float) $it['sell_price'];
            $ins->execute([$sid, $it['product_name'], (string) $it['spec'], $it['unit'] ?: '项', (float) $it['qty'], (float) $it['sell_price'],
                (string) ($it['name_id'] ?? ''), (string) ($it['spec_id'] ?? ''), (string) ($it['trans_id_status'] ?? ''),
                (string) ($it['name_en'] ?? ''), (string) ($it['spec_en'] ?? ''), (string) ($it['trans_en_status'] ?? '')]);
        }
        if (abs($sum - $amount) > 1) throw new RuntimeException("{$t['label']}：明细合计 {$sum} 和开票金额 {$amount} 对不上，可能是部分开票，先不挪");
        // 原商机整套删掉（报价单 → 订单靠外键级联；成交操作日志只增不删，留在库里不影响统计）
        $pdo->prepare("DELETE FROM customer_quotes WHERE inquiry_id = ?")->execute([(int) $inq['id']]);
        $pdo->prepare("DELETE FROM supplier_quotes WHERE inquiry_id = ?")->execute([(int) $inq['id']]);
        $pdo->prepare("DELETE FROM inquiries WHERE id = ?")->execute([(int) $inq['id']]);
        opLog($pdo, 'service_invoice', $sid, 'moved_from_inquiry', "{$inq['no']} → {$no}", null, 'cli:move_service_fees');
        echo "  ✓ {$t['label']} → 服务费 {$no}\n";
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "失败，已全部回滚，没有任何修改：" . $e->getMessage() . "\n");
    exit(1);
}
echo "✓ 已挪 " . count($todo) . " 张\n";
