<?php

function _loadInquiry(PDO $pdo, int $id, bool $withItems = true): array
{
    $st = $pdo->prepare("SELECT i.*, c.name AS customer_name, c.short_name AS customer_short_name,
                                c.code AS customer_code, c.company AS customer_company
                         FROM inquiries i
                         LEFT JOIN customers c ON c.id = i.customer_id
                         WHERE i.id = ?");
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
    $pool = trim((string) ($input['pool'] ?? ''));
    $cid = (int) ($input['customer_id'] ?? 0);
    $page = pageInt($input['page'] ?? 1, 1);
    $size = pageInt($input['page_size'] ?? 20, 20, 1, 200);

    $where = '1=1';
    $params = [];
    if ($kw !== '') {
        // 支持按 群编号/客户名/简称 搜索
        $where .= " AND (i.no LIKE ? OR i.title LIKE ? OR c.code LIKE ? OR c.name LIKE ? OR c.short_name LIKE ?)";
        $like = "%{$kw}%";
        $params = [$like, $like, $like, $like, $like];
    }
    if ($status !== '') {
        $where .= " AND i.status = ?";
        $params[] = $status;
    }
    if ($cid > 0) {
        $where .= " AND i.customer_id = ?";
        $params[] = $cid;
    }
    if (in_array($pool, ['private', 'public', 'lost'], true)) {
        // 存量行 pool 为 NULL/'' 时按私海处理
        if ($pool === 'private') {
            $where .= " AND COALESCE(NULLIF(i.pool, ''), 'private') = 'private'";
        } else {
            $where .= " AND i.pool = ?";
            $params[] = $pool;
        }
    }
    $sql = "SELECT i.*, c.name AS customer_name, c.short_name AS customer_short_name, c.code AS customer_code,
                   u.name AS creator_name, u.username AS creator_username,
                   uo.name AS owner_name, uo.username AS owner_username,
                   (SELECT COUNT(*) FROM inquiry_items t WHERE t.inquiry_id = i.id) AS items_count,
                   (SELECT q.total FROM customer_quotes q WHERE q.inquiry_id = i.id ORDER BY q.id DESC LIMIT 1) AS latest_quote_total,
                   (SELECT q.currency FROM customer_quotes q WHERE q.inquiry_id = i.id ORDER BY q.id DESC LIMIT 1) AS latest_quote_currency,
                   -- 报价生命周期（20260810-12）：列表里要看得见状态、发送时间、有没有过期。
                   -- 沿用上面两行的相关子查询写法（同一张表、同一个 ORDER BY，索引走一样的路），
                   -- 没有改成 JOIN 派生表——那要动已有的两行，收益不抵风险。
                   (SELECT q.status FROM customer_quotes q WHERE q.inquiry_id = i.id ORDER BY q.id DESC LIMIT 1) AS latest_quote_status,
                   (SELECT q.sent_at FROM customer_quotes q WHERE q.inquiry_id = i.id ORDER BY q.id DESC LIMIT 1) AS latest_quote_sent_at,
                   (SELECT q.valid_until FROM customer_quotes q WHERE q.inquiry_id = i.id ORDER BY q.id DESC LIMIT 1) AS latest_quote_valid_until,
                   (SELECT q.deal_status FROM customer_quotes q WHERE q.inquiry_id = i.id ORDER BY q.id DESC LIMIT 1) AS latest_quote_deal_status
            FROM inquiries i
            LEFT JOIN customers c ON c.id = i.customer_id
            LEFT JOIN users u ON u.id = i.created_by
            LEFT JOIN users uo ON uo.id = i.owner_id
            WHERE {$where} ORDER BY i.id DESC";
    $countSql = "SELECT COUNT(*) FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id WHERE {$where}";
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

    // 税点 / 币种改了，直接同步到已生成的对客报价单。
    // 打印页的净额、税额、价税合计都是按 tax_included + tax_rate 实时算的（QuotePrint/InvoicePrint），
    // 所以同步这几列就够了，不需要重新生成报价——重新生成会先删旧报价，
    // 而 orders.quote_id 是 ON DELETE CASCADE，会连带删掉订单/收款/返佣（20260808-05 号单），
    // 有订单的单子因此被硬拦，导致「改了税点却改不动报价单和发票」这个死循环。
    $taxChanged = $taxIncluded !== (int) $row['tax_included']
        || abs($taxRate - (float) $row['tax_rate']) > 1e-9
        || $currency !== strtoupper((string) $row['currency']);
    $syncedQuotes = 0;
    if ($taxChanged) {
        $up = $pdo->prepare("UPDATE customer_quotes SET tax_included=?, tax_rate=?, currency=?,
            updated_at=datetime('now','localtime') WHERE inquiry_id = ?");
        $up->execute([$taxIncluded, $taxRate, $currency, $id]);
        $syncedQuotes = $up->rowCount();
        // 订单币种跟着走，免得财务页和报价单显示的货币对不上
        $pdo->prepare("UPDATE orders SET currency = ? WHERE quote_id IN
            (SELECT id FROM customer_quotes WHERE inquiry_id = ?)")->execute([$currency, $id]);
        opLog($pdo, 'inquiry', $id, 'sync_tax_to_quotes', "含税={$taxIncluded} 税率={$taxRate} {$currency} → {$syncedQuotes} 张报价", (int) $user['id']);
    }

    opLog($pdo, 'inquiry', $id, 'update', '', (int) $user['id']);
    jsonOk(['id' => $id, 'synced_quotes' => $syncedQuotes]);
}

// 编辑基础信息（名称/截止/备注），任意状态可改
function handle_updateInquiryBasic(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $row = _loadInquiry($pdo, $id, false);

    // 税点 / 币种也放在这里改：handle_updateInquiry 只允许 draft/to_dispatch 状态动，
    // 但税点填错往往是开票时才发现的，那时商机早过了那两个状态，
    // 不放开就只能作废订单重来（05 号单的硬拦），代价太大。
    $taxIncluded = isset($input['tax_included']) ? (int) (bool) $input['tax_included'] : (int) $row['tax_included'];
    $taxRate = isset($input['tax_rate']) ? (float) $input['tax_rate'] : (float) $row['tax_rate'];
    $currency = strtoupper((string) ($input['currency'] ?? $row['currency']));
    if (!in_array($currency, ['IDR', 'CNY'], true)) $currency = 'IDR';

    $st = $pdo->prepare("UPDATE inquiries SET title=?, deadline=?, remark=?,
        tax_included=?, tax_rate=?, currency=?,
        updated_at=datetime('now','localtime') WHERE id = ?");
    $st->execute([
        (string) ($input['title'] ?? ''),
        $input['deadline'] ?? null,
        (string) ($input['remark'] ?? ''),
        $taxIncluded,
        $taxRate,
        $currency,
        $id,
    ]);

    // 同步到已生成的报价单（打印页按这几列实时算税额，不必重新生成报价）
    $taxChanged = $taxIncluded !== (int) $row['tax_included']
        || abs($taxRate - (float) $row['tax_rate']) > 1e-9
        || $currency !== strtoupper((string) $row['currency']);
    $syncedQuotes = 0;
    if ($taxChanged) {
        $up = $pdo->prepare("UPDATE customer_quotes SET tax_included=?, tax_rate=?, currency=?,
            updated_at=datetime('now','localtime') WHERE inquiry_id = ?");
        $up->execute([$taxIncluded, $taxRate, $currency, $id]);
        $syncedQuotes = $up->rowCount();
        $pdo->prepare("UPDATE orders SET currency = ? WHERE quote_id IN
            (SELECT id FROM customer_quotes WHERE inquiry_id = ?)")->execute([$currency, $id]);
        opLog($pdo, 'inquiry', $id, 'sync_tax_to_quotes', "含税={$taxIncluded} 税率={$taxRate} {$currency} → {$syncedQuotes} 张报价", (int) $user['id']);
    }

    opLog($pdo, 'inquiry', $id, 'update_basic', '', (int) $user['id']);
    jsonOk(['id' => $id, 'synced_quotes' => $syncedQuotes]);
}

// 交付流程信息（收货信息/生产排期/预计交付/备注）
function handle_saveInquiryDelivery(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    _loadInquiry($pdo, $id, false);
    $st = $pdo->prepare("UPDATE inquiries SET delivery_receiver=?, delivery_schedule=?,
        delivery_expected_at=?, delivery_remark=?, updated_at=datetime('now','localtime') WHERE id = ?");
    $st->execute([
        (string) ($input['delivery_receiver'] ?? ''),
        (string) ($input['delivery_schedule'] ?? ''),
        $input['delivery_expected_at'] ?? null,
        (string) ($input['delivery_remark'] ?? ''),
        $id,
    ]);
    opLog($pdo, 'inquiry', $id, 'save_delivery', '', (int) $user['id']);
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
    $taxPctRaw = (float) $inq['tax_rate'] * 100;
    $taxPct = rtrim(rtrim(number_format($taxPctRaw, 2, '.', ''), '0'), '.');

    $companyName = getSetting($pdo, 'company_name', '星选建材');

    require_once __DIR__ . '/../../includes/xlsx.php';
    $b = new XlsxBuilder('询价单');
    // 列宽（10 列）：序号 / 产品名 / 规格 / 数量 / 单位 / 品牌 / 型号 / 单价 / 货期 / 备注
    $colWidths = [6, 28, 26, 10, 8, 16, 18, 14, 12, 22];
    $b->setColWidths($colWidths);

    // 标题（合并 A1:J1）
    $title = "{$companyName}  询价单  {$inq['no']}";
    $b->mergeRange('A1:J1', $title, XlsxBuilder::S_TITLE, 36);

    // 元信息块（两列 K-V，跨 A:J）
    $customerName = trim(($inq['customer_name'] ?? '') . ($inq['customer_company'] ? ' / ' . $inq['customer_company'] : ''));
    $createdDate = !empty($inq['created_at']) ? substr($inq['created_at'], 0, 10) : date('Y-m-d');

    $metaPairs = [
        ['询价单号', $inq['no']],
        ['创建日期', $createdDate],
        ['标题', (string) $inq['title']],
        ['客户', $customerName ?: '-'],
        ['货币', "{$currency}（{$curName}） {$sym}"],
        ['报价口径', "{$taxLabel}，VAT {$taxPct}%"],
    ];
    if (!empty($inq['deadline'])) {
        $metaPairs[] = ['报价截止', $inq['deadline']];
    }
    if (!empty($inq['remark'])) {
        $metaPairs[] = ['备注', $inq['remark']];
    }

    // 元信息每行：A=key, B:E=value(merged), F=key, G:J=value(merged)；备注等长内容单独占一行 A=k, B:J=v
    // 把内容长的 / 含换行的（如备注、标题）单独一行铺满
    $shortPairs = [];
    $longPairs = [];
    foreach ($metaPairs as $pair) {
        $isLong = mb_strlen((string) $pair[1], 'UTF-8') > 30 || strpos((string) $pair[1], "\n") !== false;
        if ($isLong) $longPairs[] = $pair;
        else $shortPairs[] = $pair;
    }

    $widthBE = $colWidths[1] + $colWidths[2] + $colWidths[3] + $colWidths[4];
    $widthGJ = $colWidths[5] + $colWidths[6] + $colWidths[7] + $colWidths[8] + $colWidths[9];
    $widthBJ = $widthBE + $widthGJ;

    $i = 0;
    while ($i < count($shortPairs)) {
        $left = $shortPairs[$i];
        $right = $shortPairs[$i + 1] ?? null;
        if ($right) {
            $cells = [
                ['val' => $left[0], 'style' => XlsxBuilder::S_META_K],
                ['val' => $left[1], 'style' => XlsxBuilder::S_META_V],
                ['val' => '', 'style' => XlsxBuilder::S_META_V],
                ['val' => '', 'style' => XlsxBuilder::S_META_V],
                ['val' => '', 'style' => XlsxBuilder::S_META_V],
                ['val' => $right[0], 'style' => XlsxBuilder::S_META_K],
                ['val' => $right[1], 'style' => XlsxBuilder::S_META_V],
                ['val' => '', 'style' => XlsxBuilder::S_META_V],
                ['val' => '', 'style' => XlsxBuilder::S_META_V],
                ['val' => '', 'style' => XlsxBuilder::S_META_V],
            ];
            $lL = _xlsxEstimateLines((string) $left[1], $widthBE);
            $lR = _xlsxEstimateLines((string) $right[1], $widthGJ);
            $h = max(22, max($lL, $lR) * 16 + 6);
            $b->row($cells, XlsxBuilder::S_DEFAULT, $h);
            $r = _xlsxRowIdx($b);
            _xlsxAddMerge($b, "B{$r}:E{$r}");
            _xlsxAddMerge($b, "G{$r}:J{$r}");
            $i += 2;
        } else {
            $cells = [['val' => $left[0], 'style' => XlsxBuilder::S_META_K]];
            for ($k = 0; $k < 9; $k++) {
                $cells[] = ['val' => $k === 0 ? $left[1] : '', 'style' => XlsxBuilder::S_META_V];
            }
            $lines = _xlsxEstimateLines((string) $left[1], $widthBJ);
            $h = max(22, $lines * 16 + 6);
            $b->row($cells, XlsxBuilder::S_DEFAULT, $h);
            $r = _xlsxRowIdx($b);
            _xlsxAddMerge($b, "B{$r}:J{$r}");
            $i++;
        }
    }
    // 长内容（标题 / 备注 / 长客户）单独成行，A=key + B:J=value
    foreach ($longPairs as $pair) {
        $cells = [['val' => $pair[0], 'style' => XlsxBuilder::S_META_K]];
        for ($k = 0; $k < 9; $k++) {
            $cells[] = ['val' => $k === 0 ? $pair[1] : '', 'style' => XlsxBuilder::S_META_V];
        }
        $lines = _xlsxEstimateLines((string) $pair[1], $widthBJ);
        $h = max(22, $lines * 16 + 6);
        $b->row($cells, XlsxBuilder::S_DEFAULT, $h);
        $r = _xlsxRowIdx($b);
        _xlsxAddMerge($b, "B{$r}:J{$r}");
    }

    // 空行
    $b->emptyRow(8);

    // 表头
    $b->row(
        ['序号', '产品名', '规格', '需求数量', '单位', '品牌', '型号', "单价({$sym})", '货期', '备注'],
        XlsxBuilder::S_HEADER,
        30,
    );

    // 数据行（按内容估算行高，让长规格 / 长产品名一次性展示）
    foreach ($items as $it) {
        $rowVals = [
            (string) $it['line_no'],
            (string) $it['product_name'],
            (string) $it['spec'],
            (string) $it['qty'],
            (string) $it['unit'],
            '', '', '', '', '',
        ];
        $maxLines = 1;
        foreach ($rowVals as $cIdx => $v) {
            if ($v === '') continue;
            $lines = _xlsxEstimateLines($v, $colWidths[$cIdx] ?? 12);
            if ($lines > $maxLines) $maxLines = $lines;
        }
        $rowHeight = max(24, $maxLines * 16 + 6); // 16pt per line + 6pt padding

        $b->row([
            ['val' => (int) $it['line_no'], 'style' => XlsxBuilder::S_DATA_CENTER],
            ['val' => (string) $it['product_name'], 'style' => XlsxBuilder::S_DATA_LEFT],
            ['val' => (string) $it['spec'], 'style' => XlsxBuilder::S_DATA_LEFT],
            ['val' => (float) $it['qty'], 'style' => XlsxBuilder::S_DATA_CENTER],
            ['val' => (string) $it['unit'], 'style' => XlsxBuilder::S_DATA_CENTER],
            ['val' => '', 'style' => XlsxBuilder::S_DATA_CENTER],
            ['val' => '', 'style' => XlsxBuilder::S_DATA_CENTER],
            ['val' => '', 'style' => XlsxBuilder::S_DATA_CENTER],
            ['val' => '', 'style' => XlsxBuilder::S_DATA_CENTER],
            ['val' => '', 'style' => XlsxBuilder::S_DATA_CENTER],
        ], XlsxBuilder::S_DATA_CENTER, $rowHeight);
    }

    // 合计行（A:G 合并显示「合计」，H/I/J 留给供应商）
    $totalCells = [];
    $totalCells[] = ['val' => '合计', 'style' => XlsxBuilder::S_TOTAL];
    for ($k = 0; $k < 6; $k++) $totalCells[] = ['val' => '', 'style' => XlsxBuilder::S_TOTAL];
    $totalCells[] = ['val' => '', 'style' => XlsxBuilder::S_DATA_CENTER];
    $totalCells[] = ['val' => '', 'style' => XlsxBuilder::S_DATA_CENTER];
    $totalCells[] = ['val' => '', 'style' => XlsxBuilder::S_DATA_CENTER];
    $b->row($totalCells, XlsxBuilder::S_TOTAL, 28);
    $r = _xlsxRowIdx($b);
    _xlsxAddMerge($b, "A{$r}:G{$r}");

    // 说明
    $b->emptyRow(6);
    $note1 = '说明：请在「品牌 / 型号 / 单价 / 货期 / 备注」列填写报价，填完发回销售。';
    $note2 = "本次询价使用 {$currency}（{$curName}），单价为{$taxLabel}口径，VAT {$taxPct}%。";
    $b->row([['val' => $note1, 'style' => XlsxBuilder::S_NOTE]]);
    _xlsxAddMerge($b, 'A' . _xlsxRowIdx($b) . ':J' . _xlsxRowIdx($b));
    $b->row([['val' => $note2, 'style' => XlsxBuilder::S_NOTE]]);
    _xlsxAddMerge($b, 'A' . _xlsxRowIdx($b) . ':J' . _xlsxRowIdx($b));

    $filename = '询价_' . $inq['no'] . '_' . date('Ymd') . '.xlsx';
    $b->emit($filename);
    exit;
}

/**
 * 估算字符串在指定列宽（Excel 字符宽度单位）下需要几行
 * CJK 计 2，其他计 1，强制换行(\n)按行切，每行再按宽度向上取整
 */
function _xlsxEstimateLines(string $text, float $colWidth): int
{
    if ($text === '') return 1;
    $segments = preg_split('/\\r?\\n/u', $text) ?: [$text];
    $totalLines = 0;
    foreach ($segments as $seg) {
        $w = 0.0;
        $len = mb_strlen($seg, 'UTF-8');
        for ($i = 0; $i < $len; $i++) {
            $ch = mb_substr($seg, $i, 1, 'UTF-8');
            // 简单判断：码点 > 127 视为宽字符（CJK / 全角）
            $w += (mb_ord($ch, 'UTF-8') > 127) ? 2.0 : 1.0;
        }
        // colWidth 是 Excel 默认字号下 ≈ 字符数，预留一点 padding
        $effective = max(1.0, $colWidth - 1);
        $lines = (int) ceil($w / $effective);
        $totalLines += max(1, $lines);
    }
    return max(1, $totalLines);
}

// XlsxBuilder 内部 rowIdx / merges 是 private，下面两个小辅助通过反射访问，避免改类暴露 setter
function _xlsxRowIdx(XlsxBuilder $b): int
{
    $rp = new ReflectionProperty(XlsxBuilder::class, 'rowIdx');
    $rp->setAccessible(true);
    return (int) $rp->getValue($b);
}
function _xlsxAddMerge(XlsxBuilder $b, string $range): void
{
    $rp = new ReflectionProperty(XlsxBuilder::class, 'merges');
    $rp->setAccessible(true);
    $arr = $rp->getValue($b);
    $arr[] = $range;
    $rp->setValue($b, $arr);
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
        -- rejected（未采纳）也要放行：13 号单让「采纳一条、其余标未采纳」成为常规动作，
        -- 若不放行，采纳的一瞬间其余几家就从对比页消失，销售改主意或想按另一家
        -- 重新生成报价时行都没了。void（作废）仍排除——「作废」的语义就是这条不算数了。
        WHERE q.inquiry_id = ? AND q.status IN ('submitted','adopted','rejected')");
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
    jsonOk([
        'inquiry_id' => $id,
        'rows' => $rows,
        'currency' => strtoupper((string) ($row['currency'] ?? 'IDR')),
    ]);
}

/** 询价附件允许的扩展名 → 落盘时用的扩展名（20260810-14）
 *
 * 口径依据（不是拍脑袋定的）：询价页那个 AI 解析上传口的 accept 就是本项目对
 * 「客户实际会发什么」的回答 —— `Inquiries.tsx:512`：image/*、.pdf、.xlsx、.csv、.txt。
 * 附件是【留存原件】而不是拿去解析，所以在此基础上加了 Word 和老版 Excel（规格书常见）。
 *
 * ⚠ 名单外的一律拒绝。**尤其 html / htm / svg / xml / js**：
 * 它们会在同源以 text/html 渲染 → 存储型 XSS → 偷 localStorage 里的 token（见 _ATTACH_DENY_MIME）。
 */
const _ATTACH_EXT_WHITELIST = [
    'pdf' => 'pdf',
    'jpg' => 'jpg', 'jpeg' => 'jpg', 'png' => 'png', 'webp' => 'webp', 'gif' => 'gif',
    'xlsx' => 'xlsx', 'xls' => 'xls', 'csv' => 'csv',
    'docx' => 'docx', 'doc' => 'doc',
    'txt' => 'txt',
];

/** 无论扩展名叫什么，检测出这些 MIME 一律拒绝 —— 堵「evil.html 改名成 evil.pdf」 */
const _ATTACH_DENY_MIME = [
    'text/html', 'application/xhtml+xml', 'image/svg+xml',
    'text/xml', 'application/xml', 'application/javascript', 'text/javascript',
    'application/x-httpd-php', 'text/x-php',
];

/** 图片扩展名必须真的是图片 —— 这几类 MIME 检测可靠，可以强校验 */
const _ATTACH_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function handle_uploadInquiryAttachment(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $st = $pdo->prepare("SELECT id FROM inquiries WHERE id = ?");
    $st->execute([$id]);
    if (!$st->fetchColumn()) jsonError('询价单不存在', 404);
    if (empty($_FILES['file'])) jsonError('未上传文件');

    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) {
        // 区分「PHP 自己按 ini 拒了」和别的失败，否则用户只看到「上传失败」，
        // 完全不知道是文件太大——而 ini 的上限往往比本函数的 20MB 小得多（见下）。
        if (in_array((int) $f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            jsonError('文件超过服务器允许的上传大小（当前上限 ' . ini_get('upload_max_filesize') . '），请压缩后再传');
        }
        jsonError('上传失败（错误码 ' . (int) $f['error'] . '）');
    }

    // ---------- 1. 大小 ----------
    // 20MB：与本项目已有的最大上限一致（uploadVoucher 20MB、aiParseInquiryFile 20MB），
    // 不额外发明一个数值让用户去猜。图纸类 PDF 常见 5~15MB，够用。
    //
    // ⚠ 这只是【上限的上限】。实际能传多大 = min(post_max_size, upload_max_filesize, 20MB)，
    // 前两个由服务器 php.ini 决定，本函数管不着。本机预检时实测 php.ini 是
    // post_max_size=8M / upload_max_filesize=2M —— 超过 8M 的请求在进入本函数之前
    // 就被 PHP 拒绝了（$_FILES 甚至是空的）。生产的 ini 值需要确认，见本单结论。
    $maxBytes = 20 * 1024 * 1024;
    if ((int) ($f['size'] ?? 0) > $maxBytes) jsonError('附件不能超过 20MB');

    // ---------- 2. 扩展名白名单 ----------
    $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
    if (!isset(_ATTACH_EXT_WHITELIST[$ext])) {
        jsonError('不支持的文件类型。可上传：PDF、图片（JPG/PNG/WebP/GIF）、Excel（xlsx/xls/csv）、Word（docx/doc）、txt');
    }
    $safeExt = _ATTACH_EXT_WHITELIST[$ext];

    // ---------- 3. 内容检测：扩展名可以撒谎，内容不行 ----------
    $mime = _aiDetectMime($f['tmp_name'], (string) $f['name']);
    if (in_array($mime, _ATTACH_DENY_MIME, true)) {
        // 关键一层：把 evil.html 改名成 evil.pdf 也过不去。
        // 这类文件会在同源以 text/html 渲染，是存储型 XSS 的载体，
        // 而 token 存在 localStorage，同源 XSS 直接读得走。
        jsonError('文件内容被识别为网页/脚本类型，出于安全考虑不允许上传');
    }
    if (in_array($safeExt, ['jpg', 'png', 'webp', 'gif'], true)
        && !in_array($mime, _ATTACH_IMAGE_MIME, true)) {
        jsonError('该文件扩展名是图片，但内容不是图片');
    }

    // ---------- 4. 落盘：文件名完全重写，用户输入不参与路径 ----------
    // 原先是 date('YmdHis') . '_' . 用户原名，两个问题：
    //   a) 用户扩展名原样保留（本单要堵的就是这个）
    //   b) 秒级粒度，同一秒传两个同名文件会被 move_uploaded_file 静默覆盖
    // 现在文件名与用户输入无关，路径穿越、同名覆盖、扩展名伪造一并消失。
    // 原始文件名照旧存 DB 的 filename 列，展示用。
    $dir = __DIR__ . '/../../storage/inquiry';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $rel = 'inquiry/' . date('YmdHis') . '_' . bin2hex(random_bytes(6)) . '.' . $safeExt;
    $abs = __DIR__ . '/../../storage/' . $rel;
    if (!move_uploaded_file($f['tmp_name'], $abs)) jsonError('保存文件失败');

    // 原始文件名去掉控制字符并限长，避免脏数据进 DB 影响展示
    $origName = preg_replace('/[\x00-\x1F\x7F]/u', '', (string) $f['name']);
    $origName = mb_substr($origName !== '' ? $origName : ('附件.' . $safeExt), 0, 200);

    $st = $pdo->prepare("INSERT INTO inquiry_attachments (inquiry_id, filename, file_path, size) VALUES (?, ?, ?, ?)");
    $st->execute([$id, $origName, $rel, (int) ($f['size'] ?? 0)]);
    jsonOk(['id' => (int) $pdo->lastInsertId(), 'filename' => $origName, 'file_path' => $rel]);
}

// 商机池流转：私海 private / 公海 public / 已流失 lost
// 移入公海清空负责人；从公海认领回私海时负责人=当前用户；标记流失可带原因
function handle_setInquiryPool(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $pool = trim((string) ($input['pool'] ?? ''));
    if (!$id) jsonError('参数缺失');
    if (!in_array($pool, ['private', 'public', 'lost'], true)) jsonError('pool 取值错误');
    $reason = (string) ($input['reason'] ?? '');
    if (mb_strlen($reason) > 500) jsonError('原因过长（最多 500 字）');

    $st = $pdo->prepare("SELECT id FROM inquiries WHERE id = ?");
    $st->execute([$id]);
    if (!$st->fetch()) jsonError('商机不存在', 404);

    if ($pool === 'public') {
        $pdo->prepare("UPDATE inquiries SET pool='public', owner_id=0,
            updated_at=datetime('now','localtime') WHERE id=?")->execute([$id]);
    } elseif ($pool === 'lost') {
        $pdo->prepare("UPDATE inquiries SET pool='lost', lost_reason=?,
            updated_at=datetime('now','localtime') WHERE id=?")->execute([$reason, $id]);
    } else {
        $pdo->prepare("UPDATE inquiries SET pool='private', owner_id=?, lost_reason='',
            updated_at=datetime('now','localtime') WHERE id=?")
            ->execute([(int) ($user['id'] ?? 0), $id]);
    }
    jsonOk(['pool' => $pool]);
}
