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

/**
 * 采纳一家供应商的报价（20260810-13）
 *
 * `reject_others`：是否把同一询价单下【其余】报价标为 `rejected`（未采纳）。
 * 前端确认框里默认勾选，但**可以取消**——业务上会不会分单给多家，代码答不了，
 * 做成可选之后两种业务现实下都是对的（CTO 2026-08-10 裁决）。
 *
 * 为什么其余用 `rejected` 而不是 `void`：没被选中的报价**是有效的、只是没中标**，
 * 标成「作废」是失真的。而且 `void` 会被 `compareInquiry` 过滤掉（对比页看不见了），
 * `rejected` 已随本单一起放行。
 *
 * 只动 `submitted` / `adopted` 的，**不碰 `void`** —— 已经作废的就是作废了，
 * 不该因为别人中标而被改写成「未采纳」。
 */
function handle_adoptSupplierQuote(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $row = _loadSupplierQuote($pdo, $id);
    $rejectOthers = !empty($input['reject_others']);
    $inquiryId = (int) $row['inquiry_id'];

    $rejected = 0;
    $pdo->beginTransaction();
    try {
        $pdo->prepare("UPDATE supplier_quotes SET status='adopted' WHERE id = ?")->execute([$id]);
        if ($rejectOthers && $inquiryId > 0) {
            $st = $pdo->prepare("UPDATE supplier_quotes SET status='rejected'
                WHERE inquiry_id = ? AND id <> ? AND status IN ('submitted','adopted')");
            $st->execute([$inquiryId, $id]);
            $rejected = $st->rowCount();
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        jsonError('采纳失败，已回滚：' . $e->getMessage());
    }

    opLog($pdo, 'supplier_quote', $id, 'adopt', $rejected > 0 ? "其余 {$rejected} 家标为未采纳" : '', (int) $user['id']);
    jsonOk(['rejected' => $rejected]);
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
            _setInquiryStatus($pdo, $inquiryId, 'quoted', (int) ($user['id'] ?? 0) ?: null);
        }
    }

    opLog($pdo, 'supplier_quote', $qid, 'internal_submit', $no, (int) $user['id']);
    jsonOk(['id' => $qid, 'no' => $no, 'total' => round($total, 2)]);
}


/**
 * 给指定的几行货品指定供应商（20261116）
 *
 * 场景：客户后来加了货品（钢钉、地毯），这几行没有任何供应商报过价，对比表里选不了供应商；
 * 以及一张清单要分给多家（1~3 行给 A，4~5 行给 B）。原来的「代录入报价」要求整张清单都填价，
 * 等于只能选一家。
 *
 * 做法：只对勾选的行，在这家供应商的报价里新增 / 更新那几行（不动它已有的其它行）。
 * 这家还没有报价就新建一张（派单范围只含这几行）。
 * 如果商机已经有对客报价单：把这几行的供货来源和成本价直接记到报价单上（售价、金额不动）。
 *
 * 输入：inquiry_id, supplier_id, items[{inquiry_item_id, supplier_price, lead_time?, brand?, model?}]
 */
