<?php
/**
 * 数据迁移：把货架首页两张内置轮播图落库到 banners 表（改由后台「管理横幅」维护）
 *
 * 图片源为仓库内 frontend/src/assets/shelf-*.png，复制到 backend/storage/banner/ 后插入记录：
 *   - shelf_recruit.png（供应商招募·金色）→ 链接 /vendor/login，排前
 *   - shelf_launch.png（崭新上线·浅蓝）  → 链接 /c/all
 * 幂等：按 image_path 判重，已存在则跳过；重复执行不会重复插入/覆盖排序。
 * 执行（服务器项目根目录）：
 *   php scripts/data-fixes/seed_shelf_banners.php          # dry-run 预览
 *   php scripts/data-fixes/seed_shelf_banners.php --apply  # 真正执行
 */

require __DIR__ . '/../../backend/config/database.php';

$apply = in_array('--apply', $argv ?? [], true);
$pdo = Database::getInstance()->getConnection();

$root = dirname(__DIR__, 2);
$storageDir = $root . '/backend/storage/banner';

$seeds = [
    // 排在前面的 sort_weight 更大（shelfBanners 按 sort_weight DESC）
    ['src' => 'frontend/src/assets/shelf-recruit.png', 'dst' => 'banner/shelf_recruit.png', 'link' => '/vendor/login', 'note' => '供应商招募（金色）'],
    ['src' => 'frontend/src/assets/shelf-launch.png',  'dst' => 'banner/shelf_launch.png',  'link' => '/c/all',        'note' => '崭新上线（浅蓝）'],
];

$maxW = (int) $pdo->query("SELECT COALESCE(MAX(sort_weight), 0) FROM banners")->fetchColumn();
$nextW = $maxW + count($seeds); // 第一条权重最高，依次递减

echo $apply ? "== 执行模式 ==\n" : "== dry-run（加 --apply 才写入）==\n";

foreach ($seeds as $s) {
    $srcAbs = $root . '/' . $s['src'];
    $dstAbs = $root . '/backend/storage/' . $s['dst'];

    if (!is_file($srcAbs)) {
        fwrite(STDERR, "缺少源文件 {$s['src']}，请先 git pull 拉全仓库\n");
        exit(1);
    }

    $st = $pdo->prepare("SELECT id FROM banners WHERE image_path = ?");
    $st->execute([$s['dst']]);
    if ($existId = $st->fetchColumn()) {
        // 记录已在：仅刷新图片文件（源图有更新时重跑 --apply 即可换图）
        echo "已存在 {$s['note']}（banner id={$existId}），刷新图片文件\n";
        if ($apply) {
            if (!is_dir($storageDir)) mkdir($storageDir, 0775, true);
            if (!copy($srcAbs, $dstAbs)) {
                fwrite(STDERR, "复制失败：{$dstAbs}\n");
                exit(1);
            }
            @chmod($dstAbs, 0664);
            echo "  ✓ 已覆盖 {$s['dst']}\n";
        }
        $nextW--;
        continue;
    }

    echo "插入 {$s['note']}：{$s['dst']} → {$s['link']}（sort_weight={$nextW}）\n";
    if ($apply) {
        if (!is_dir($storageDir)) mkdir($storageDir, 0775, true);
        if (!copy($srcAbs, $dstAbs)) {
            fwrite(STDERR, "复制失败：{$dstAbs}\n");
            exit(1);
        }
        @chmod($dstAbs, 0664);
        $pdo->prepare("INSERT INTO banners (image_path, link_url, sort_weight, is_active) VALUES (?, ?, ?, 1)")
            ->execute([$s['dst'], $s['link'], $nextW]);
        echo "  ✓ id=" . $pdo->lastInsertId() . "\n";
    }
    $nextW--;
}

echo "完成。\n";
