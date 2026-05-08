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

/**
 * 后台代录入供应商报价（销售拿到供应商微信/邮件/Excel 报价后手工录入）
 *
 * 输入：inquiry_id, supplier_id, items[], remark?, valid_until?
 * 行为：
 *   - 如果该 (inquiry_id, supplier_id) 没有 dispatch，自动创建一条 dispatch（status=responded）
 *   - 如果有 dispatch 且已有未采纳的 quote，删旧建新（保号）
 *   - 创建 supplier_quote + items，状态 submitted
 */
function handle_internalSubmitQuote(PDO $pdo, array $input, array $user): void
{
    $inquiryId = (int) ($input['inquiry_id'] ?? 0);
    $supplierId = (int) ($input['supplier_id'] ?? 0);
    if (!$inquiryId || !$supplierId) jsonError('请指定询价单和供应商');

    $st = $pdo->prepare("SELECT id FROM inquiries WHERE id = ?");
    $st->execute([$inquiryId]);
    if (!$st->fetchColumn()) jsonError('询价单不存在', 404);

    $st = $pdo->prepare("SELECT id FROM suppliers WHERE id = ?");
    $st->execute([$supplierId]);
    if (!$st->fetchColumn()) jsonError('供应商不存在', 404);

    $items = $input['items'] ?? [];
    if (!is_array($items) || empty($items)) jsonError('请填写明细');

    // 找/建 dispatch
    $st = $pdo->prepare("SELECT * FROM dispatches WHERE inquiry_id = ? AND supplier_id = ?");
    $st->execute([$inquiryId, $supplierId]);
    $dispatch = $st->fetch();
    if (!$dispatch) {
        $token = genShareToken();
        $st = $pdo->prepare("INSERT INTO dispatches
            (inquiry_id, supplier_id, token, status, sent_at, responded_at)
            VALUES (?, ?, ?, 'responded', datetime('now','localtime'), datetime('now','localtime'))");
        $st->execute([$inquiryId, $supplierId, $token]);
        $dispatchId = (int) $pdo->lastInsertId();
    } else {
        $dispatchId = (int) $dispatch['id'];
        $pdo->prepare("UPDATE dispatches SET status='responded', responded_at=datetime('now','localtime') WHERE id = ?")
            ->execute([$dispatchId]);
    }

    // 校验明细 id 属于该询价单
    $st = $pdo->prepare("SELECT id FROM inquiry_items WHERE inquiry_id = ?");
    $st->execute([$inquiryId]);
    $allowed = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));

    // 已有未采纳的报价：覆盖
    $st = $pdo->prepare("SELECT id, no FROM supplier_quotes WHERE dispatch_id = ? AND status != 'adopted' ORDER BY id DESC LIMIT 1");
    $st->execute([$dispatchId]);
    $old = $st->fetch();
    if ($old) {
        $no = $old['no'];
        $pdo->prepare("DELETE FROM supplier_quotes WHERE id = ?")->execute([(int) $old['id']]);
    } else {
        $no = nextSupplierQuoteNo($pdo);
    }

    // 继承询价单
    $iqs = $pdo->prepare("SELECT tax_included, tax_rate, currency FROM inquiries WHERE id = ?");
    $iqs->execute([$inquiryId]);
    $iqRow = $iqs->fetch() ?: ['tax_included' => 1, 'tax_rate' => 0.11, 'currency' => 'IDR'];
    $taxIncluded = (int) $iqRow['tax_included'];
    $taxRate = (float) $iqRow['tax_rate'];
    $currency = (string) $iqRow['currency'];

    $total = 0.0;
    $st = $pdo->prepare("INSERT INTO supplier_quotes
        (no, dispatch_id, supplier_id, inquiry_id, status, remark, valid_until, total, tax_included, tax_rate, currency)
        VALUES (?, ?, ?, ?, 'submitted', ?, ?, 0, ?, ?, ?)");
    $st->execute([
        $no,
        $dispatchId,
        $supplierId,
        $inquiryId,
        (string) ($input['remark'] ?? ''),
        $input['valid_until'] ?? null,
        $taxIncluded,
        $taxRate,
        $currency,
    ]);
    $qid = (int) $pdo->lastInsertId();

    $insLine = $pdo->prepare("INSERT INTO supplier_quote_items
        (quote_id, inquiry_item_id, brand, model, spec, supplier_price, qty, unit, lead_time, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    foreach ($items as $it) {
        $iiid = (int) ($it['inquiry_item_id'] ?? 0);
        if (!in_array($iiid, $allowed, true)) continue;
        $price = (float) ($it['supplier_price'] ?? 0);
        $qty = (float) ($it['qty'] ?? 1);
        $total += $price * $qty;
        $insLine->execute([
            $qid,
            $iiid,
            (string) ($it['brand'] ?? ''),
            (string) ($it['model'] ?? ''),
            (string) ($it['spec'] ?? ''),
            $price,
            $qty,
            (string) ($it['unit'] ?? '件'),
            (string) ($it['lead_time'] ?? ''),
            (string) ($it['remark'] ?? ''),
        ]);
    }
    $pdo->prepare("UPDATE supplier_quotes SET total = ? WHERE id = ?")->execute([round($total, 2), $qid]);

    // 询价单状态：如果所有派单都已回报，置为 quoted
    $remain = $pdo->prepare("SELECT COUNT(*) FROM dispatches WHERE inquiry_id = ? AND status IN ('pending','sent')");
    $remain->execute([$inquiryId]);
    if ((int) $remain->fetchColumn() === 0) {
        $st = $pdo->prepare("SELECT status FROM inquiries WHERE id = ?");
        $st->execute([$inquiryId]);
        if ($st->fetchColumn() === 'dispatching') {
            $pdo->prepare("UPDATE inquiries SET status='quoted' WHERE id = ?")->execute([$inquiryId]);
        }
    }

    opLog($pdo, 'supplier_quote', $qid, 'internal_submit', $no, (int) $user['id']);
    jsonOk(['id' => $qid, 'no' => $no, 'total' => round($total, 2)]);
}
