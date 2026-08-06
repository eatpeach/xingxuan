<?php
/**
 * 数据清理：删除测试报价 BJ20260806001、BJ20260805001
 *
 * 级联说明：customer_quotes 删除会连带 customer_quote_items、
 * orders（及其合同/收款/返佣）、quote_follow_logs（外键 ON DELETE CASCADE）。
 * 幂等：单号不存在则跳过。
 * 执行（服务器项目根目录）：
 *   php scripts/data-fixes/delete_quotes_bj20260805_06.php          # dry-run 预览
 *   php scripts/data-fixes/delete_quotes_bj20260805_06.php --apply  # 真正删除
 */

require __DIR__ . '/../../backend/config/database.php';

$apply = in_array('--apply', $argv ?? [], true);
$pdo = Database::getInstance()->getConnection();
$pdo->exec('PRAGMA foreign_keys = ON'); // 确保级联生效

$targets = ['BJ20260806001', 'BJ20260805001'];

echo $apply ? "== 执行模式 ==\n" : "== dry-run（加 --apply 才删除）==\n";

foreach ($targets as $no) {
    $st = $pdo->prepare("SELECT q.id, q.no, q.total, q.currency, q.status, q.invoice_no, q.created_at,
            (SELECT COUNT(*) FROM customer_quote_items WHERE quote_id = q.id) AS items,
            (SELECT COUNT(*) FROM orders WHERE quote_id = q.id) AS orders
        FROM customer_quotes q WHERE q.no = ?");
    $st->execute([$no]);
    $q = $st->fetch();
    if (!$q) {
        echo "跳过 {$no}：不存在（可能已删）\n";
        continue;
    }
    printf("删除 %s（id=%d, %s %s, 状态=%s, 明细%d行, 关联订单%d, 发票=%s, 建于%s）\n",
        $q['no'], $q['id'], $q['currency'], number_format((float) $q['total']),
        $q['status'], $q['items'], $q['orders'], $q['invoice_no'] ?: '无', $q['created_at']);
    if ((int) $q['orders'] > 0) {
        echo "  ⚠ 该报价有关联订单，级联删除将一并移除订单及其合同/收款/返佣\n";
    }
    if ($apply) {
        $pdo->prepare("DELETE FROM customer_quotes WHERE id = ?")->execute([(int) $q['id']]);
        echo "  ✓ 已删除\n";
    }
}
echo "完成。\n";
