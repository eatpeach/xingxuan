<?php

/**
 * 确认到账才算成交（20261112）
 *
 * 以前「开单」就等于成交，可客户实际可能还没付钱，工作台的成交、营收全是虚的。
 * 现在：开单后订单是「待付款（未成交）」，跟单在商机管理里手动点「确认到账」才算成交；
 * 点错了可以撤销，但必须写原因。每一次确认 / 撤销都进 deal_confirm_logs（库层面只许新增）。
 *
 * 成交判据：orders.deal_confirmed_at 非空。统计口径统一走 dealWonSql()，别在各处手写。
 */

/** 「已成交」的 SQL 条件。$a 是 orders 表的别名 */
function dealWonSql(string $a = 'o'): string
{
    return "{$a}.status IN ('in_progress','completed','pending_contract') AND {$a}.deal_confirmed_at IS NOT NULL";
}

/** 「已开单、未确认到账」的 SQL 条件 */
function dealPendingSql(string $a = 'o'): string
{
    return "{$a}.status IN ('in_progress','completed','pending_contract') AND {$a}.deal_confirmed_at IS NULL";
}

const DEAL_ACTION_LABELS = [
    'confirm' => '确认到账',
    'revoke' => '撤销成交',
    'migrate' => '系统迁移',
    'import' => '历史订单导入',
    'migrate_rollback' => '撤回系统迁移',
];

function _dealUserName(PDO $pdo, ?int $uid): string
{
    if (!$uid) return '系统';
    $st = $pdo->prepare("SELECT COALESCE(NULLIF(name, ''), username) FROM users WHERE id = ?");
    $st->execute([$uid]);
    return (string) ($st->fetchColumn() ?: ('#' . $uid));
}

/** 写一条成交操作日志（只新增） */
function _dealWriteLog(PDO $pdo, array $order, string $action, ?int $uid, string $reason = '', ?string $at = null): void
{
    $pdo->prepare("INSERT INTO deal_confirm_logs (inquiry_id, order_id, action, user_id, user_name, reason, amount, currency, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        ->execute([
            $order['inquiry_id'] ?? null,
            (int) $order['id'],
            $action,
            $uid,
            _dealUserName($pdo, $uid),
            $reason,
            (float) ($order['total_amount'] ?? 0),
            (string) ($order['currency'] ?? ''),
            $at ?: date('Y-m-d H:i:s'),
        ]);
}

