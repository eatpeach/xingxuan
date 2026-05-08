<?php

function handle_dashboardOverview(PDO $pdo): void
{
    $q = fn (string $sql) => (int) $pdo->query($sql)->fetchColumn();
    jsonOk([
        'overview' => [
            'customers' => $q("SELECT COUNT(*) FROM customers"),
            'inquiries_total' => $q("SELECT COUNT(*) FROM inquiries"),
            'inquiries_pending' => $q("SELECT COUNT(*) FROM inquiries WHERE status IN ('draft','to_dispatch','dispatching')"),
            'dispatch_pending_response' => $q("SELECT COUNT(*) FROM dispatches WHERE status IN ('pending','sent')"),
            'quotes_draft' => $q("SELECT COUNT(*) FROM customer_quotes WHERE status IN ('draft','to_review')"),
            'quotes_sent' => $q("SELECT COUNT(*) FROM customer_quotes WHERE status='sent'"),
        ],
    ]);
}
