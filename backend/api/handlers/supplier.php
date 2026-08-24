<?php

function handle_listSuppliers(PDO $pdo, array $input): void
{
    $kw = trim((string) ($input['keyword'] ?? ''));
    $cat = trim((string) ($input['category'] ?? ''));
    $page = pageInt($input['page'] ?? 1, 1);
    $size = pageInt($input['page_size'] ?? 20, 20, 1, 200);

    $where = '1=1';
    $params = [];
    if ($kw !== '') {
        $where .= " AND (name LIKE ? OR contact LIKE ? OR phone LIKE ? OR code LIKE ?)";
        $like = "%{$kw}%";
        $params = [$like, $like, $like, $like];
    }
    if ($cat !== '') {
        $where .= " AND category = ?";
        $params[] = $cat;
    }
    $sql = "SELECT * FROM suppliers WHERE {$where} ORDER BY id DESC";
    $countSql = "SELECT COUNT(*) FROM suppliers WHERE {$where}";
    $ret = paginate($pdo, $sql, $params, $page, $size, $countSql);
    // 列表里只说「密码可不可查」，不把一整页明文密码发出去；
    // 真要看走 getSupplierCredential，那条路会记日志
    foreach ($ret['items'] as &$r) {
        $r['pwd_viewable'] = trim((string) ($r['initial_pwd'] ?? '')) !== '' ? 1 : 0;
        unset($r['password_hash'], $r['initial_pwd']);
    }
    unset($r);
    jsonOk($ret);
}

function handle_getSupplier(PDO $pdo, array $input): void
{
    $st = $pdo->prepare("SELECT * FROM suppliers WHERE id = ?");
    $st->execute([(int) ($input['id'] ?? 0)]);
    $row = $st->fetch();
    if (!$row) jsonError('供应商不存在', 404);
    // 明文密码只从 getSupplierCredential 出（那条路有 admin 校验 + 查看留痕）
    $row['pwd_viewable'] = trim((string) ($row['initial_pwd'] ?? '')) !== '' ? 1 : 0;
    unset($row['password_hash'], $row['initial_pwd']);
    jsonOk(['data' => $row]);
}

function handle_createSupplier(PDO $pdo, array $input): void
{
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') jsonError('供应商名称不能为空');
    $st = $pdo->prepare("INSERT INTO suppliers
        (code, name, contact, phone, email, category, rating, is_active, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $st->execute([
        nextSupplierCode($pdo),
        $name,
        (string) ($input['contact'] ?? ''),
        (string) ($input['phone'] ?? ''),
        (string) ($input['email'] ?? ''),
        (string) ($input['category'] ?? ''),
        (int) ($input['rating'] ?? 0),
        !empty($input['is_active']) ? 1 : 0,
        (string) ($input['remark'] ?? ''),
    ]);
    jsonOk(['id' => (int) $pdo->lastInsertId()]);
}

function handle_updateSupplier(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT id FROM suppliers WHERE id = ?");
    $st->execute([$id]);
    if (!$st->fetchColumn()) jsonError('供应商不存在', 404);

    $st = $pdo->prepare("UPDATE suppliers SET
        name=?, contact=?, phone=?, email=?, category=?, rating=?, is_active=?, remark=?,
        updated_at=datetime('now','localtime')
        WHERE id = ?");
    $st->execute([
        (string) ($input['name'] ?? ''),
        (string) ($input['contact'] ?? ''),
        (string) ($input['phone'] ?? ''),
        (string) ($input['email'] ?? ''),
        (string) ($input['category'] ?? ''),
        (int) ($input['rating'] ?? 0),
        !empty($input['is_active']) ? 1 : 0,
        (string) ($input['remark'] ?? ''),
        $id,
    ]);
    jsonOk(['id' => $id]);
}

function handle_deleteSupplier(PDO $pdo, array $input): void
{
    $pdo->prepare("DELETE FROM suppliers WHERE id = ?")->execute([(int) ($input['id'] ?? 0)]);
    jsonOk();
}
