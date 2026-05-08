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
    $where = '1=1';
    $params = [];
    if (!empty($input['customer_id'])) {
        $where .= " AND customer_id = ?";
        $params[] = (int) $input['customer_id'];
    }
    if (!empty($input['inquiry_id'])) {
        $where .= " AND inquiry_id = ?";
        $params[] = (int) $input['inquiry_id'];
    }
    if (!empty($input['status'])) {
        $where .= " AND status = ?";
        $params[] = $input['status'];
    }
    $page = pageInt($input['page'] ?? 1, 1);
    $size = pageInt($input['page_size'] ?? 20, 20, 1, 200);
    $sql = "SELECT * FROM customer_quotes WHERE {$where} ORDER BY id DESC";
    $countSql = "SELECT COUNT(*) FROM customer_quotes WHERE {$where}";
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

    $no = nextCustomerQuoteNo($pdo);
    $st = $pdo->prepare("INSERT INTO customer_quotes
        (no, inquiry_id, customer_id, status, markup_strategy, total, valid_until, remark, created_by, tax_included, tax_rate, currency)
        VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)");
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
