<?php
/**
 * 只读盘点：已开发票里有多少张是「空主体快照」（20260808-06 第 5 步）
 *
 * 背景：唯一可达的开票入口 Orders.tsx 从来不传 account_id，
 * issueInvoice 于是把 invoice_entity_* / invoice_bank_* 原样写空串，
 * 发票打印页只能回落到 system_settings 的默认抬头和银行信息。
 *
 * 本脚本**只读**，没有 --apply，不会写任何一张表（并且开了 PRAGMA query_only）。
 * 补历史数据是另一张单的事，这里只出数字。
 *
 * 🔴 判据变更（2026-08-10，20260809-07 回填验收后）：
 *   「快照完整 / 空快照」原本按 `invoice_entity_id IS NOT NULL` 判定。
 *   那把尺子是按「把历史发票挂到某个 payment_entity 上」那种补法定的，
 *   而 07 号单最终裁决是**保持 entity_id = NULL、只补文本快照列**（理由见第 1 节输出里的说明）。
 *   两者不是一套：按旧判据算，回填做得再对「快照完整」也永远是 0，
 *   下一个人看到「完整 0 / 空快照 100%」会以为回填没生效而去二次执行。
 *   **现按 `invoice_entity_name` 判定**，第 1、2 节都已校准。
 *   entity_id 仍然打印，但只作参考、不参与判定，并附「这不是缺陷」的说明。
 *
 * 用法（服务器上）：
 *   cd /www/wwwroot/www.xingxuan.cc && php scripts/data-fixes/audit_invoice_entity_snapshot.php
 */

$dbPath = __DIR__ . '/../../backend/data/xingxuan.db';
if (!file_exists($dbPath)) {
    fwrite(STDERR, "找不到数据库：{$dbPath}\n");
    exit(1);
}

$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->exec('PRAGMA query_only=ON');

function h(string $t): void { echo "\n=== {$t} ===\n"; }
function one(PDO $p, string $sql): int { return (int) $p->query($sql)->fetchColumn(); }

echo "开票主体快照 · 只读盘点\n";
echo "库：{$dbPath}\n";
echo "时间：" . date('Y-m-d H:i:s') . "\n";

// 老库可能还没跑到加列的 migrate，先确认列在不在，避免直接报 no such column
$cols = array_column($pdo->query("PRAGMA table_info(customer_quotes)")->fetchAll(), 'name');
$need = ['invoice_no', 'invoice_entity_id', 'invoice_entity_name', 'invoice_bank_account_no'];
$missing = array_values(array_diff($need, $cols));
if ($missing) {
    fwrite(STDERR, "\n这个库还缺列：" . implode(', ', $missing)
        . "\n说明 migrate 没跑过（先访问一次任意 API 触发 initialize），盘点终止。\n");
    exit(1);
}

// ---------------------------------------------------------------- 1. 总量
h('1. 已开发票总量与空快照占比');

