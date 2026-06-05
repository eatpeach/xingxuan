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

    jsonOk([
        'overview' => [
            'customers' => $q("SELECT COUNT(*) FROM customers"),
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
        ],
    ]);
}
