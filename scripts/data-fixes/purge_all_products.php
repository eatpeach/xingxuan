<?php
/**
 * 数据清理：清空商品库（products 全表 + product_price_logs 全表）
 *
 * 背景：IKAD瓷砖导入的商品是按【尺寸代号】拆的旧版（SZ/DZ/DX/DT/GE/SX/LS/ZS/XD/XS），
 * 本该按花色设计合并成 7 个产品（见 import_ikad_products.php），但旧数据当时已被置为
 * status='on'，而 import 脚本的清理条件是「base_price=0 且 status=pending」——没命中，
 * 旧数据留了下来。加上价格全为 0，货架对外展示的是一批无价的重复商品。
 * 决策（CTO，2026-08-08）：整库清空，后续重新导入。
 *
 * 影响面：
 *   - products / product_price_logs 两张表清空（含演示数据、供应商门户自报的商品）
 *   - 电子货架首页 / 分类页 / 详情页 → 0 商品
 *   - 询价 / 报价 / 订单 / 客户 / 供应商档案【不受影响】：全库只有 product_price_logs
 *     外键引用 products，其余业务表不存商品 id
 *   - categories 的商品数是实时 COUNT 出来的，清空后自动归 0，无需另行处理
 *
 * 安全措施：--apply 前自动生成一致性快照备份（VACUUM INTO，WAL 安全），路径会打印出来。
 * 幂等：表已空则跳过，重复执行无副作用。
 *
 * 执行（服务器项目根目录 /www/wwwroot/www.xingxuan.cc）：
 *   php scripts/data-fixes/purge_all_products.php                 # dry-run 预览
 *   php scripts/data-fixes/purge_all_products.php --apply         # 真正清空（自动先备份）
 *   php scripts/data-fixes/purge_all_products.php --apply --purge-images
 *                                                                 # 顺带删 storage/products 下的图片文件
 */

require __DIR__ . '/../../backend/config/database.php';

$argvSafe     = $argv ?? [];
$apply        = in_array('--apply', $argvSafe, true);
$purgeImages  = in_array('--purge-images', $argvSafe, true);

$pdo = Database::getInstance()->getConnection();
$pdo->exec('PRAGMA foreign_keys = ON');

echo $apply ? "== 执行模式（会真删）==\n\n" : "== dry-run 预览（加 --apply 才真正删除）==\n\n";

// ---------- 1. 盘点 ----------
$total     = (int) $pdo->query("SELECT COUNT(*) FROM products")->fetchColumn();
$totalLogs = (int) $pdo->query("SELECT COUNT(*) FROM product_price_logs")->fetchColumn();

if ($total === 0 && $totalLogs === 0) {
    echo "商品库已经是空的，无需处理。\n";
    exit(0);
}

echo "商品总数：{$total}    改价记录：{$totalLogs}\n\n";

echo "按状态：\n";
foreach ($pdo->query("SELECT status, COUNT(*) c FROM products GROUP BY status ORDER BY c DESC")->fetchAll() as $r) {
    printf("  %-10s %d\n", $r['status'], $r['c']);
}

