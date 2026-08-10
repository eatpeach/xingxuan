<?php

function handle_dashboardOverview(PDO $pdo): void
{
    $q = fn (string $sql) => (int) $pdo->query($sql)->fetchColumn();

    $today = date('Y-m-d');
    $monthStart = date('Y-m-01');
    $monthEnd = date('Y-m-t');

    $dealWhere = "WHERE o.status IN ('in_progress','completed','pending_contract')";

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
        WHERE o.status IN ('in_progress','completed','pending_contract')
          AND date(o.created_at) >= '{$monthStart}' AND date(o.created_at) <= '{$monthEnd}'
        GROUP BY currency
    ")->fetchAll();

    // 今日新成交
    $todayDeals = $pdo->query("
        SELECT currency, COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS total
        FROM orders o
        WHERE o.status IN ('in_progress','completed','pending_contract')
          AND date(o.created_at) = '{$today}'
        GROUP BY currency
    ")->fetchAll();

    $completedCount = $q("SELECT COUNT(*) FROM orders WHERE status='completed'");
    $inProgressCount = $q("SELECT COUNT(*) FROM orders WHERE status='in_progress'");

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
        SELECT strftime('%Y-%m', created_at) AS ym,
               currency,
               COUNT(*) AS cnt,
               COALESCE(SUM(total_amount),0) AS total
        FROM orders
        WHERE status IN ('in_progress','completed','pending_contract')
          AND date(created_at) >= date('now','-12 months','localtime')
        GROUP BY ym, currency
        ORDER BY ym
    ")->fetchAll();

    // 最近 10 单成交流水
    $recentDeals = $pdo->query("
        SELECT o.id, o.no, o.contract_no, o.total_amount, o.currency, o.status, o.created_at,
               o.supplier_name, c.name AS customer_name, c.short_name AS customer_short_name
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.status IN ('in_progress','completed','pending_contract')
        ORDER BY o.id DESC
        LIMIT 10
    ")->fetchAll();

    // 应收款订单（成交口径内、未收满）
    $unpaidOrders = $pdo->query("
        SELECT o.id, o.no, o.contract_no, o.currency, o.total_amount, o.status, o.created_at,
               (o.total_amount - COALESCE(pay.paid, 0)) AS unpaid,
               c.code AS customer_code, c.name AS customer_name, c.short_name AS customer_short_name
        FROM orders o
        LEFT JOIN (SELECT order_id, SUM(amount) AS paid FROM payments GROUP BY order_id) pay ON pay.order_id = o.id
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.status IN ('in_progress','completed','pending_contract')
          AND (o.total_amount - COALESCE(pay.paid, 0)) > 0.01
        ORDER BY unpaid DESC
        LIMIT 30
    ")->fetchAll();

    // 应收款看板（发票级，只读；20260810-11）
    // 判据（代码级确认，见单子结论）：一张发票 = customer_quotes.invoice_no 非空；
    // 「未收款」= 该发票 paid_at 为空（markInvoicePaid 手动标志）。
    // 注意：这与上面 unpaid_orders 是【两套不同口径】——那条是订单级 SUM(payments) 未收满，
    // 本条是发票级 paid_at 未标记。二者回答不同问题，不能混算。按到期日分三档。
    $today = date('Y-m-d');
    $soonCutoff = date('Y-m-d', strtotime('+7 days'));
    $arRows = $pdo->query("
        SELECT q.id, q.no, q.invoice_no, q.invoice_issued_at, q.invoice_due_at, q.total, q.currency,
               c.code AS customer_code, c.name AS customer_name, c.short_name AS customer_short_name
        FROM customer_quotes q
        LEFT JOIN customers c ON c.id = q.customer_id
        WHERE q.invoice_no IS NOT NULL AND q.invoice_no != ''
          AND (q.paid_at IS NULL OR q.paid_at = '')
        ORDER BY (q.invoice_due_at IS NULL OR q.invoice_due_at = ''), q.invoice_due_at ASC
    ")->fetchAll();

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
            'summary' => array_values($arSummary),
            'overdue' => $arOverdue,
            'due_soon' => $arDueSoon,
        ],
        'overview' => [
            'customers' => $q("SELECT COUNT(*) FROM customers"),
            'customers_new_month' => $q("SELECT COUNT(*) FROM customers WHERE date(created_at) >= '{$monthStart}'"),
            'inquiries_total' => $q("SELECT COUNT(*) FROM inquiries"),
            'inquiries_pending' => $q("SELECT COUNT(*) FROM inquiries WHERE status IN ('draft','to_dispatch','dispatching')"),
            'dispatch_pending_response' => $q("SELECT COUNT(*) FROM dispatches WHERE status IN ('pending','sent')"),
            'quotes_draft' => $q("SELECT COUNT(*) FROM customer_quotes WHERE status IN ('draft','to_review')"),
            'quotes_sent' => $q("SELECT COUNT(*) FROM customer_quotes WHERE status='sent'"),
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
        ],
    ]);
}

// 未产生商机的客户（最近 N 个月内没有任何商机）
function handle_dashboardIdleCustomers(PDO $pdo, array $input): void
{
    $months = (int) ($input['months'] ?? 1);
    if ($months < 1 || $months > 12) $months = 1;
    $cutoff = date('Y-m-d', strtotime("-{$months} months"));

    $st = $pdo->prepare("
        SELECT c.id, c.code, c.name, c.short_name, c.source, c.created_at,
               (SELECT MAX(created_at) FROM inquiries i WHERE i.customer_id = c.id) AS last_inquiry_at
        FROM customers c
        WHERE NOT EXISTS (
            SELECT 1 FROM inquiries i WHERE i.customer_id = c.id AND date(i.created_at) >= ?
        )
        ORDER BY c.id DESC
        LIMIT 100
    ");
    $st->execute([$cutoff]);
    jsonOk(['items' => $st->fetchAll()]);
}
