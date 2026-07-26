<?php
/**
 * 数据修复：品类归拢为两级（6 大类 + 现有品类作为子类）
 *
 * 背景：初版把 8 个品类都种成了大类，太细。按印尼建材集采场景归拢成 6 个广义大类，
 *       把现有品类（瓷砖/卫浴/板材/涂料/灯具/门窗/五金/水泥）挂到对应大类下当子类。
 * 做法：
 *   1. 确保 6 个大类存在（不存在则建，parent_id=NULL）
 *   2. 把现有品类（当前是顶级）改挂到目标大类下（设 parent_id）
 *   3. 商品/供应商仍按品类「名称」关联，名称不变 => 数据零影响
 * 执行（服务器项目根目录）：
 *   php scripts/data-fixes/reorg_categories_two_level.php          # dry-run 只打印将做的变更
 *   php scripts/data-fixes/reorg_categories_two_level.php --apply  # 真正执行
 * 幂等：已挂好的品类跳过；大类已存在则复用；重复执行输出“无需处理”。
 */

require __DIR__ . '/../../backend/config/database.php';

$apply = in_array('--apply', $argv ?? [], true);
$pdo = Database::getInstance()->getConnection();

// 大类 => 归入的现有子类
$plan = [
    '装饰主材' => ['瓷砖', '板材', '涂料'],
    '卫浴洁具' => ['卫浴'],
    '照明电工' => ['灯具'],
    '门窗系统' => ['门窗'],
    '五金水暖' => ['五金'],
    '建筑基材' => ['水泥'],
];

/** 取品类行（按名称，全树唯一） */
$getCat = function (string $name) use ($pdo) {
    $st = $pdo->prepare("SELECT * FROM categories WHERE name = ?");
    $st->execute([$name]);
    return $st->fetch();
};

$changes = [];   // 打印用
$topWeight = (int) ($pdo->query("SELECT COALESCE(MAX(sort_weight),0) FROM categories WHERE parent_id IS NULL")->fetchColumn());

foreach ($plan as $topName => $children) {
    // 1. 大类
    $top = $getCat($topName);
    if (!$top) {
        $topWeight++;
        $changes[] = "建大类：{$topName}（sort={$topWeight}）";
        if ($apply) {
            $pdo->prepare("INSERT INTO categories (parent_id, name, sort_weight, is_active) VALUES (NULL, ?, ?, 1)")
                ->execute([$topName, $topWeight]);
        }
        $topId = $apply ? (int) $pdo->lastInsertId() : -1;
    } else {
        if ($top['parent_id'] !== null) {
            $changes[] = "跳过：大类 {$topName} 目前是子类，需人工确认，未处理";
            continue;
        }
        $topId = (int) $top['id'];
    }

    // 2. 子类改挂
    foreach ($children as $childName) {
        $child = $getCat($childName);
        if (!$child) {
            $changes[] = "跳过：品类 {$childName} 不存在（可能已改名），未处理";
            continue;
        }
        // 已经挂在目标大类下
        if ($topId > 0 && (int) $child['parent_id'] === $topId) {
            continue;
        }
        // 该品类自己名下有子类 => 不能降为子类，跳过并提示
        $hasKids = (int) $pdo->query("SELECT COUNT(*) FROM categories WHERE parent_id = " . (int) $child['id'])->fetchColumn();
        if ($hasKids > 0) {
            $changes[] = "跳过：{$childName} 名下已有子类，不能改为子类，需人工处理";
            continue;
        }
        $changes[] = "改挂：{$childName} => 归入「{$topName}」";
        if ($apply) {
            $pdo->prepare("UPDATE categories SET parent_id = (SELECT id FROM categories WHERE name = ?) WHERE id = ?")
                ->execute([$topName, (int) $child['id']]);
        }
    }
}

if (!$changes) {
    echo "品类已是目标两级结构，无需处理。\n";
    exit(0);
}

echo ($apply ? "== 已执行以下变更 ==\n" : "== DRY-RUN（加 --apply 才真正执行）==\n");
foreach ($changes as $c) echo " - {$c}\n";

echo "\n当前品类树：\n";
$tops = $pdo->query("SELECT * FROM categories WHERE parent_id IS NULL ORDER BY sort_weight DESC, id ASC")->fetchAll();
foreach ($tops as $t) {
    echo "· {$t['name']}\n";
    $kids = $pdo->prepare("SELECT name FROM categories WHERE parent_id = ? ORDER BY sort_weight DESC, id ASC");
    $kids->execute([(int) $t['id']]);
    foreach ($kids->fetchAll(PDO::FETCH_COLUMN) as $k) echo "    - {$k}\n";
}
