<?php
/**
 * 数据整理：重建为 MRO 商城完整三级品类（大类 > 中类 > 小类）
 *
 * 直接抓取云筑 MRO 商城的官方全量分类接口（13 大类 / 116 中类 / 783 小类），
 * 推倒现有品类结构重建。商品/供应商按品类「名称」关联，删品类不删商品。
 * 执行（服务器项目根目录）：
 *   php scripts/data-fixes/rebuild_categories_mro.php          # dry-run 预览（抓取 + 统计 + 有商品落在新结构外的警告）
 *   php scripts/data-fixes/rebuild_categories_mro.php --apply  # 真正执行
 * 说明：
 *   - 名称全树唯一，跨中类重名的小类只保留第一个（INSERT OR IGNORE）
 *   - 服务器需能访问 mro.yzw.cn（正常商业站，非墙）；抓取失败会报错，重试即可
 */

require __DIR__ . '/../../backend/config/database.php';

$apply = in_array('--apply', $argv ?? [], true);
$pdo = Database::getInstance()->getConnection();

// 1. 抓取 MRO 全量分类
$url = 'https://mro.yzw.cn/api/item/v1/open/category/getAllFrontendCategory';
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_HTTPHEADER => ['Accept: application/json'],
    CURLOPT_USERAGENT => 'Mozilla/5.0',
]);
$resp = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);
if ($resp === false || $code !== 200) {
    fwrite(STDERR, "抓取 MRO 分类失败（HTTP {$code} {$err}）。请检查服务器能否访问 mro.yzw.cn 后重试。\n");
    exit(1);
}
$data = json_decode($resp, true);
$tops = $data['data'] ?? null;
if (!is_array($tops) || !$tops) {
    fwrite(STDERR, "分类接口返回异常，未拿到数据。\n");
    exit(1);
}

// 2. 统计
$nTop = count($tops);
$nMid = 0;
$nLeaf = 0;
$newNames = [];
foreach ($tops as $t) {
    $newNames[$t['name']] = 1;
    foreach ($t['children'] ?? [] as $m) {
        $nMid++;
        $newNames[$m['name']] = 1;
        foreach ($m['children'] ?? [] as $l) {
            $nLeaf++;
            $newNames[$l['name']] = 1;
        }
    }
}

echo ($apply ? "== 已执行重建 ==\n" : "== DRY-RUN（加 --apply 才真正执行）==\n");
echo "抓取到 MRO 分类：{$nTop} 大类 / {$nMid} 中类 / {$nLeaf} 小类\n";

// 有商品、但不在新结构里的品类
$orphan = [];
foreach ($pdo->query("SELECT category, COUNT(*) c FROM products WHERE category != '' GROUP BY category")->fetchAll() as $r) {
    if (!isset($newNames[$r['category']])) $orphan[(string) $r['category']] = (int) $r['c'];
}
if ($orphan) {
    echo "\n⚠ 以下品类有商品、但不在新结构里（商品保留，货架将不显示该类目，请后台把它们加为子类或改商品品类）：\n";
    foreach ($orphan as $name => $c) echo "    - {$name}（{$c} 个商品）\n";
} else {
    echo "（没有『有商品却落在新结构外』的品类，可放心重建）\n";
}

// 3. 重建
if ($apply) {
    $pdo->beginTransaction();
    $pdo->exec("DELETE FROM categories");
    // name 唯一：跨中类重名的小类只进第一个
    $ins = $pdo->prepare("INSERT OR IGNORE INTO categories (parent_id, name, sort_weight, is_active) VALUES (?, ?, ?, 1)");
    $tw = $nTop + 1;
    foreach ($tops as $t) {
        $ins->execute([null, $t['name'], $tw--]);
        $topId = (int) $pdo->lastInsertId();
        $mw = count($t['children'] ?? []) + 1;
        foreach ($t['children'] ?? [] as $m) {
            $ins->execute([$topId, $m['name'], $mw--]);
            $midId = (int) $pdo->lastInsertId();
            if (!$midId) continue; // 重名被 ignore
            $lw = count($m['children'] ?? []) + 1;
            foreach ($m['children'] ?? [] as $l) {
                $ins->execute([$midId, $l['name'], $lw--]);
            }
        }
    }
    $pdo->commit();
    $total = (int) $pdo->query("SELECT COUNT(*) FROM categories")->fetchColumn();
    echo "\n已重建品类树，共 {$total} 个节点（重名小类已去重）。\n";
} else {
    echo "\n将重建为上述 {$nTop} 大类 / {$nMid} 中类 / {$nLeaf} 小类的三级结构（重名小类会去重）。\n";
}
echo "（商品/供应商按品类名称关联，本脚本不改商品数据）\n";
