<?php
/**
 * 运费分摊单元测试：php backend/tests/freight_alloc_test.php
 * 前端同一套算法的测试在 frontend/tests/freight.test.ts，两边用例保持一致
 */
require __DIR__ . '/../includes/freight.php';

$fail = 0;
$eq = function ($name, $got, $want) use (&$fail) {
    $ok = is_float($want) || is_int($want) ? abs((float) $got - (float) $want) < 0.0001 : $got === $want;
    echo ($ok ? '  ✓ ' : '  ✗ ') . $name . ($ok ? '' : '  期望 ' . var_export($want, true) . '，实际 ' . var_export($got, true)) . "\n";
    if (!$ok) $fail++;
};
$sumSub = fn ($r) => array_sum(array_column($r['lines'], 'subtotal'));

echo "1. 需求里的例子：运费 1,000,000；A 100×50,000，B 10×500,000\n";
$r = freightAllocate([['qty' => 100, 'price' => 50000], ['qty' => 10, 'price' => 500000]], 1000000, 'IDR');
$eq('A 分到运费 500,000', $r['lines'][0]['alloc'], 500000);
$eq('B 分到运费 500,000', $r['lines'][1]['alloc'], 500000);
$eq('A 含运费单价 55,000', $r['lines'][0]['price_with_freight'], 55000);
$eq('B 含运费单价 550,000', $r['lines'][1]['price_with_freight'], 550000);
$eq('总价 = 货品 10,000,000 + 运费 = 11,000,000', $r['total'], 11000000);
$eq('各行小计合计 = 总价', $sumSub($r), 11000000);
$eq('没有尾差', $r['tail_index'], null);

echo "2. 只有一行：3 × 33,333，运费 10,000\n";
$r = freightAllocate([['qty' => 3, 'price' => 33333]], 10000, 'IDR');
$eq('分到全部运费 10,000', $r['lines'][0]['alloc'], 10000);
$eq('含运费单价 36,666（33,333 + 3,333.33 取整）', $r['lines'][0]['price_with_freight'], 36666);
$eq('小计 109,999（109,998 + 尾差 1）', $r['lines'][0]['subtotal'], 109999);
$eq('尾差 +1', $r['lines'][0]['tail'], 1.0);
$eq('总价 = 99,999 + 10,000', $r['total'], 109999);

echo "3. 数量是小数：2.5 × 12,000 和 7.25 × 8,000，运费 50,000\n";
$r = freightAllocate([['qty' => 2.5, 'price' => 12000], ['qty' => 7.25, 'price' => 8000]], 50000, 'IDR');
$eq('A 金额占比 30,000 / 88,000', $r['lines'][0]['share'], 30000 / 88000);
$eq('A 分到运费 17,045.45', $r['lines'][0]['alloc'], 17045.45);
$eq('A 含运费单价 18,818', $r['lines'][0]['price_with_freight'], 18818);
$eq('B 含运费单价 12,545', $r['lines'][1]['price_with_freight'], 12545);
$eq('总价 = 88,000 + 50,000', $r['total'], 138000);
$eq('各行小计合计 = 总价', $sumSub($r), 138000);
$eq('尾差落在金额最大的 B 行', $r['tail_index'], 1);

echo "4. 存在尾差：三行各 1 × 100，运费 100\n";
$r = freightAllocate([['qty' => 1, 'price' => 100], ['qty' => 1, 'price' => 100], ['qty' => 1, 'price' => 100]], 100, 'IDR');
$eq('每行含运费单价 133', $r['lines'][1]['price_with_freight'], 133);
$eq('金额并列时尾差给第一行', $r['tail_index'], 0);
$eq('第一行尾差 +1', $r['lines'][0]['tail'], 1.0);
$eq('第一行小计 134', $r['lines'][0]['subtotal'], 134);
$eq('总价 = 300 + 100', $r['total'], 400);
$eq('各行小计合计 = 总价', $sumSub($r), 400);

echo "5. 运费为 0\n";
$r = freightAllocate([['qty' => 3, 'price' => 1234.5], ['qty' => 2, 'price' => 10]], 0, 'IDR');
$eq('含运费单价 = 原单价', $r['lines'][0]['price_with_freight'], 1234.5);
$eq('小计不取整 = 3703.5', $r['lines'][0]['subtotal'], 3703.5);
$eq('总价 = 货品总额 3,723.5', $r['total'], 3723.5);
$eq('没有尾差', $r['tail_index'], null);

echo "6. 人民币取整到分：3 × 10.00，运费 1.00\n";
$r = freightAllocate([['qty' => 3, 'price' => 10]], 1, 'CNY');
$eq('含运费单价 10.33', $r['lines'][0]['price_with_freight'], 10.33);
$eq('小计 31.00（30.99 + 尾差 0.01）', $r['lines'][0]['subtotal'], 31.0);

echo $fail ? "\n✗ {$fail} 项失败\n" : "\n✓ 全部通过\n";
exit($fail ? 1 : 0);
