<?php

/**
 * 供应商门户 · 我的询价与报价（20260824）
 *
 * 以前供应商只能靠销售发来的那条 token 链接进报价页，链接一丢就找不回来，
 * 也没法回看自己之前报过什么价。有了门户账号之后，这些应该在门户里能查。
 *
 * 【给看什么、不给看什么】——中介平台的命门是「别让供应商看到客户」：
 *   给看：询价单号 / 标题 / 派给他的那几行 / 截止时间 / 他自己报的价 / 是否被采纳
 *   不给看：客户是谁、客户联系方式、对客售价、加价多少、别家供应商报了多少
 * 所以下面所有查询都不 JOIN customers，也绝不返回 customer_quote_items。
 */

/** 门户首页角标：几个待报价 */
function handle_vendorInquiryStats(PDO $pdo, array $vendor): void
{
    $sid = (int) $vendor['id'];
    $st = $pdo->prepare("SELECT
            SUM(CASE WHEN d.status IN ('pending','sent') THEN 1 ELSE 0 END) AS todo,
            SUM(CASE WHEN d.status = 'responded' THEN 1 ELSE 0 END) AS done
        FROM dispatches d WHERE d.supplier_id = ?");
    $st->execute([$sid]);
    $r = $st->fetch() ?: [];

    // 快到期的（3 天内）单独提一句，供应商最容易忘的就是这个
    $st = $pdo->prepare("SELECT COUNT(*) FROM dispatches d
        JOIN inquiries i ON i.id = d.inquiry_id
        WHERE d.supplier_id = ? AND d.status IN ('pending','sent')
          AND i.deadline IS NOT NULL AND i.deadline != ''
          AND date(i.deadline) <= date('now','localtime','+3 days')");
    $st->execute([$sid]);

    jsonOk([
        'todo' => (int) ($r['todo'] ?? 0),
        'responded' => (int) ($r['done'] ?? 0),
        'urgent' => (int) $st->fetchColumn(),
    ]);
}

/**
 * 派给我的询价列表
 * status: todo（待报价）| responded（已报价）| all
 */
function handle_vendorListInquiries(PDO $pdo, array $input, array $vendor): void
{
    $sid = (int) $vendor['id'];
    $status = (string) ($input['status'] ?? 'all');

    $where = ['d.supplier_id = ?'];
    $params = [$sid];
    if ($status === 'todo') {
        $where[] = "d.status IN ('pending','sent')";
    } elseif ($status === 'responded') {
        $where[] = "d.status = 'responded'";
    }

    $sql = "SELECT d.id AS dispatch_id, d.token, d.status AS dispatch_status,
                   d.token_expire_at, d.created_at AS dispatched_at, d.responded_at,
                   i.id AS inquiry_id, i.no AS inquiry_no, i.title, i.deadline,
                   i.currency, i.tax_included, i.tax_rate,
                   q.id AS quote_id, q.no AS quote_no, q.total AS quoted_total,
                   q.status AS quote_status, q.valid_until
            FROM dispatches d
            JOIN inquiries i ON i.id = d.inquiry_id
            LEFT JOIN supplier_quotes q ON q.dispatch_id = d.id
            WHERE " . implode(' AND ', $where) . "
            ORDER BY d.id DESC LIMIT 200";
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll();

    // 每条派单覆盖哪几行：dispatch_items 没记录 = 整单（按行派单之前的老数据）
    $stScope = $pdo->prepare("SELECT COUNT(*) FROM dispatch_items WHERE dispatch_id = ?");
    $stAll = $pdo->prepare("SELECT COUNT(*) FROM inquiry_items WHERE inquiry_id = ?");
    $today = date('Y-m-d');

    $out = [];
    foreach ($rows as $r) {
        $stScope->execute([(int) $r['dispatch_id']]);
        $scoped = (int) $stScope->fetchColumn();
        if ($scoped === 0) {
            $stAll->execute([(int) $r['inquiry_id']]);
            $scoped = (int) $stAll->fetchColumn();
        }

        $deadline = substr((string) ($r['deadline'] ?? ''), 0, 10);
        $expired = false;
        if (!empty($r['token_expire_at'])) {
            $expired = strtotime((string) $r['token_expire_at']) < time();
        }

        $out[] = [
            'dispatch_id' => (int) $r['dispatch_id'],
            'inquiry_no' => $r['inquiry_no'],
            'title' => $r['title'],
            'item_count' => $scoped,
            'deadline' => $deadline,
            'overdue' => $deadline !== '' && $deadline < $today ? 1 : 0,
            'dispatched_at' => $r['dispatched_at'],
            'responded_at' => $r['responded_at'],
            'status' => $r['dispatch_status'],
            'currency' => $r['currency'] ?: 'IDR',
            'tax_included' => (int) $r['tax_included'],
            'tax_rate' => (float) $r['tax_rate'],
            // 报价页还是走原来那条 token 链接，逻辑一份不用改；门户只是帮他找回入口
            'link' => $expired ? '' : '/p/quote/' . $r['token'],
            'link_expired' => $expired ? 1 : 0,
            'quote_id' => $r['quote_id'] ? (int) $r['quote_id'] : null,
            'quote_no' => $r['quote_no'],
            'quoted_total' => $r['quoted_total'] !== null ? (float) $r['quoted_total'] : null,
            'quote_status' => $r['quote_status'],   // submitted / adopted / rejected
            'valid_until' => $r['valid_until'],
        ];
    }

    jsonOk(['items' => $out]);
}

/**
 * 看某一单的明细：派给我的那几行 + 我报过的价
 * 只认自己名下的派单，别人的一律 403。
 */
function handle_vendorGetInquiry(PDO $pdo, array $input, array $vendor): void
{
    $sid = (int) $vendor['id'];
    $did = (int) ($input['dispatch_id'] ?? 0);
    if (!$did) jsonError('参数缺失');

    $st = $pdo->prepare("SELECT d.*, i.no AS inquiry_no, i.title, i.remark, i.deadline,
                                i.currency, i.tax_included, i.tax_rate
        FROM dispatches d JOIN inquiries i ON i.id = d.inquiry_id
        WHERE d.id = ? AND d.supplier_id = ?");
    $st->execute([$did, $sid]);
    $d = $st->fetch();
    if (!$d) jsonError('这条派单不属于你', 403);

    // 派单范围（无记录 = 整单）
    $stDi = $pdo->prepare("SELECT inquiry_item_id FROM dispatch_items WHERE dispatch_id = ?");
    $stDi->execute([$did]);
    $scope = array_map('intval', $stDi->fetchAll(PDO::FETCH_COLUMN));
    if ($scope) {
        $ph = implode(',', array_fill(0, count($scope), '?'));
        $stIt = $pdo->prepare("SELECT id, line_no, product_name, spec, unit, qty, remark
            FROM inquiry_items WHERE inquiry_id = ? AND id IN ({$ph}) ORDER BY line_no ASC, id ASC");
        $stIt->execute(array_merge([(int) $d['inquiry_id']], $scope));
    } else {
        $stIt = $pdo->prepare("SELECT id, line_no, product_name, spec, unit, qty, remark
            FROM inquiry_items WHERE inquiry_id = ? ORDER BY line_no ASC, id ASC");
        $stIt->execute([(int) $d['inquiry_id']]);
    }
    $items = $stIt->fetchAll();

    // 我报过的价（逐行）
    $stQ = $pdo->prepare("SELECT * FROM supplier_quotes WHERE dispatch_id = ? ORDER BY id DESC LIMIT 1");
    $stQ->execute([$did]);
    $quote = $stQ->fetch();
    $priced = [];
    if ($quote) {
        $stQi = $pdo->prepare("SELECT * FROM supplier_quote_items WHERE quote_id = ?");
        $stQi->execute([(int) $quote['id']]);
        foreach ($stQi->fetchAll() as $qi) $priced[(int) $qi['inquiry_item_id']] = $qi;
    }
    foreach ($items as &$it) {
        $p = $priced[(int) $it['id']] ?? null;
        $it['my_price'] = $p ? (float) $p['supplier_price'] : null;
        $it['my_brand'] = $p['brand'] ?? '';
        $it['my_model'] = $p['model'] ?? '';
        $it['my_lead_time'] = $p['lead_time'] ?? '';
        $it['my_qty'] = $p ? (float) $p['qty'] : (float) $it['qty'];
        $it['my_amount'] = $p ? (float) $p['supplier_price'] * (float) $p['qty'] : null;
    }
    unset($it);

    $expired = !empty($d['token_expire_at']) && strtotime((string) $d['token_expire_at']) < time();

    jsonOk([
        'inquiry_no' => $d['inquiry_no'],
        'title' => $d['title'],
        'remark' => $d['remark'],
        'deadline' => substr((string) $d['deadline'], 0, 10),
        'currency' => $d['currency'] ?: 'IDR',
        'tax_included' => (int) $d['tax_included'],
        'tax_rate' => (float) $d['tax_rate'],
        'status' => $d['status'],
        'link' => $expired ? '' : '/p/quote/' . $d['token'],
        'link_expired' => $expired ? 1 : 0,
        'items' => $items,
        'quote' => $quote ? [
            'no' => $quote['no'],
            'total' => (float) $quote['total'],
            'status' => $quote['status'],
            'valid_until' => $quote['valid_until'],
            'remark' => $quote['remark'],
            'created_at' => $quote['created_at'] ?? null,
        ] : null,
    ]);
}
