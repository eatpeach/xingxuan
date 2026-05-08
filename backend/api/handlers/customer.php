<?php

function handle_listCustomers(PDO $pdo, array $input): void
{
    $kw = trim((string) ($input['keyword'] ?? ''));
    $page = pageInt($input['page'] ?? 1, 1);
    $size = pageInt($input['page_size'] ?? 20, 20, 1, 200);

    $where = '1=1';
    $params = [];
    if ($kw !== '') {
        $where .= " AND (name LIKE ? OR phone LIKE ? OR company LIKE ?)";
        $like = "%{$kw}%";
        $params = [$like, $like, $like];
    }
    $sql = "SELECT * FROM customers WHERE {$where} ORDER BY id DESC";
    $countSql = "SELECT COUNT(*) FROM customers WHERE {$where}";
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
        (code, name, short_name, company, phone, email, wechat, address, source, sales_id, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
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
        name=?, short_name=?, company=?, phone=?, email=?, wechat=?, address=?, source=?, sales_id=?, remark=?,
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
