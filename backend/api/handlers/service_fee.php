<?php

/**
 * 服务费板块（20261118）
 *
 * 服务费不是建材板块的收入，单独一个板块开票、收款，数据存在 service_invoices / service_invoice_items，
 * 和商机 / 报价单 / 订单完全分开 —— 工作台、成交排名、直播大屏、财务应收都只查建材那几张表，
 * 所以服务费天然不进任何建材统计，不需要到处加「排除服务费」的条件。
 *
 * 流程很短：填单（客户 + 服务项目）→ 选付款方式 / 收款账户 / PPN / PPh / 语言 → 开票 → 确认到账。
 * 发票号单独前缀 SVC（系统设置 service_no_prefix 可改）。所有登录用户都能看、都能开。
 * 金额口径和建材报价单一致：total = Σ 数量 × 单价（不含 PPN），PPN 价外加，PPh 按不含 PPN 的金额算。
 */

function _svcNextNo(PDO $pdo): string
{
    $prefix = trim((string) getSetting($pdo, 'service_no_prefix', 'SVC')) ?: 'SVC';
    $datePart = date('Ymd');
    $st = $pdo->prepare("SELECT no FROM service_invoices WHERE no LIKE ? ORDER BY no DESC LIMIT 1");
    $st->execute([$prefix . $datePart . '%']);
    $last = (string) $st->fetchColumn();
    $seq = $last !== '' ? (int) substr($last, strlen($prefix . $datePart)) + 1 : 1;
    return $prefix . $datePart . str_pad((string) $seq, 3, '0', STR_PAD_LEFT);
}

