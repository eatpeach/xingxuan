<?php
/**
 * 只读盘点：对客报价「重新生成」级联删单的历史影响与当前风险面（20260808-05 第 4 步）
 *
 * 背景：buildCustomerQuote 覆盖旧报价时走 DELETE，而 orders.quote_id 是
 * ON DELETE CASCADE，级联链 customer_quotes → orders → contracts/payments/commissions。
 *
 * 本脚本**只读**，没有 --apply，不会写任何一张表。
 *
 * 用法（服务器上）：
 *   cd /www/wwwroot/www.xingxuan.cc && php scripts/data-fixes/audit_quote_cascade_risk.php
 */

$dbPath = __DIR__ . '/../../backend/data/xingxuan.db';
if (!file_exists($dbPath)) {
    fwrite(STDERR, "找不到数据库：{$dbPath}\n");
    exit(1);
}

$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
// 只读脚本，不需要开 FK；显式声明避免误会
$pdo->exec('PRAGMA query_only=ON');

function h(string $t): void { echo "\n=== {$t} ===\n"; }
function one(PDO $p, string $sql): int { return (int) $p->query($sql)->fetchColumn(); }

echo "对客报价级联删单 · 只读盘点\n";
echo "库：{$dbPath}\n";
echo "时间：" . date('Y-m-d H:i:s') . "\n";

// ---------------------------------------------------------------- 1. 当前风险面
h('1. 当前处于危险状态的商机（有旧报价已成单，仍可被重新生成覆盖）');

