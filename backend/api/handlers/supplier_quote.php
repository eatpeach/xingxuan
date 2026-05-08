<?php

function _loadSupplierQuote(PDO $pdo, int $id): array
{
    $st = $pdo->prepare("SELECT q.*, s.name AS supplier_name FROM supplier_quotes q
        LEFT JOIN suppliers s ON s.id = q.supplier_id WHERE q.id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('报价单不存在', 404);
    $st = $pdo->prepare("SELECT * FROM supplier_quote_items WHERE quote_id = ? ORDER BY id ASC");
    $st->execute([$id]);
    $row['items'] = $st->fetchAll();
    return $row;
}

function handle_listSupplierQuotes(PDO $pdo, array $input): void
{
    $where = '1=1';
    $params = [];
    if (!empty($input['inquiry_id'])) {
        $where .= " AND q.inquiry_id = ?";
        $params[] = (int) $input['inquiry_id'];
    }
    if (!empty($input['supplier_id'])) {
        $where .= " AND q.supplier_id = ?";
        $params[] = (int) $input['supplier_id'];
    }
    if (!empty($input['status'])) {
        $where .= " AND q.status = ?";
        $params[] = $input['status'];
    }
    $page = pageInt($input['page'] ?? 1, 1);
    $size = pageInt($input['page_size'] ?? 20, 20, 1, 200);
    $sql = "SELECT q.*, s.name AS supplier_name FROM supplier_quotes q
            LEFT JOIN suppliers s ON s.id = q.supplier_id
            WHERE {$where} ORDER BY q.id DESC";
    $countSql = "SELECT COUNT(*) FROM supplier_quotes q WHERE {$where}";
    jsonOk(paginate($pdo, $sql, $params, $page, $size, $countSql));
}

function handle_getSupplierQuote(PDO $pdo, array $input): void
{
    jsonOk(['data' => _loadSupplierQuote($pdo, (int) ($input['id'] ?? 0))]);
}

function handle_adoptSupplierQuote(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    _loadSupplierQuote($pdo, $id);
    $pdo->prepare("UPDATE supplier_quotes SET status='adopted' WHERE id = ?")->execute([$id]);
    opLog($pdo, 'supplier_quote', $id, 'adopt', '', (int) $user['id']);
    jsonOk();
}

function handle_voidSupplierQuote(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    _loadSupplierQuote($pdo, $id);
    $pdo->prepare("UPDATE supplier_quotes SET status='void' WHERE id = ?")->execute([$id]);
    opLog($pdo, 'supplier_quote', $id, 'void', '', (int) $user['id']);
    jsonOk();
}
