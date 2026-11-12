<?php

/**
 * 报价单锁定 + 追加物料（20261112）
 *
 * 报价单一旦提交（发送客户 / 已开单），就锁定：销售不能再直接改、加、删货品。
 * 客户后续要加产品，两条路：
 *   1. 新建商机重新报价
 *   2. 在原报价单上「追加物料」—— 只能加新行、不能动原有行；追加后报价单进「待审批」，
 *      管理员通过后生效，驳回则把这一批撤掉。
 * 管理员仍可直接修改已锁定的报价单（必须写原因，进 quote_revisions），留一条改错的路。
 * 每次追加 / 通过 / 驳回都写 quote_append_logs（库层面只许新增）。
 */

function quoteIsLocked(PDO $pdo, array $q): bool
{
    if (in_array((string) ($q['status'] ?? ''), ['sent', 'confirmed', 'to_review'], true)) return true;
    if (($q['deal_status'] ?? '') === 'won') return true;
    $st = $pdo->prepare("SELECT COUNT(*) FROM orders WHERE quote_id = ?");
    $st->execute([(int) $q['id']]);
    return (int) $st->fetchColumn() > 0;
}

/** 直接改明细前的闸门：锁定的单只有管理员能改；待审批中谁都不能直接改 */
function quoteRequireEditable(PDO $pdo, array $q, array $user): void
{
    if (($q['status'] ?? '') === 'to_review') {
        jsonError('这张报价单有追加物料正在待审批，审批完成后才能修改');
    }
    if (quoteIsLocked($pdo, $q) && ($user['role'] ?? '') !== 'admin') {
        jsonError('报价单已提交，已锁定，不能直接修改。客户要加产品：点「追加物料」（需审批），或新建商机重新报价');
    }
}

function _quoteAppendLog(PDO $pdo, int $qid, int $batch, string $action, array $items, float $before, float $after, array $user, string $remark = ''): void
{
    $pdo->prepare("INSERT INTO quote_append_logs (quote_id, batch, action, items, item_count, total_before, total_after, user_id, user_name, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        ->execute([
            $qid, $batch, $action, json_encode($items, JSON_UNESCAPED_UNICODE), count($items), $before, $after,
            (int) ($user['id'] ?? 0), _dealUserName($pdo, (int) ($user['id'] ?? 0)), $remark,
        ]);
}