/** 订单 + 它所属的商机 id */
function _dealLoadOrder(PDO $pdo, int $orderId): ?array
{
    $st = $pdo->prepare("SELECT o.*, q.inquiry_id, q.payment_channel
        FROM orders o LEFT JOIN customer_quotes q ON q.id = o.quote_id WHERE o.id = ?");
    $st->execute([$orderId]);
    $r = $st->fetch();
    return $r ?: null;
}

/**
 * 直接标记为已成交（历史订单导入、迁移脚本用）。不检查权限，调用方自己负责。
 * $at = 成交时间；不传就是现在
 */
function _dealMarkConfirmed(PDO $pdo, int $orderId, ?int $uid, string $action, ?string $at = null, string $reason = ''): void
{
    $order = _dealLoadOrder($pdo, $orderId);
    if (!$order || !empty($order['deal_confirmed_at'])) return;
    $at = $at ?: date('Y-m-d H:i:s');
    $pdo->prepare("UPDATE orders SET deal_confirmed_at = ?, deal_confirmed_by = ?,
        deal_last_action = ?, deal_last_action_at = ?, deal_last_action_by = ? WHERE id = ?")
        ->execute([$at, $uid, $action, $at, $uid, $orderId]);
    _dealWriteLog($pdo, $order, $action, $uid, $reason, $at);
}

/** 只有该单负责人和管理员能确认 / 撤销 */
function _dealRequireOperator(PDO $pdo, array $user, ?int $inquiryId): void
{
    if (($user['role'] ?? '') === 'admin') return;
    if (!$inquiryId) jsonError('只有管理员能操作这张单', 403);
    $st = $pdo->prepare("SELECT owner_id, created_by FROM inquiries WHERE id = ?");
    $st->execute([$inquiryId]);
    $inq = $st->fetch();
    if (!$inq) jsonError('商机不存在', 404);
    $uid = (int) $user['id'];
    // 负责人 = 商机的 owner；没有指定负责人的老商机，以创建人为负责人（和列表「负责人」列的显示一致）
    $owner = (int) $inq['owner_id'] ?: (int) $inq['created_by'];
    if ($owner !== $uid) jsonError('只有这张单的负责人或管理员才能操作', 403);
}

/** 找到要操作的订单：传 order_id，或传 inquiry_id（取该商机最新的一张订单） */
function _dealResolveOrder(PDO $pdo, array $input): array
{
    $oid = (int) ($input['order_id'] ?? 0);
    if (!$oid && !empty($input['inquiry_id'])) {
        $st = $pdo->prepare("SELECT o.id FROM orders o JOIN customer_quotes q ON q.id = o.quote_id
            WHERE q.inquiry_id = ? ORDER BY o.id DESC LIMIT 1");
        $st->execute([(int) $input['inquiry_id']]);
        $oid = (int) $st->fetchColumn();
    }
    if (!$oid) jsonError('这个商机还没有开单，不能确认到账');
    $order = _dealLoadOrder($pdo, $oid);
    if (!$order) jsonError('订单不存在', 404);
    return $order;
}

function handle_confirmDealPayment(PDO $pdo, array $input, array $user): void
{
    $order = _dealResolveOrder($pdo, $input);
    _dealRequireOperator($pdo, $user, $order['inquiry_id'] ? (int) $order['inquiry_id'] : null);
    $uid = (int) $user['id'];
    $now = date('Y-m-d H:i:s');

    $pdo->beginTransaction();
    try {
        // 带条件更新：两个人同时点，只有一个能成功，不会记两条「确认」
        $st = $pdo->prepare("UPDATE orders SET deal_confirmed_at = ?, deal_confirmed_by = ?,
            deal_last_action = 'confirm', deal_last_action_at = ?, deal_last_action_by = ?,
            updated_at = datetime('now','localtime')
            WHERE id = ? AND deal_confirmed_at IS NULL");
        $st->execute([$now, $uid, $now, $uid, (int) $order['id']]);
        if ($st->rowCount() === 0) {
            $pdo->rollBack();
            jsonError('这张单已经是已成交状态了，刷新一下看看');
        }
        _dealWriteLog($pdo, $order, 'confirm', $uid, '', $now);
        if ($order['inquiry_id']) _setInquiryStatus($pdo, (int) $order['inquiry_id'], 'won', $uid);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    opLog($pdo, 'order', (int) $order['id'], 'deal_confirm', (string) $order['no'], $uid);
    jsonOk(['order_id' => (int) $order['id'], 'deal_confirmed_at' => $now]);
}

function handle_revokeDealPayment(PDO $pdo, array $input, array $user): void
{
    $reason = trim((string) ($input['reason'] ?? ''));
    if (mb_strlen($reason) < 2) jsonError('请填写撤销原因');
    if (mb_strlen($reason) > 200) $reason = mb_substr($reason, 0, 200);
    $order = _dealResolveOrder($pdo, $input);
    _dealRequireOperator($pdo, $user, $order['inquiry_id'] ? (int) $order['inquiry_id'] : null);
    $uid = (int) $user['id'];
    $now = date('Y-m-d H:i:s');

    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("UPDATE orders SET deal_confirmed_at = NULL, deal_confirmed_by = NULL,
            deal_last_action = 'revoke', deal_last_action_at = ?, deal_last_action_by = ?,
            updated_at = datetime('now','localtime')
            WHERE id = ? AND deal_confirmed_at IS NOT NULL");
        $st->execute([$now, $uid, (int) $order['id']]);
        if ($st->rowCount() === 0) {
            $pdo->rollBack();
            jsonError('这张单本来就是未成交状态，刷新一下看看');
        }
        _dealWriteLog($pdo, $order, 'revoke', $uid, $reason, $now);
        if ($order['inquiry_id']) _setInquiryStatus($pdo, (int) $order['inquiry_id'], 'pending_payment', $uid);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    opLog($pdo, 'order', (int) $order['id'], 'deal_revoke', (string) $order['no'] . ' ' . $reason, $uid);
    jsonOk(['order_id' => (int) $order['id']]);
}

function handle_listDealConfirmLogs(PDO $pdo, array $input): void
{
    $iid = (int) ($input['inquiry_id'] ?? 0);
    $oid = (int) ($input['order_id'] ?? 0);
    if (!$iid && !$oid) jsonError('参数错误');
    if ($iid) {
        // 按商机查，同时带上订单号（一个商机理论上只有一张单，这里不假设）
        $st = $pdo->prepare("SELECT l.*, o.no AS order_no FROM deal_confirm_logs l
            LEFT JOIN orders o ON o.id = l.order_id
            WHERE l.inquiry_id = ? OR l.order_id IN (SELECT o2.id FROM orders o2 JOIN customer_quotes q ON q.id = o2.quote_id WHERE q.inquiry_id = ?)
            ORDER BY l.created_at DESC, l.id DESC");
        $st->execute([$iid, $iid]);
    } else {
        $st = $pdo->prepare("SELECT l.*, o.no AS order_no FROM deal_confirm_logs l
            LEFT JOIN orders o ON o.id = l.order_id WHERE l.order_id = ? ORDER BY l.created_at DESC, l.id DESC");
        $st->execute([$oid]);
    }
    $rows = $st->fetchAll();
    foreach ($rows as &$r) $r['action_label'] = DEAL_ACTION_LABELS[$r['action']] ?? $r['action'];
    unset($r);
    jsonOk(['items' => $rows]);
}

/**
 * 给商机列表附上成交信息（一次查完，不逐行查）。
 * 每个商机取最新的一张订单。
 */
function _dealAttachToInquiries(PDO $pdo, array &$rows, array $user): void
{
    $ids = array_values(array_filter(array_map(fn ($r) => (int) $r['id'], $rows)));
    if (!$ids) return;
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT q.inquiry_id, o.id AS order_id, o.no AS order_no, o.total_amount, o.currency,
            o.deal_confirmed_at, o.deal_last_action, o.deal_last_action_at,
            COALESCE(NULLIF(u.name, ''), u.username) AS deal_last_action_by_name,
            q.payment_channel,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id AND p.status = 'confirmed') AS paid_confirmed
        FROM orders o
        JOIN customer_quotes q ON q.id = o.quote_id
        LEFT JOIN users u ON u.id = o.deal_last_action_by
        WHERE q.inquiry_id IN ({$ph})
        ORDER BY o.id ASC");
    $st->execute($ids);
    $byInq = [];
    foreach ($st->fetchAll() as $o) $byInq[(int) $o['inquiry_id']] = $o; // 升序遍历，最后留下的是最新一张

    $isAdmin = ($user['role'] ?? '') === 'admin';
    $uid = (int) ($user['id'] ?? 0);
    foreach ($rows as &$r) {
        $o = $byInq[(int) $r['id']] ?? null;
        $owner = (int) ($r['owner_id'] ?? 0) ?: (int) ($r['created_by'] ?? 0);
        $r['deal'] = $o ? [
            'order_id' => (int) $o['order_id'],
            'order_no' => $o['order_no'],
            'amount' => (float) $o['total_amount'],
            'currency' => $o['currency'] ?: 'IDR',
            'confirmed' => !empty($o['deal_confirmed_at']),
            'confirmed_at' => $o['deal_confirmed_at'],
            'last_action' => $o['deal_last_action'] ?: '',
            'last_action_label' => DEAL_ACTION_LABELS[$o['deal_last_action']] ?? '',
            'last_action_at' => $o['deal_last_action_at'],
            'last_action_by' => $o['deal_last_action_by_name'] ?: ($o['deal_last_action'] ? '系统' : ''),
            'payment_channel' => $o['payment_channel'] ?: '',
            'paid_confirmed' => (float) $o['paid_confirmed'],
            'can_operate' => $isAdmin || $owner === $uid,
        ] : null;
    }
    unset($r);
}


/* ================= 客户直付工厂：应收工厂返佣（20261112） =================
 *
 * 客户直接把货款打给工厂，钱不经我们的手。我们的利润是差价：
 *   应收工厂返佣 = 报价货品总额（原单价 × 数量，不含运费）− 工厂成本（成本价 × 数量）
 * 系统自动算；成本没填全时提示，可以手动改金额。工厂把差价打给我们后点「确认到账」，
 * 才计入工作台的「工厂返佣」收入。不单独生成采购单：「按供应商拆分明细」可直接打印给工厂。
 */

/** 自动计算的返佣：货品售价合计 − 成本合计，以及有没有没填成本的行 */
function _factoryRebateAuto(PDO $pdo, int $quoteId): array
{
    $st = $pdo->prepare("SELECT COALESCE(SUM(qty * sell_price), 0) AS sell, COALESCE(SUM(qty * cost_price), 0) AS cost,
            SUM(CASE WHEN COALESCE(cost_price, 0) <= 0 THEN 1 ELSE 0 END) AS no_cost
        FROM customer_quote_items WHERE quote_id = ?");
    $st->execute([$quoteId]);
    $r = $st->fetch() ?: ['sell' => 0, 'cost' => 0, 'no_cost' => 0];
    return [
        'sell' => round((float) $r['sell'], 2),
        'cost' => round((float) $r['cost'], 2),
        'auto' => round((float) $r['sell'] - (float) $r['cost'], 2),
        'missing_cost_lines' => (int) $r['no_cost'],
    ];
}

/** 给订单行附上返佣信息（只对直付工厂的单） */
function factoryRebateInfo(PDO $pdo, array $order): ?array
{
    $st = $pdo->prepare("SELECT payment_channel FROM customer_quotes WHERE id = ?");
    $st->execute([(int) $order['quote_id']]);
    if ((string) $st->fetchColumn() !== 'factory') return null;
    $auto = _factoryRebateAuto($pdo, (int) $order['quote_id']);
    $manual = $order['factory_rebate_amount'] ?? null;
    $name = '';
    if (!empty($order['factory_rebate_confirmed_by'])) $name = _dealUserName($pdo, (int) $order['factory_rebate_confirmed_by']);
    return [
        'auto' => $auto['auto'],
        'sell' => $auto['sell'],
        'cost' => $auto['cost'],
        'missing_cost_lines' => $auto['missing_cost_lines'],
        'manual' => $manual === null || $manual === '' ? null : (float) $manual,
        'amount' => $manual === null || $manual === '' ? $auto['auto'] : (float) $manual,
        'confirmed_at' => $order['factory_rebate_confirmed_at'] ?? null,
        'confirmed_by' => $name,
        'remark' => (string) ($order['factory_rebate_remark'] ?? ''),
    ];
}

function _factoryRebateOrder(PDO $pdo, array $input, array $user): array
{
    $order = _dealResolveOrder($pdo, $input);
    if (($order['payment_channel'] ?? '') !== 'factory') jsonError('这张单不是「客户直付工厂」，没有工厂返佣');
    _dealRequireOperator($pdo, $user, $order['inquiry_id'] ? (int) $order['inquiry_id'] : null);
    return $order;
}

/** 修改返佣金额；amount 传空 = 恢复自动计算 */
function handle_setFactoryRebate(PDO $pdo, array $input, array $user): void
{
    $order = _factoryRebateOrder($pdo, $input, $user);
    if (!empty($order['factory_rebate_confirmed_at'])) jsonError('返佣已确认到账，要改金额请先撤销到账');
    $amt = $input['amount'] ?? null;
    $amt = ($amt === null || $amt === '') ? null : round((float) $amt, 2);
    if ($amt !== null && $amt < 0) jsonError('返佣金额不能为负');
    $pdo->prepare("UPDATE orders SET factory_rebate_amount = ?, factory_rebate_remark = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        ->execute([$amt, trim((string) ($input['remark'] ?? '')), (int) $order['id']]);
    opLog($pdo, 'order', (int) $order['id'], 'factory_rebate_set', $amt === null ? '恢复自动计算' : (string) $amt, (int) $user['id']);
    jsonOk(['info' => factoryRebateInfo($pdo, _dealLoadOrder($pdo, (int) $order['id']))]);
}

function handle_confirmFactoryRebate(PDO $pdo, array $input, array $user): void
{
    $order = _factoryRebateOrder($pdo, $input, $user);
    $info = factoryRebateInfo($pdo, $order);
    if (($info['amount'] ?? 0) <= 0) jsonError('返佣金额是 0，先核对成本价或手动填返佣金额');
    $st = $pdo->prepare("UPDATE orders SET factory_rebate_confirmed_at = datetime('now','localtime'), factory_rebate_confirmed_by = ?,
            factory_rebate_amount = ? WHERE id = ? AND factory_rebate_confirmed_at IS NULL");
    // 确认时把金额定死：之后改明细 / 成本，已到账的数字不会跟着漂
    $st->execute([(int) $user['id'], $info['amount'], (int) $order['id']]);
    if ($st->rowCount() === 0) jsonError('已经确认过了，刷新一下看看');
    opLog($pdo, 'order', (int) $order['id'], 'factory_rebate_confirm', (string) $info['amount'], (int) $user['id']);
    jsonOk();
}

function handle_revokeFactoryRebate(PDO $pdo, array $input, array $user): void
{
    $reason = trim((string) ($input['reason'] ?? ''));
    if (mb_strlen($reason) < 2) jsonError('请填写撤销原因');
    $order = _factoryRebateOrder($pdo, $input, $user);
    $st = $pdo->prepare("UPDATE orders SET factory_rebate_confirmed_at = NULL, factory_rebate_confirmed_by = NULL
        WHERE id = ? AND factory_rebate_confirmed_at IS NOT NULL");
    $st->execute([(int) $order['id']]);
    if ($st->rowCount() === 0) jsonError('还没确认到账，不用撤销');
    opLog($pdo, 'order', (int) $order['id'], 'factory_rebate_revoke', $reason, (int) $user['id']);
    jsonOk();
}