$risk = $pdo->query(
    "SELECT i.id AS inquiry_id, i.no AS inquiry_no, i.status AS inquiry_status,
            q.no AS quote_no, o.no AS order_no, o.total_amount, o.currency,
            (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.id) AS pay_cnt,
            (SELECT IFNULL(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) AS paid_sum,
            (SELECT COUNT(*) FROM commissions c WHERE c.order_id = o.id) AS commission_cnt,
            (SELECT COUNT(*) FROM contracts ct WHERE ct.order_id = o.id) AS contract_cnt
       FROM customer_quotes q
       JOIN orders o ON o.quote_id = q.id
       JOIN inquiries i ON i.id = q.inquiry_id
      ORDER BY i.id"
)->fetchAll();

if (!$risk) {
    echo "无。当前没有任何『报价已成单』的商机，风险面为 0。\n";
} else {
    printf("%-10s %-16s %-16s %-16s %8s %14s %6s %6s\n",
        '商机ID', '商机号', '报价号', '订单号', '收款笔', '已收金额', '返佣', '合同');
    $withMoney = 0;
    foreach ($risk as $r) {
        if ((int) $r['pay_cnt'] > 0 || (int) $r['commission_cnt'] > 0) $withMoney++;
        printf("%-10s %-16s %-16s %-16s %8d %14s %6d %6d\n",
            $r['inquiry_id'], $r['inquiry_no'], $r['quote_no'], $r['order_no'],
            (int) $r['pay_cnt'],
            ($r['currency'] === 'CNY' ? '¥' : 'Rp') . number_format((float) $r['paid_sum']),
            (int) $r['commission_cnt'], (int) $r['contract_cnt']);
    }
    echo "\n合计 " . count($risk) . " 条报价已成单";
    echo "，其中 {$withMoney} 条已有收款或返佣（这些是拦截生效后会被硬拦的）。\n";
}

// ---------------------------------------------------------------- 2. 历史是否已经发生过
h('2. 历史影响：级联删除是否已经真的发生过');

// 2a. 孤儿检测——FK 开着时级联会删干净，所以孤儿数为 0 属正常，不能作为「没发生过」的证据
$orphanOrders = one($pdo, "SELECT COUNT(*) FROM orders o
    WHERE o.quote_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM customer_quotes q WHERE q.id = o.quote_id)");
$orphanPay = one($pdo, "SELECT COUNT(*) FROM payments p
    WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = p.order_id)");
$orphanComm = one($pdo, "SELECT COUNT(*) FROM commissions c
    WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = c.order_id)");
echo "孤儿订单（quote_id 指向已删报价）：{$orphanOrders}\n";
echo "孤儿收款：{$orphanPay}　孤儿返佣：{$orphanComm}\n";
echo "  ⚠ 注意：FK 开着时级联会把子表一并删干净，所以孤儿为 0 " .
     "**不能**证明没发生过，只能证明没留下残骸。\n";

// 2b. 订单号断档——订单号连续分配，中间缺号说明订单被删过
$orderNos = $pdo->query("SELECT no FROM orders WHERE no <> '' ORDER BY no")->fetchAll(PDO::FETCH_COLUMN);
$gaps = [];
$byPrefix = [];
foreach ($orderNos as $no) {
    if (preg_match('/^(.*?)(\d{3})$/', (string) $no, $m)) {
        $byPrefix[$m[1]][] = (int) $m[2];
    }
}
foreach ($byPrefix as $prefix => $seqs) {
    sort($seqs);
    for ($i = 1; $i < count($seqs); $i++) {
        if ($seqs[$i] - $seqs[$i - 1] > 1) {
            for ($m2 = $seqs[$i - 1] + 1; $m2 < $seqs[$i]; $m2++) {
                $gaps[] = $prefix . str_pad((string) $m2, 3, '0', STR_PAD_LEFT);
            }
        }
    }
}
echo "订单总数：" . count($orderNos) . "　订单号断档：" . count($gaps) . " 个";
echo $gaps ? "　→ " . implode('、', array_slice($gaps, 0, 20)) . (count($gaps) > 20 ? ' …' : '') : '';
echo "\n";
if ($gaps) {
    echo "  ⚠ 断档不一定是本 bug 造成的：bulkDeleteOrders（后台批量删订单）也会留下断档。\n";
    echo "    需要人工对照 op_logs 里的 bulk_delete 记录排除。\n";
}

// 2c. op_logs 佐证
h('3. op_logs 佐证');
$hasOpLogs = one($pdo, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='op_logs'");
if (!$hasOpLogs) {
    echo "没有 op_logs 表，跳过。\n";
} else {
    foreach ([
        ['customer_quote', 'build', '生成对客报价（每次都可能覆盖旧的）'],
        ['order', 'bulk_delete', '后台批量删订单（断档的另一个来源）'],
        ['customer_quote', 'delete', '单条删除报价'],
    ] as [$ent, $act, $desc]) {
        $st = $pdo->prepare("SELECT COUNT(*) FROM op_logs WHERE entity = ? AND action LIKE ?");
        $st->execute([$ent, "%{$act}%"]);
        printf("%-14s %-14s %5d 次　%s\n", $ent, $act, (int) $st->fetchColumn(), $desc);
    }
    echo "\n最近 10 条生成/删除记录：\n";
    $st = $pdo->query("SELECT created_at, entity, entity_id, action, detail FROM op_logs
        WHERE (entity = 'customer_quote' AND (action LIKE '%build%' OR action LIKE '%delete%'))
           OR (entity = 'order' AND action LIKE '%delete%')
        ORDER BY id DESC LIMIT 10");
    foreach ($st->fetchAll() as $r) {
        printf("  %s  %s#%s  %s  %s\n", $r['created_at'], $r['entity'],
            $r['entity_id'] ?? '-', $r['action'], mb_substr((string) $r['detail'], 0, 40));
    }
}

h('结论要点');
echo "1. 上面第 1 节的行数 = 拦截上线后会被硬拦的场景数；为 0 说明当前没有存量风险。\n";
echo "2. 第 2 节的断档数需人工排除 bulk_delete 的影响后，才能判断本 bug 是否真的发生过。\n";
echo "3. 本脚本只读（PRAGMA query_only=ON），不改任何数据。\n";
