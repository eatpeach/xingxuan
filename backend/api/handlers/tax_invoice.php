<?php

/**
 * 税票登记（20261127）
 *
 * 财务每天要知道两件事：
 *   out —— 哪些成交的单要给【客户】开税票，开了没有
 *   in  —— 哪些成交的单要找【供应商】拿税票，拿到没有（一张单几家供应商就是几行）
 * 只是「点一下登记」，不填税票号、不传文件。
 *
 * 一行的状态（没登记过的按默认规则算，登记过的以登记为准）：
 *   todo 未开 / done 已开（已收） / skip 无需开票
 * 默认规则：
 *   - 上线前（tax_invoice.cutoff 之前）已确认到账的老单：统一算已处理（history）
 *   - 对私付款的单：无需开票
 *   - 其他：未开
 * 进清单的条件：
 *   - 客户侧：已确认到账；或财务手动加进来的（客户要求先开税票再付款）
 *   - 供应商侧：必须已确认到账（我们付完钱才找供应商要票）
 * 开票后订单金额变了：状态仍是 done，但 changed = true，前端提示「金额已变，需重开」。
 *
 * 权限：管理员 + users.can_tax_invoice = 1 的账号能点；其他人只读（销售只看自己客户的）。
 * 回滚：删掉本文件和路由即可，tax_invoices / tax_invoice_logs 两张表不影响任何别的功能。
 */

function taxCanOperate(array $user): bool
{
    return ($user['role'] ?? '') === 'admin' || (int) ($user['can_tax_invoice'] ?? 0) === 1;
}

function _taxCutoff(PDO $pdo): string
{
    $v = $pdo->query("SELECT value FROM system_settings WHERE key = 'tax_invoice.cutoff'")->fetchColumn();
    return $v ? (string) $v : '';
}

/** 一张单的供应商名单：订单头的「供应商」（可能是 "A / B / C"）；没填就从报价明细的采纳来源反查 */
function _taxSuppliersOf(string $headName, array $fromItems): array
{
    $out = [];
    foreach (preg_split('/\s*\/\s*/u', $headName) as $n) {
        $n = trim($n);
        if ($n !== '' && !in_array($n, $out, true)) $out[] = $n;
    }
    if (!$out) $out = array_values(array_unique($fromItems));
    return $out ?: [''];   // '' = 这张单没填供应商，也要占一行，不然财务会漏
}

/** 没登记过的行，默认是什么状态 */
function _taxDefault(array $o, string $cutoff): array
{
    $confirmed = (string) ($o['deal_confirmed_at'] ?? '');
    if ($cutoff !== '' && $confirmed !== '' && $confirmed <= $cutoff) return ['done', 'history'];
    if (in_array((string) ($o['payment_channel'] ?? ''), ['private_idr', 'private_cny'], true)) return ['skip', 'private'];
    return ['todo', ''];
}

