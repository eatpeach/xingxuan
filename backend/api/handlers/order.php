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
                   q.no AS quote_no, q.invoice_no, q.paid_at AS invoice_paid_at,
                   (SELECT COUNT(*) FROM contracts WHERE order_id = o.id) AS contracts_count,
                   (SELECT COUNT(*) FROM contracts WHERE order_id = o.id AND status='signed') AS contracts_signed,
                   (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE order_id = o.id) AS paid_sum,
                   (SELECT COUNT(*) FROM payments WHERE order_id = o.id) AS payments_count,
                   (SELECT COUNT(*) FROM commissions WHERE order_id = o.id) AS commissions_count,
                   (SELECT COUNT(*) FROM commissions WHERE order_id = o.id AND status='paid') AS commissions_paid
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

function _defaultContractClauses(array $order, PDO $pdo): array
{
    $sym = $order['currency'] === 'CNY' ? '¥' : 'Rp';
    $amt = $sym . ' ' . number_format((float) $order['total_amount']);
    $companyName = getSetting($pdo, 'company_name', '星选建材');
    $bankName = getSetting($pdo, 'bank_name', 'BCA');
    $bankNo = getSetting($pdo, 'bank_account_no', '');
    $bankHolder = getSetting($pdo, 'bank_account_name', '');
    $today = date('Y-m-d');
    $contractNo = (string) $order['no'];
    $customer = (string) $order['customer_name'];
    $quoteNo = (string) ($order['quote_no'] ?? '');

    return [
        [
            'title_cn' => '合同信息',
            'body_cn' => "合同编号：{$contractNo}\n签订日期：{$today}\n关联报价单：{$quoteNo}",
            'title_id' => 'Informasi Kontrak',
            'body_id' => "Nomor Kontrak: {$contractNo}\nTanggal: {$today}\nQuotation Terkait: {$quoteNo}",
        ],
        [
            'title_cn' => '一、合同双方 / Para Pihak',
            'body_cn' => "甲方（卖方）：{$companyName}\n乙方（买方）：{$customer}",
            'title_id' => 'I. Para Pihak',
            'body_id' => "Pihak Pertama (Penjual): {$companyName}\nPihak Kedua (Pembeli): {$customer}",
        ],
        [
            'title_cn' => '二、合同标的',
            'body_cn' => "本合同标的为甲方提供给乙方的建材商品，具体品名、规格、数量、单价见所附报价单 {$quoteNo}，作为本合同不可分割的一部分。",
            'title_id' => 'II. Objek Kontrak',
            'body_id' => "Objek kontrak adalah bahan bangunan yang disediakan oleh Pihak Pertama kepada Pihak Kedua. Detail produk, spesifikasi, jumlah dan harga satuan tercantum pada Quotation {$quoteNo} terlampir, yang merupakan bagian tidak terpisahkan dari kontrak ini.",
        ],
        [
            'title_cn' => '三、合同总金额',
            'body_cn' => "本合同总金额为 {$amt}，已包含税费（如适用）。\n如最终交付数量与报价单不符，按实际交付数量结算。",
            'title_id' => 'III. Total Nilai Kontrak',
            'body_id' => "Total nilai kontrak ini adalah {$amt}, sudah termasuk pajak (jika berlaku).\nApabila jumlah barang yang diserahkan berbeda dengan Quotation, penyelesaian dilakukan berdasarkan jumlah aktual yang diserahkan.",
        ],
        [
            'title_cn' => '四、付款方式',
            'body_cn' => "1. 乙方应在合同签订后 3 个工作日内支付定金（合同金额的 30%）；\n2. 余款于发货前一次性付清，或按双方书面约定的分期方式支付；\n3. 收款账户：{$bankName} / {$bankNo} / {$bankHolder}；\n4. 转账时须备注合同编号 {$contractNo}，款项到达甲方账户即视为有效付款。",
            'title_id' => 'IV. Metode Pembayaran',
            'body_id' => "1. Pihak Kedua wajib membayar uang muka (30% dari nilai kontrak) dalam 3 hari kerja setelah penandatanganan kontrak;\n2. Sisa pembayaran dilunasi sebelum pengiriman, atau dibayar secara mengangsur sesuai kesepakatan tertulis kedua belah pihak;\n3. Rekening Penerima: {$bankName} / {$bankNo} / {$bankHolder};\n4. Pada saat transfer wajib mencantumkan nomor kontrak {$contractNo}. Pembayaran dianggap sah setelah dana masuk ke rekening Pihak Pertama.",
        ],
        [
            'title_cn' => '五、交货方式与时间',
            'body_cn' => "1. 交货方式：工厂自提（默认）/ 由甲方代为安排物流；\n2. 交货时间：在乙方支付定金且确认订单后 7-15 个工作日内备货完毕，具体以双方书面确认为准；\n3. 交货地点：双方另行书面约定。",
            'title_id' => 'V. Metode dan Waktu Pengiriman',
            'body_id' => "1. Metode pengiriman: Diambil sendiri di pabrik (default) atau diatur oleh Pihak Pertama;\n2. Waktu pengiriman: 7-15 hari kerja setelah pembayaran uang muka dan konfirmasi pesanan, dengan konfirmasi tertulis kedua belah pihak;\n3. Tempat penyerahan: ditentukan secara terpisah secara tertulis oleh kedua belah pihak.",
        ],
        [
            'title_cn' => '六、验收与质量标准',
            'body_cn' => "1. 商品按中国国家相关行业标准生产与检验；\n2. 乙方应在收货当日完成验收，对数量、外观、规格的异议应于当日以书面方式提出，逾期视为验收合格；\n3. 隐蔽质量问题：自交货之日起 30 日内提出。",
            'title_id' => 'VI. Pemeriksaan dan Standar Mutu',
            'body_id' => "1. Barang diproduksi dan diuji sesuai standar industri nasional Tiongkok yang berlaku;\n2. Pihak Kedua wajib menyelesaikan pemeriksaan pada hari penerimaan barang. Keberatan terkait jumlah, tampilan dan spesifikasi harus diajukan secara tertulis pada hari yang sama. Jika lewat dari waktu tersebut, dianggap lulus pemeriksaan;\n3. Cacat tersembunyi: diajukan dalam waktu 30 hari sejak tanggal penyerahan barang.",
        ],
        [
            'title_cn' => '七、违约责任',
            'body_cn' => "1. 乙方逾期付款的，每逾期一日按未付款金额的 0.05% 支付违约金；\n2. 甲方逾期交货的，每逾期一日按已收款金额的 0.05% 支付违约金；\n3. 因不可抗力造成的延误，双方互不追究违约责任。",
            'title_id' => 'VII. Tanggung Jawab Wanprestasi',
            'body_id' => "1. Apabila Pihak Kedua terlambat membayar, denda 0,05% per hari dari jumlah yang belum dibayar;\n2. Apabila Pihak Pertama terlambat mengirim, denda 0,05% per hari dari jumlah yang telah diterima;\n3. Keterlambatan akibat force majeure tidak menimbulkan tanggung jawab wanprestasi bagi kedua belah pihak.",
        ],
        [
            'title_cn' => '八、不可抗力',
            'body_cn' => "因自然灾害、战争、政府行为、流行病等不可抗力事件导致一方无法履行合同的，应及时通知对方并提供有效证明，双方协商处理，互不承担违约责任。",
            'title_id' => 'VIII. Force Majeure',
            'body_id' => "Apabila pelaksanaan kontrak terhambat oleh peristiwa force majeure seperti bencana alam, perang, tindakan pemerintah, wabah penyakit dan sebagainya, pihak yang terdampak wajib segera memberitahukan pihak lain dengan bukti yang sah. Kedua belah pihak akan bermusyawarah dan tidak saling menuntut wanprestasi.",
        ],
        [
            'title_cn' => '九、保密条款',
            'body_cn' => "双方对履行本合同过程中获知的商业秘密负有保密义务，未经对方书面同意不得向第三方披露，本条款在合同终止后仍然有效。",
            'title_id' => 'IX. Kerahasiaan',
            'body_id' => "Kedua belah pihak wajib menjaga kerahasiaan informasi bisnis yang diperoleh selama pelaksanaan kontrak, tidak boleh diungkapkan kepada pihak ketiga tanpa persetujuan tertulis pihak lain. Klausul ini tetap berlaku setelah kontrak berakhir.",
        ],
        [
            'title_cn' => '十、争议解决',
            'body_cn' => "因本合同引起的任何争议，双方应首先通过友好协商解决；协商不成的，提交印尼当地有管辖权的仲裁机构裁决，仲裁结果对双方均具有约束力。",
            'title_id' => 'X. Penyelesaian Sengketa',
            'body_id' => "Setiap sengketa yang timbul dari kontrak ini diselesaikan terlebih dahulu melalui musyawarah. Apabila musyawarah tidak berhasil, sengketa diajukan ke lembaga arbitrase yang berwenang di Indonesia dan putusan arbitrase bersifat mengikat para pihak.",
        ],
        [
            'title_cn' => '十一、合同变更',
            'body_cn' => "本合同的任何修改、补充须由双方书面签署，口头约定不具法律效力。",
            'title_id' => 'XI. Perubahan Kontrak',
            'body_id' => "Setiap perubahan atau tambahan terhadap kontrak ini harus dibuat secara tertulis dan ditandatangani oleh kedua belah pihak. Kesepakatan lisan tidak memiliki kekuatan hukum.",
        ],
        [
            'title_cn' => '十二、合同生效',
            'body_cn' => "本合同自双方签字盖章之日起生效，一式两份，双方各执一份，具有同等法律效力。本合同中文与印尼文具有同等效力，如有歧义以中文为准。",
            'title_id' => 'XII. Pemberlakuan Kontrak',
            'body_id' => "Kontrak ini berlaku sejak ditandatangani dan distempel oleh kedua belah pihak, dibuat dalam dua rangkap, masing-masing pihak menyimpan satu rangkap, dan memiliki kekuatan hukum yang sama. Versi Bahasa Mandarin dan Indonesia memiliki kekuatan yang sama; apabila terjadi perbedaan penafsiran, versi Bahasa Mandarin yang berlaku.",
        ],
    ];
}

