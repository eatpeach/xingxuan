<?php
/**
 * 数据导入：IKAD瓷砖（ikadceramic.com）官网产品目录 → suppliers + products
 *
 * 数据源：同目录 ikad_products.json（2026-07-28 从 https://www.ikadceramic.com/?isi=produk 抓取，
 *         48 个系列，含类型/尺寸/花色/表面/适用场景/色号及图片链接）。
 *
 * 行为：
 *   1. 找供应商（name 含 IKAD），没有则创建「IKAD瓷砖」（category=瓷砖）
 *   2. categories 表确保存在「瓷砖」大类
 *   3. 每个系列一条 product：brand=IKAD、spec=「墙砖/地砖 + 尺寸」、unit=箱、
 *      base_price=0、status=pending（待后台补价后上架）、色号清单进 description
 *   4. 图片（主图+色号图，最多 6 张）：优先从仓库内 ikad_images/ 拷贝（已本地抓好并压缩，
 *      官网带防盗链，服务器直接下载会 403），仓库缺图时才回退在线下载（带 Referer）。
 *      落到 backend/storage/products/{supplier_id}/，文件名 ikad_<md5(url)>.<ext>
 *
 * 幂等：按 (supplier_id, name, spec) 判重，已存在的系列跳过插入；
 *      但已存在且 images 为空的商品会补写图片（修复首次导入时图片 403 全失败的情况）。
 * 执行（服务器项目根目录）：
 *   php scripts/data-fixes/import_ikad_products.php          # dry-run 预览
 *   php scripts/data-fixes/import_ikad_products.php --apply  # 真正执行
 */

require __DIR__ . '/../../backend/config/database.php';

$apply = in_array('--apply', $argv ?? [], true);
$pdo = Database::getInstance()->getConnection();

$jsonFile = __DIR__ . '/ikad_products.json';
if (!is_file($jsonFile)) {
    echo "找不到数据文件: {$jsonFile}\n";
    exit(1);
}
$items = json_decode((string) file_get_contents($jsonFile), true);
if (!is_array($items) || count($items) === 0) {
    echo "数据文件解析失败或为空\n";
    exit(1);
}
echo ($apply ? '[APPLY]' : '[DRY-RUN]') . " 数据源共 " . count($items) . " 个系列\n";

// 1) 供应商
$st = $pdo->prepare("SELECT id, name FROM suppliers WHERE name LIKE '%IKAD%' OR name LIKE '%ikad%' LIMIT 1");
$st->execute();
$supplier = $st->fetch();
if ($supplier) {
    $supplierId = (int) $supplier['id'];
    echo "供应商已存在: #{$supplierId} {$supplier['name']}\n";
} else {
    echo "将创建供应商: IKAD瓷砖（category=瓷砖，remark=官网）\n";
    $supplierId = 0;
    if ($apply) {
        $pdo->prepare("INSERT INTO suppliers (name, category, remark) VALUES (?, ?, ?)")
            ->execute(['IKAD瓷砖', '瓷砖', '官网 https://www.ikadceramic.com，产品目录由脚本导入']);
        $supplierId = (int) $pdo->lastInsertId();
        echo "已创建供应商 #{$supplierId}\n";
    }
}

// 2) 品类
$hasCat = $pdo->prepare("SELECT COUNT(*) FROM categories WHERE name = ?");
$hasCat->execute(['瓷砖']);
if ((int) $hasCat->fetchColumn() === 0) {
    echo "将创建品类: 瓷砖\n";
    if ($apply) {
        $pdo->prepare("INSERT OR IGNORE INTO categories (name) VALUES ('瓷砖')")->execute();
    }
}

// 图片：仓库内 ikad_images/ 拷贝优先，缺失才在线下载（官网防盗链需带 Referer）。返回相对 URL 或 null
function ikadFetchImage(string $url, string $dir, int $supplierId): ?string
{
    $fname = 'ikad_' . md5($url);
    // storage 里已有则直接复用
    foreach (['jpg', 'png', 'webp'] as $e) {
        if (is_file("{$dir}/{$fname}.{$e}")) {
            return "/storage/products/{$supplierId}/{$fname}.{$e}";
        }
    }
    // 仓库内已抓好的图
    foreach (['jpg', 'png', 'webp'] as $e) {
        $local = __DIR__ . "/ikad_images/{$fname}.{$e}";
        if (is_file($local)) {
            if (!is_dir($dir)) mkdir($dir, 0775, true);
            if (!copy($local, "{$dir}/{$fname}.{$e}")) return null;
            @chmod("{$dir}/{$fname}.{$e}", 0664);
            return "/storage/products/{$supplierId}/{$fname}.{$e}";
        }
    }
    // 回退：在线下载（换 www 域名 + Referer 绕防盗链）
    $u = str_replace('://ikadceramic.com', '://www.ikadceramic.com', $url);
    $ch = curl_init($u);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        CURLOPT_REFERER => 'https://www.ikadceramic.com/?isi=produk',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $code !== 200 || strlen($body) < 128 || strlen($body) > 10 * 1024 * 1024) {
        return null;
    }
    $ext = null;
    if (strncmp($body, "\xFF\xD8\xFF", 3) === 0) $ext = 'jpg';
    elseif (strncmp($body, "\x89PNG", 4) === 0) $ext = 'png';
    elseif (substr($body, 0, 4) === 'RIFF' && substr($body, 8, 4) === 'WEBP') $ext = 'webp';
    if ($ext === null) return null;

    if (!is_dir($dir)) mkdir($dir, 0775, true);
    if (file_put_contents("{$dir}/{$fname}.{$ext}", $body) === false) return null;
    @chmod("{$dir}/{$fname}.{$ext}", 0664);
    return "/storage/products/{$supplierId}/{$fname}.{$ext}";
}

