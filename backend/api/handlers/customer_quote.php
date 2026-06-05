<?php

function _loadCustomerQuote(PDO $pdo, int $id): array
{
    $st = $pdo->prepare("SELECT * FROM customer_quotes WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('报价单不存在', 404);
    $row['markup_strategy'] = $row['markup_strategy'] ? json_decode($row['markup_strategy'], true) : null;
    $st = $pdo->prepare("SELECT * FROM customer_quote_items WHERE quote_id = ? ORDER BY id ASC");
    $st->execute([$id]);
    $row['items'] = $st->fetchAll();
    return $row;
}

/**
 * 快速开发票：跳过派单/供应商报价环节，直接客户+明细 → 询价(won)+报价(draft)+发票
 * 输入：customer_id, currency, tax_included, tax_rate, items[{product_name, spec, qty, unit, sell_price, brand, model}]
 */
function handle_quickCreateInvoice(PDO $pdo, array $input, array $user): void
{
    $cid = (int) ($input['customer_id'] ?? 0);
    if ($cid <= 0) jsonError('请选择客户');
    $st = $pdo->prepare("SELECT id, name FROM customers WHERE id = ?");
    $st->execute([$cid]);
    $cust = $st->fetch();
    if (!$cust) jsonError('客户不存在');

    $items = $input['items'] ?? [];
    if (!is_array($items) || empty($items)) jsonError('请至少填一行明细');

    $valid = [];
    foreach ($items as $it) {
        $name = trim((string) ($it['product_name'] ?? ''));
        $qty = (float) ($it['qty'] ?? 0);
        $sell = (float) ($it['sell_price'] ?? 0);
        if ($name === '' || $qty <= 0 || $sell <= 0) continue;
        $valid[] = [
            'product_name' => $name,
            'spec' => (string) ($it['spec'] ?? ''),
            'unit' => (string) ($it['unit'] ?? '件') ?: '件',
            'qty' => $qty,
            'sell_price' => $sell,
            'brand' => (string) ($it['brand'] ?? ''),
            'model' => (string) ($it['model'] ?? ''),
            'show_brand' => isset($it['show_brand']) ? (int) (bool) $it['show_brand'] : 1,
            'remark' => (string) ($it['remark'] ?? ''),
        ];
    }
    if (empty($valid)) jsonError('明细行需有产品名 / 数量 / 单价');

    $taxIncluded = isset($input['tax_included']) ? (int) (bool) $input['tax_included'] : 1;
    $taxRate = isset($input['tax_rate']) ? (float) $input['tax_rate'] : 0.11;
    $currency = strtoupper((string) ($input['currency'] ?? 'IDR'));
    if (!in_array($currency, ['IDR', 'CNY'], true)) $currency = 'IDR';

    $pdo->beginTransaction();
    try {
        // 1. 创建一个最小询价单（标记 won 状态，表示无需后续流程）
        $inqNo = nextInquiryNo($pdo);
        $title = '直接开票 - ' . $cust['name'] . ' - ' . date('Y-m-d');
        $pdo->prepare("INSERT INTO inquiries
            (no, customer_id, title, status, remark, created_by, tax_included, tax_rate, currency)
            VALUES (?, ?, ?, 'won', ?, ?, ?, ?, ?)")
            ->execute([$inqNo, $cid, $title, '快速开票自动创建', (int) $user['id'], $taxIncluded, $taxRate, $currency]);
        $iid = (int) $pdo->lastInsertId();

        // 2. 询价明细
        $insIi = $pdo->prepare("INSERT INTO inquiry_items
            (inquiry_id, line_no, product_name, spec, unit, qty, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?)");
        $iiIds = [];
        foreach ($valid as $idx => $v) {
            $insIi->execute([$iid, $idx + 1, $v['product_name'], $v['spec'], $v['unit'], $v['qty'], $v['remark']]);
            $iiIds[] = (int) $pdo->lastInsertId();
        }

        // 3. 客户报价
        $cqNo = nextCustomerQuoteNo($pdo);
        $total = 0.0;
        foreach ($valid as $v) $total += $v['sell_price'] * $v['qty'];
        $validUntil = !empty($input['valid_until'])
            ? (string) $input['valid_until']
            : date('Y-m-d H:i:s', strtotime('+30 days'));
        $productionCycle = (string) ($input['production_cycle'] ?? '');
        $pdo->prepare("INSERT INTO customer_quotes
            (no, inquiry_id, customer_id, status, markup_strategy, total, valid_until, remark, created_by,
             tax_included, tax_rate, currency, production_cycle)
            VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            ->execute([
                $cqNo, $iid, $cid,
                json_encode(['type' => 'direct'], JSON_UNESCAPED_UNICODE),
                $total, $validUntil,
                (string) ($input['remark'] ?? ''),
                (int) $user['id'],
                $taxIncluded, $taxRate, $currency, $productionCycle,
            ]);
        $qid = (int) $pdo->lastInsertId();

        // 4. 客户报价明细（cost_price = sell_price，markup = 0；品牌按 show_brand 决定是否展示）
        $insCq = $pdo->prepare("INSERT INTO customer_quote_items
            (quote_id, inquiry_item_id, source_supplier_quote_item_id, show_brand, brand_display, model_display,
             product_name, spec, unit, qty, cost_price, sell_price, markup_amount, remark)
            VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)");
        foreach ($valid as $idx => $v) {
            $insCq->execute([
                $qid, $iiIds[$idx], $v['show_brand'],
                $v['brand'], $v['model'],
                $v['product_name'], $v['spec'], $v['unit'], $v['qty'],
                $v['sell_price'], $v['sell_price'],
                $v['remark'],
            ]);
        }

        // 5. 开发票（可选覆盖收款账户）
        $invNo = _nextInvoiceNo($pdo);
        $dueDays = max(0, (int) getSetting($pdo, 'invoice_due_days', '7'));
        $issuedAt = date('Y-m-d H:i:s');
        $dueAt = date('Y-m-d 23:59:59', strtotime("+{$dueDays} days"));
        $bankName = (string) ($input['bank_name'] ?? '');
        $bankNo = (string) ($input['bank_account_no'] ?? '');
        $bankHolder = (string) ($input['bank_account_name'] ?? '');
        $bankSwift = (string) ($input['bank_swift'] ?? '');
        $pdo->prepare("UPDATE customer_quotes
            SET invoice_no = ?, invoice_issued_at = ?, invoice_due_at = ?,
                invoice_bank_name = ?, invoice_bank_account_no = ?,
                invoice_bank_account_name = ?, invoice_bank_swift = ?,
                updated_at = datetime('now','localtime')
            WHERE id = ?")
            ->execute([
                $invNo, $issuedAt, $dueAt,
                $bankName, $bankNo, $bankHolder, $bankSwift,
                $qid,
            ]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        jsonError('生成失败：' . $e->getMessage(), 500);
    }

    opLog($pdo, 'customer_quote', $qid, 'quick_create_invoice', $invNo, (int) $user['id']);
    jsonOk([
        'quote_id' => $qid,
        'quote_no' => $cqNo,
        'invoice_no' => $invNo,
        'invoice_due_at' => $dueAt,
        'total' => $total,
    ]);
}

function _nextInvoiceNo(PDO $pdo): string
{
    $prefix = trim((string) getSetting($pdo, 'invoice_no_prefix', 'INV')) ?: 'INV';
    $datePart = date('Ymd');
    $like = $prefix . $datePart . '%';
    $st = $pdo->prepare("SELECT invoice_no FROM customer_quotes
        WHERE invoice_no LIKE ? ORDER BY invoice_no DESC LIMIT 1");
    $st->execute([$like]);
    $last = (string) $st->fetchColumn();
    $seq = 1;
    if ($last !== '') {
        $tail = substr($last, strlen($prefix . $datePart));
        $seq = (int) $tail + 1;
    }
    return $prefix . $datePart . str_pad((string) $seq, 3, '0', STR_PAD_LEFT);
}

function handle_issueInvoice(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('请指定报价单');
    $st = $pdo->prepare("SELECT * FROM customer_quotes WHERE id = ?");
    $st->execute([$id]);
    $q = $st->fetch();
    if (!$q) jsonError('报价单不存在', 404);

    // 已开过就直接返回原发票号（幂等），但允许更新银行账户快照
    $alreadyIssued = !empty($q['invoice_no']);

    // 可选覆盖收款账户（不传则用系统默认，留空快照即可）
    $bankName = (string) ($input['bank_name'] ?? '');
    $bankNo = (string) ($input['bank_account_no'] ?? '');
    $bankHolder = (string) ($input['bank_account_name'] ?? '');
    $bankSwift = (string) ($input['bank_swift'] ?? '');

    if ($alreadyIssued) {
        // 已开过，仅更新银行账户字段（如果传了）
        if ($bankName !== '' || $bankNo !== '' || $bankHolder !== '' || $bankSwift !== '') {
            $pdo->prepare("UPDATE customer_quotes
                SET invoice_bank_name = ?, invoice_bank_account_no = ?,
                    invoice_bank_account_name = ?, invoice_bank_swift = ?,
                    updated_at = datetime('now','localtime')
                WHERE id = ?")->execute([$bankName, $bankNo, $bankHolder, $bankSwift, $id]);
            opLog($pdo, 'customer_quote', $id, 'update_invoice_bank', $bankName . '/' . $bankNo, (int) $user['id']);
        }
        jsonOk([
            'invoice_no' => $q['invoice_no'],
            'invoice_issued_at' => $q['invoice_issued_at'],
            'invoice_due_at' => $q['invoice_due_at'],
            'already_issued' => true,
        ]);
        return;
    }

    $no = _nextInvoiceNo($pdo);
    $dueDays = max(0, (int) getSetting($pdo, 'invoice_due_days', '7'));
    $issuedAt = date('Y-m-d H:i:s');
    $dueAt = date('Y-m-d 23:59:59', strtotime("+{$dueDays} days"));

    $pdo->prepare("UPDATE customer_quotes
        SET invoice_no = ?, invoice_issued_at = ?, invoice_due_at = ?,
            invoice_bank_name = ?, invoice_bank_account_no = ?,
            invoice_bank_account_name = ?, invoice_bank_swift = ?,
            updated_at = datetime('now','localtime')
        WHERE id = ?")->execute([
            $no, $issuedAt, $dueAt,
            $bankName, $bankNo, $bankHolder, $bankSwift,
            $id,
        ]);

    opLog($pdo, 'customer_quote', $id, 'issue_invoice', $no, (int) $user['id']);
    jsonOk([
        'invoice_no' => $no,
        'invoice_issued_at' => $issuedAt,
        'invoice_due_at' => $dueAt,
    ]);
}

function handle_markInvoicePaid(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('请指定报价单');
    $paid = !empty($input['paid']);
    $pdo->prepare("UPDATE customer_quotes SET paid_at = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        ->execute([$paid ? date('Y-m-d H:i:s') : null, $id]);
    opLog($pdo, 'customer_quote', $id, $paid ? 'mark_paid' : 'unmark_paid', '', (int) $user['id']);
    jsonOk();
}

function handle_listQuoteFollowLogs(PDO $pdo, array $input): void
{
    $qid = (int) ($input['quote_id'] ?? 0);
    if (!$qid) jsonError('请指定报价单');
    $st = $pdo->prepare("SELECT * FROM quote_follow_logs WHERE quote_id = ? ORDER BY id DESC");
    $st->execute([$qid]);
    jsonOk(['items' => $st->fetchAll()]);
}

function handle_addQuoteFollowLog(PDO $pdo, array $input, array $user): void
{
    $qid = (int) ($input['quote_id'] ?? 0);
    $content = trim((string) ($input['content'] ?? ''));
    if (!$qid) jsonError('请指定报价单');
    if ($content === '') jsonError('跟进内容不能为空');
    if (mb_strlen($content) > 2000) jsonError('内容过长（最多 2000 字）');
    $st = $pdo->prepare("INSERT INTO quote_follow_logs (quote_id, user_id, user_name, content) VALUES (?, ?, ?, ?)");
    $st->execute([
        $qid,
        (int) ($user['id'] ?? 0),
        (string) ($user['name'] ?? ''),
        $content,
    ]);
    jsonOk(['id' => (int) $pdo->lastInsertId()]);
}

function handle_deleteQuoteFollowLog(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $st = $pdo->prepare("SELECT user_id FROM quote_follow_logs WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('记录不存在', 404);
    // 只允许本人或 admin 删除
    if ((int) $row['user_id'] !== (int) ($user['id'] ?? 0) && ($user['role'] ?? '') !== 'admin') {
        jsonError('无权删除他人的跟进记录', 403);
    }
    $pdo->prepare("DELETE FROM quote_follow_logs WHERE id = ?")->execute([$id]);
    jsonOk();
}

function handle_listCustomerQuotes(PDO $pdo, array $input): void
{
    $where = 'q.id IS NOT NULL';
    $params = [];
    if (!empty($input['customer_id'])) {
        $where .= " AND q.customer_id = ?";
        $params[] = (int) $input['customer_id'];
    }
    if (!empty($input['inquiry_id'])) {
        $where .= " AND q.inquiry_id = ?";
        $params[] = (int) $input['inquiry_id'];
    }
    if (!empty($input['status'])) {
        $where .= " AND q.status = ?";
        $params[] = $input['status'];
    }
    if (!empty($input['keyword'])) {
        $kw = '%' . trim((string) $input['keyword']) . '%';
        $where .= " AND (q.no LIKE ? OR c.name LIKE ? OR c.short_name LIKE ?
                        OR c.code LIKE ? OR c.company LIKE ? OR c.phone LIKE ?)";
        for ($i = 0; $i < 6; $i++) $params[] = $kw;
    }
    $page = pageInt($input['page'] ?? 1, 1);
    $size = pageInt($input['page_size'] ?? 20, 20, 1, 200);
    $sql = "SELECT q.*, c.name as customer_name, c.short_name as customer_short_name,
                   c.code as customer_code, c.company as customer_company, c.phone as customer_phone
            FROM customer_quotes q
            LEFT JOIN customers c ON c.id = q.customer_id
            WHERE {$where} ORDER BY q.id DESC";
    $countSql = "SELECT COUNT(*) FROM customer_quotes q LEFT JOIN customers c ON c.id = q.customer_id WHERE {$where}";
    jsonOk(paginate($pdo, $sql, $params, $page, $size, $countSql));
}

function handle_getCustomerQuote(PDO $pdo, array $input): void
{
    jsonOk(['data' => _loadCustomerQuote($pdo, (int) ($input['id'] ?? 0))]);
}

function handle_buildCustomerQuote(PDO $pdo, array $input, array $user): void
{
    $iid = (int) ($input['inquiry_id'] ?? 0);
    if (!$iid) jsonError('请指定询价单');
    $st = $pdo->prepare("SELECT * FROM inquiries WHERE id = ?");
    $st->execute([$iid]);
    $inq = $st->fetch();
    if (!$inq) jsonError('询价单不存在', 404);

    $items = $input['items'] ?? [];
    if (!is_array($items) || empty($items)) jsonError('请至少选择一行');
    $strategy = $input['markup'] ?? ['type' => 'flat_pct', 'value' => (float) getSetting($pdo, 'default_markup_pct', '15')];

    $hideDefault = getSettingBool($pdo, 'hide_supplier_brand_default', true);

    // 询价明细
    $st = $pdo->prepare("SELECT * FROM inquiry_items WHERE inquiry_id = ?");
    $st->execute([$iid]);
    $inqItems = [];
    foreach ($st->fetchAll() as $it) $inqItems[(int) $it['id']] = $it;

    // 来源供应商行
    $srcIds = array_filter(array_map(fn ($x) => (int) ($x['source_supplier_quote_item_id'] ?? 0), $items));
    $srcMap = [];
    if ($srcIds) {
        $ph = implode(',', array_fill(0, count($srcIds), '?'));
        $st = $pdo->prepare("SELECT * FROM supplier_quote_items WHERE id IN ({$ph})");
        $st->execute(array_values($srcIds));
        foreach ($st->fetchAll() as $r) $srcMap[(int) $r['id']] = $r;
    }

    // 准备计算行
    $calcLines = [];
    $lineMeta = [];
    foreach ($items as $li) {
        $iiid = (int) ($li['inquiry_item_id'] ?? 0);
        if (!isset($inqItems[$iiid])) jsonError("明细 {$iiid} 不属于该询价单");
        $src = isset($li['source_supplier_quote_item_id']) ? ($srcMap[(int) $li['source_supplier_quote_item_id']] ?? null) : null;
        $cost = isset($li['cost_price']) && $li['cost_price'] !== '' ? (float) $li['cost_price']
              : ($src ? (float) $src['supplier_price'] : 0.0);
        $qty = isset($li['qty']) && $li['qty'] !== '' ? (float) $li['qty'] : (float) $inqItems[$iiid]['qty'];
        $calcLines[] = [
            'inquiry_item_id' => $iiid,
            'cost_price' => $cost,
            'qty' => $qty,
            'sell_price_override' => $li['sell_price_override'] ?? null,
        ];
        $showBrand = isset($li['show_brand']) ? (bool) $li['show_brand'] : !$hideDefault;
        $lineMeta[] = [
            'source_id' => $src['id'] ?? null,
            'show_brand' => $showBrand ? 1 : 0,
            'brand_display' => (string) ($li['brand_display'] ?? ($src && $showBrand ? $src['brand'] : '')),
            'model_display' => (string) ($li['model_display'] ?? ($src && $showBrand ? $src['model'] : '')),
            'product_name' => (string) ($li['product_name'] ?? $inqItems[$iiid]['product_name']),
            'spec' => (string) ($li['spec'] ?? $inqItems[$iiid]['spec']),
            'unit' => (string) ($li['unit'] ?? $inqItems[$iiid]['unit']),
            'qty' => $qty,
            'remark' => (string) ($li['remark'] ?? ''),
            'inquiry_item_id' => $iiid,
        ];
    }

    $total = applyMarkup($calcLines, $strategy);

    $validUntil = $input['valid_until'] ?? null;
    if (!$validUntil) {
        $days = max(1, (int) getSetting($pdo, 'default_quote_valid_days', '7'));
        $validUntil = date('Y-m-d H:i:s', strtotime("+{$days} days"));
    }

    // 货币/税点：直接沿用询价单（销售派单前已统一定）
    $taxIncluded = (int) ($inq['tax_included'] ?? 1);
    $taxRate = (float) ($inq['tax_rate'] ?? 0.11);
    $currency = strtoupper((string) ($inq['currency'] ?? 'IDR'));
    if (!in_array($currency, ['IDR', 'CNY'], true)) $currency = 'IDR';

    $productionCycle = (string) ($input['production_cycle'] ?? '');
    $no = nextCustomerQuoteNo($pdo);
    $st = $pdo->prepare("INSERT INTO customer_quotes
        (no, inquiry_id, customer_id, status, markup_strategy, total, valid_until, remark, created_by, tax_included, tax_rate, currency, production_cycle)
        VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $st->execute([
        $no,
        $iid,
        (int) $inq['customer_id'],
        json_encode($strategy, JSON_UNESCAPED_UNICODE),
        $total,
        $validUntil,
        (string) ($input['remark'] ?? ''),
        (int) $user['id'],
        $taxIncluded,
        $taxRate,
        $currency,
        $productionCycle,
    ]);
    $qid = (int) $pdo->lastInsertId();

    $insLine = $pdo->prepare("INSERT INTO customer_quote_items
        (quote_id, inquiry_item_id, source_supplier_quote_item_id, show_brand, brand_display, model_display,
         product_name, spec, unit, qty, cost_price, sell_price, markup_amount, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    foreach ($calcLines as $i => $cl) {
        $m = $lineMeta[$i];
        $insLine->execute([
            $qid,
            $cl['inquiry_item_id'],
            $m['source_id'],
            $m['show_brand'],
            $m['brand_display'],
            $m['model_display'],
            $m['product_name'],
            $m['spec'],
            $m['unit'],
            $cl['qty'],
            $cl['cost_price'],
            $cl['sell_price'],
            $cl['markup_amount'],
            $m['remark'],
        ]);
    }

    if (in_array($inq['status'], ['dispatching', 'quoted'], true)) {
        $pdo->prepare("UPDATE inquiries SET status='quoted', updated_at=datetime('now','localtime') WHERE id = ?")
            ->execute([$iid]);
    }
    opLog($pdo, 'customer_quote', $qid, 'build', $no, (int) $user['id']);
    jsonOk(['id' => $qid, 'no' => $no, 'total' => $total]);
}

function handle_updateQuoteTerms(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $sets = [];
    $params = [];
    foreach (['production_cycle', 'valid_until', 'remark'] as $f) {
        if (array_key_exists($f, $input)) {
            $sets[] = "{$f} = ?";
            $params[] = $input[$f];
        }
    }
    if (empty($sets)) jsonError('无字段更新');
    $sets[] = "updated_at = datetime('now','localtime')";
    $params[] = $id;
    $pdo->prepare("UPDATE customer_quotes SET " . implode(',', $sets) . " WHERE id = ?")->execute($params);
    opLog($pdo, 'customer_quote', $id, 'update_terms', '', (int) $user['id']);
    jsonOk();
}

function handle_sendCustomerQuote(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $row = _loadCustomerQuote($pdo, $id);
    $pdo->prepare("UPDATE customer_quotes SET status='sent', sent_at=datetime('now','localtime'),
        updated_at=datetime('now','localtime') WHERE id = ?")->execute([$id]);
    $st = $pdo->prepare("SELECT status FROM inquiries WHERE id = ?");
    $st->execute([(int) $row['inquiry_id']]);
    if ($st->fetchColumn() === 'quoted') {
        $pdo->prepare("UPDATE inquiries SET status='delivered' WHERE id = ?")
            ->execute([(int) $row['inquiry_id']]);
    }
    opLog($pdo, 'customer_quote', $id, 'send', '', (int) $user['id']);
    jsonOk();
}

function handle_deleteCustomerQuote(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    $row = _loadCustomerQuote($pdo, $id);
    if (!in_array($row['status'], ['draft', 'to_review'], true)) {
        jsonError('已发送或确认的报价不能删除');
    }
    $pdo->prepare("DELETE FROM customer_quotes WHERE id = ?")->execute([$id]);
    jsonOk();
}
