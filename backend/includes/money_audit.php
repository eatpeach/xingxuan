<?php
/**
 * 金额对账（20261113，INV20261110001 少开 5,760,900 事故之后加的）
 *
 * 报价单 / 订单 / 发票三处金额必须互相对得上。这里把所有「对不上」的情况找出来：
 *   1. 报价总额 ≠ 明细按运费方式重算的结果（每行 数量×单价，加进单价时 = 货品 + 运费）
 *   2. 订单金额 ≠ 报价总额
 *   3. 发票开票金额 > 报价总额
 *   4. 发票开票金额 < 报价总额，但没有确认过「部分开票」
 *   5. 发票开出之后报价明细又改过（发票没跟着作废重开）
 *   6. 明细里含运费单价 / 小计和重新分摊的结果不一致
 *
 * 用在三个地方：开票前拦截（单张）、工作台红色提醒（全量）、每天定时对账脚本（全量 + 企业微信通知）。
 * 历史补录的单（status=confirmed，金额是从老订单直接录进来的）不查第 1、6 条。
 */

function _auditTol(string $currency): float
{
    return strtoupper($currency) === 'CNY' ? 0.02 : 1.0;
}

/**
 * @param int|null $quoteId 只查一张报价单；null = 全部
 * @return array 每条：['level' => 'error', 'code', 'quote_id', 'quote_no', 'order_no', 'customer', 'message']
 */
function moneyAudit(PDO $pdo, ?int $quoteId = null): array
{
    $where = $quoteId ? 'WHERE q.id = ' . (int) $quoteId : '';
    $quotes = $pdo->query("SELECT q.*, COALESCE(NULLIF(c.short_name, ''), c.name) AS customer,
            (SELECT MAX(created_at) FROM quote_revisions r WHERE r.quote_id = q.id) AS last_rev_at
        FROM customer_quotes q LEFT JOIN customers c ON c.id = q.customer_id {$where}")->fetchAll();
    if (!$quotes) return [];

    $ids = array_map(fn ($q) => (int) $q['id'], $quotes);
    $ph = implode(',', $ids);
    $itemsBy = [];
    foreach ($pdo->query("SELECT quote_id, qty, sell_price, price_with_freight, line_total FROM customer_quote_items WHERE quote_id IN ({$ph}) ORDER BY id")->fetchAll() as $it) {
        $itemsBy[(int) $it['quote_id']][] = $it;
    }
    $ordersBy = [];
    foreach ($pdo->query("SELECT id, no, quote_id, total_amount FROM orders WHERE quote_id IN ({$ph})")->fetchAll() as $o) {
        $ordersBy[(int) $o['quote_id']][] = $o;
    }

    $fmt = fn ($n, $cur) => ($cur === 'CNY' ? '¥' : 'Rp ') . number_format((float) $n, $cur === 'CNY' ? 2 : 0);
    $issues = [];
    foreach ($quotes as $q) {
        $qid = (int) $q['id'];
        $cur = strtoupper((string) ($q['currency'] ?: 'IDR'));
        $tol = _auditTol($cur);
        $total = (float) $q['total'];
        $orders = $ordersBy[$qid] ?? [];
        $base = [
            'level' => 'error', 'quote_id' => $qid, 'quote_no' => $q['no'],
            'order_no' => $orders[0]['no'] ?? '', 'customer' => (string) ($q['customer'] ?? ''),
            'inquiry_id' => (int) $q['inquiry_id'],
        ];
        $add = function (string $code, string $msg) use (&$issues, $base) {
            $issues[] = $base + ['code' => $code, 'message' => $msg];
        };
        $historical = ($q['status'] ?? '') === 'confirmed';

        // 1 / 6：报价总额与明细
        $items = $itemsBy[$qid] ?? [];
        if (!$historical && $items) {
            $mode = freightMode($q['freight_mode'] ?? 'collect');
            $res = freightAllocate(
                array_map(fn ($it) => ['qty' => (float) $it['qty'], 'price' => (float) $it['sell_price']], $items),
                $mode === 'in_price' ? (float) ($q['freight_amount'] ?? 0) : 0.0,
                $cur
            );
            if (abs($res['total'] - $total) > $tol) {
                $add('quote_total', sprintf('报价总额 %s 和明细算出来的 %s 对不上（差 %s）',
                    $fmt($total, $cur), $fmt($res['total'], $cur), $fmt($res['total'] - $total, $cur)));
            }
            if ($mode === 'in_price') {
                foreach ($items as $i => $it) {
                    if ($it['line_total'] === null) continue;
                    if (abs((float) $it['line_total'] - $res['lines'][$i]['subtotal']) > $tol) {
                        $add('line_total', sprintf('第 %d 行含运费小计 %s，重新分摊应为 %s', $i + 1,
                            $fmt($it['line_total'], $cur), $fmt($res['lines'][$i]['subtotal'], $cur)));
                        break;
                    }
                }
            }
        }

        // 2：订单金额
        foreach ($orders as $o) {
            if (abs((float) $o['total_amount'] - $total) > $tol) {
                $add('order_total', sprintf('订单 %s 金额 %s 和报价总额 %s 对不上', $o['no'],
                    $fmt($o['total_amount'], $cur), $fmt($total, $cur)));
            }
        }

        // 3 / 4 / 5：发票
        if (!empty($q['invoice_no'])) {
            $amt = $q['invoice_amount'] === null || $q['invoice_amount'] === '' ? $total : (float) $q['invoice_amount'];
            if ($amt > $total + $tol) {
                $add('invoice_over', sprintf('发票 %s 开票金额 %s 超过报价总额 %s', $q['invoice_no'], $fmt($amt, $cur), $fmt($total, $cur)));
            } elseif ($amt < $total - $tol && empty($q['invoice_partial'])) {
                $add('invoice_partial_unconfirmed', sprintf('发票 %s 只开了 %s（报价总额 %s，%.1f%%），但没有确认过是部分开票',
                    $q['invoice_no'], $fmt($amt, $cur), $fmt($total, $cur), $total > 0 ? $amt / $total * 100 : 0));
            }
            if (!empty($q['last_rev_at']) && !empty($q['invoice_issued_at']) && $q['last_rev_at'] > $q['invoice_issued_at']) {
                $add('invoice_stale', sprintf('发票 %s 开于 %s，之后报价明细在 %s 又改过，发票没有重开',
                    $q['invoice_no'], substr((string) $q['invoice_issued_at'], 0, 16), substr((string) $q['last_rev_at'], 0, 16)));
            }
        }
    }
    return $issues;
}

/** 开票前拦截：这张报价单金额本身就对不上，就不许开票 */
function moneyAuditRequireClean(PDO $pdo, int $quoteId): void
{
    $bad = array_filter(moneyAudit($pdo, $quoteId), fn ($i) => in_array($i['code'], ['quote_total', 'line_total', 'order_total'], true));
    if ($bad) {
        jsonError('金额校验没通过，不能开票：' . implode('；', array_column($bad, 'message')) . '。请先在「修改报价单」里保存一次重新计算，或联系管理员。');
    }
}

function handle_moneyAuditReport(PDO $pdo, array $user): void
{
    if (($user['role'] ?? '') !== 'admin') jsonError('只有管理员能看', 403);
    $issues = moneyAudit($pdo);
    jsonOk(['items' => $issues, 'count' => count($issues), 'checked_at' => date('Y-m-d H:i:s')]);
}
