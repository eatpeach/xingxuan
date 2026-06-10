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
    $id = (int) $pdo->lastInsertId();
    opLog($pdo, 'customer', $id, 'create', "{$code} {$name}", (int) $user['id']);
    jsonOk(['id' => $id, 'code' => $code]);
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
