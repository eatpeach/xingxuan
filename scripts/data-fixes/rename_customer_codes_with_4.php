<?php
/**
 * 数据修复：客户编号去 4（忌讳）
 *
 * 现象：客户编号（群名 [公司 编号] 里的编号）含数字 4
 * 做法：找出所有 code 含 4 的客户，从当前最大编号之后分配新的不含 4 的编号；
 *       旧编号留空号不复用。输出 旧->新 对照表，方便同步改微信群名。
 * 执行（服务器项目根目录）：
 *   php scripts/data-fixes/rename_customer_codes_with_4.php          # dry-run 只打印
 *   php scripts/data-fixes/rename_customer_codes_with_4.php --apply  # 真正执行
 * 幂等：跑完后不存在含 4 的编号，重复执行输出“无需处理”。
 */

require __DIR__ . '/../../backend/config/database.php';

$apply = in_array('--apply', $argv ?? [], true);
$pdo = Database::getInstance()->getConnection();

$rows = $pdo->query("SELECT id, code, name, short_name FROM customers
    WHERE code LIKE '%4%'
    ORDER BY CAST(code AS INTEGER) ASC")->fetchAll();

if (!$rows) {
    echo "没有含 4 的客户编号，无需处理。\n";
    exit(0);
}

$max = (int) ($pdo->query("SELECT MAX(CAST(code AS INTEGER)) FROM customers WHERE code != ''")->fetchColumn() ?: 10000);
$next = $max;
$nextCode = function () use (&$next) {
    do {
        $next++;
    } while (strpos((string) $next, '4') !== false);
    return (string) $next;
};

echo ($apply ? "[APPLY] " : "[DRY-RUN] ") . '将变更 ' . count($rows) . " 个客户编号：\n";
$st = $pdo->prepare("UPDATE customers SET code = ?, updated_at = datetime('now','localtime') WHERE id = ?");
foreach ($rows as $r) {
    $new = $nextCode();
    $name = $r['short_name'] ?: $r['name'];
    echo "  {$r['code']} -> {$new}   {$name}（记得同步改微信群名）\n";
    if ($apply) {
        $st->execute([$new, $r['id']]);
    }
}
echo $apply ? "完成。\n" : "以上为预览，确认无误后加 --apply 执行。\n";