function _quoteVoidInvoice(PDO $pdo, array $q, string $why): string
{
    if (empty($q['invoice_no'])) return '';
    $pdo->prepare("UPDATE customer_quotes SET invoice_void_at = datetime('now','localtime'), invoice_void_reason = ?,
            invoice_rev = COALESCE(invoice_rev, 0) + 1, invoice_no = '', invoice_issued_at = NULL, invoice_due_at = NULL WHERE id = ?")
        ->execute([sprintf('%s，作废原发票 %s', $why, $q['invoice_no']), (int) $q['id']]);
    return (string) $q['invoice_no'];
}

function handle_appendQuoteItems(PDO $pdo, array $input, array $user): void
{
    $qid = (int) ($input['quote_id'] ?? 0);
    $st = $pdo->prepare("SELECT * FROM customer_quotes WHERE id = ?");
    $st->execute([$qid]);
    $q = $st->fetch();
    if (!$q) jsonError('报价单不存在', 404);
    if (($q['status'] ?? '') === 'to_review') jsonError('上一批追加的物料还在待审批，审批完成后再追加');
    if (!quoteIsLocked($pdo, $q)) jsonError('这张报价单还没提交，直接用「修改报价单」改就行');

    $items = $input['items'] ?? [];
    if (!is_array($items) || !$items) jsonError('请至少填一行要追加的物料');
    $valid = [];
    foreach ($items as $it) {
        $name = trim((string) ($it['product_name'] ?? ''));
        if ($name === '') continue;
        $qty = (float) ($it['qty'] ?? 0);
        $sell = (float) ($it['sell_price'] ?? 0);
        if ($qty <= 0) jsonError("「{$name}」数量必须大于 0");
        if ($sell < 0) jsonError("「{$name}」单价不能为负");
        $cost = (float) ($it['cost_price'] ?? 0);
        $valid[] = [
            'product_name' => $name,
            'spec' => trim((string) ($it['spec'] ?? '')),
            'unit' => trim((string) ($it['unit'] ?? '')) ?: '件',
            'qty' => $qty,
            'cost_price' => $cost,
            'sell_price' => $sell,
            'lead_time' => trim((string) ($it['lead_time'] ?? '')),
            'remark' => trim((string) ($it['remark'] ?? '')),
        ];
    }
    if (!$valid) jsonError('请至少填一行有产品名的物料');
    $reason = trim((string) ($input['reason'] ?? ''));

    $before = (float) $q['total'];
    // 批次号按日志往后排：驳回会删掉明细行，按明细算会和被驳回的那批撞号
    $st = $pdo->prepare("SELECT MAX(COALESCE((SELECT MAX(batch) FROM quote_append_logs WHERE quote_id = ?), 0),
        COALESCE((SELECT MAX(append_batch) FROM customer_quote_items WHERE quote_id = ?), 0)) + 1");
    $st->execute([$qid, $qid]);
    $batch = (int) $st->fetchColumn();

    $pdo->beginTransaction();
    try {
        // 商机明细也补上这几行：派单 / 供应商报价 / 订单拆分都以商机明细为准
        $st = $pdo->prepare("SELECT COALESCE(MAX(line_no), 0) FROM inquiry_items WHERE inquiry_id = ?");
        $st->execute([(int) $q['inquiry_id']]);
        $line = (int) $st->fetchColumn();
        $insIi = $pdo->prepare("INSERT INTO inquiry_items (inquiry_id, line_no, product_name, spec, unit, qty, remark) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $insQi = $pdo->prepare("INSERT INTO customer_quote_items
            (quote_id, inquiry_item_id, source_supplier_quote_item_id, show_brand, brand_display, model_display,
             product_name, spec, unit, qty, cost_price, sell_price, markup_amount, lead_time, remark, append_batch, append_status)
            VALUES (?, ?, NULL, 0, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')");
        foreach ($valid as $v) {
            $insIi->execute([(int) $q['inquiry_id'], ++$line, $v['product_name'], $v['spec'], $v['unit'], $v['qty'], '追加物料（待审批）']);
            $iiid = (int) $pdo->lastInsertId();
            $insQi->execute([$qid, $iiid, $v['product_name'], $v['spec'], $v['unit'], $v['qty'], $v['cost_price'], $v['sell_price'],
                $v['sell_price'] - $v['cost_price'], $v['lead_time'], $v['remark'], $batch]);
        }
        $after = quoteApplyFreight($pdo, $qid);
        $voided = _quoteVoidInvoice($pdo, $q, '追加物料');
        $pdo->prepare("UPDATE customer_quotes SET status = 'to_review', review_from_status = ? WHERE id = ?")
            ->execute([(string) $q['status'], $qid]);
        _quoteAppendLog($pdo, $qid, $batch, 'append', $valid, $before, $after, $user, $reason);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    opLog($pdo, 'customer_quote', $qid, 'append_items', count($valid) . ' 行 ' . $reason, (int) $user['id']);
    jsonOk(['batch' => $batch, 'count' => count($valid), 'total_before' => $before, 'total_after' => $after, 'invoice_voided' => $voided]);
}

/** 管理员审批追加：approve 生效；reject 撤掉这批追加的行，总价还原 */
function handle_reviewQuoteAppend(PDO $pdo, array $input, array $user): void
{
    if (($user['role'] ?? '') !== 'admin') jsonError('只有管理员能审批', 403);
    $qid = (int) ($input['quote_id'] ?? 0);
    $decision = (string) ($input['decision'] ?? '');
    if (!in_array($decision, ['approve', 'reject'], true)) jsonError('参数错误');
    $remark = trim((string) ($input['remark'] ?? ''));
    if ($decision === 'reject' && mb_strlen($remark) < 2) jsonError('请填写驳回原因');

    $st = $pdo->prepare("SELECT * FROM customer_quotes WHERE id = ?");
    $st->execute([$qid]);
    $q = $st->fetch();
    if (!$q) jsonError('报价单不存在', 404);
    if (($q['status'] ?? '') !== 'to_review') jsonError('这张报价单没有待审批的追加');

    $st = $pdo->prepare("SELECT * FROM customer_quote_items WHERE quote_id = ? AND append_status = 'pending'");
    $st->execute([$qid]);
    $pending = $st->fetchAll();
    $batch = $pending ? (int) $pending[0]['append_batch'] : 0;
    $before = (float) $q['total'];
    $back = (string) ($q['review_from_status'] ?: 'sent');

    $pdo->beginTransaction();
    try {
        if ($decision === 'approve') {
            $pdo->prepare("UPDATE customer_quote_items SET append_status = 'approved' WHERE quote_id = ? AND append_status = 'pending'")->execute([$qid]);
            $pdo->prepare("UPDATE inquiry_items SET remark = '追加物料' WHERE id IN
                (SELECT inquiry_item_id FROM customer_quote_items WHERE quote_id = ? AND append_batch = ?)")->execute([$qid, $batch]);
            $after = $before;
        } else {
            $ids = array_map(fn ($r) => (int) $r['inquiry_item_id'], $pending);
            $pdo->prepare("DELETE FROM customer_quote_items WHERE quote_id = ? AND append_status = 'pending'")->execute([$qid]);
            if ($ids) {
                $ph = implode(',', array_fill(0, count($ids), '?'));
                // 只删这批追加时新建的商机明细，且没被供应商报价引用的
                $pdo->prepare("DELETE FROM inquiry_items WHERE id IN ({$ph})
                    AND NOT EXISTS (SELECT 1 FROM supplier_quote_items s WHERE s.inquiry_item_id = inquiry_items.id)")->execute($ids);
            }
            $after = quoteApplyFreight($pdo, $qid);
        }
        $pdo->prepare("UPDATE customer_quotes SET status = ?, review_from_status = '' WHERE id = ?")->execute([$back, $qid]);
        $logItems = array_map(fn ($r) => ['product_name' => $r['product_name'], 'spec' => $r['spec'], 'unit' => $r['unit'],
            'qty' => (float) $r['qty'], 'sell_price' => (float) $r['sell_price']], $pending);
        _quoteAppendLog($pdo, $qid, $batch, $decision, $logItems, $before, $after, $user, $remark);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    opLog($pdo, 'customer_quote', $qid, 'append_' . $decision, $remark, (int) $user['id']);
    jsonOk(['total' => $after]);
}

function handle_listQuoteAppendLogs(PDO $pdo, array $input): void
{
    $qid = (int) ($input['quote_id'] ?? 0);
    if (!$qid) jsonError('请指定报价单');
    $st = $pdo->prepare("SELECT * FROM quote_append_logs WHERE quote_id = ? ORDER BY id DESC");
    $st->execute([$qid]);
    $rows = $st->fetchAll();
    $labels = ['append' => '追加物料', 'approve' => '审批通过', 'reject' => '审批驳回'];
    foreach ($rows as &$r) {
        $r['items'] = json_decode((string) $r['items'], true) ?: [];
        $r['action_label'] = $labels[$r['action']] ?? $r['action'];
    }
    unset($r);
    jsonOk(['items' => $rows]);
}