function handle_createContract(PDO $pdo, array $input, array $user): void
{
    $oid = (int) ($input['order_id'] ?? 0);
    if (!$oid) jsonError('参数缺失');
    $order = _loadOrder($pdo, $oid);
    $clauses = isset($input['clauses']) && is_array($input['clauses'])
        ? $input['clauses']
        : _defaultContractClauses($order, $pdo);
    $clausesJson = json_encode($clauses, JSON_UNESCAPED_UNICODE);

    $st = $pdo->prepare("SELECT MAX(version) FROM contracts WHERE order_id = ?");
    $st->execute([$oid]);
    $version = ((int) $st->fetchColumn()) + 1;
    $pdo->prepare("INSERT INTO contracts (order_id, version, clauses_json, status)
        VALUES (?, ?, ?, 'pending')")
        ->execute([$oid, $version, $clausesJson]);
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
    if (isset($input['clauses']) && is_array($input['clauses'])) {
        $sets[] = "clauses_json = ?";
        $params[] = json_encode($input['clauses'], JSON_UNESCAPED_UNICODE);
    }
    foreach (['status', 'signed_pdf_path'] as $f) {
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

// ============ 录入历史订单（一次性补录已完成的旧单） ============
/**
 * 输入：
 *   customer_id, order_date (YYYY-MM-DD), currency, tax_included, tax_rate,
 *   items: [{product_name, spec, qty, unit, sell_price, brand?, model?}],
 *   total_override?  (覆盖明细总额)
 *   payment_status:  none / partial / full,
 *   paid_amount?, paid_at?, payment_method?
 *   is_completed: 0/1, completed_at?
 *   salesperson_id?, commission_amount?, commission_status?
 *   issue_invoice: 0/1（是否同时生成发票号）
 *   bank_name? / bank_account_no? / bank_account_name?
 *   remark?
 */
function handle_importHistoricalOrder(PDO $pdo, array $input, array $user): void
{
    $cid = (int) ($input['customer_id'] ?? 0);
    if (!$cid) jsonError('请选择客户');
    $orderDate = (string) ($input['order_date'] ?? date('Y-m-d'));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $orderDate)) jsonError('日期格式应为 YYYY-MM-DD');
    $orderDt = $orderDate . ' 10:00:00';

    $items = $input['items'] ?? [];
    if (!is_array($items) || empty($items)) jsonError('请至少填一行明细');

    $valid = [];
    $sumTotal = 0.0;
    foreach ($items as $it) {
        $name = trim((string) ($it['product_name'] ?? ''));
        $qty = (float) ($it['qty'] ?? 0);
        $sell = (float) ($it['sell_price'] ?? 0);
        if ($name === '' || $qty <= 0 || $sell <= 0) continue;
        $valid[] = [
            'product_name' => $name,
            'spec' => (string) ($it['spec'] ?? ''),
            'unit' => (string) ($it['unit'] ?? '件') ?: '件',
            'qty' => $qty,
            'sell_price' => $sell,
            'brand' => (string) ($it['brand'] ?? ''),
            'model' => (string) ($it['model'] ?? ''),
        ];
        $sumTotal += $qty * $sell;
    }
    if (empty($valid)) jsonError('明细行需有产品名 / 数量 / 单价');

    $total = isset($input['total_override']) && (float) $input['total_override'] > 0
        ? (float) $input['total_override']
        : $sumTotal;

    $taxIncluded = isset($input['tax_included']) ? (int) (bool) $input['tax_included'] : 1;
    $taxRate = isset($input['tax_rate']) ? (float) $input['tax_rate'] : 0.11;
    $currency = strtoupper((string) ($input['currency'] ?? 'IDR'));
    if (!in_array($currency, ['IDR', 'CNY'], true)) $currency = 'IDR';

    $paymentStatus = (string) ($input['payment_status'] ?? 'none'); // none / partial / full
    $paidAmount = (float) ($input['paid_amount'] ?? 0);
    if ($paymentStatus === 'full') $paidAmount = $total;
    $paidAt = (string) ($input['paid_at'] ?? '') ?: ($paidAmount > 0 ? $orderDt : null);
    if ($paidAt && preg_match('/^\d{4}-\d{2}-\d{2}$/', $paidAt)) $paidAt .= ' 12:00:00';

    $isCompleted = (int) (bool) ($input['is_completed'] ?? 0);
    $completedAt = (string) ($input['completed_at'] ?? '');
    if ($isCompleted && !$completedAt) $completedAt = $paidAt ?: $orderDt;
    if ($completedAt && preg_match('/^\d{4}-\d{2}-\d{2}$/', $completedAt)) $completedAt .= ' 18:00:00';

    $issueInvoice = (int) (bool) ($input['issue_invoice'] ?? 0);
    $remark = (string) ($input['remark'] ?? '');

    $pdo->beginTransaction();
    try {
        // 1. 询价
        $inqNo = nextInquiryNo($pdo);
        $title = '历史订单 - ' . $orderDate;
        $pdo->prepare("INSERT INTO inquiries
            (no, customer_id, title, status, remark, created_by,
             tax_included, tax_rate, currency, created_at, updated_at)
            VALUES (?, ?, ?, 'won', ?, ?, ?, ?, ?, ?, ?)")
            ->execute([
                $inqNo, $cid, $title, '历史订单补录: ' . $remark,
                (int) $user['id'],
                $taxIncluded, $taxRate, $currency,
                $orderDt, $orderDt,
            ]);
        $iid = (int) $pdo->lastInsertId();

        $insIi = $pdo->prepare("INSERT INTO inquiry_items
            (inquiry_id, line_no, product_name, spec, unit, qty, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?)");
        $iiIds = [];
        foreach ($valid as $idx => $v) {
            $insIi->execute([$iid, $idx + 1, $v['product_name'], $v['spec'], $v['unit'], $v['qty'], '']);
            $iiIds[] = (int) $pdo->lastInsertId();
        }

        // 2. 客户报价 + 标记成交/已付款 + 可选开票
        $cqNo = nextCustomerQuoteNo($pdo);
        $validUntil = date('Y-m-d 23:59:59', strtotime($orderDate . ' +30 days'));
        $invoiceNo = null;
        $invoiceIssuedAt = null;
        $invoiceDueAt = null;
        if ($issueInvoice) {
            $invoiceNo = _nextInvoiceNo($pdo);
            $invoiceIssuedAt = $orderDt;
            $invoiceDueAt = date('Y-m-d 23:59:59', strtotime($orderDate . ' +30 days'));
        }
        $bankName = (string) ($input['bank_name'] ?? '');
        $bankNo = (string) ($input['bank_account_no'] ?? '');
        $bankHolder = (string) ($input['bank_account_name'] ?? '');

        $pdo->prepare("INSERT INTO customer_quotes
            (no, inquiry_id, customer_id, status, markup_strategy, total, valid_until, remark, created_by,
             tax_included, tax_rate, currency,
             invoice_no, invoice_issued_at, invoice_due_at,
             invoice_bank_name, invoice_bank_account_no, invoice_bank_account_name,
             deal_status, won_at, paid_at,
             created_at, updated_at)
            VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'won', ?, ?, ?, ?)")
            ->execute([
                $cqNo, $iid, $cid,
                json_encode(['type' => 'imported'], JSON_UNESCAPED_UNICODE),
                $total, $validUntil, $remark, (int) $user['id'],
                $taxIncluded, $taxRate, $currency,
                $invoiceNo, $invoiceIssuedAt, $invoiceDueAt,
                $bankName, $bankNo, $bankHolder,
                $orderDt, // won_at
                $paymentStatus === 'full' ? ($paidAt ?: $orderDt) : null, // paid_at on quote
                $orderDt, $orderDt,
            ]);
        $qid = (int) $pdo->lastInsertId();

        $insCq = $pdo->prepare("INSERT INTO customer_quote_items
            (quote_id, inquiry_item_id, source_supplier_quote_item_id, show_brand, brand_display, model_display,
             product_name, spec, unit, qty, cost_price, sell_price, markup_amount, remark)
            VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, '')");
        foreach ($valid as $idx => $v) {
            $insCq->execute([
                $qid, $iiIds[$idx],
                $v['brand'], $v['model'],
                $v['product_name'], $v['spec'], $v['unit'], $v['qty'],
                $v['sell_price'], $v['sell_price'],
            ]);
        }

        // 3. 订单
        $orderNo = _nextOrderNo($pdo);
        $orderStatus = $isCompleted ? 'completed' : ($paidAmount > 0 ? 'in_progress' : 'pending_contract');
        $salespersonId = (int) ($input['salesperson_id'] ?? 0) ?: null;
        $pdo->prepare("INSERT INTO orders
            (no, quote_id, customer_id, status, total_amount, currency,
             salesperson_id, completed_at, completion_remark, remark, created_by,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            ->execute([
                $orderNo, $qid, $cid,
                $orderStatus, $total, $currency,
                $salespersonId,
                $isCompleted ? $completedAt : null,
                $isCompleted ? '历史订单补录完结' : '',
                $remark,
                (int) $user['id'],
                $orderDt, $orderDt,
            ]);
        $oid = (int) $pdo->lastInsertId();

        // 4. 付款记录
        if ($paidAmount > 0) {
            $pdo->prepare("INSERT INTO payments
                (order_id, type, amount, method, paid_at, remark, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)")
                ->execute([
                    $oid,
                    $paymentStatus === 'full' ? 'full' : 'deposit',
                    $paidAmount,
                    (string) ($input['payment_method'] ?? '历史补录'),
                    $paidAt ?: $orderDt,
                    '补录',
                    $orderDt,
                ]);
        }

        // 5. 返佣
        $commissionAmount = (float) ($input['commission_amount'] ?? 0);
        if ($salespersonId && $commissionAmount > 0) {
            $stB = $pdo->prepare("SELECT name FROM salespersons WHERE id = ?");
            $stB->execute([$salespersonId]);
            $bname = (string) $stB->fetchColumn();
            $commStatus = (string) ($input['commission_status'] ?? ($isCompleted ? 'paid' : 'pending'));
            $pdo->prepare("INSERT INTO commissions
                (order_id, beneficiary_id, beneficiary_name, amount, status, settled_at, remark, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                ->execute([
                    $oid, $salespersonId, $bname, $commissionAmount,
                    $commStatus,
                    $commStatus === 'paid' ? ($completedAt ?: $orderDt) : null,
                    '历史补录',
                    $orderDt,
                ]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        jsonError('录入失败：' . $e->getMessage(), 500);
    }

    opLog($pdo, 'order', $oid, 'import_historical', $orderNo, (int) $user['id']);
    jsonOk([
        'order_id' => $oid,
        'order_no' => $orderNo,
        'quote_id' => $qid,
        'quote_no' => $cqNo,
        'invoice_no' => $invoiceNo,
    ]);
}

// ============ 通用凭证上传（图片 / PDF） ============
function handle_uploadVoucher(PDO $pdo, array $input, array $user): void
{
    if (empty($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        jsonError('请上传文件');
    }
    $f = $_FILES['file'];
    if ((int) $f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败 code=' . (int) $f['error']);
    if ((int) $f['size'] > 20 * 1024 * 1024) jsonError('文件不能超过 20MB');

    $entity = preg_replace('/[^a-z]/', '', strtolower((string) ($_POST['entity'] ?? 'misc'))) ?: 'misc';
    $entityId = (int) ($_POST['entity_id'] ?? 0);

    $base = __DIR__ . '/../../storage/vouchers/' . $entity . '/' . ($entityId ?: 'misc');
    if (!is_dir($base)) @mkdir($base, 0775, true);
    $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
    if (!preg_match('/^[a-z0-9]{1,5}$/', $ext)) $ext = 'bin';
    $name = date('YmdHis') . '_' . substr(md5($f['name'] . rand()), 0, 6) . '.' . $ext;
    $abs = $base . '/' . $name;
    if (!move_uploaded_file($f['tmp_name'], $abs)) jsonError('保存失败');
    $rel = 'vouchers/' . $entity . '/' . ($entityId ?: 'misc') . '/' . $name;
    // 公开 URL：/storage/<rel>
    $url = '/storage/' . $rel;

    // 若指定了 entity + entity_id，自动绑定到对应表
    if ($entityId > 0) {
        if ($entity === 'payment') {
            $pdo->prepare("UPDATE payments SET voucher_path = ? WHERE id = ?")->execute([$url, $entityId]);
        } elseif ($entity === 'commission') {
            $pdo->prepare("UPDATE commissions SET voucher_path = ? WHERE id = ?")->execute([$url, $entityId]);
        } elseif ($entity === 'contract') {
            $pdo->prepare("UPDATE contracts SET signed_pdf_path = ? WHERE id = ?")->execute([$url, $entityId]);
        } elseif ($entity === 'order') {
            $pdo->prepare("UPDATE orders SET completion_voucher_path = ? WHERE id = ?")->execute([$url, $entityId]);
        }
    }
    opLog($pdo, 'voucher', $entityId, 'upload', "{$entity}: {$name}", (int) ($user['id'] ?? 0));
    jsonOk(['url' => $url, 'name' => $f['name']]);
}

// ============ 完成订单 ============
function handle_completeOrder(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $remark = (string) ($input['remark'] ?? '');
    $now = date('Y-m-d H:i:s');
    $pdo->prepare("UPDATE orders SET status='completed', completed_at=?, completion_remark=?,
        updated_at=datetime('now','localtime') WHERE id = ?")
        ->execute([$now, $remark, $id]);
    opLog($pdo, 'order', $id, 'complete', $remark, (int) $user['id']);
    jsonOk();
}

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
