<?php

function handle_dashboardOverview(PDO $pdo, array $user): void
{
    $q = fn (string $sql) => (int) $pdo->query($sql)->fetchColumn();

    // 销售只看自己客户的数字。这几段直接拼进 WHERE —— uid 是整数、来自已鉴权的 token，
    // 没有注入面；这些查询本来就是 $pdo->query() 不带参数的写法
    $uid = (int) ($user['id'] ?? 0);
    $scoped = isSalesScoped($user);
    $ordScope = $scoped ? " AND o.customer_id IN (SELECT id FROM customers WHERE owner_id = {$uid})" : '';
    $cusScope = $scoped ? " WHERE owner_id = {$uid}" : '';
    $cusAnd   = $scoped ? " AND owner_id = {$uid}" : '';
    $inqScope = $scoped ? " WHERE customer_id IN (SELECT id FROM customers WHERE owner_id = {$uid})" : '';
    $inqAnd   = $scoped ? " AND customer_id IN (SELECT id FROM customers WHERE owner_id = {$uid})" : '';
    $qScope   = $scoped ? " AND customer_id IN (SELECT id FROM customers WHERE owner_id = {$uid})" : '';

    $today = date('Y-m-d');
    $monthStart = date('Y-m-01');
    $monthEnd = date('Y-m-t');

    $dealWhere = "WHERE o.status IN ('in_progress','completed','pending_contract') AND o.deal_confirmed_at IS NOT NULL{$ordScope}";

    // 按货币分组的总成交额
    $byCurrency = $pdo->query("
        SELECT currency, COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS total
        FROM orders o {$dealWhere}
        GROUP BY currency
    ")->fetchAll();

    // 各货币已收款
    $paidByCurrency = $pdo->query("
        SELECT o.currency, COALESCE(SUM(p.amount), 0) AS paid
        FROM orders o
        LEFT JOIN payments p ON p.order_id = o.id
        {$dealWhere}
        GROUP BY o.currency
    ")->fetchAll();
    $paidMap = [];
    foreach ($paidByCurrency as $r) $paidMap[$r['currency']] = (float) $r['paid'];

    // 本月新成交
    $thisMonth = $pdo->query("
        SELECT currency, COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS total
        FROM orders o
        WHERE o.status IN ('in_progress','completed','pending_contract') AND o.deal_confirmed_at IS NOT NULL{$ordScope}
          AND date(o.deal_confirmed_at) >= '{$monthStart}' AND date(o.deal_confirmed_at) <= '{$monthEnd}'
        GROUP BY currency
    ")->fetchAll();

    // 今日新成交
    $todayDeals = $pdo->query("
        SELECT currency, COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS total
        FROM orders o
        WHERE o.status IN ('in_progress','completed','pending_contract') AND o.deal_confirmed_at IS NOT NULL{$ordScope}
          AND date(o.deal_confirmed_at) = '{$today}'
        GROUP BY currency
    ")->fetchAll();

    // 已开单、还没确认到账：按币种给单数和金额
    $pendingConfirm = $pdo->query("
        SELECT o.currency, COUNT(*) AS cnt, COALESCE(SUM(o.total_amount),0) AS total
        FROM orders o
        WHERE o.status IN ('in_progress','completed','pending_contract') AND o.deal_confirmed_at IS NULL{$ordScope}
        GROUP BY o.currency
    ")->fetchAll();
    // 本月撤销成交次数（按日志算：撤销又确认、再撤销，算两次）
    $revokedMonth = $q("SELECT COUNT(*) FROM deal_confirm_logs l JOIN orders o ON o.id = l.order_id
        WHERE l.action = 'revoke' AND date(l.created_at) >= '{$monthStart}'{$ordScope}");

    $completedCount = $q("SELECT COUNT(*) FROM orders o WHERE o.status='completed' AND o.deal_confirmed_at IS NOT NULL{$ordScope}");
    $inProgressCount = $q("SELECT COUNT(*) FROM orders o WHERE o.status='in_progress' AND o.deal_confirmed_at IS NOT NULL{$ordScope}");

    // 按供应商汇总
    $bySupplier = $pdo->query("
        SELECT supplier_name, currency, COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS total
        FROM orders o {$dealWhere} AND supplier_name != ''
        GROUP BY supplier_name, currency
        ORDER BY total DESC
        LIMIT 10
    ")->fetchAll();

    // 最近 12 个月每月成交
    $monthly = $pdo->query("
        SELECT strftime('%Y-%m', o.deal_confirmed_at) AS ym,
               currency,
               COUNT(*) AS cnt,
               COALESCE(SUM(total_amount),0) AS total
        FROM orders o
        WHERE o.status IN ('in_progress','completed','pending_contract') AND o.deal_confirmed_at IS NOT NULL{$ordScope}
          AND date(o.deal_confirmed_at) >= date('now','-12 months','localtime')
        GROUP BY ym, currency
        ORDER BY ym
    ")->fetchAll();

    // 最近 10 单成交流水
    $recentDeals = $pdo->query("
        SELECT o.id, o.no, o.contract_no, o.total_amount, o.currency, o.status, o.created_at, o.deal_confirmed_at,
               o.supplier_name, c.name AS customer_name, c.short_name AS customer_short_name
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.status IN ('in_progress','completed','pending_contract') AND o.deal_confirmed_at IS NOT NULL{$ordScope}
        ORDER BY o.deal_confirmed_at DESC, o.id DESC
        LIMIT 10
    ")->fetchAll();

    // 应收款订单（成交口径内、未收满）
    $unpaidOrders = $pdo->query("
        SELECT o.id, o.no, o.contract_no, o.currency, o.total_amount, o.status, o.created_at,
               (o.total_amount - COALESCE(pay.paid, 0) + COALESCE(rf.refunded, 0)) AS unpaid,
               c.code AS customer_code, c.name AS customer_name, c.short_name AS customer_short_name
        FROM orders o
        -- 只算财务已确认的收款，再减掉已退款：与订单页 / 财务管理同一口径。
        -- 原先 SUM 全部 payments，待确认的也算作已收，未收金额会偏小
        LEFT JOIN (SELECT order_id, SUM(amount) AS paid FROM payments WHERE status = 'confirmed' GROUP BY order_id) pay ON pay.order_id = o.id
        LEFT JOIN (SELECT order_id, SUM(amount) AS refunded FROM refunds WHERE status = 'done' GROUP BY order_id) rf ON rf.order_id = o.id
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.status IN ('in_progress','completed','pending_contract') AND o.deal_confirmed_at IS NOT NULL{$ordScope}
          AND (o.total_amount - COALESCE(pay.paid, 0) + COALESCE(rf.refunded, 0)) > 0.01
        ORDER BY unpaid DESC
        LIMIT 30
    ")->fetchAll();

    // 应收款看板（发票级，只读；20260810-11）
    // 判据（代码级确认，见单子结论）：一张发票 = customer_quotes.invoice_no 非空；
    // 「未收款」= 该发票 paid_at 为空（markInvoicePaid 手动标志）。
    // 注意：这与上面 unpaid_orders 是【两套不同口径】——那条是订单级 SUM(payments) 未收满，
    // 本条是发票级 paid_at 未标记。二者回答不同问题，不能混算。按到期日分三档。
    //
    // 🔴 只统计「起始日之后开具」的发票（invoice_issued_at >= receivables_since）。
    // 原因（CTO 裁决，20260810）：paid_at 目前没有可达的写入点（markInvoicePaid 只被死文件
    // Quotes.tsx 调用），历史发票 paid_at 恒为 NULL。若不设起始日，21 张历史发票会全被列成逾期
    // = 100% 假阳性。老板定「以前的数据不用管」——用统计口径实现，【绝不批量改历史数据伪造已收款】。
    // 起始日可在系统设置调整；界面上会显式写出统计范围。
    $today = date('Y-m-d');
    $soonCutoff = date('Y-m-d', strtotime('+7 days'));
    $arSince = trim(getSetting($pdo, 'receivables_since', '2026-08-10'));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $arSince)) $arSince = '2026-08-10'; // 防误配，兜底
    $arStmt = $pdo->prepare("
        SELECT q.id, q.no, q.invoice_no, q.invoice_issued_at, q.invoice_due_at, q.total, q.currency,
               c.code AS customer_code, c.name AS customer_name, c.short_name AS customer_short_name
        FROM customer_quotes q
        LEFT JOIN customers c ON c.id = q.customer_id
        WHERE q.invoice_no IS NOT NULL AND q.invoice_no != ''
          AND (q.paid_at IS NULL OR q.paid_at = '')
          AND q.invoice_issued_at IS NOT NULL AND date(q.invoice_issued_at) >= ?
          {$qScope}
        ORDER BY (q.invoice_due_at IS NULL OR q.invoice_due_at = ''), q.invoice_due_at ASC
    ");
    $arStmt->execute([$arSince]);
    $arRows = $arStmt->fetchAll();

    $arOverdue = [];
    $arDueSoon = [];
    $arSummary = [];
    foreach ($arRows as $r) {
        $cur = $r['currency'] ?: 'IDR';
        if (!isset($arSummary[$cur])) {
            $arSummary[$cur] = ['currency' => $cur, 'outstanding' => 0.0, 'overdue' => 0.0,
                'due_soon' => 0.0, 'not_due' => 0.0, 'count' => 0, 'overdue_count' => 0, 'due_soon_count' => 0];
        }
        $amt = (float) $r['total'];
        $arSummary[$cur]['outstanding'] += $amt;
        $arSummary[$cur]['count'] += 1;

        $due = !empty($r['invoice_due_at']) ? substr((string) $r['invoice_due_at'], 0, 10) : '';
        $tier = 'not_due';
        $days = 0;
        if ($due !== '') {
            if ($due < $today) {
                $tier = 'overdue';
                $days = (int) floor((strtotime($today) - strtotime($due)) / 86400);
            } elseif ($due <= $soonCutoff) {
                $tier = 'due_soon';
                $days = (int) floor((strtotime($due) - strtotime($today)) / 86400);
            }
        }
        $item = [
            'id' => (int) $r['id'], 'no' => $r['no'], 'invoice_no' => $r['invoice_no'],
            'due_at' => $r['invoice_due_at'], 'currency' => $cur, 'amount' => $amt, 'days' => $days,
            'customer_code' => $r['customer_code'], 'customer_name' => $r['customer_name'],
            'customer_short_name' => $r['customer_short_name'],
        ];
        if ($tier === 'overdue') {
            $arOverdue[] = $item;
            $arSummary[$cur]['overdue'] += $amt;
            $arSummary[$cur]['overdue_count'] += 1;
        } elseif ($tier === 'due_soon') {
            $arDueSoon[] = $item;
            $arSummary[$cur]['due_soon'] += $amt;
            $arSummary[$cur]['due_soon_count'] += 1;
        } else {
            $arSummary[$cur]['not_due'] += $amt;
        }
    }

    jsonOk([
        'receivables' => [
            'since' => $arSince,
            'summary' => array_values($arSummary),
            'overdue' => $arOverdue,
            'due_soon' => $arDueSoon,
        ],
        'overview' => [
            'customers' => $q("SELECT COUNT(*) FROM customers{$cusScope}"),
            'customers_new_month' => $q("SELECT COUNT(*) FROM customers WHERE date(created_at) >= '{$monthStart}'{$cusAnd}"),
            'inquiries_total' => $q("SELECT COUNT(*) FROM inquiries{$inqScope}"),
            'inquiries_pending' => $q("SELECT COUNT(*) FROM inquiries WHERE status IN ('draft','to_dispatch','dispatching'){$inqAnd}"),
            'dispatch_pending_response' => $q("SELECT COUNT(*) FROM dispatches d WHERE d.status IN ('pending','sent')"
                . ($scoped ? " AND d.inquiry_id IN (SELECT id FROM inquiries WHERE customer_id IN (SELECT id FROM customers WHERE owner_id = {$uid}))" : '')),
            'quotes_draft' => $q("SELECT COUNT(*) FROM customer_quotes WHERE status IN ('draft','to_review'){$qScope}"),
            'quotes_sent' => $q("SELECT COUNT(*) FROM customer_quotes WHERE status='sent'{$qScope}"),
            'orders_completed' => $completedCount,
            'orders_in_progress' => $inProgressCount,
        ],
        'deals' => [
            'by_currency' => array_map(function ($r) use ($paidMap) {
                $total = (float) $r['total'];
                $paid = $paidMap[$r['currency']] ?? 0;
                return [
                    'currency' => $r['currency'],
                    'count' => (int) $r['cnt'],
                    'total' => $total,
                    'paid' => $paid,
                    'unpaid' => $total - $paid,
                ];
            }, $byCurrency),
            'this_month' => $thisMonth,
            'today' => $todayDeals,
            'by_supplier' => $bySupplier,
            'monthly' => $monthly,
            'recent' => $recentDeals,
            'unpaid_orders' => $unpaidOrders,
            'pending_confirm' => array_map(fn ($r) => [
                'currency' => $r['currency'] ?: 'IDR',
                'count' => (int) $r['cnt'],
                'total' => (float) $r['total'],
            ], $pendingConfirm),
            'revoked_this_month' => $revokedMonth,
        ],
    ]);
}

// 未产生商机的客户（最近 N 个月内没有任何商机）
function handle_dashboardIdleCustomers(PDO $pdo, array $input, array $user): void
{
    $months = (int) ($input['months'] ?? 1);
    if ($months < 1 || $months > 12) $months = 1;
    $cutoff = date('Y-m-d', strtotime("-{$months} months"));
    $uid = (int) ($user['id'] ?? 0);
    $ownWhere = isSalesScoped($user) ? " AND c.owner_id = {$uid}" : '';

    $st = $pdo->prepare("
        SELECT c.id, c.code, c.name, c.short_name, c.source, c.created_at,
               (SELECT MAX(created_at) FROM inquiries i WHERE i.customer_id = c.id) AS last_inquiry_at
        FROM customers c
        WHERE NOT EXISTS (
            SELECT 1 FROM inquiries i WHERE i.customer_id = c.id AND date(i.created_at) >= ?
        )
        {$ownWhere}
        ORDER BY c.id DESC
        LIMIT 100
    ");
    $st->execute([$cutoff]);
    jsonOk(['items' => $st->fetchAll()]);
}

/**
 * 成交排行榜（20260824）
 *
 * 老板要在工作台一眼看到：一共成交了多少个客户、哪个品类成交最高，
 * 点开还能看完整排行 + 每个客户成交了几单。
 *
 * 【品类归属】orders 表没有品类字段，只能从明细行推。按可靠性依次取：
 *   1. 产品名/规格里直接命中 categories 表里的品类名（最长优先，"防水涂料" 不会被 "涂料" 抢走）
 *   2. 该行采纳的供应商的经营品类（一家只做电缆的供应商，报的行就是电缆）
 *   3. 订单头上的供应商名 → 供应商品类（历史补录单没有供应商报价行，靠这条兜底）
 *   4. 都推不出来 → 未分类
 * 未分类占比高不是 bug，是「供应商没填经营品类 / 品类表太少」，界面上会提示去补。
 *
 * 【金额口径】明细行金额按比例缩放到 orders.total_amount。
 * 因为历史补录可以 total_override、成交后又能改报价单，行小计之和不一定等于订单额；
 * 排行榜必须和面板上的成交总额对得上，否则老板会问「为什么加起来对不上」。
 * 没有明细行的订单，整单算「未分类」。
 */
/**
 * 这一行为什么归不了类（20260825）
 *
 * 「未分类」不是一个品类，是「系统推不出来」。老板看到一坨未分类却不知道是什么、
 * 更不知道怎么消掉它，所以每一行都要能说出原因和补救办法。
 */
function _dealWhyUncategorized(array $line, array $order): string
{
    $hasLineSupplier = !empty($line['line_supplier_id']);
    $hasHeadSupplier = trim((string) $order['supplier_name']) !== '';
    if (!$hasLineSupplier && !$hasHeadSupplier) {
        return '产品名里没有品类词，这单也没记供应商';
    }
    return '产品名里没有品类词，供应商没填经营品类';
}

function handle_dashboardDealRanking(PDO $pdo, array $user): void
{
    $dealStatus = "('in_progress','completed','pending_contract')";
    // 销售只看自己客户的成交
    $uid = (int) ($user['id'] ?? 0);
    $ordScope = isSalesScoped($user)
        ? " AND o.customer_id IN (SELECT id FROM customers WHERE owner_id = {$uid})" : '';

    // 品类词表：长的排前面，保证最长匹配
    $catNames = $pdo->query("SELECT name FROM categories WHERE is_active = 1")->fetchAll(PDO::FETCH_COLUMN);
    $catNames = array_values(array_filter(array_map('trim', $catNames), fn ($s) => $s !== ''));
    usort($catNames, fn ($a, $b) => mb_strlen($b) <=> mb_strlen($a));

    // 供应商品类：一家可能填了 "电缆,桥架"，取第一个作为主营
    $supCatById = [];
    $supCatByName = [];
    foreach ($pdo->query("SELECT id, name, category FROM suppliers")->fetchAll() as $s) {
        $parts = preg_split('/[,，、\/]/u', (string) $s['category']);
        $main = '';
        foreach ($parts as $p) {
            $p = trim($p);
            if ($p !== '') { $main = $p; break; }
        }
        if ($main === '') continue;
        $supCatById[(int) $s['id']] = $main;
        $supCatByName[trim((string) $s['name'])] = $main;
    }

    $matchCat = function (string $text) use ($catNames): string {
        $text = trim($text);
        if ($text === '') return '';
        foreach ($catNames as $c) {
            if (mb_stripos($text, $c) !== false) return $c;
        }
        return '';
    };

    // 订单头
    $orders = $pdo->query("
        SELECT o.id, o.quote_id, o.customer_id, o.currency, o.total_amount, o.supplier_name, o.created_at
        FROM orders o
        WHERE o.status IN {$dealStatus} AND o.deal_confirmed_at IS NOT NULL{$ordScope}
    ")->fetchAll();
    if (empty($orders)) {
        jsonOk([
            'summary' => ['deal_customers' => 0, 'deal_orders' => 0, 'repeat_customers' => 0, 'avg_orders' => 0],
            'categories' => [], 'customers' => [], 'top_category' => [], 'uncategorized_ratio' => [],
        ]);
    }

    $orderById = [];
    foreach ($orders as $o) $orderById[(int) $o['id']] = $o;

    // 明细行（带采纳来源的供应商）
    $lines = $pdo->query("
        SELECT o.id AS order_id,
               ci.product_name, ci.spec, ci.qty, ci.sell_price, ci.cost_price,
               sq.supplier_id AS line_supplier_id
        FROM orders o
        JOIN customer_quote_items ci ON ci.quote_id = o.quote_id
        LEFT JOIN supplier_quote_items sqi ON sqi.id = ci.source_supplier_quote_item_id
        LEFT JOIN supplier_quotes sq ON sq.id = sqi.quote_id
        WHERE o.status IN {$dealStatus} AND o.deal_confirmed_at IS NOT NULL{$ordScope}
    ")->fetchAll();

    // 按订单分组，算原始行小计
    $byOrder = [];
    foreach ($lines as $ln) {
        $oid = (int) $ln['order_id'];
        $amt = (float) $ln['qty'] * (float) $ln['sell_price'];
        $cost = (float) $ln['qty'] * (float) $ln['cost_price'];
        $ord = $orderById[$oid] ?? null;
        if (!$ord) continue;

        $cat = $matchCat((string) $ln['product_name'] . ' ' . (string) $ln['spec']);
        if ($cat === '' && !empty($ln['line_supplier_id'])) {
            $cat = $supCatById[(int) $ln['line_supplier_id']] ?? '';
        }
        if ($cat === '') {
            // 订单头供应商名：可能是 "神州电缆 / 某某管业"，逐个试
            foreach (preg_split('/\s*\/\s*/u', (string) $ord['supplier_name']) as $sn) {
                $sn = trim($sn);
                if ($sn === '') continue;
                if (isset($supCatByName[$sn])) { $cat = $supCatByName[$sn]; break; }
                $guess = $matchCat($sn);
                if ($guess !== '') { $cat = $guess; break; }
            }
        }
        if ($cat === '') $cat = '未分类';

        if (!isset($byOrder[$oid])) $byOrder[$oid] = ['raw' => 0.0, 'rows' => []];
        $byOrder[$oid]['raw'] += $amt;
        $byOrder[$oid]['rows'][] = [
            'cat' => $cat, 'amt' => $amt, 'cost' => $cost,
            // 下钻到具体产品用：老板问「未分类里到底是什么」，得答得出来
            'name' => trim((string) $ln['product_name']),
            'spec' => trim((string) $ln['spec']),
            'qty' => (float) $ln['qty'],
            'unit' => '',
            'why' => $cat === '未分类' ? _dealWhyUncategorized($ln, $ord) : '',
        ];
    }

    // 汇总到 品类 × 货币
    $catAgg = [];
    $touch = function (string $cur, string $cat) use (&$catAgg) {
        $k = $cur . '|' . $cat;
        if (!isset($catAgg[$k])) {
            $catAgg[$k] = ['currency' => $cur, 'category' => $cat, 'total' => 0.0, 'cost' => 0.0,
                'lines' => 0, '_orders' => [], '_customers' => [], '_prod' => []];
        }
        return $k;
    };
    // 产品维度（跨品类）：老板要的「深度拆解成具体产品」
    $prodAgg = [];
    $touchProd = function (array &$bucket, string $name, string $spec) {
        // 同名不同规格算两个产品：DN100 和 DN300 的三通不是一回事
        $key = mb_strtolower(trim($name)) . '|' . mb_strtolower(trim($spec));
        if (!isset($bucket[$key])) {
            $bucket[$key] = ['product_name' => $name, 'spec' => $spec,
                'total' => 0.0, 'qty' => 0.0, 'lines' => 0, '_orders' => [], 'why' => ''];
        }
        return $key;
    };

    foreach ($orderById as $oid => $ord) {
        $cur = (string) ($ord['currency'] ?: 'IDR');
        $orderTotal = (float) $ord['total_amount'];
        $cid = (int) $ord['customer_id'];
        $grp = $byOrder[$oid] ?? null;

        if (!$grp || $grp['raw'] <= 0) {
            // 没明细行（或行价全 0）：整单落到未分类，金额不能丢
            $k = $touch($cur, '未分类');
            $catAgg[$k]['total'] += $orderTotal;
            $catAgg[$k]['_orders'][$oid] = 1;
            $catAgg[$k]['_customers'][$cid] = 1;
            continue;
        }
        // 缩放到订单实际成交额，保证排行榜合计 == 面板成交总额
        $scale = $orderTotal > 0 ? $orderTotal / $grp['raw'] : 0;
        foreach ($grp['rows'] as $r) {
            $k = $touch($cur, $r['cat']);
            $amt = $r['amt'] * $scale;
            $catAgg[$k]['total'] += $amt;
            $catAgg[$k]['cost'] += $r['cost'] * $scale;
            $catAgg[$k]['lines'] += 1;
            $catAgg[$k]['_orders'][$oid] = 1;
            $catAgg[$k]['_customers'][$cid] = 1;

            if ($r['name'] !== '') {
                // 品类内的产品
                $pk = $touchProd($catAgg[$k]['_prod'], $r['name'], $r['spec']);
                $catAgg[$k]['_prod'][$pk]['total'] += $amt;
                $catAgg[$k]['_prod'][$pk]['qty'] += $r['qty'];
                $catAgg[$k]['_prod'][$pk]['lines'] += 1;
                $catAgg[$k]['_prod'][$pk]['_orders'][$oid] = 1;
                if ($r['why'] !== '') $catAgg[$k]['_prod'][$pk]['why'] = $r['why'];

                // 全局产品榜
                if (!isset($prodAgg[$cur])) $prodAgg[$cur] = [];
                $gk = $touchProd($prodAgg[$cur], $r['name'], $r['spec']);
                $prodAgg[$cur][$gk]['total'] += $amt;
                $prodAgg[$cur][$gk]['qty'] += $r['qty'];
                $prodAgg[$cur][$gk]['lines'] += 1;
                $prodAgg[$cur][$gk]['_orders'][$oid] = 1;
                $prodAgg[$cur][$gk]['category'] = $r['cat'];
            }
        }
    }

    $categories = [];
    foreach ($catAgg as $row) {
        $row['orders'] = count($row['_orders']);
        $row['customers'] = count($row['_customers']);
        $row['profit'] = $row['total'] - $row['cost'];

        // 展开成具体产品，金额从高到低。未分类那一栏尤其要看得见，
        // 否则老板只能看到「未分类 4200 万」却不知道里面是什么
        $prods = array_values($row['_prod'] ?? []);
        usort($prods, fn ($a, $b) => $b['total'] <=> $a['total']);
        $row['product_count'] = count($prods);
        $row['products'] = array_map(function ($p) {
            return [
                'product_name' => $p['product_name'],
                'spec' => $p['spec'],
                'total' => round($p['total'], 2),
                'qty' => round($p['qty'], 3),
                'lines' => $p['lines'],
                'orders' => count($p['_orders']),
                'why' => $p['why'],
            ];
        }, array_slice($prods, 0, 60));   // 一栏最多带 60 个，别把响应撑爆

        unset($row['_orders'], $row['_customers'], $row['_prod']);
        $row['total'] = round($row['total'], 2);
        $row['cost'] = round($row['cost'], 2);
        $row['profit'] = round($row['profit'], 2);
        $categories[] = $row;
    }
    usort($categories, fn ($a, $b) => $b['total'] <=> $a['total']);

    // 每个货币的冠军品类 + 未分类占比（占比高说明品类没维护好，界面要提示）
    $topCategory = [];
    $curTotal = [];
    $curUncat = [];
    foreach ($categories as $c) {
        $cur = $c['currency'];
        $curTotal[$cur] = ($curTotal[$cur] ?? 0) + $c['total'];
        if ($c['category'] === '未分类') $curUncat[$cur] = ($curUncat[$cur] ?? 0) + $c['total'];
        if ($c['category'] !== '未分类' && !isset($topCategory[$cur])) $topCategory[$cur] = $c;
    }
    $uncatRatio = [];
    foreach ($curTotal as $cur => $t) {
        $uncatRatio[] = ['currency' => $cur, 'ratio' => $t > 0 ? round(($curUncat[$cur] ?? 0) / $t, 4) : 0];
    }

    // 客户排行：一个客户成交了几单、多少钱
    $custRows = $pdo->query("
        SELECT o.customer_id, o.currency,
               COUNT(*) AS orders,
               COALESCE(SUM(o.total_amount),0) AS total,
               MIN(o.created_at) AS first_at,
               MAX(o.created_at) AS last_at,
               c.code AS customer_code, c.name AS customer_name,
               c.short_name AS customer_short_name, c.category AS customer_category
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.status IN {$dealStatus} AND o.deal_confirmed_at IS NOT NULL{$ordScope}
        GROUP BY o.customer_id, o.currency
        ORDER BY total DESC
    ")->fetchAll();
    $customers = array_map(fn ($r) => [
        'customer_id' => (int) $r['customer_id'],
        'customer_code' => $r['customer_code'],
        'customer_name' => $r['customer_name'],
        'customer_short_name' => $r['customer_short_name'],
        'customer_category' => $r['customer_category'],
        'currency' => $r['currency'] ?: 'IDR',
        'orders' => (int) $r['orders'],
        'total' => round((float) $r['total'], 2),
        'first_at' => $r['first_at'],
        'last_at' => $r['last_at'],
    ], $custRows);

    // 汇总：客户数按人头去重（跨货币不重复计），复购 = 成交 ≥2 单
    $perCustomerOrders = [];
    foreach ($orderById as $ord) {
        $cid = (int) $ord['customer_id'];
        $perCustomerOrders[$cid] = ($perCustomerOrders[$cid] ?? 0) + 1;
    }
    $dealCustomers = count($perCustomerOrders);
    $dealOrders = count($orderById);
    $repeat = count(array_filter($perCustomerOrders, fn ($n) => $n >= 2));

    // 全局产品榜（每个货币各取前 100）
    $products = [];
    foreach ($prodAgg as $cur => $bucket) {
        $list = array_values($bucket);
        usort($list, fn ($a, $b) => $b['total'] <=> $a['total']);
        foreach (array_slice($list, 0, 100) as $p) {
            $products[] = [
                'currency' => $cur,
                'product_name' => $p['product_name'],
                'spec' => $p['spec'],
                'category' => $p['category'] ?? '未分类',
                'total' => round($p['total'], 2),
                'qty' => round($p['qty'], 3),
                'lines' => $p['lines'],
                'orders' => count($p['_orders']),
            ];
        }
    }

    jsonOk([
        'products' => $products,
        'summary' => [
            'deal_customers' => $dealCustomers,
            'deal_orders' => $dealOrders,
            'repeat_customers' => $repeat,
            'avg_orders' => $dealCustomers > 0 ? round($dealOrders / $dealCustomers, 2) : 0,
        ],
        'categories' => $categories,
        'top_category' => array_values($topCategory),
        'uncategorized_ratio' => $uncatRatio,
        'customers' => $customers,
    ]);
}

/**
 * 手机端「订单直播大屏」（/admin/live，拍短视频用）：今日 / 本月 / 累计 + 近 14 天每日 + 最新 40 单。
 * 登录态接口；销售角色按自己客户范围。
 * 免登录版走 liveBoardShared（/live?key=…）：不是裸奔到公网，要带 system_settings.live.share_key 这把钥匙，
 * 钥匙由管理员在大屏 ⚙ 里「复制免登录链接」时生成；在系统设置里清空即作废。
 */
function handle_liveBoard(PDO $pdo, array $user): void
{
    jsonOk(_liveBoardPayload($pdo, $user));
}

function handle_liveBoardShared(PDO $pdo, array $input): void
{
    $key = trim((string) ($input['key'] ?? ''));
    $real = getSetting($pdo, 'live.share_key', '');
    if ($key === '' || $real === '' || !hash_equals($real, $key)) {
        jsonError('免登录链接无效或已失效，请登录后在直播大屏 ⚙ 里重新复制', 403);
    }
    $data = _liveBoardPayload($pdo, null);
    $data['company_name'] = getSetting($pdo, 'company_name', '星选建材');
    jsonOk($data);
}

/** 取免登录钥匙（没有就现场生成一把，16 位十六进制）。仅管理员——这把钥匙等于把全部订单汇总开给拿到链接的人 */
function handle_liveShareKey(PDO $pdo, array $user): void
{
    if (($user['role'] ?? '') !== 'admin') jsonError('仅管理员可取免登录链接', 403);
    $key = getSetting($pdo, 'live.share_key', '');
    if ($key === '') {
        $key = bin2hex(random_bytes(8));
        setSetting($pdo, 'live.share_key', $key, '订单直播大屏免登录口令');
        opLog($pdo, 'setting', null, 'gen_live_share_key', 'live.share_key', (int) $user['id']);
    }
    jsonOk(['key' => $key]);
}

/** $user 为 null = 免登录版，不按销售范围过滤 */
function _liveBoardPayload(PDO $pdo, ?array $user): array
{
    $uid = (int) ($user['id'] ?? 0);
    $scope = ($user && isSalesScoped($user)) ? " AND o.customer_id IN (SELECT id FROM customers WHERE owner_id = {$uid})" : '';
    $where = "WHERE o.status IN ('in_progress','completed','pending_contract') AND o.deal_confirmed_at IS NOT NULL{$scope}";
    $today = date('Y-m-d');
    $monthStart = date('Y-m-01');
    $from14 = date('Y-m-d', strtotime('-13 days'));

    $row = fn (string $sql) => $pdo->query($sql)->fetch();
    $sum = $row("SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS amount, COUNT(DISTINCT customer_id) AS customers FROM orders o {$where}");
    $month = $row("SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS amount FROM orders o {$where} AND date(o.deal_confirmed_at) >= '{$monthStart}'");
    $todayRow = $row("SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS amount FROM orders o {$where} AND date(o.deal_confirmed_at) = '{$today}'");

    $daily = $pdo->query("SELECT date(o.deal_confirmed_at) AS d, COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS amount
        FROM orders o {$where} AND date(o.deal_confirmed_at) >= '{$from14}' GROUP BY d")->fetchAll();
    $map = [];
    foreach ($daily as $r) $map[$r['d']] = $r;
    $days = [];
    for ($i = 13; $i >= 0; $i--) {
        $d = date('Y-m-d', strtotime("-{$i} days"));
        $days[] = ['date' => $d, 'cnt' => (int) ($map[$d]['cnt'] ?? 0), 'amount' => (float) ($map[$d]['amount'] ?? 0)];
    }

    $latest = $pdo->query("
        SELECT o.id, o.no, o.deal_confirmed_at AS created_at, o.total_amount, o.currency,
               COALESCE(NULLIF(c.short_name, ''), c.name) AS customer,
               (SELECT COUNT(*) FROM customer_quote_items i WHERE i.quote_id = o.quote_id) AS item_count,
               (SELECT i.product_name FROM customer_quote_items i WHERE i.quote_id = o.quote_id
                 ORDER BY (i.qty * i.sell_price) DESC, i.id LIMIT 1) AS top_product
        FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
        {$where}
        ORDER BY o.deal_confirmed_at DESC, o.id DESC
        LIMIT 40
    ")->fetchAll();
    $items = array_map(fn ($r) => [
        'id' => (int) $r['id'],
        'no' => (string) $r['no'],
        'created_at' => (string) $r['created_at'],
        'amount' => (float) $r['total_amount'],
        'currency' => (string) ($r['currency'] ?: 'IDR'),
        'customer' => (string) ($r['customer'] ?? ''),
        'item_count' => (int) $r['item_count'],
        'product' => (string) ($r['top_product'] ?? ''),
    ], $latest);

    return [
        'server_time' => date('Y-m-d H:i:s'),
        'today' => ['cnt' => (int) $todayRow['cnt'], 'amount' => (float) $todayRow['amount']],
        'month' => ['cnt' => (int) $month['cnt'], 'amount' => (float) $month['amount']],
        'total' => ['cnt' => (int) $sum['cnt'], 'amount' => (float) $sum['amount'], 'customers' => (int) $sum['customers']],
        'days' => $days,
        'latest' => $items,
    ];
}
