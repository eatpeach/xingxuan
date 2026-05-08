<?php

function _loadInquiry(PDO $pdo, int $id, bool $withItems = true): array
{
    $st = $pdo->prepare("SELECT * FROM inquiries WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('询价单不存在', 404);
    if ($withItems) {
        $st = $pdo->prepare("SELECT * FROM inquiry_items WHERE inquiry_id = ? ORDER BY line_no ASC, id ASC");
        $st->execute([$id]);
        $row['items'] = $st->fetchAll();
    }
    return $row;
}

function _replaceInquiryItems(PDO $pdo, int $inquiryId, array $items): void
{
    $pdo->prepare("DELETE FROM inquiry_items WHERE inquiry_id = ?")->execute([$inquiryId]);
    $st = $pdo->prepare("INSERT INTO inquiry_items
        (inquiry_id, line_no, product_name, spec, unit, qty, target_price, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    foreach (array_values($items) as $i => $it) {
        $st->execute([
            $inquiryId,
            (int) ($it['line_no'] ?? ($i + 1)),
            (string) ($it['product_name'] ?? ''),
            (string) ($it['spec'] ?? ''),
            (string) ($it['unit'] ?? '件'),
            (float) ($it['qty'] ?? 1),
            isset($it['target_price']) && $it['target_price'] !== '' ? (float) $it['target_price'] : null,
            (string) ($it['remark'] ?? ''),
        ]);
    }
}

function handle_listInquiries(PDO $pdo, array $input): void
{
    $kw = trim((string) ($input['keyword'] ?? ''));
    $status = trim((string) ($input['status'] ?? ''));
    $cid = (int) ($input['customer_id'] ?? 0);
    $page = pageInt($input['page'] ?? 1, 1);
    $size = pageInt($input['page_size'] ?? 20, 20, 1, 200);

    $where = '1=1';
    $params = [];
    if ($kw !== '') {
        $where .= " AND (no LIKE ? OR title LIKE ?)";
        $like = "%{$kw}%";
        $params = [$like, $like];
    }
    if ($status !== '') {
        $where .= " AND status = ?";
        $params[] = $status;
    }
    if ($cid > 0) {
        $where .= " AND customer_id = ?";
        $params[] = $cid;
    }
    $sql = "SELECT i.*, c.name AS customer_name FROM inquiries i
            LEFT JOIN customers c ON c.id = i.customer_id
            WHERE {$where} ORDER BY i.id DESC";
    $countSql = "SELECT COUNT(*) FROM inquiries WHERE {$where}";
    jsonOk(paginate($pdo, $sql, $params, $page, $size, $countSql));
}

function handle_getInquiry(PDO $pdo, array $input): void
{
    $row = _loadInquiry($pdo, (int) ($input['id'] ?? 0), true);
    jsonOk(['data' => $row]);
}

function handle_createInquiry(PDO $pdo, array $input, array $user): void
{
    $cid = (int) ($input['customer_id'] ?? 0);
    if ($cid <= 0) jsonError('请选择客户');
    $st = $pdo->prepare("SELECT id FROM customers WHERE id = ?");
    $st->execute([$cid]);
    if (!$st->fetchColumn()) jsonError('客户不存在');

    $items = $input['items'] ?? [];
    if (!is_array($items) || empty($items)) jsonError('明细不能为空');

    $taxIncluded = isset($input['tax_included']) ? (int) (bool) $input['tax_included'] : 1;
    $taxRate = isset($input['tax_rate']) ? (float) $input['tax_rate'] : 0.11;
    $currency = strtoupper((string) ($input['currency'] ?? 'IDR'));
    if (!in_array($currency, ['IDR', 'CNY'], true)) $currency = 'IDR';

    $no = nextInquiryNo($pdo);
    $st = $pdo->prepare("INSERT INTO inquiries
        (no, customer_id, title, status, deadline, remark, created_by, tax_included, tax_rate, currency)
        VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)");
    $st->execute([
        $no,
        $cid,
        (string) ($input['title'] ?? ''),
        $input['deadline'] ?? null,
        (string) ($input['remark'] ?? ''),
        (int) $user['id'],
        $taxIncluded,
        $taxRate,
        $currency,
    ]);
    $id = (int) $pdo->lastInsertId();
    _replaceInquiryItems($pdo, $id, $items);
    opLog($pdo, 'inquiry', $id, 'create', $no, (int) $user['id']);
    jsonOk(['id' => $id, 'no' => $no]);
}

function handle_updateInquiry(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $row = _loadInquiry($pdo, $id, false);
    if (!in_array($row['status'], ['draft', 'to_dispatch'], true)) {
        jsonError('当前状态不允许修改');
    }
    $taxIncluded = isset($input['tax_included']) ? (int) (bool) $input['tax_included'] : (int) $row['tax_included'];
    $taxRate = isset($input['tax_rate']) ? (float) $input['tax_rate'] : (float) $row['tax_rate'];
    $currency = strtoupper((string) ($input['currency'] ?? $row['currency']));
    if (!in_array($currency, ['IDR', 'CNY'], true)) $currency = 'IDR';

    $st = $pdo->prepare("UPDATE inquiries SET customer_id=?, title=?, deadline=?, remark=?,
        tax_included=?, tax_rate=?, currency=?,
        updated_at=datetime('now','localtime') WHERE id = ?");
    $st->execute([
        (int) ($input['customer_id'] ?? $row['customer_id']),
        (string) ($input['title'] ?? ''),
        $input['deadline'] ?? null,
        (string) ($input['remark'] ?? ''),
        $taxIncluded,
        $taxRate,
        $currency,
        $id,
    ]);
    if (isset($input['items']) && is_array($input['items'])) {
        _replaceInquiryItems($pdo, $id, $input['items']);
    }
    opLog($pdo, 'inquiry', $id, 'update', '', (int) $user['id']);
    jsonOk(['id' => $id]);
}

function handle_deleteInquiry(PDO $pdo, array $input): void
{
    $pdo->prepare("DELETE FROM inquiries WHERE id = ?")->execute([(int) ($input['id'] ?? 0)]);
    jsonOk();
}

function handle_exportInquiryExcel(PDO $pdo, array $input): void
{
    $iid = (int) ($input['id'] ?? 0);
    if (!$iid) jsonError('请指定询价单');

    $st = $pdo->prepare("SELECT i.*, c.name as customer_name, c.company as customer_company, c.code as customer_code
                         FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id
                         WHERE i.id = ?");
    $st->execute([$iid]);
    $inq = $st->fetch();
    if (!$inq) jsonError('询价单不存在', 404);

    $st = $pdo->prepare("SELECT * FROM inquiry_items WHERE inquiry_id = ? ORDER BY line_no ASC, id ASC");
    $st->execute([$iid]);
    $items = $st->fetchAll();

    $currency = $inq['currency'] ?: 'IDR';
    $sym = $currency === 'CNY' ? '¥' : 'Rp';
    $curName = $currency === 'CNY' ? '人民币' : '印尼盾';
    $taxLabel = ((int) $inq['tax_included']) ? '含税' : '不含税';
    $taxPct = (float) $inq['tax_rate'] * 100;

    $filename = '询价_' . $inq['no'] . '_' . date('Ymd') . '.csv';

    // 抢在 jsonOk / 默认 Content-Type 之前重置 header
    if (function_exists('header_remove')) header_remove();
    while (ob_get_level()) ob_end_clean();
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . rawurlencode($filename) . '"');
    header('Cache-Control: no-cache, no-store, must-revalidate');

    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM，让 Excel 直接识别中文

    fputcsv($out, ['询价单号', $inq['no']]);
    fputcsv($out, ['标题', $inq['title']]);
    fputcsv($out, ['客户', trim(($inq['customer_name'] ?? '') . ($inq['customer_company'] ? ' / ' . $inq['customer_company'] : ''))]);
    fputcsv($out, ['货币', $currency . '（' . $curName . '）']);
    fputcsv($out, ['报价口径', $taxLabel . '，VAT ' . rtrim(rtrim(number_format($taxPct, 2, '.', ''), '0'), '.') . '%']);
    if (!empty($inq['deadline'])) fputcsv($out, ['报价截止', $inq['deadline']]);
    if (!empty($inq['remark'])) fputcsv($out, ['备注', $inq['remark']]);
    fputcsv($out, []);

    fputcsv($out, ['序号', '产品名', '规格', '需求数量', '单位', '品牌', '型号', "单价({$sym})", '货期', '备注']);
    foreach ($items as $it) {
        fputcsv($out, [
            $it['line_no'],
            $it['product_name'],
            $it['spec'],
            $it['qty'],
            $it['unit'],
            '',
            '',
            '',
            '',
            '',
        ]);
    }
    fputcsv($out, []);
    fputcsv($out, ['', '', '', '', '', '', '', '合计', '']);
    fputcsv($out, ['说明', '请在「品牌/型号/单价/货期/备注」列填写报价；填完发回销售。']);
    fclose($out);
    exit;
}

function handle_dispatchInquiry(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $row = _loadInquiry($pdo, $id, true);
    if (empty($row['items'])) jsonError('询价单无明细，无法派单');

    $supplierIds = $input['supplier_ids'] ?? [];
    if (!is_array($supplierIds) || empty($supplierIds)) jsonError('请选择供应商');
    $expireDays = max(1, (int) ($input['expire_days'] ?? 7));

    $st = $pdo->prepare("SELECT supplier_id FROM dispatches WHERE inquiry_id = ?");
    $st->execute([$id]);
    $existing = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));

    $created = [];
    $ins = $pdo->prepare("INSERT INTO dispatches
        (inquiry_id, supplier_id, token, token_expire_at, status, sent_at)
        VALUES (?, ?, ?, datetime('now','localtime','+{$expireDays} days'), 'sent', datetime('now','localtime'))");
    $supExist = $pdo->prepare("SELECT id FROM suppliers WHERE id = ?");
    foreach ($supplierIds as $sid) {
        $sid = (int) $sid;
        if ($sid <= 0 || in_array($sid, $existing, true)) continue;
        $supExist->execute([$sid]);
        if (!$supExist->fetchColumn()) continue;
        $token = genShareToken();
        $ins->execute([$id, $sid, $token]);
        $created[] = ['id' => (int) $pdo->lastInsertId(), 'supplier_id' => $sid, 'token' => $token];
    }

    if (in_array($row['status'], ['draft', 'to_dispatch'], true)) {
        $pdo->prepare("UPDATE inquiries SET status='dispatching', updated_at=datetime('now','localtime') WHERE id = ?")
            ->execute([$id]);
    }
    opLog($pdo, 'inquiry', $id, 'dispatch', '派给 ' . count($created) . ' 个供应商', (int) $user['id']);
    jsonOk(['created' => $created]);
}

function handle_listDispatches(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT d.*, s.name AS supplier_name
        FROM dispatches d LEFT JOIN suppliers s ON s.id = d.supplier_id
        WHERE d.inquiry_id = ? ORDER BY d.id ASC");
    $st->execute([$id]);
    jsonOk(['items' => $st->fetchAll()]);
}

function handle_shareLinks(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    $base = rtrim((string) ($input['public_base'] ?? ''), '/');
    if ($base === '') {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $base = "{$scheme}://{$host}";
    }
    $st = $pdo->prepare("SELECT d.*, s.name AS supplier_name
        FROM dispatches d LEFT JOIN suppliers s ON s.id = d.supplier_id
        WHERE d.inquiry_id = ?");
    $st->execute([$id]);
    $rows = $st->fetchAll();
    $out = array_map(function ($d) use ($base) {
        return [
            'dispatch_id' => (int) $d['id'],
            'supplier_id' => (int) $d['supplier_id'],
            'supplier_name' => $d['supplier_name'],
            'url' => "{$base}/p/quote/{$d['token']}",
            'expire_at' => $d['token_expire_at'],
            'status' => $d['status'],
        ];
    }, $rows);
    jsonOk(['items' => $out]);
}

function handle_compareInquiry(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    $row = _loadInquiry($pdo, $id, true);

    $st = $pdo->prepare("SELECT q.*, s.name AS supplier_name FROM supplier_quotes q
        LEFT JOIN suppliers s ON s.id = q.supplier_id
        WHERE q.inquiry_id = ? AND q.status IN ('submitted','adopted')");
    $st->execute([$id]);
    $quotes = $st->fetchAll();

    $itemsMap = [];
    if ($quotes) {
        $ids = array_column($quotes, 'id');
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT * FROM supplier_quote_items WHERE quote_id IN ({$ph})");
        $st->execute($ids);
        foreach ($st->fetchAll() as $qi) {
            $itemsMap[(int) $qi['quote_id']][] = $qi;
        }
    }

    $rows = [];
    foreach ($row['items'] as $it) {
        $offers = [];
        foreach ($quotes as $q) {
            foreach (($itemsMap[(int) $q['id']] ?? []) as $qi) {
                if ((int) $qi['inquiry_item_id'] === (int) $it['id']) {
                    $offers[] = [
                        'supplier_quote_item_id' => (int) $qi['id'],
                        'supplier_quote_id' => (int) $q['id'],
                        'supplier_id' => (int) $q['supplier_id'],
                        'supplier_name' => $q['supplier_name'],
                        'brand' => $qi['brand'],
                        'model' => $qi['model'],
                        'spec' => $qi['spec'],
                        'supplier_price' => (float) $qi['supplier_price'],
                        'lead_time' => $qi['lead_time'],
                        'remark' => $qi['remark'],
                    ];
                }
            }
        }
        $rows[] = [
            'inquiry_item_id' => (int) $it['id'],
            'line_no' => (int) $it['line_no'],
            'product_name' => $it['product_name'],
            'spec' => $it['spec'],
            'qty' => (float) $it['qty'],
            'unit' => $it['unit'],
            'target_price' => $it['target_price'] !== null ? (float) $it['target_price'] : null,
            'offers' => $offers,
        ];
    }
    jsonOk(['inquiry_id' => $id, 'rows' => $rows]);
}

function handle_uploadInquiryAttachment(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $st = $pdo->prepare("SELECT id FROM inquiries WHERE id = ?");
    $st->execute([$id]);
    if (!$st->fetchColumn()) jsonError('询价单不存在', 404);
    if (empty($_FILES['file'])) jsonError('未上传文件');

    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败');

    $dir = __DIR__ . '/../../storage/inquiry';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $safe = preg_replace('/[\\/\\\\]/', '_', $f['name']);
    $rel = 'inquiry/' . date('YmdHis') . '_' . $safe;
    $abs = __DIR__ . '/../../storage/' . $rel;
    if (!move_uploaded_file($f['tmp_name'], $abs)) jsonError('保存文件失败');

    $st = $pdo->prepare("INSERT INTO inquiry_attachments (inquiry_id, filename, file_path, size) VALUES (?, ?, ?, ?)");
    $st->execute([$id, $f['name'], $rel, (int) ($f['size'] ?? 0)]);
    jsonOk(['id' => (int) $pdo->lastInsertId(), 'filename' => $f['name'], 'file_path' => $rel]);
}