echo "\n按供应商：\n";
$bySupplier = $pdo->query("SELECT p.supplier_id, COALESCE(s.name,'（供应商已删）') AS sname,
        COUNT(*) c, SUM(CASE WHEN p.is_demo = 1 THEN 1 ELSE 0 END) demo
    FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
    GROUP BY p.supplier_id ORDER BY c DESC")->fetchAll();
foreach ($bySupplier as $r) {
    printf("  #%-4d %-24s %3d 条%s\n", $r['supplier_id'], $r['sname'], $r['c'],
        $r['demo'] > 0 ? "（其中演示数据 {$r['demo']} 条）" : '');
}

echo "\n按品类：\n";
foreach ($pdo->query("SELECT category, COUNT(*) c FROM products GROUP BY category ORDER BY c DESC")->fetchAll() as $r) {
    printf("  %-16s %d\n", $r['category'] !== '' ? $r['category'] : '（未分类）', $r['c']);
}

// ---------- 2. 清空后会留下什么（提示，不动）----------
echo "\n--- 清空后残留（本脚本不处理，按需另行决定）---\n";

$demoSuppliers = $pdo->query("SELECT id, name FROM suppliers WHERE is_demo = 1")->fetchAll();
if ($demoSuppliers) {
    echo "  演示供应商 " . count($demoSuppliers) . " 家会变成空档案：";
    echo implode('、', array_column($demoSuppliers, 'name')) . "\n";
    echo "    → 想一并清掉：后台「商品库管理」页点『一键清除演示数据』\n";
}

$imgRoot = __DIR__ . '/../../backend/storage/products';
$imgBytes = 0;
$imgFiles = 0;
if (is_dir($imgRoot)) {
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($imgRoot, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if ($f->isFile()) { $imgFiles++; $imgBytes += $f->getSize(); }
    }
    printf("  商品图片 %d 个文件 / %.1f MB 留在 backend/storage/products/\n", $imgFiles, $imgBytes / 1048576);
    echo "    → 想一并删除：加 --purge-images 参数\n";
}

if (!$apply) {
    echo "\n以上为预览。确认无误后执行：\n";
    echo "  php scripts/data-fixes/purge_all_products.php --apply\n";
    exit(0);
}

// ---------- 3. 备份 ----------
$dbFile  = __DIR__ . '/../../backend/data/xingxuan.db';
$bakFile = $dbFile . '.bak-' . date('Ymd-His');
echo "\n[1/3] 备份数据库 → {$bakFile}\n";
try {
    // VACUUM INTO 出的是一致性快照，WAL 未 checkpoint 的内容也包含在内
    $pdo->exec("VACUUM INTO " . $pdo->quote($bakFile));
} catch (Throwable $e) {
    echo "  VACUUM INTO 失败（{$e->getMessage()}），回退到文件拷贝\n";
    foreach (['', '-wal', '-shm'] as $suffix) {
        if (is_file($dbFile . $suffix)) copy($dbFile . $suffix, $bakFile . $suffix);
    }
}
if (!is_file($bakFile)) {
    echo "  ✗ 备份失败，中止。请检查 backend/data 目录写权限。\n";
    exit(1);
}
printf("  ✓ 备份完成（%.1f MB）\n", filesize($bakFile) / 1048576);
echo "    回滚办法：停 nginx → cp '{$bakFile}' '{$dbFile}' → 删同名 -wal/-shm → 启 nginx\n";

// ---------- 4. 清空 ----------
echo "\n[2/3] 清空 products / product_price_logs\n";
$pdo->beginTransaction();
try {
    $pdo->exec("DELETE FROM product_price_logs");
    $pdo->exec("DELETE FROM products");
    // 全表清空，自增 id 归零，重新导入从 1 开始。
    // sqlite_sequence 只在库里存在 AUTOINCREMENT 表时才有，缺了不算失败，别拖累整个事务
    $hasSeq = (int) $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")->fetchColumn();
    if ($hasSeq) {
        $pdo->exec("DELETE FROM sqlite_sequence WHERE name IN ('products','product_price_logs')");
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    echo "  ✗ 清空失败已回滚：{$e->getMessage()}\n";
    echo "    数据库未改动，备份文件可删：{$bakFile}\n";
    exit(1);
}
echo "  ✓ 删除商品 {$total} 条、改价记录 {$totalLogs} 条，自增 id 已归零\n";

// ---------- 5. 图片 ----------
echo "\n[3/3] 商品图片\n";
if (!$purgeImages) {
    echo "  - 跳过（未加 --purge-images），{$imgFiles} 个文件保留在 backend/storage/products/\n";
} elseif (!is_dir($imgRoot)) {
    echo "  - 目录不存在，跳过\n";
} else {
    $removed = 0;
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($imgRoot, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($it as $f) {
        if ($f->isFile()) { @unlink($f->getPathname()); $removed++; }
        elseif ($f->isDir()) { @rmdir($f->getPathname()); }
    }
    printf("  ✓ 删除图片 %d 个（%.1f MB）\n", $removed, $imgBytes / 1048576);
}

echo "\n完成。商品库已清空，货架首页现在是 0 商品。\n";
echo "备份留在：{$bakFile}\n";
