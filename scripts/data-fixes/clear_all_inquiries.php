<?php
/**
 * 清空全部商机数据（询价 → 报价 → 订单 → 合同/收款/返佣/退款）
 *
 * 用法：
 *   php scripts/data-fixes/clear_all_inquiries.php            # dry-run，只统计不删
 *   php scripts/data-fixes/clear_all_inquiries.php --apply    # 真删
 *
 * 🔴 不可逆。跑 --apply 前务必先备份：
 *   cp backend/data/xingxuan.db backend/data/xingxuan.db.bak_$(date +%Y%m%d%H%M)
 *
 * ⚠ 为什么不能直接 DELETE FROM inquiries：
 *   customer_quotes.inquiry_id 和 supplier_quotes.inquiry_id 上**没有外键约束**，
 *   只删 inquiries 的话，报价单、订单、合同、收款、返佣全会变成孤儿数据留在库里，
 *   下次统计和 Dashboard 还会把它们算进去。所以这里按依赖顺序显式删。
 *
 * 保留：客户、供应商、商品库、品类、渠道、系统设置、用户账号、短视频、日历、工作计划。
 */

$root = dirname(__DIR__, 2);
require_once $root . '/backend/config/database.php';

$apply = in_array('--apply', $argv, true);

$pdo = Database::getInstance()->getConnection();
$pdo->exec('PRAGMA foreign_keys = ON');   // SQLite 默认关，不开级联不生效

/** 按依赖顺序：子表在前，父表在后 */
$plan = [
    'refunds'              => "SELECT COUNT(*) FROM refunds",
    'payments'             => "SELECT COUNT(*) FROM payments",
    'commissions'          => "SELECT COUNT(*) FROM commissions",
    'contracts'            => "SELECT COUNT(*) FROM contracts",
    'orders'               => "SELECT COUNT(*) FROM orders",
    'quote_follow_logs'    => "SELECT COUNT(*) FROM quote_follow_logs",
    'customer_quote_items' => "SELECT COUNT(*) FROM customer_quote_items",
    'customer_quotes'      => "SELECT COUNT(*) FROM customer_quotes",
    'supplier_quote_items' => "SELECT COUNT(*) FROM supplier_quote_items",
    'supplier_quotes'      => "SELECT COUNT(*) FROM supplier_quotes",
    'dispatches'           => "SELECT COUNT(*) FROM dispatches",
    'inquiry_attachments'  => "SELECT COUNT(*) FROM inquiry_attachments",
    'inquiry_items'        => "SELECT COUNT(*) FROM inquiry_items",
    'inquiries'            => "SELECT COUNT(*) FROM inquiries",
];

echo $apply ? "== 执行清空 ==\n" : "== DRY-RUN（不会改任何数据，加 --apply 才真删）==\n";

$total = 0;
foreach ($plan as $table => $sql) {
    try {
        $n = (int) $pdo->query($sql)->fetchColumn();
    } catch (Throwable $e) {
        printf("  %-22s 跳过（表不存在）\n", $table);
        continue;
    }
    $total += $n;
    printf("  %-22s %6d 行\n", $table, $n);
}
echo "  ------------------------------\n";
printf("  合计 %d 行\n\n", $total);

if ($total === 0) {
    echo "没有商机数据，无需清理。\n";
    exit(0);
}

if (!$apply) {
    echo "以上数据将被删除。确认无误后执行：\n";
    echo "  cp backend/data/xingxuan.db backend/data/xingxuan.db.bak_\$(date +%Y%m%d%H%M)\n";
    echo "  php scripts/data-fixes/clear_all_inquiries.php --apply\n";
    exit(0);
}

$pdo->beginTransaction();
try {
    foreach (array_keys($plan) as $table) {
        try {
            $pdo->exec("DELETE FROM {$table}");
        } catch (Throwable $e) {
            // 表不存在就跳过，不因此中断整体清理
        }
    }
    // 编号从头开始：AUTOINCREMENT 的水位记录在 sqlite_sequence 里
    foreach (array_keys($plan) as $table) {
        $st = $pdo->prepare("DELETE FROM sqlite_sequence WHERE name = ?");
        $st->execute([$table]);
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "失败已回滚：" . $e->getMessage() . "\n");
    exit(1);
}

echo "已清空。核对残留：\n";
foreach ($plan as $table => $sql) {
    try {
        printf("  %-22s %6d 行\n", $table, (int) $pdo->query($sql)->fetchColumn());
    } catch (Throwable $e) {
        // 忽略不存在的表
    }
}
echo "\n客户 / 供应商 / 商品库 / 设置 / 账号均未改动。\n";
