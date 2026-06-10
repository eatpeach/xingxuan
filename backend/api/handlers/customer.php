<?php

function handle_listCustomers(PDO $pdo, array $input): void
{
    $kw = trim((string) ($input['keyword'] ?? ''));
    $page = pageInt($input['page'] ?? 1, 1);
    $size = pageInt($input['page_size'] ?? 20, 20, 1, 200);

    $where = 'c.id IS NOT NULL';
    $params = [];
    if ($kw !== '') {
        $where .= " AND (c.name LIKE ? OR c.phone LIKE ? OR c.company LIKE ? OR c.short_name LIKE ? OR c.code LIKE ?)";
        $like = "%{$kw}%";
        $params = [$like, $like, $like, $like, $like];
    }
    // 聚合：每个客户的报价数、最新报价金额、最高已成交订单金额
    $sql = "SELECT c.*,
                   (SELECT COUNT(*) FROM customer_quotes q WHERE q.customer_id = c.id) AS quote_count,
                   (SELECT q.total FROM customer_quotes q WHERE q.customer_id = c.id ORDER BY q.id DESC LIMIT 1) AS latest_quote_total,
                   (SELECT q.currency FROM customer_quotes q WHERE q.customer_id = c.id ORDER BY q.id DESC LIMIT 1) AS latest_quote_currency,
                   (SELECT COALESCE(SUM(q.total), 0) FROM customer_quotes q WHERE q.customer_id = c.id) AS total_quoted,
                   (SELECT COUNT(*) FROM customer_quotes q WHERE q.customer_id = c.id AND q.deal_status = 'won') AS won_count,
                   (SELECT COALESCE(SUM(q.total), 0) FROM customer_quotes q WHERE q.customer_id = c.id AND q.deal_status = 'won') AS won_amount
            FROM customers c
            WHERE {$where}
            ORDER BY c.id DESC";
    $countSql = "SELECT COUNT(*) FROM customers c WHERE {$where}";
    jsonOk(paginate($pdo, $sql, $params, $page, $size, $countSql));
}

function handle_getCustomer(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT * FROM customers WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('客户不存在', 404);
    jsonOk(['data' => $row]);
}

function handle_createCustomer(PDO $pdo, array $input, array $user): void
{
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') jsonError('姓名不能为空');

    $code = nextCustomerCode($pdo);
    $shortName = trim((string) ($input['short_name'] ?? ''));
    if ($shortName === '') $shortName = $name;

    $st = $pdo->prepare("INSERT INTO customers
        (code, name, short_name, company, phone, email, wechat, address, source, sales_id, remark, material_needs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $st->execute([
        $code,
        $name,
        $shortName,
        (string) ($input['company'] ?? ''),
        (string) ($input['phone'] ?? ''),
        (string) ($input['email'] ?? ''),
        (string) ($input['wechat'] ?? ''),
        (string) ($input['address'] ?? ''),
        (string) ($input['source'] ?? ''),
        (int) ($input['sales_id'] ?? $user['id']),
        (string) ($input['remark'] ?? ''),
        (string) ($input['material_needs'] ?? ''),
    ]);
    $cid = (int) $pdo->lastInsertId();
    opLog($pdo, 'customer', $cid, 'create', "{$code} {$name}", (int) $user['id']);

    // 快速报价：勾选「已报价」时直接建一条简化询价 + 报价记录
    $quotedAmount = (float) ($input['quoted_amount'] ?? 0);
    if (!empty($input['has_quoted']) && $quotedAmount > 0) {
        $currency = strtoupper((string) ($input['quoted_currency'] ?? 'IDR'));
        if (!in_array($currency, ['IDR', 'CNY'], true)) $currency = 'IDR';
        $quotedRemark = (string) ($input['quoted_remark'] ?? '');
        $now = date('Y-m-d H:i:s');

        // 1) 询价
        $inqNo = nextInquiryNo($pdo);
        $pdo->prepare("INSERT INTO inquiries
            (no, customer_id, title, status, remark, created_by, currency, created_at, updated_at)
            VALUES (?, ?, ?, 'quoted', ?, ?, ?, ?, ?)")
            ->execute([$inqNo, $cid, '直接口头报价', '客户登记时直接报价', (int) $user['id'], $currency, $now, $now]);
        $iid = (int) $pdo->lastInsertId();

        $pdo->prepare("INSERT INTO inquiry_items
            (inquiry_id, line_no, product_name, spec, unit, qty, remark)
            VALUES (?, 1, ?, '', '式', 1, ?)")
            ->execute([$iid, $quotedRemark ?: '直接报价', $quotedRemark]);
        $iiid = (int) $pdo->lastInsertId();

        // 2) 报价
        $cqNo = nextCustomerQuoteNo($pdo);
        $validUntil = date('Y-m-d 23:59:59', strtotime('+7 days'));
        $pdo->prepare("INSERT INTO customer_quotes
            (no, inquiry_id, customer_id, status, markup_strategy, total, valid_until, remark, created_by, currency, created_at, updated_at)
            VALUES (?, ?, ?, 'sent', ?, ?, ?, ?, ?, ?, ?, ?)")
            ->execute([
                $cqNo, $iid, $cid,
                json_encode(['type' => 'casual'], JSON_UNESCAPED_UNICODE),
                $quotedAmount, $validUntil, $quotedRemark,
                (int) $user['id'], $currency, $now, $now,
            ]);
        $qid = (int) $pdo->lastInsertId();

        $pdo->prepare("INSERT INTO customer_quote_items
            (quote_id, inquiry_item_id, source_supplier_quote_item_id, show_brand, brand_display, model_display,
             product_name, spec, unit, qty, cost_price, sell_price, markup_amount, remark)
            VALUES (?, ?, NULL, 1, '', '', ?, '', '式', 1, ?, ?, 0, ?)")
            ->execute([$qid, $iiid, '直接报价', $quotedAmount, $quotedAmount, $quotedRemark]);

        opLog($pdo, 'customer_quote', $qid, 'casual_quote_on_create', $cqNo, (int) $user['id']);
        jsonOk(['id' => $cid, 'code' => $code, 'quote_id' => $qid, 'quote_no' => $cqNo]);
        return;
    }

    jsonOk(['id' => $cid, 'code' => $code]);
}

function handle_updateCustomer(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT id FROM customers WHERE id = ?");
    $st->execute([$id]);
    if (!$st->fetchColumn()) jsonError('客户不存在', 404);

    $name = (string) ($input['name'] ?? '');
    $shortName = trim((string) ($input['short_name'] ?? ''));
    if ($shortName === '') $shortName = $name;

    $st = $pdo->prepare("UPDATE customers SET
        name=?, short_name=?, company=?, phone=?, email=?, wechat=?, address=?, source=?, sales_id=?, remark=?, material_needs=?,
        updated_at=datetime('now','localtime')
        WHERE id = ?");
    $st->execute([
        $name,
        $shortName,
        (string) ($input['company'] ?? ''),
        (string) ($input['phone'] ?? ''),
        (string) ($input['email'] ?? ''),
        (string) ($input['wechat'] ?? ''),
        (string) ($input['address'] ?? ''),
        (string) ($input['source'] ?? ''),
        (int) ($input['sales_id'] ?? 0) ?: null,
        (string) ($input['remark'] ?? ''),
        (string) ($input['material_needs'] ?? ''),
        $id,
    ]);
    jsonOk(['id' => $id]);
}

function handle_deleteCustomer(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    $pdo->prepare("DELETE FROM customers WHERE id = ?")->execute([$id]);
    jsonOk();
}
