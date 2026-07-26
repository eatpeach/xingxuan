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
    foreach ($ret['items'] as &$r) unset($r['password_hash']);
    unset($r);
    jsonOk($ret);
}

function handle_getSupplier(PDO $pdo, array $input): void
{
    $st = $pdo->prepare("SELECT * FROM suppliers WHERE id = ?");
    $st->execute([(int) ($input['id'] ?? 0)]);
    $row = $st->fetch();
    if (!$row) jsonError('供应商不存在', 404);
    unset($row['password_hash']);
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
