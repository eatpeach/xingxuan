<?php

function _loadDispatchByToken(PDO $pdo, string $token): array
{
    $st = $pdo->prepare("SELECT * FROM dispatches WHERE token = ?");
    $st->execute([$token]);
    $d = $st->fetch();
    if (!$d) jsonError('链接无效', 404);
    if ($d['status'] === 'void') jsonError('链接已作废', 410);
    if ($d['token_expire_at']) {
        $exp = strtotime($d['token_expire_at']);
        if ($exp && $exp < time()) jsonError('链接已过期', 410);
    }
    return $d;
}

function handle_publicGetInquiry(PDO $pdo, array $input): void
{
    $token = (string) ($input['token'] ?? '');
    if (!$token) jsonError('缺少 token');
    $d = _loadDispatchByToken($pdo, $token);

    $st = $pdo->prepare("SELECT id, no, title, remark, deadline FROM inquiries WHERE id = ?");
    $st->execute([(int) $d['inquiry_id']]);
    $inq = $st->fetch();

    $st = $pdo->prepare("SELECT id, line_no, product_name, spec, unit, qty, remark
        FROM inquiry_items WHERE inquiry_id = ? ORDER BY line_no ASC, id ASC");
    $st->execute([(int) $d['inquiry_id']]);
    $items = $st->fetchAll();

    $st = $pdo->prepare("SELECT id, name FROM suppliers WHERE id = ?");
    $st->execute([(int) $d['supplier_id']]);
    $sup = $st->fetch();

    // 已经提交过且未被采纳的报价 - 允许编辑
    $st = $pdo->prepare("SELECT * FROM supplier_quotes WHERE dispatch_id = ? ORDER BY id DESC LIMIT 1");
    $st->execute([(int) $d['id']]);
    $existing = $st->fetch();
    if ($existing) {
        $st = $pdo->prepare("SELECT * FROM supplier_quote_items WHERE quote_id = ?");
        $st->execute([(int) $existing['id']]);
        $existing['items'] = $st->fetchAll();
    }

    jsonOk([
        'supplier' => $sup,
        'inquiry' => array_merge($inq ?: [], ['items' => $items]),
        'existing_quote' => $existing ?: null,
    ]);
}

function handle_publicSubmitQuote(PDO $pdo, array $input): void
{
    $token = (string) ($input['token'] ?? '');
    if (!$token) jsonError('缺少 token');
    $d = _loadDispatchByToken($pdo, $token);

    $items = $input['items'] ?? [];
    if (!is_array($items) || empty($items)) jsonError('请填写报价明细');

    // 校验明细 id 属于该询价单
    $st = $pdo->prepare("SELECT id FROM inquiry_items WHERE inquiry_id = ?");
    $st->execute([(int) $d['inquiry_id']]);
    $allowed = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));

    // 已有未被采纳的报价：删旧建新（保号）
    $st = $pdo->prepare("SELECT id, no FROM supplier_quotes WHERE dispatch_id = ? AND status != 'adopted' ORDER BY id DESC LIMIT 1");
    $st->execute([(int) $d['id']]);
    $old = $st->fetch();
    if ($old) {
        $no = $old['no'];
        $pdo->prepare("DELETE FROM supplier_quotes WHERE id = ?")->execute([(int) $old['id']]);
    } else {
        $no = nextSupplierQuoteNo($pdo);
    }

    $total = 0.0;
    $st = $pdo->prepare("INSERT INTO supplier_quotes
        (no, dispatch_id, supplier_id, inquiry_id, status, remark, valid_until, total)
        VALUES (?, ?, ?, ?, 'submitted', ?, ?, 0)");
    $st->execute([
        $no,
        (int) $d['id'],
        (int) $d['supplier_id'],
        (int) $d['inquiry_id'],
        (string) ($input['remark'] ?? ''),
        $input['valid_until'] ?? null,
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

    $pdo->prepare("UPDATE dispatches SET status='responded', responded_at=datetime('now','localtime') WHERE id = ?")
        ->execute([(int) $d['id']]);

    // 是否所有派单都已回报
    $remain = $pdo->prepare("SELECT COUNT(*) FROM dispatches WHERE inquiry_id = ? AND status IN ('pending','sent')");
    $remain->execute([(int) $d['inquiry_id']]);
    if ((int) $remain->fetchColumn() === 0) {
        $st = $pdo->prepare("SELECT status FROM inquiries WHERE id = ?");
        $st->execute([(int) $d['inquiry_id']]);
        if ($st->fetchColumn() === 'dispatching') {
            $pdo->prepare("UPDATE inquiries SET status='quoted' WHERE id = ?")
                ->execute([(int) $d['inquiry_id']]);
        }
    }

    opLog($pdo, 'supplier_quote', $qid, 'submit', $no, null, "supplier:{$d['supplier_id']}");
    jsonOk(['id' => $qid, 'no' => $no, 'total' => round($total, 2)]);
}
