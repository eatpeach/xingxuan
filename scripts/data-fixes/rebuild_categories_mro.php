<?php
/**
 * 数据整理：重建为 MRO 商城式标准品类（3 大类 + 13 子类）
 *
 * 参考 mro.yzw.cn 的产品分类体系，归成 3 个大类：
 *   建筑材料 / 五金机电 / 安防后勤
 * 说明：本脚本会「推倒现有品类结构」重建标准结构（现有品类多为试用乱建）。
 *       商品/供应商按品类「名称」关联，删品类不删商品——但若某商品的品类名不在新结构里，
 *       该商品仍在、只是货架不再显示该类目；dry-run 会列出这类情况供你决定。
 * 执行（服务器项目根目录）：
 *   php scripts/data-fixes/rebuild_categories_mro.php          # dry-run 预览（列出将删的品类 + 有商品的警告 + 新结构）
 *   php scripts/data-fixes/rebuild_categories_mro.php --apply  # 真正执行
 * 幂等：重复执行结果一致（都重建为这套标准 3 大类 13 子类）。之后可在后台品类管理里增删子类。
 */

require __DIR__ . '/../../backend/config/database.php';

$apply = in_array('--apply', $argv ?? [], true);
$pdo = Database::getInstance()->getConnection();

// 目标结构：大类 => [子类...]
$structure = [
    '建筑材料' => ['装饰材料', '卫浴照明', '防水保温', '建筑钢材'],
    '五金机电' => ['电工电气', '五金紧固', '工具耗材', '机械设备', '消防暖通', '给水排水'],
    '安防后勤' => ['安全防护', '日杂用品', '办公用品'],
];

// 新结构所有名称
$newNames = [];
foreach ($structure as $top => $kids) {
    $newNames[] = $top;
    foreach ($kids as $k) $newNames[] = $k;
}

// 现有品类 + 各自商品数
$existing = $pdo->query("SELECT id, name FROM categories ORDER BY id ASC")->fetchAll();
$stCnt = $pdo->prepare("SELECT COUNT(*) FROM products WHERE category = ?");
$orphanWithProducts = [];
foreach ($existing as $c) {
    $stCnt->execute([$c['name']]);
    $n = (int) $stCnt->fetchColumn();
    if ($n > 0 && !in_array($c['name'], $newNames, true)) {
        $orphanWithProducts[$c['name']] = $n;
    }
}

echo ($apply ? "== 已执行重建 ==\n" : "== DRY-RUN（加 --apply 才真正执行）==\n");
echo "现有品类数：" . count($existing) . "（将全部清除并重建）\n";

if ($orphanWithProducts) {
    echo "\n⚠ 以下品类有商品、但不在新结构里（商品保留，但货架将不显示该类目；如需保留请在后台把这些加为子类，或把商品改到新类目）：\n";
    foreach ($orphanWithProducts as $name => $n) echo "    - {$name}（{$n} 个商品）\n";
} else {
    echo "（没有『有商品却落在新结构外』的品类，可放心重建）\n";
}

if ($apply) {
    $pdo->beginTransaction();
    $pdo->exec("DELETE FROM categories");
    $tw = count($structure) + 1;
    $insTop = $pdo->prepare("INSERT INTO categories (parent_id, name, sort_weight, is_active) VALUES (NULL, ?, ?, 1)");
    $insSub = $pdo->prepare("INSERT INTO categories (parent_id, name, sort_weight, is_active) VALUES (?, ?, ?, 1)");
    foreach ($structure as $top => $kids) {
        $insTop->execute([$top, $tw--]);
        $topId = (int) $pdo->lastInsertId();
        $sw = count($kids) + 1;
        foreach ($kids as $k) {
            $insSub->execute([$topId, $k, $sw--]);
        }
    }
    $pdo->commit();
}

echo "\n" . ($apply ? "已建立" : "将建立") . "的品类结构：\n";
foreach ($structure as $top => $kids) {
    echo "· {$top}\n";
    foreach ($kids as $k) echo "    - {$k}\n";
}
echo "\n（商品/供应商按品类名称关联，本脚本不改商品数据）\n";
