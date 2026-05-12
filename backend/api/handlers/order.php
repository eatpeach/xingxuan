<?php
/**
 * 订单履约：成交后的合同/付款/发票/返佣全流程
 */

function _nextOrderNo(PDO $pdo): string
{
    $datePart = date('Ymd');
    $like = 'SO' . $datePart . '%';
    $st = $pdo->prepare("SELECT no FROM orders WHERE no LIKE ? ORDER BY no DESC LIMIT 1");
    $st->execute([$like]);
    $last = (string) $st->fetchColumn();
    $seq = $last ? (int) substr($last, strlen('SO' . $datePart)) + 1 : 1;
    return 'SO' . $datePart . str_pad((string) $seq, 3, '0', STR_PAD_LEFT);
}

// ============ 成交状态 ============

function handle_setDealStatus(PDO $pdo, array $input, array $user): void
{
    $qid = (int) ($input['quote_id'] ?? 0);
    $status = (string) ($input['status'] ?? '');
    if (!$qid || !in_array($status, ['won', 'lost', 'pending'], true)) jsonError('参数错误');

    $st = $pdo->prepare("SELECT * FROM customer_quotes WHERE id = ?");
    $st->execute([$qid]);
    $q = $st->fetch();
    if (!$q) jsonError('报价单不存在', 404);

    $now = date('Y-m-d H:i:s');
    if ($status === 'won') {
        $pdo->prepare("UPDATE customer_quotes SET deal_status='won', won_at=?, lost_at=NULL, lost_reason='' WHERE id=?")
            ->execute([$now, $qid]);
        // 幂等：已有 order 就返回旧的
        $st = $pdo->prepare("SELECT * FROM orders WHERE quote_id = ? LIMIT 1");
        $st->execute([$qid]);
        $existing = $st->fetch();
        if ($existing) {
            jsonOk(['order_id' => (int) $existing['id'], 'order_no' => $existing['no'], 'already' => true]);
            return;
        }
        $no = _nextOrderNo($pdo);
        $pdo->prepare("INSERT INTO orders (no, quote_id, customer_id, status, total_amount, currency, created_by)
            VALUES (?, ?, ?, 'pending_contract', ?, ?, ?)")
            ->execute([$no, $qid, (int) $q['customer_id'], (float) $q['total'], (string) ($q['currency'] ?: 'IDR'), (int) $user['id']]);
        $oid = (int) $pdo->lastInsertId();
        opLog($pdo, 'order', $oid, 'create_from_quote', $no, (int) $user['id']);
        jsonOk(['order_id' => $oid, 'order_no' => $no]);
    } elseif ($status === 'lost') {
        $reason = trim((string) ($input['reason'] ?? ''));
        $pdo->prepare("UPDATE customer_quotes SET deal_status='lost', lost_at=?, lost_reason=?, won_at=NULL WHERE id=?")
            ->execute([$now, $reason, $qid]);
        opLog($pdo, 'customer_quote', $qid, 'mark_lost', $reason, (int) $user['id']);
        jsonOk();
    } else {
        $pdo->prepare("UPDATE customer_quotes SET deal_status='pending', won_at=NULL, lost_at=NULL, lost_reason='' WHERE id=?")
            ->execute([$qid]);
        jsonOk();
    }
}

// ============ 订单 ============

function handle_listOrders(PDO $pdo, array $input): void
{
    $where = '1=1';
    $params = [];
    if (!empty($input['status'])) {
        $where .= " AND o.status = ?";
        $params[] = $input['status'];
    }
    if (!empty($input['keyword'])) {
        $kw = '%' . trim($input['keyword']) . '%';
        $where .= " AND (o.no LIKE ? OR c.name LIKE ? OR c.short_name LIKE ? OR c.code LIKE ?)";
        for ($i = 0; $i < 4; $i++) $params[] = $kw;
    }
    $page = pageInt($input['page'] ?? 1, 1);
    $size = pageInt($input['page_size'] ?? 20, 20, 1, 200);
    $sql = "SELECT o.*, c.name AS customer_name, c.short_name AS customer_short_name, c.code AS customer_code,
                   q.no AS quote_no, q.invoice_no
            FROM orders o
            LEFT JOIN customers c ON c.id = o.customer_id
            LEFT JOIN customer_quotes q ON q.id = o.quote_id
            WHERE {$where} ORDER BY o.id DESC";
    $countSql = "SELECT COUNT(*) FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE {$where}";
    jsonOk(paginate($pdo, $sql, $params, $page, $size, $countSql));
}

function _loadOrder(PDO $pdo, int $id): array
{
    $st = $pdo->prepare("SELECT o.*, c.name AS customer_name, c.short_name AS customer_short_name,
                                c.code AS customer_code, c.company AS customer_company, c.phone AS customer_phone,
                                q.no AS quote_no, q.invoice_no, q.invoice_due_at, q.paid_at AS quote_paid_at,
                                s.name AS salesperson_name
                         FROM orders o
                         LEFT JOIN customers c ON c.id = o.customer_id
                         LEFT JOIN customer_quotes q ON q.id = o.quote_id
                         LEFT JOIN salespersons s ON s.id = o.salesperson_id
                         WHERE o.id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('订单不存在', 404);
    return $row;
}

function handle_getOrder(PDO $pdo, array $input): void
{
    $oid = (int) ($input['id'] ?? 0);
    $order = _loadOrder($pdo, $oid);
    // 子记录
    $st = $pdo->prepare("SELECT * FROM contracts WHERE order_id = ? ORDER BY id DESC");
    $st->execute([$oid]);
    $contracts = $st->fetchAll();
    $st = $pdo->prepare("SELECT * FROM payments WHERE order_id = ? ORDER BY id ASC");
    $st->execute([$oid]);
    $payments = $st->fetchAll();
    $st = $pdo->prepare("SELECT * FROM commissions WHERE order_id = ? ORDER BY id ASC");
    $st->execute([$oid]);
    $commissions = $st->fetchAll();
    $paidSum = array_sum(array_map(fn($p) => (float) $p['amount'], $payments));
    jsonOk([
        'order' => $order,
        'contracts' => $contracts,
        'payments' => $payments,
        'commissions' => $commissions,
        'paid_sum' => $paidSum,
    ]);
}

function handle_updateOrder(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $fields = ['status', 'salesperson_id', 'channel_partner_id', 'commission_rule_json', 'remark'];
    $sets = [];
    $params = [];
    foreach ($fields as $f) {
        if (array_key_exists($f, $input)) {
            $sets[] = "{$f} = ?";
            $params[] = $input[$f];
        }
    }
    if (empty($sets)) jsonError('无字段更新');
    $sets[] = "updated_at = datetime('now','localtime')";
    $params[] = $id;
    $pdo->prepare("UPDATE orders SET " . implode(',', $sets) . " WHERE id = ?")->execute($params);
    opLog($pdo, 'order', $id, 'update', '', (int) $user['id']);
    jsonOk();
}

// ============ 合同 ============

function _defaultContractCn(array $order): string
{
    return "甲方（卖方）：星选建材\n乙方（买方）：{$order['customer_name']}\n\n"
        . "合同编号：{$order['no']}\n签订日期：" . date('Y-m-d') . "\n\n"
        . "一、合同标的：见报价单 {$order['quote_no']} 所列商品明细\n"
        . "二、合同总金额：" . ($order['currency'] === 'CNY' ? '¥' : 'Rp') . ' ' . number_format((float) $order['total_amount']) . "\n"
        . "三、付款方式：见报价单条款\n"
        . "四、交货方式：工厂自提 / 双方另行约定\n"
        . "五、质量标准：按中国国家标准执行，如有异议应于到货当日提出\n"
        . "六、违约责任：按印尼商业惯例与合同法相关规定执行\n"
        . "七、争议解决：双方友好协商；协商不成提交印尼仲裁机构裁决\n"
        . "八、本合同自双方签字盖章之日起生效";
}

function _defaultContractId(array $order): string
{
    return "Pihak Pertama (Penjual): Xing Xuan Bahan Bangunan\nPihak Kedua (Pembeli): {$order['customer_name']}\n\n"
        . "Nomor Kontrak: {$order['no']}\nTanggal: " . date('Y-m-d') . "\n\n"
        . "I. Objek Kontrak: sesuai daftar barang pada Quotation {$order['quote_no']}\n"
        . "II. Total Nilai Kontrak: " . ($order['currency'] === 'CNY' ? 'CNY' : 'Rp') . ' ' . number_format((float) $order['total_amount']) . "\n"
        . "III. Metode Pembayaran: sesuai ketentuan pada Quotation\n"
        . "IV. Pengiriman: Ambil sendiri di pabrik / sesuai kesepakatan para pihak\n"
        . "V. Standar Mutu: sesuai standar nasional Tiongkok; keberatan harus diajukan pada hari penerimaan barang\n"
        . "VI. Wanprestasi: sesuai dengan praktik bisnis Indonesia dan ketentuan hukum kontrak\n"
        . "VII. Penyelesaian Sengketa: musyawarah; jika gagal diajukan ke lembaga arbitrase Indonesia\n"
        . "VIII. Kontrak ini berlaku sejak ditandatangani oleh kedua belah pihak";
}

function handle_createContract(PDO $pdo, array $input, array $user): void
{
    $oid = (int) ($input['order_id'] ?? 0);
    if (!$oid) jsonError('参数缺失');
    $order = _loadOrder($pdo, $oid);
    $contentCn = $input['content_cn'] ?? _defaultContractCn($order);
    $contentId = $input['content_id'] ?? _defaultContractId($order);
    $st = $pdo->prepare("SELECT MAX(version) FROM contracts WHERE order_id = ?");
    $st->execute([$oid]);
    $version = ((int) $st->fetchColumn()) + 1;
    $pdo->prepare("INSERT INTO contracts (order_id, version, content_cn, content_id, status)
        VALUES (?, ?, ?, ?, 'pending')")
        ->execute([$oid, $version, $contentCn, $contentId]);
    $cid = (int) $pdo->lastInsertId();
    opLog($pdo, 'contract', $cid, 'create', 'v' . $version, (int) $user['id']);
    jsonOk(['id' => $cid, 'version' => $version]);
}

function handle_updateContract(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $sets = [];
    $params = [];
    foreach (['content_cn', 'content_id', 'status'] as $f) {
        if (array_key_exists($f, $input)) {
            $sets[] = "{$f} = ?";
            $params[] = $input[$f];
        }
    }
    if (!empty($input['status']) && $input['status'] === 'signed') {
        $sets[] = "signed_at = datetime('now','localtime')";
    }
    if (empty($sets)) jsonError('无字段更新');
    $sets[] = "updated_at = datetime('now','localtime')";
    $params[] = $id;
    $pdo->prepare("UPDATE contracts SET " . implode(',', $sets) . " WHERE id = ?")->execute($params);
    opLog($pdo, 'contract', $id, 'update', '', (int) $user['id']);
    jsonOk();
}

function handle_deleteContract(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $pdo->prepare("DELETE FROM contracts WHERE id = ?")->execute([$id]);
    opLog($pdo, 'contract', $id, 'delete', '', (int) $user['id']);
    jsonOk();
}

// ============ 付款 ============

function handle_addPayment(PDO $pdo, array $input, array $user): void
{
    $oid = (int) ($input['order_id'] ?? 0);
    $amount = (float) ($input['amount'] ?? 0);
    if (!$oid || $amount <= 0) jsonError('参数错误');
    $pdo->prepare("INSERT INTO payments (order_id, type, amount, method, paid_at, voucher_path, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?)")
        ->execute([
            $oid,
            (string) ($input['type'] ?? 'deposit'),
            $amount,
            (string) ($input['method'] ?? ''),
            $input['paid_at'] ?? date('Y-m-d H:i:s'),
            (string) ($input['voucher_path'] ?? ''),
            (string) ($input['remark'] ?? ''),
        ]);
    opLog($pdo, 'payment', (int) $pdo->lastInsertId(), 'add', (string) $amount, (int) $user['id']);
    jsonOk();
}

function handle_deletePayment(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $pdo->prepare("DELETE FROM payments WHERE id = ?")->execute([$id]);
    opLog($pdo, 'payment', $id, 'delete', '', (int) $user['id']);
    jsonOk();
}

// ============ 返佣 ============

function handle_addCommission(PDO $pdo, array $input, array $user): void
{
    $oid = (int) ($input['order_id'] ?? 0);
    $amount = (float) ($input['amount'] ?? 0);
    if (!$oid) jsonError('参数错误');
    $bid = (int) ($input['beneficiary_id'] ?? 0) ?: null;
    $bname = (string) ($input['beneficiary_name'] ?? '');
    if ($bid && !$bname) {
        $st = $pdo->prepare("SELECT name FROM salespersons WHERE id = ?");
        $st->execute([$bid]);
        $bname = (string) $st->fetchColumn();
    }
    $pdo->prepare("INSERT INTO commissions (order_id, beneficiary_id, beneficiary_name, rule_snapshot, amount, status, remark)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)")
        ->execute([
            $oid, $bid, $bname,
            (string) ($input['rule_snapshot'] ?? ''),
            $amount,
            (string) ($input['remark'] ?? ''),
        ]);
    opLog($pdo, 'commission', (int) $pdo->lastInsertId(), 'add', (string) $amount, (int) $user['id']);
    jsonOk();
}

function handle_updateCommission(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $sets = [];
    $params = [];
    foreach (['amount', 'status', 'voucher_path', 'remark'] as $f) {
        if (array_key_exists($f, $input)) {
            $sets[] = "{$f} = ?";
            $params[] = $input[$f];
        }
    }
    if (!empty($input['status']) && $input['status'] === 'settled') {
        $sets[] = "settled_at = datetime('now','localtime')";
    }
    if (empty($sets)) jsonError('无字段更新');
    $params[] = $id;
    $pdo->prepare("UPDATE commissions SET " . implode(',', $sets) . " WHERE id = ?")->execute($params);
    opLog($pdo, 'commission', $id, 'update', '', (int) $user['id']);
    jsonOk();
}

function handle_deleteCommission(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $pdo->prepare("DELETE FROM commissions WHERE id = ?")->execute([$id]);
    opLog($pdo, 'commission', $id, 'delete', '', (int) $user['id']);
    jsonOk();
}

// ============ 业务员 ============

function handle_listSalespersons(PDO $pdo): void
{
    $rows = $pdo->query("SELECT * FROM salespersons ORDER BY id DESC")->fetchAll();
    jsonOk(['items' => $rows]);
}
function handle_createSalesperson(PDO $pdo, array $input, array $user): void
{
    $pdo->prepare("INSERT INTO salespersons (name, type, phone, wechat, commission_default_pct, remark)
        VALUES (?, ?, ?, ?, ?, ?)")
        ->execute([
            trim((string) ($input['name'] ?? '')),
            (string) ($input['type'] ?? 'sales'),
            (string) ($input['phone'] ?? ''),
            (string) ($input['wechat'] ?? ''),
            (float) ($input['commission_default_pct'] ?? 5),
            (string) ($input['remark'] ?? ''),
        ]);
    jsonOk(['id' => (int) $pdo->lastInsertId()]);
}
function handle_updateSalesperson(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $pdo->prepare("UPDATE salespersons SET name=?, type=?, phone=?, wechat=?, commission_default_pct=?, remark=? WHERE id=?")
        ->execute([
            trim((string) ($input['name'] ?? '')),
            (string) ($input['type'] ?? 'sales'),
            (string) ($input['phone'] ?? ''),
            (string) ($input['wechat'] ?? ''),
            (float) ($input['commission_default_pct'] ?? 5),
            (string) ($input['remark'] ?? ''),
            $id,
        ]);
    jsonOk();
}
function handle_deleteSalesperson(PDO $pdo, array $input): void
{
    $pdo->prepare("DELETE FROM salespersons WHERE id = ?")->execute([(int) ($input['id'] ?? 0)]);
    jsonOk();
}