function handle_assignSupplierToItems(PDO $pdo, array $input, array $user): void
{
    $inquiryId = (int) ($input['inquiry_id'] ?? 0);
    $supplierId = (int) ($input['supplier_id'] ?? 0);
    if (!$inquiryId || !$supplierId) jsonError('请选择供应商');
    $st = $pdo->prepare("SELECT * FROM inquiries WHERE id = ?");
    $st->execute([$inquiryId]);
    $inq = $st->fetch();
    if (!$inq) jsonError('商机不存在', 404);
    $st = $pdo->prepare("SELECT id, name FROM suppliers WHERE id = ?");
    $st->execute([$supplierId]);
    $sup = $st->fetch();
    if (!$sup) jsonError('供应商不存在', 404);

    $st = $pdo->prepare("SELECT * FROM inquiry_items WHERE inquiry_id = ?");
    $st->execute([$inquiryId]);
    $inqItems = [];
    foreach ($st->fetchAll() as $r) $inqItems[(int) $r['id']] = $r;

    $rows = [];
    foreach ((array) ($input['items'] ?? []) as $it) {
        $iiid = (int) ($it['inquiry_item_id'] ?? 0);
        if (!isset($inqItems[$iiid])) continue;
        $price = (float) ($it['supplier_price'] ?? 0);
        if ($price <= 0) jsonError("「{$inqItems[$iiid]['product_name']}」还没填成本价");
        $rows[$iiid] = [
            'price' => $price,
            'lead_time' => trim((string) ($it['lead_time'] ?? '')),
            'brand' => trim((string) ($it['brand'] ?? '')),
            'model' => trim((string) ($it['model'] ?? '')),
        ];
    }
    if (!$rows) jsonError('请至少勾选一行货品');

    $pdo->beginTransaction();
    try {
        // 派单：没有就建一条（已回报），范围只含这次勾选的行；有且是按行派的，把新行补进范围
        $st = $pdo->prepare("SELECT * FROM dispatches WHERE inquiry_id = ? AND supplier_id = ?");
        $st->execute([$inquiryId, $supplierId]);
        $dispatch = $st->fetch();
        $insScope = $pdo->prepare("INSERT OR IGNORE INTO dispatch_items (dispatch_id, inquiry_item_id) VALUES (?, ?)");
        if (!$dispatch) {
            $pdo->prepare("INSERT INTO dispatches (inquiry_id, supplier_id, token, status, sent_at, responded_at)
                VALUES (?, ?, ?, 'responded', datetime('now','localtime'), datetime('now','localtime'))")
                ->execute([$inquiryId, $supplierId, genShareToken()]);
            $dispatchId = (int) $pdo->lastInsertId();
            foreach (array_keys($rows) as $iiid) $insScope->execute([$dispatchId, $iiid]);
        } else {
            $dispatchId = (int) $dispatch['id'];
            $cnt = $pdo->prepare("SELECT COUNT(*) FROM dispatch_items WHERE dispatch_id = ?");
            $cnt->execute([$dispatchId]);
            if ((int) $cnt->fetchColumn() > 0) {
                foreach (array_keys($rows) as $iiid) $insScope->execute([$dispatchId, $iiid]);
            }
            $pdo->prepare("UPDATE dispatches SET status = 'responded', responded_at = COALESCE(responded_at, datetime('now','localtime')) WHERE id = ?")
                ->execute([$dispatchId]);
        }

        // 这家的报价单：有就往里加 / 改行，没有就新建
        $st = $pdo->prepare("SELECT * FROM supplier_quotes WHERE dispatch_id = ? AND status IN ('submitted','adopted','rejected') ORDER BY id DESC LIMIT 1");
        $st->execute([$dispatchId]);
        $sq = $st->fetch();
        if ($sq) {
            $sqid = (int) $sq['id'];
        } else {
            $pdo->prepare("INSERT INTO supplier_quotes
                (no, dispatch_id, supplier_id, inquiry_id, status, remark, total, tax_included, tax_rate, currency)
                VALUES (?, ?, ?, ?, 'submitted', '后台指定供应商', 0, ?, ?, ?)")
                ->execute([nextSupplierQuoteNo($pdo), $dispatchId, $supplierId, $inquiryId,
                    (int) $inq['tax_included'], (float) $inq['tax_rate'], (string) $inq['currency']]);
            $sqid = (int) $pdo->lastInsertId();
        }

        $find = $pdo->prepare("SELECT id FROM supplier_quote_items WHERE quote_id = ? AND inquiry_item_id = ? ORDER BY id DESC LIMIT 1");
        $upd = $pdo->prepare("UPDATE supplier_quote_items SET supplier_price = ?, qty = ?, unit = ?, lead_time = CASE WHEN ? != '' THEN ? ELSE lead_time END,
            brand = CASE WHEN ? != '' THEN ? ELSE brand END, model = CASE WHEN ? != '' THEN ? ELSE model END WHERE id = ?");
        $ins = $pdo->prepare("INSERT INTO supplier_quote_items (quote_id, inquiry_item_id, brand, model, spec, supplier_price, qty, unit, lead_time, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '后台指定供应商')");
        $lineIds = [];
        foreach ($rows as $iiid => $r) {
            $ii = $inqItems[$iiid];
            $find->execute([$sqid, $iiid]);
            $lid = (int) $find->fetchColumn();
            if ($lid) {
                $upd->execute([$r['price'], (float) $ii['qty'], (string) $ii['unit'], $r['lead_time'], $r['lead_time'],
                    $r['brand'], $r['brand'], $r['model'], $r['model'], $lid]);
            } else {
                $ins->execute([$sqid, $iiid, $r['brand'], $r['model'], (string) $ii['spec'], $r['price'], (float) $ii['qty'], (string) $ii['unit'], $r['lead_time']]);
                $lid = (int) $pdo->lastInsertId();
            }
            $lineIds[$iiid] = $lid;
        }
        $pdo->prepare("UPDATE supplier_quotes SET total = (SELECT COALESCE(SUM(supplier_price * qty), 0) FROM supplier_quote_items WHERE quote_id = ?) WHERE id = ?")
            ->execute([$sqid, $sqid]);

        // 已有对客报价单：把这几行的供货来源 + 成本价直接记上去（售价、金额不动）
        $linked = 0;
        $quoteNo = '';
        $st = $pdo->prepare("SELECT id, no FROM customer_quotes WHERE inquiry_id = ? ORDER BY id DESC");
        $st->execute([$inquiryId]);
        $cqs = $st->fetchAll();
        if (count($cqs) === 1) {
            $quoteNo = (string) $cqs[0]['no'];
            $lk = $pdo->prepare("UPDATE customer_quote_items SET source_supplier_quote_item_id = ?, cost_price = ?, markup_amount = sell_price - ?
                WHERE quote_id = ? AND inquiry_item_id = ?");
            foreach ($rows as $iiid => $r) {
                $lk->execute([$lineIds[$iiid], $r['price'], $r['price'], (int) $cqs[0]['id'], $iiid]);
                $linked += $lk->rowCount();
            }
            if ($linked) {
                $bd = _quoteSupplierBreakdown($pdo, (int) $cqs[0]['id']);
                $pdo->prepare("UPDATE orders SET supplier_name = ? WHERE quote_id = ?")->execute([_supplierSummaryText($bd), (int) $cqs[0]['id']]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    opLog($pdo, 'supplier_quote', $sqid, 'assign_items', "{$sup['name']} " . count($rows) . ' 行', (int) $user['id']);
    jsonOk(['supplier_quote_id' => $sqid, 'count' => count($rows), 'line_ids' => $lineIds, 'linked_quote_rows' => $linked, 'quote_no' => $quoteNo]);
}
