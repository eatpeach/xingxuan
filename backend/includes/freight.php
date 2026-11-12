<?php
/**
 * 运费方式 + 按金额权重分摊（20261112）
 *
 * 三种运费方式：
 *   collect  到付     —— 客户收货时自付，不计入订单金额，单据上注明「运费：到付」
 *   in_price 加进单价 —— 总运费按金额权重分摊进各行单价
 *   absorb   我方承担 —— 不加到客户单价，运费记入该单成本（影响毛利），单据上写「运费：免运费」
 *
 * 分摊规则（不是平均分）：
 *   每行分摊运费 = 总运费 × (该行金额 ÷ 所有货品总金额)
 *   含运费单价   = 原单价 + 该行分摊运费 ÷ 该行数量，取整（IDR 到 1，CNY 到 0.01）
 *   每行小计     = 含运费单价 × 数量（同样取整）
 *   尾差         = (货品总额 + 运费) − 各行小计合计，加到行金额最大的那一行的小计上，
 *                 保证总价完全等于 货品总额 + 运费
 * 顺序：先分摊运费，再算 PPN（打印页按 total 算税）；运费不参与加点（加点只作用在原单价上）。
 *
 * 前端 frontend/src/utils/freight.ts 是同一套算法（编辑页实时预览用），改一边必须改另一边，
 * 两边各有单元测试：backend/tests/freight_alloc_test.php、frontend/tests/freight.test.ts
 */

const FREIGHT_MODES = ['collect', 'in_price', 'absorb'];

function freightMode($v): string
{
    $v = (string) $v;
    return in_array($v, FREIGHT_MODES, true) ? $v : 'collect';
}

function freightRoundUnit(string $currency): float
{
    return strtoupper($currency) === 'CNY' ? 0.01 : 1.0;
}

function _freightRound(float $v, float $unit): float
{
    return round(round($v / $unit) * $unit, 2);
}

/**
 * @param array $lines  [['qty' => float, 'price' => float], ...]（price = 原单价）
 * @return array ['lines' => [[goods, share, alloc, price_with_freight, subtotal, tail]], 'goods_total', 'freight', 'total', 'tail_index']
 */
function freightAllocate(array $lines, float $freight, string $currency = 'IDR'): array
{
    $unit = freightRoundUnit($currency);
    $goods = [];
    $G = 0.0;
    foreach ($lines as $i => $l) {
        $g = (float) ($l['qty'] ?? 0) * (float) ($l['price'] ?? 0);
        $goods[$i] = $g;
        $G += $g;
    }
    $G = round($G, 2);
    $freight = max(0.0, round($freight, 2));

    $out = [];
    // 没有运费（或没有货值可分）：原样返回，小计不取整，和以前的算法完全一致
    if ($freight <= 0 || $G <= 0) {
        foreach ($lines as $i => $l) {
            $out[$i] = [
                'goods' => $goods[$i],
                'share' => $G > 0 ? $goods[$i] / $G : 0.0,
                'alloc' => 0.0,
                'price_with_freight' => (float) ($l['price'] ?? 0),
                'subtotal' => $goods[$i],
                'tail' => 0.0,
            ];
        }
        return ['lines' => $out, 'goods_total' => $G, 'freight' => $G > 0 ? 0.0 : $freight, 'total' => $G, 'tail_index' => null,
            'unallocated' => $G <= 0 && $freight > 0];
    }

    $sum = 0.0;
    $maxIdx = null;
    foreach ($lines as $i => $l) {
        $qty = (float) ($l['qty'] ?? 0);
        $price = (float) ($l['price'] ?? 0);
        $share = $goods[$i] / $G;
        $alloc = $freight * $share;
        $pwf = $qty > 0 ? _freightRound($price + $alloc / $qty, $unit) : $price;
        $sub = _freightRound($pwf * $qty, $unit);
        $out[$i] = [
            'goods' => $goods[$i],
            'share' => $share,
            'alloc' => round($alloc, 2),
            'price_with_freight' => $pwf,
            'subtotal' => $sub,
            'tail' => 0.0,
        ];
        $sum += $sub;
        // 行金额最大的那行吃尾差；并列时取靠前的
        if ($maxIdx === null || $goods[$i] > $goods[$maxIdx]) $maxIdx = $i;
    }
    $target = round($G + $freight, 2);
    $diff = round($target - $sum, 2);
    if ($maxIdx !== null && abs($diff) > 0.0001) {
        $out[$maxIdx]['subtotal'] = round($out[$maxIdx]['subtotal'] + $diff, 2);
        $out[$maxIdx]['tail'] = $diff;
    }
    return ['lines' => $out, 'goods_total' => $G, 'freight' => $freight, 'total' => $target,
        'tail_index' => abs($diff) > 0.0001 ? $maxIdx : null, 'unallocated' => false];
}

/**
 * 按报价单当前的运费方式重算明细的分摊字段和总价，并同步订单金额。
 * 返回新的 total。调用方负责事务。
 */
function quoteApplyFreight(PDO $pdo, int $qid): float
{
    $st = $pdo->prepare("SELECT id, currency, freight_mode, freight_amount FROM customer_quotes WHERE id = ?");
    $st->execute([$qid]);
    $q = $st->fetch();
    if (!$q) return 0.0;
    $mode = freightMode($q['freight_mode'] ?? 'collect');
    $freight = (float) ($q['freight_amount'] ?? 0);

    $stI = $pdo->prepare("SELECT id, qty, sell_price FROM customer_quote_items WHERE quote_id = ? ORDER BY id ASC");
    $stI->execute([$qid]);
    $items = $stI->fetchAll();
    $lines = array_map(fn ($it) => ['qty' => (float) $it['qty'], 'price' => (float) $it['sell_price']], $items);

    // 只有「加进单价」才把运费摊进客户价格；到付 / 我方承担客户看到的就是原单价
    $res = freightAllocate($lines, $mode === 'in_price' ? $freight : 0.0, (string) $q['currency']);
    $up = $pdo->prepare("UPDATE customer_quote_items SET freight_alloc = ?, price_with_freight = ?, line_total = ?, freight_tail = ? WHERE id = ?");
    foreach ($items as $i => $it) {
        $l = $res['lines'][$i];
        $up->execute([$l['alloc'], $l['price_with_freight'], $l['subtotal'], $l['tail'], (int) $it['id']]);
    }
    $total = $res['total'];
    $pdo->prepare("UPDATE customer_quotes SET total = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        ->execute([$total, $qid]);
    $pdo->prepare("UPDATE orders SET total_amount = ?, updated_at = datetime('now','localtime') WHERE quote_id = ?")
        ->execute([$total, $qid]);
    return $total;
}