function handle_listTaxInvoices(PDO $pdo, array $input, array $user): void
{
    $canOp = taxCanOperate($user);
    $scope = $canOp ? '' : salesScopeSql($user, 'o.customer_id');
    $cutoff = _taxCutoff($pdo);

    $orders = $pdo->query("SELECT o.id, o.no AS order_no, o.quote_id, o.total_amount, o.currency, o.supplier_name,
               o.deal_confirmed_at, o.created_at, o.contract_no,
               q.inquiry_id, q.payment_channel, q.tax_rate, q.tax_included,
               i.no AS inquiry_no, i.title AS inquiry_title,
               c.name AS customer_name, c.short_name AS customer_short_name, c.code AS customer_code
        FROM orders o
        LEFT JOIN customer_quotes q ON q.id = o.quote_id
        LEFT JOIN inquiries i ON i.id = q.inquiry_id
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.status IN ('in_progress','completed','pending_contract'){$scope}
        ORDER BY COALESCE(o.deal_confirmed_at, o.created_at) DESC, o.id DESC")->fetchAll();

    $marks = [];
    foreach ($pdo->query("SELECT * FROM tax_invoices")->fetchAll() as $m) {
        $marks[$m['order_id'] . '|' . $m['side'] . '|' . $m['supplier_name']] = $m;
    }
    // 报价明细采纳的供应商（订单头没填供应商时兜底用）
    $itemSup = [];
    foreach ($pdo->query("SELECT DISTINCT o.id AS order_id, s.name
        FROM orders o
        JOIN customer_quote_items ci ON ci.quote_id = o.quote_id
        JOIN supplier_quote_items sqi ON sqi.id = ci.source_supplier_quote_item_id
        JOIN supplier_quotes sq ON sq.id = sqi.quote_id
        JOIN suppliers s ON s.id = sq.supplier_id
        WHERE COALESCE(o.supplier_name, '') = ''")->fetchAll() as $r) {
        $itemSup[(int) $r['order_id']][] = (string) $r['name'];
    }

    $build = function (array $o, string $side, string $supplier) use ($marks, $cutoff): array {
        $gross = _orderGrossOf((float) $o['total_amount'], $o['tax_rate'], $o['tax_included'], (string) $o['currency']);
        $m = $marks[$o['id'] . '|' . $side . '|' . $supplier] ?? null;
        if ($m) {
            $state = (string) $m['status'];
            $why = 'manual';
        } else {
            [$state, $why] = _taxDefault($o, $cutoff);
        }
        return [
            'key' => $o['id'] . '|' . $side . '|' . $supplier,
            'order_id' => (int) $o['id'],
            'side' => $side,
            'supplier_name' => $supplier,
            'order_no' => $o['order_no'],
            'inquiry_no' => $o['inquiry_no'],
            'inquiry_title' => $o['inquiry_title'],
            'contract_no' => $o['contract_no'],
            'customer_name' => $o['customer_short_name'] ?: $o['customer_name'],
            'customer_code' => $o['customer_code'],
            'order_suppliers' => $o['supplier_name'],
            'currency' => $o['currency'],
            'amount' => $gross,
            'payment_channel' => (string) $o['payment_channel'],
            'deal_confirmed_at' => $o['deal_confirmed_at'],
            'order_created_at' => $o['created_at'],
            'state' => $state,
            'why' => $why,      // manual 人工登记 / history 上线前老单 / private 对私 / '' 默认未开
            // 开票后金额变了：提醒财务重开
            'changed' => $m && $state === 'done' && abs((float) $m['amount'] - $gross) > 0.5,
            'marked_amount' => $m ? (float) $m['amount'] : null,
            'marked_at' => $m['marked_at'] ?? null,
            'marked_by_name' => $m['marked_by_name'] ?? '',
        ];
    };

    $out = $in = $addable = [];
    foreach ($orders as $o) {
        $confirmed = !empty($o['deal_confirmed_at']);
        $hasOut = isset($marks[$o['id'] . '|out|']);
        if ($confirmed || $hasOut) {
            $out[] = $build($o, 'out', '');
        } else {
            $addable[] = [
                'order_id' => (int) $o['id'], 'order_no' => $o['order_no'], 'inquiry_no' => $o['inquiry_no'],
                'customer_name' => $o['customer_short_name'] ?: $o['customer_name'],
                'currency' => $o['currency'],
                'amount' => _orderGrossOf((float) $o['total_amount'], $o['tax_rate'], $o['tax_included'], (string) $o['currency']),
                'payment_channel' => (string) $o['payment_channel'],
                'order_created_at' => $o['created_at'],
            ];
        }
        if ($confirmed) {
            foreach (_taxSuppliersOf((string) $o['supplier_name'], $itemSup[(int) $o['id']] ?? []) as $sn) {
                $in[] = $build($o, 'in', $sn);
            }
        }
    }
    jsonOk(['out' => $out, 'in' => $in, 'addable' => $addable, 'can_operate' => $canOp, 'cutoff' => $cutoff]);
}

/**
 * 登记 / 改一行的税票状态
 * 入参：order_id, side(out|in), supplier_name(供应商侧必传，可为空串), status(todo|done|skip|remove)
 * remove 只用于「把手动加进清单的未到账单移出去」
 */
function handle_markTaxInvoice(PDO $pdo, array $input, array $user): void
{
    if (!taxCanOperate($user)) jsonError('没有登记税票的权限，请联系管理员在「系统设置 → 账号管理」里开通', 403);
    $oid = (int) ($input['order_id'] ?? 0);
    $side = (string) ($input['side'] ?? '');
    $status = (string) ($input['status'] ?? '');
    $supplier = $side === 'in' ? trim((string) ($input['supplier_name'] ?? '')) : '';
    if (!$oid || !in_array($side, ['out', 'in'], true) || !in_array($status, ['todo', 'done', 'skip', 'remove'], true)) {
        jsonError('参数不对');
    }
    $st = $pdo->prepare("SELECT o.id, o.no, o.status, o.total_amount, o.currency, o.deal_confirmed_at, q.tax_rate, q.tax_included
        FROM orders o LEFT JOIN customer_quotes q ON q.id = o.quote_id WHERE o.id = ?");
    $st->execute([$oid]);
    $o = $st->fetch();
    if (!$o || $o['status'] === 'cancelled') jsonError('订单不存在或已取消', 404);
    $confirmed = !empty($o['deal_confirmed_at']);
    if ($side === 'in' && !$confirmed) jsonError('这张单还没确认到账，供应商税票要等到账后再登记');
    if ($status === 'remove' && ($side !== 'out' || $confirmed)) jsonError('只有手动加进来的未到账单才能移出清单');

    $gross = _orderGrossOf((float) $o['total_amount'], $o['tax_rate'], $o['tax_included'], (string) $o['currency']);
    $uid = (int) $user['id'];
    $uname = (string) (($user['name'] ?? '') ?: ($user['username'] ?? ''));
    $now = date('Y-m-d H:i:s');

    $pdo->beginTransaction();
    try {
        if ($status === 'remove') {
            $pdo->prepare("DELETE FROM tax_invoices WHERE order_id = ? AND side = 'out' AND supplier_name = ''")->execute([$oid]);
        } else {
            $pdo->prepare("INSERT INTO tax_invoices (order_id, side, supplier_name, status, amount, marked_by, marked_by_name, marked_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(order_id, side, supplier_name) DO UPDATE SET
                    status = excluded.status, amount = excluded.amount, marked_by = excluded.marked_by,
                    marked_by_name = excluded.marked_by_name, marked_at = excluded.marked_at")
                ->execute([$oid, $side, $supplier, $status, $gross, $uid, $uname, $now]);
        }
        $pdo->prepare("INSERT INTO tax_invoice_logs (order_id, order_no, side, supplier_name, action, amount, user_id, user_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            ->execute([$oid, (string) $o['no'], $side, $supplier, $status, $gross, $uid, $uname, $now]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    jsonOk();
}

/** 开 / 关某个账号的「可登记税票」。管理员本来就能点，不用设 */
function handle_setUserTaxInvoice(PDO $pdo, array $input, array $user): void
{
    _requireAdmin($user);
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $on = !empty($input['on']) ? 1 : 0;
    $pdo->prepare("UPDATE users SET can_tax_invoice = ?, updated_at=datetime('now','localtime') WHERE id=?")->execute([$on, $id]);
    opLog($pdo, 'user', $id, 'set_tax_invoice', $on ? '开通：可登记税票' : '关闭：可登记税票', (int) $user['id']);
    jsonOk();
}