function _svcLoad(PDO $pdo, int $id): array
{
    $st = $pdo->prepare("SELECT s.*, COALESCE(NULLIF(u.name, ''), u.username) AS creator_name,
            COALESCE(NULLIF(pu.name, ''), pu.username) AS paid_by_name
        FROM service_invoices s LEFT JOIN users u ON u.id = s.created_by LEFT JOIN users pu ON pu.id = s.paid_by WHERE s.id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('服务费单不存在', 404);
    $st = $pdo->prepare("SELECT * FROM service_invoice_items WHERE invoice_id = ? ORDER BY id");
    $st->execute([$id]);
    $row['items'] = $st->fetchAll();
    return $row;
}

/** 金额：不含税小计、PPN、含税合计、PPh、客户实付 */
function _svcAmounts(array $r): array
{
    $total = (float) $r['total'];
    $tax = round($total * (float) $r['tax_rate'], 2);
    $grand = round($total + $tax, 2);
    $pph = (float) ($r['pph_amount'] ?? 0);
    return ['subtotal' => $total, 'tax' => $tax, 'grand_total' => $grand, 'pph' => $pph, 'amount_due' => round($grand - $pph, 2)];
}

function handle_listServiceInvoices(PDO $pdo, array $input, array $user): void
{
    $page = pageInt($input['page'] ?? 1, 1);
    $size = pageInt($input['page_size'] ?? 20, 20, 1, 100);
    $where = ['1=1'];
    $params = [];
    if (!empty($input['status'])) { $where[] = 's.status = ?'; $params[] = (string) $input['status']; }
    if (!empty($input['customer_id'])) { $where[] = 's.customer_id = ?'; $params[] = (int) $input['customer_id']; }
    $kw = trim((string) ($input['keyword'] ?? ''));
    if ($kw !== '') {
        $where[] = '(s.no LIKE ? OR s.title LIKE ? OR s.customer_name LIKE ? OR EXISTS (SELECT 1 FROM service_invoice_items i WHERE i.invoice_id = s.id AND i.product_name LIKE ?))';
        $like = "%{$kw}%";
        array_push($params, $like, $like, $like, $like);
    }
    $sql = "SELECT s.*, COALESCE(NULLIF(u.name, ''), u.username) AS creator_name,
            COALESCE(NULLIF(pu.name, ''), pu.username) AS paid_by_name,
            (SELECT COUNT(*) FROM service_invoice_items i WHERE i.invoice_id = s.id) AS items_count,
            (SELECT GROUP_CONCAT(i.product_name, ' / ') FROM service_invoice_items i WHERE i.invoice_id = s.id) AS items_text
        FROM service_invoices s LEFT JOIN users u ON u.id = s.created_by LEFT JOIN users pu ON pu.id = s.paid_by
        WHERE " . implode(' AND ', $where) . " ORDER BY s.id DESC";
    // 查询里有子查询，自动改写出来的计数 SQL 会坏，单独给一条
    $countSql = "SELECT COUNT(*) FROM service_invoices s WHERE " . implode(' AND ', $where);
    $ret = paginate($pdo, $sql, $params, $page, $size, $countSql);
    foreach ($ret['items'] as &$r) {
        $r += _svcAmounts($r);
        unset($r['legacy_json']);
    }
    unset($r);

    // 板块自己的小统计（只在这个板块里显示，不进工作台）：本月开票 / 已收 / 未收，按币种
    $monthStart = date('Y-m-01');
    $stats = [];
    foreach ($pdo->query("SELECT currency, status, total, tax_rate, pph_amount, issued_at FROM service_invoices WHERE status != 'void'")->fetchAll() as $r) {
        $cur = $r['currency'] ?: 'IDR';
        $stats[$cur] = $stats[$cur] ?? ['currency' => $cur, 'month_issued' => 0.0, 'month_count' => 0, 'paid' => 0.0, 'unpaid' => 0.0, 'unpaid_count' => 0];
        $due = _svcAmounts($r)['amount_due'];
        if (substr((string) $r['issued_at'], 0, 10) >= $monthStart) { $stats[$cur]['month_issued'] += $due; $stats[$cur]['month_count']++; }
        if ($r['status'] === 'paid') $stats[$cur]['paid'] += $due;
        else { $stats[$cur]['unpaid'] += $due; $stats[$cur]['unpaid_count']++; }
    }
    $ret['stats'] = array_values($stats);
    jsonOk($ret);
}

/**
 * 详情。shape=quote 时按发票打印页（InvoicePrint，读 getCustomerQuote 的格式）要的字段名输出，
 * 打印页、金额自检、物品翻译都不用另写一套
 */
function handle_getServiceInvoice(PDO $pdo, array $input): void
{
    $r = _svcLoad($pdo, (int) ($input['id'] ?? 0));
    unset($r['legacy_json']);
    $r += _svcAmounts($r);
    if (($input['shape'] ?? '') !== 'quote') jsonOk(['data' => $r]);

    $isVoid = $r['status'] === 'void';
    jsonOk(['data' => [
        'is_service' => 1,
        'id' => (int) $r['id'], 'no' => $r['no'], 'status' => 'sent', 'customer_id' => $r['customer_id'],
        'currency' => $r['currency'], 'tax_included' => 0, 'tax_rate' => (float) $r['tax_rate'], 'total' => (float) $r['total'],
        'freight_mode' => 'collect', 'freight_amount' => 0,
        'invoice_no' => $isVoid ? '' : $r['no'], 'invoice_void_at' => $r['void_at'],
        'invoice_issued_at' => $r['issued_at'], 'invoice_due_at' => $r['due_at'],
        'invoice_amount' => (float) $r['total'], 'invoice_partial' => 0,
        'invoice_pph_rate' => (float) $r['pph_rate'], 'invoice_pph_amount' => (float) $r['pph_amount'],
        'invoice_lang' => $r['lang'], 'paid_at' => $r['status'] === 'paid' ? $r['paid_at'] : null,
        'payment_channel' => $r['payment_channel'],
        'invoice_entity_id' => $r['entity_id'], 'invoice_entity_name' => $r['entity_name'], 'invoice_entity_tax_no' => $r['entity_tax_no'],
        'invoice_entity_address' => $r['entity_address'], 'invoice_entity_phone' => $r['entity_phone'], 'invoice_entity_logo_path' => $r['entity_logo_path'],
        'invoice_account_id' => $r['account_id'], 'invoice_bank_name' => $r['bank_name'], 'invoice_bank_account_no' => $r['bank_account_no'],
        'invoice_bank_account_name' => $r['bank_account_name'], 'invoice_bank_swift' => $r['bank_swift'], 'invoice_bank_branch' => $r['bank_branch'],
        'invoice_customer_name' => $r['customer_name'], 'invoice_customer_tax_no' => $r['customer_tax_no'],
        'invoice_customer_address' => $r['customer_address'], 'invoice_customer_phone' => $r['customer_phone'],
        'customer_name' => $r['customer_name'], 'remark' => $r['remark'],
        'items' => $r['items'],
    ]]);
}

/** 新开 / 修改（已收款、已作废的不能改） */
function handle_saveServiceInvoice(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $old = $id ? _svcLoad($pdo, $id) : null;
    if ($old && $old['status'] !== 'issued') jsonError($old['status'] === 'paid' ? '已确认到账的服务费单不能改，先撤销到账' : '已作废的服务费单不能改');

    $items = [];
    foreach ((array) ($input['items'] ?? []) as $it) {
        $name = trim((string) ($it['product_name'] ?? ''));
        if ($name === '') continue;
        $qty = (float) ($it['qty'] ?? 0);
        $price = (float) ($it['sell_price'] ?? 0);
        if ($qty <= 0) jsonError("「{$name}」数量必须大于 0");
        if ($price <= 0) jsonError("「{$name}」还没填单价");
        $items[] = ['product_name' => $name, 'spec' => trim((string) ($it['spec'] ?? '')), 'unit' => trim((string) ($it['unit'] ?? '')) ?: '项', 'qty' => $qty, 'sell_price' => $price];
    }
    if (!$items) jsonError('请至少填一行服务项目');

    // 客户：从客户库选（带出抬头 / 税号 / 地址），抬头可以当场改；也可以不选客户直接手填抬头
    $cid = (int) ($input['customer_id'] ?? 0) ?: null;
    $c = [];
    if ($cid) {
        $st = $pdo->prepare("SELECT name, company, tax_no, address, phone FROM customers WHERE id = ?");
        $st->execute([$cid]);
        $c = $st->fetch() ?: [];
        if (!$c) jsonError('客户不存在');
    }
    $custName = trim((string) ($input['customer_name'] ?? '')) ?: (string) (($c['company'] ?? '') ?: ($c['name'] ?? ''));
    if ($custName === '') jsonError('请选择客户或填写客户抬头');

    $currency = strtoupper((string) ($input['currency'] ?? 'IDR'));
    if (!in_array($currency, ['IDR', 'CNY'], true)) $currency = 'IDR';
    $taxRate = !empty($input['has_tax']) ? 0.11 : 0.0;
    $pphRate = !empty($input['pph']) ? 0.02 : 0.0;
    $channel = normPaymentChannel($input['payment_channel'] ?? '', $currency);
    if ($channel === '') jsonError('请选择付款方式');
    $lang = in_array($input['lang'] ?? '', ['cn', 'en', 'id'], true) ? $input['lang'] : 'cn';

    $total = 0.0;
    foreach ($items as $it) $total += $it['qty'] * $it['sell_price'];
    $total = round($total, 2);
    $pphAmount = round($total * $pphRate, 2); // PPN 是价外加的，total 本身就是不含 PPN 的金额（DPP）

    // 收款账户快照：直付工厂不印我方任何账号；其它必须选一个启用账户（系统里有的话）
    $accountId = $channel === 'factory' ? 0 : (int) ($input['account_id'] ?? 0);
    if ($channel !== 'factory' && !$accountId && _hasSelectablePaymentAccount($pdo)) jsonError('请选择收款账户');
    $snap = _buildInvoiceSnapshot($pdo, $accountId, []);
    if ($channel === 'factory') {
        $snap['invoice_bank_name'] = $snap['invoice_bank_account_no'] = $snap['invoice_bank_account_name'] = $snap['invoice_bank_swift'] = $snap['invoice_bank_branch'] = '';
        $snap['invoice_account_id'] = null;
    }

    $fields = [
        'customer_id' => $cid, 'title' => trim((string) ($input['title'] ?? '')) ?: $items[0]['product_name'],
        'currency' => $currency, 'tax_rate' => $taxRate, 'total' => $total, 'pph_rate' => $pphRate, 'pph_amount' => $pphAmount,
        'payment_channel' => $channel, 'lang' => $lang, 'remark' => trim((string) ($input['remark'] ?? '')),
        'customer_name' => $custName,
        'customer_tax_no' => trim((string) ($input['customer_tax_no'] ?? ($c['tax_no'] ?? ''))),
        'customer_address' => trim((string) ($input['customer_address'] ?? ($c['address'] ?? ''))),
        'customer_phone' => trim((string) ($input['customer_phone'] ?? ($c['phone'] ?? ''))),
        'entity_id' => $snap['invoice_entity_id'], 'entity_name' => $snap['invoice_entity_name'], 'entity_tax_no' => $snap['invoice_entity_tax_no'],
        'entity_address' => $snap['invoice_entity_address'], 'entity_phone' => $snap['invoice_entity_phone'], 'entity_logo_path' => $snap['invoice_entity_logo_path'],
        'account_id' => $snap['invoice_account_id'], 'bank_name' => $snap['invoice_bank_name'], 'bank_account_no' => $snap['invoice_bank_account_no'],
        'bank_account_name' => $snap['invoice_bank_account_name'], 'bank_swift' => $snap['invoice_bank_swift'], 'bank_branch' => $snap['invoice_bank_branch'],
    ];

    $pdo->beginTransaction();
    try {
        if ($old) {
            $sets = implode(', ', array_map(fn ($k) => "{$k} = ?", array_keys($fields)));
            $pdo->prepare("UPDATE service_invoices SET {$sets}, updated_at = datetime('now','localtime') WHERE id = ?")
                ->execute(array_merge(array_values($fields), [$id]));
            $no = $old['no'];
            $pdo->prepare("DELETE FROM service_invoice_items WHERE invoice_id = ?")->execute([$id]);
        } else {
            $no = _svcNextNo($pdo);
            $dueDays = max(0, (int) getSetting($pdo, 'invoice_due_days', '7'));
            $cols = array_merge(['no', 'status', 'issued_at', 'due_at', 'created_by'], array_keys($fields));
            $vals = array_merge([$no, 'issued', date('Y-m-d H:i:s'), date('Y-m-d 23:59:59', strtotime("+{$dueDays} days")), (int) $user['id']], array_values($fields));
            $pdo->prepare("INSERT INTO service_invoices (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")")->execute($vals);
            $id = (int) $pdo->lastInsertId();
        }
        $ins = $pdo->prepare("INSERT INTO service_invoice_items (invoice_id, product_name, spec, unit, qty, sell_price) VALUES (?, ?, ?, ?, ?, ?)");
        foreach ($items as $it) $ins->execute([$id, $it['product_name'], $it['spec'], $it['unit'], $it['qty'], $it['sell_price']]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    opLog($pdo, 'service_invoice', $id, $old ? 'update' : 'create', $no . ' ' . number_format($total), (int) $user['id']);
    jsonOk(['id' => $id, 'no' => $no, 'total' => $total]);
}

function handle_confirmServicePaid(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("UPDATE service_invoices SET status = 'paid', paid_at = datetime('now','localtime'), paid_by = ?, updated_at = datetime('now','localtime')
        WHERE id = ? AND status = 'issued'");
    $st->execute([(int) $user['id'], $id]);
    if ($st->rowCount() === 0) jsonError('这张单不是「待收款」状态，刷新一下看看');
    opLog($pdo, 'service_invoice', $id, 'confirm_paid', '', (int) $user['id']);
    jsonOk();
}

function handle_revokeServicePaid(PDO $pdo, array $input, array $user): void
{
    $reason = trim((string) ($input['reason'] ?? ''));
    if (mb_strlen($reason) < 2) jsonError('请填写撤销原因');
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("UPDATE service_invoices SET status = 'issued', paid_at = NULL, paid_by = NULL, updated_at = datetime('now','localtime')
        WHERE id = ? AND status = 'paid'");
    $st->execute([$id]);
    if ($st->rowCount() === 0) jsonError('这张单还没确认到账，不用撤销');
    opLog($pdo, 'service_invoice', $id, 'revoke_paid', $reason, (int) $user['id']);
    jsonOk();
}

function handle_voidServiceInvoice(PDO $pdo, array $input, array $user): void
{
    $reason = trim((string) ($input['reason'] ?? ''));
    if (mb_strlen($reason) < 2) jsonError('请填写作废原因');
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("UPDATE service_invoices SET status = 'void', void_at = datetime('now','localtime'), void_reason = ?, updated_at = datetime('now','localtime')
        WHERE id = ? AND status = 'issued'");
    $st->execute([$reason, $id]);
    if ($st->rowCount() === 0) jsonError('只有「待收款」的单能作废；已确认到账的先撤销到账');
    opLog($pdo, 'service_invoice', $id, 'void', $reason, (int) $user['id']);
    jsonOk();
}