// 3) 逐系列导入
$typeMap = ['Wall Tile' => '墙砖', 'Floor Tile' => '地砖'];
$root = dirname(__DIR__, 2);
$imgDir = $root . '/backend/storage/products/' . $supplierId;

$exists = $pdo->prepare("SELECT id, images FROM products WHERE supplier_id = ? AND name = ? AND spec = ? LIMIT 1");
$updImages = $pdo->prepare("UPDATE products SET images = ?, updated_at = datetime('now','localtime') WHERE id = ?");
$insert = $pdo->prepare(
    "INSERT INTO products (supplier_id, category, name, spec, brand, unit, moq, base_price, currency,
        stock_status, images, description, status)
     VALUES (?, '瓷砖', ?, ?, 'IKAD', '箱', 0, 0, 'IDR', 'in_stock', ?, ?, 'pending')"
);

$added = 0; $skipped = 0; $repaired = 0; $imgOk = 0; $imgFail = 0;
foreach ($items as $it) {
    $name = trim((string) $it['name']);
    $typeCn = $typeMap[$it['tile_type']] ?? (string) $it['tile_type'];
    $spec = trim($typeCn . ' ' . (string) $it['size']);

    $existing = null;
    if ($supplierId > 0) {
        $exists->execute([$supplierId, $name, $spec]);
        $existing = $exists->fetch() ?: null;
    }

    $codes = array_map(fn($t) => (string) $t['code'], $it['tiles'] ?? []);
    $descLines = ['类型：' . $typeCn];
    if (!empty($it['design'])) $descLines[] = '花色：' . $it['design'];
    if (!empty($it['finishing'])) $descLines[] = '表面：' . $it['finishing'];
    if (!empty($it['suitable'])) $descLines[] = '适用：' . $it['suitable'];
    if ($codes) $descLines[] = '色号：' . implode('、', $codes);
    $descLines[] = '数据来源：ikadceramic.com';
    $desc = implode("\n", $descLines);

    // 图片：主图优先，其次色号图，最多 6 张
    $urls = [];
    if (!empty($it['main_image'])) $urls[] = (string) $it['main_image'];
    elseif (!empty($it['thumb'])) $urls[] = (string) $it['thumb'];
    foreach ($it['tiles'] ?? [] as $t) {
        if (!empty($t['image'])) $urls[] = (string) $t['image'];
    }
    $urls = array_values(array_unique($urls));
    $urls = array_slice($urls, 0, 6);

    // 已存在：images 为空则补图，否则跳过
    if ($existing !== null) {
        $curImages = json_decode((string) ($existing['images'] ?? '[]'), true);
        if (is_array($curImages) && count($curImages) > 0) {
            $skipped++;
            continue;
        }
        if (!$apply) {
            echo "  ~ 补图 {$name} | {$spec} | 计划 " . count($urls) . " 张\n";
            $repaired++;
            continue;
        }
        $images = [];
        foreach ($urls as $u) {
            $rel = ikadFetchImage($u, $imgDir, $supplierId);
            if ($rel !== null) { $images[] = $rel; $imgOk++; }
            else { $imgFail++; }
        }
        $updImages->execute([json_encode($images, JSON_UNESCAPED_SLASHES), (int) $existing['id']]);
        $repaired++;
        echo "  ~ 补图 #{$existing['id']} {$name} | 图片 " . count($images) . "/" . count($urls) . "\n";
        continue;
    }

    if (!$apply) {
        echo "  + {$name} | {$spec} | 图片 " . count($urls) . " 张 | 色号 " . count($codes) . " 个\n";
        $added++;
        continue;
    }

    $images = [];
    foreach ($urls as $u) {
        $rel = ikadFetchImage($u, $imgDir, $supplierId);
        if ($rel !== null) { $images[] = $rel; $imgOk++; }
        else { $imgFail++; }
    }

    $insert->execute([$supplierId, $name, $spec, json_encode($images, JSON_UNESCAPED_SLASHES), $desc]);
    $added++;
    echo "  + #{$pdo->lastInsertId()} {$name} | {$spec} | 图片 " . count($images) . "/" . count($urls) . "\n";
}

echo "\n完成：新增 {$added}，补图 {$repaired}，跳过(已存在) {$skipped}";
if ($apply) echo "，图片成功 {$imgOk}、失败 {$imgFail}";
echo $apply ? "\n" : "（dry-run，未写库未下图，--apply 执行）\n";
echo "导入后商品在「商品库」待审核(pending)，补充价格后再上架。\n";