$issued     = one($pdo, "SELECT COUNT(*) FROM customer_quotes WHERE IFNULL(invoice_no,'') <> ''");
$noEntity   = one($pdo, "SELECT COUNT(*) FROM customer_quotes
                          WHERE IFNULL(invoice_no,'') <> '' AND IFNULL(invoice_entity_name,'') = ''");
$noBankNo   = one($pdo, "SELECT COUNT(*) FROM customer_quotes
                          WHERE IFNULL(invoice_no,'') <> '' AND IFNULL(invoice_bank_account_no,'') = ''");
$noAnything = one($pdo, "SELECT COUNT(*) FROM customer_quotes
                          WHERE IFNULL(invoice_no,'') <> ''
                            AND IFNULL(invoice_entity_name,'') = ''
                            AND IFNULL(invoice_bank_account_no,'') = ''");
$ok         = one($pdo, "SELECT COUNT(*) FROM customer_quotes
                          WHERE IFNULL(invoice_no,'') <> ''
                            AND IFNULL(invoice_entity_name,'') <> ''
                            AND IFNULL(invoice_bank_account_no,'') <> ''");
// 仅作参考打印，不参与上面任何一项判定，原因见下面那段说明
$nullEntityId = one($pdo, "SELECT COUNT(*) FROM customer_quotes
                            WHERE IFNULL(invoice_no,'') <> '' AND invoice_entity_id IS NULL");

printf("已开发票总数                    ：%d\n", $issued);
printf("  invoice_entity_name = ''      ：%d（无抬头快照）\n", $noEntity);
printf("  invoice_bank_account_no = ''  ：%d（无银行账号快照）\n", $noBankNo);
printf("  两者都空                      ：%d\n", $noAnything);
printf("  快照完整                      ：%d\n", $ok);
if ($issued > 0) {
    printf("空快照占比                      ：%.1f%%\n", $noEntity * 100.0 / $issued);
}

printf("\n参考（不参与上面的判定）：invoice_entity_id IS NULL：%d 张\n", $nullEntityId);
echo <<<'NOTE'

  🔴 这个数字不为 0【不是缺陷，不要去「修」】。

  2026-08-09 的 07 号单回填时，CTO 明确裁决对历史发票**保持 invoice_entity_id = NULL**：
  这批发票开具的年代，系统里根本没让人选过收款主体，它们渲染的是 system_settings
  的值，不属于任何一个 payment_entity。硬把它们挂到某个主体上，等于伪造一个
  开票当时并不存在的事实——对外正式单据不能这么补。

  所以回填只补文本快照列（invoice_entity_name / invoice_bank_* 等），entity_id 一律留空。
  记录如实表达的是「当时没选主体，这是那个年代的设置值」，且渲染结果与回填前完全一致，
  只是从此不再跟着 system_settings 漂。

  ⚠ 判据也因此改过（2026-08-10）：「快照完整 / 空快照」原本按 invoice_entity_id IS NOT NULL 算，
  那把尺子是按「挂主体」那种补法定的，与最终裁决不是一套——按它算，回填做得再对
  「完整」也永远是 0，会让人误以为回填没生效而去二次执行。**现按 invoice_entity_name 判定。**


NOTE;

// ---------------------------------------------------------------- 2. 明细
h('2. 空快照发票明细（最多 50 条）');

$rows = $pdo->query(
    "SELECT q.id, q.no, q.invoice_no, q.invoice_issued_at, q.currency, q.total,
            c.name AS customer_name,
            q.invoice_entity_id, q.invoice_entity_name,
            q.invoice_bank_name, q.invoice_bank_account_no
       FROM customer_quotes q
       LEFT JOIN customers c ON c.id = q.customer_id
      WHERE IFNULL(q.invoice_no,'') <> ''
        AND (IFNULL(q.invoice_entity_name,'') = '' OR IFNULL(q.invoice_bank_account_no,'') = '')
      ORDER BY q.invoice_issued_at DESC
      LIMIT 50"
)->fetchAll();

if (!$rows) {
    echo "（没有空快照的发票）\n";
} else {
    printf("%-12s %-16s %-12s %-14s %s\n", '报价号', '发票号', '开票日', '客户', '缺什么');
    foreach ($rows as $r) {
        $lack = [];
        if ((string) $r['invoice_entity_name'] === '') $lack[] = '抬头';
        if ((string) $r['invoice_bank_account_no'] === '') $lack[] = '银行账号';
        printf(
            "%-12s %-16s %-12s %-14s %s\n",
            $r['no'],
            $r['invoice_no'],
            substr((string) $r['invoice_issued_at'], 0, 10),
            mb_substr((string) $r['customer_name'], 0, 12),
            implode('+', $lack)
        );
    }
    if (count($rows) === 50) echo "（只显示前 50 条，总数见上面第 1 节）\n";
}

// ---------------------------------------------------------------- 3. 配置面
h('3. 收款主体 / 账户配置情况（决定新闸门是「必须选」还是「允许回落」）');

$entAll    = one($pdo, "SELECT COUNT(*) FROM payment_entities");
$entActive = one($pdo, "SELECT COUNT(*) FROM payment_entities WHERE status = 'active'");
$accAll    = one($pdo, "SELECT COUNT(*) FROM payment_accounts");
$selectable = one($pdo, "SELECT COUNT(*) FROM payment_accounts a
                          JOIN payment_entities e ON e.id = a.entity_id
                         WHERE a.status = 'active' AND e.status = 'active'");

printf("收款主体：%d 条（启用 %d）\n", $entAll, $entActive);
printf("收款账户：%d 条（可选 = 启用账户且主体也启用：%d）\n", $accAll, $selectable);
echo $selectable > 0
    ? "→ 闸门生效：开票必须选账户，后端会拒绝不带 account_id 的调用。\n"
    : "→ 当前没有可选账户，开票走回落（系统默认抬头），前端会给出配置提示。\n";

// ---------------------------------------------------------------- 4. 另一条开票路径
h('4. 「录入历史订单」补录出来的发票（importHistoricalOrder，不走 issueInvoice）');

$imported = one(
    $pdo,
    "SELECT COUNT(*) FROM customer_quotes
      WHERE IFNULL(invoice_no,'') <> ''
        AND IFNULL(markup_strategy,'') LIKE '%\"type\":\"imported\"%'"
);
printf("补录订单带出来的发票：%d 张\n", $imported);
echo "注：这条路径直接写 invoice_no，不经过 issueInvoice，本单的兜底闸门管不到它。\n";

echo "\n盘点完成（未做任何写操作）。\n";
