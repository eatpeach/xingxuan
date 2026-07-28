<?php
/**
 * 数据导入：IKAD瓷砖（ikadceramic.com）官网产品目录 → suppliers + products
 *
 * 数据源：同目录 ikad_products.json（2026-07-28 抓取，48 个尺寸系列）。
 * 官网的 DL/DX/SX 等前缀是尺寸代号，同一花色会拆成十几个系列；
 * 本脚本按【花色设计】合并：MARBLE / MINIMALIST / MOZAIC / RETRO / STONE / STONE NATURO / WOOD 等
 * 每个设计一条商品，各尺寸系列与色号进 description，图片取各尺寸主图（最多 6 张）。
 *
 * 行为：
 *   1. 找供应商（name 含 IKAD），没有则创建「IKAD瓷砖」（category=瓷砖）
 *   2. categories 表确保存在「瓷砖」大类
 *   3. 清理旧版脚本按尺寸拆分导入的商品（仅删 base_price=0 且 status=pending 的未动过的）
 *   4. 按设计合并插入商品：brand=IKAD、unit=箱、base_price=0、status=pending（补价后上架）
 *   5. 图片优先从仓库 ikad_images/ 拷贝（官网防盗链，服务器直连 403），缺失才在线下载
 *
 * 幂等：按 (supplier_id, name, spec) 判重；已存在且 images 为空的商品补图；重复执行不重复插入。
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

$typeMap = ['Wall Tile' => '墙砖', 'Floor Tile' => '地砖'];
$cnMap = [
    'MARBLE' => '大理石纹',
    'MINIMALIST' => '极简纯色',
    'MOZAIC' => '马赛克',
    'RETRO' => '复古花砖',
    'STONE' => '石纹',
    'STONE NATURO' => '天然石纹',
    'WOOD' => '木纹',
];

// 按花色设计分组
$groups = [];
foreach ($items as $it) {
    $rawName = trim((string) $it['name']);
    $prefix = '';
    $key = strtoupper($rawName);
    if (preg_match('/^([A-Z]{2,3})\s+(.+?)(?:\s+Series)?$/ui', $rawName, $m)) {
        $prefix = strtoupper($m[1]);
        $key = strtoupper(trim($m[2]));
    }
    $key = preg_replace('/\s+SERIES$/', '', $key); // 兼容大写 SERIES 后缀
    $it['_raw_name'] = $rawName;
    $it['_prefix'] = $prefix;
    $groups[$key][] = $it;
}
echo ($apply ? '[APPLY]' : '[DRY-RUN]') . ' 数据源 ' . count($items) . ' 个尺寸系列 → 合并为 ' . count($groups) . " 个设计\n";

// 1) 供应商
$st = $pdo->prepare("SELECT id, name FROM suppliers WHERE name LIKE '%IKAD%' OR name LIKE '%ikad%' LIMIT 1");
$st->execute();
$supplier = $st->fetch();
if ($supplier) {
    $supplierId = (int) $supplier['id'];
    echo "供应商已存在: #{$supplierId} {$supplier['name']}\n";
} else {
    echo "将创建供应商: IKAD瓷砖（category=瓷砖）\n";
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

// 3) 清理旧版按尺寸拆分导入的商品（只删没补过价、没改过状态的）
if ($supplierId > 0) {
    $oldNames = array_map(fn($it) => trim((string) $it['name']), $items);
    $ph = implode(',', array_fill(0, count($oldNames), '?'));
    $st = $pdo->prepare("SELECT COUNT(*) FROM products WHERE supplier_id = ? AND name IN ({$ph}) AND base_price = 0 AND status = 'pending'");
    $st->execute(array_merge([$supplierId], $oldNames));
    $oldCnt = (int) $st->fetchColumn();
    if ($oldCnt > 0) {
        echo ($apply ? '' : '将') . "删除旧版按尺寸拆分的商品 {$oldCnt} 条（未补价、未上架的）\n";
        if ($apply) {
            $pdo->prepare("DELETE FROM products WHERE supplier_id = ? AND name IN ({$ph}) AND base_price = 0 AND status = 'pending'")
                ->execute(array_merge([$supplierId], $oldNames));
        }
    }
}

// 图片：仓库内 ikad_images/ 拷贝优先，缺失才在线下载（官网防盗链需带 Referer）。返回相对 URL 或 null
function ikadFetchImage(string $url, string $dir, int $supplierId): ?string
{
    $fname = 'ikad_' . md5($url);
    foreach (['jpg', 'png', 'webp'] as $e) {
        if (is_file("{$dir}/{$fname}.{$e}")) {
            return "/storage/products/{$supplierId}/{$fname}.{$e}";
        }
    }
    foreach (['jpg', 'png', 'webp'] as $e) {
        $local = __DIR__ . "/ikad_images/{$fname}.{$e}";
        if (is_file($local)) {
            if (!is_dir($dir)) mkdir($dir, 0775, true);
            if (!copy($local, "{$dir}/{$fname}.{$e}")) return null;
            @chmod("{$dir}/{$fname}.{$e}", 0664);
            return "/storage/products/{$supplierId}/{$fname}.{$e}";
        }
    }
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

// 4) 按设计合并导入
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
foreach ($groups as $key => $subs) {
    // 排序：先墙砖后地砖，再按尺寸
    usort($subs, function ($a, $b) {
        return [$a['tile_type'], $a['size']] <=> [$b['tile_type'], $b['size']];
    });

    $cn = $cnMap[$key] ?? '';
    $name = $cn !== '' ? "{$cn} {$key} 系列" : "{$key} 系列";

    $types = [];
    $combos = [];
    foreach ($subs as $s) {
        $t = $typeMap[$s['tile_type']] ?? (string) $s['tile_type'];
        $types[$t] = true;
        $combos[$t . '|' . $s['size']] = true;
    }
    $spec = implode('/', array_keys($types)) . ' · ' . count($combos) . ' 种规格';

    // 描述：花色/表面/适用 + 每个尺寸系列的色号
    $designs = array_values(array_unique(array_filter(array_map(fn($s) => trim((string) $s['design']), $subs))));
    $finishings = array_values(array_unique(array_filter(array_map(fn($s) => trim((string) $s['finishing']), $subs))));
    $suitables = [];
    foreach ($subs as $s) {
        foreach (preg_split('/\s*,\s*/', (string) $s['suitable']) as $part) {
            $part = trim($part);
            if ($part !== '') $suitables[$part] = true;
        }
    }
    $descLines = [];
    if ($designs) $descLines[] = '花色：' . implode('、', $designs);
    if ($finishings) $descLines[] = '表面：' . implode('、', $finishings);
    if ($suitables) $descLines[] = '适用：' . implode('、', array_keys($suitables));
    $descLines[] = '规格与色号：';
    foreach ($subs as $s) {
        $t = $typeMap[$s['tile_type']] ?? (string) $s['tile_type'];
        $codes = array_values(array_filter(array_map(fn($x) => trim((string) $x['code']), $s['tiles'] ?? [])));
        $line = "- {$s['_prefix']} {$t} {$s['size']}";
        if ($codes) $line .= '｜色号：' . implode('、', $codes);
        $descLines[] = $line;
    }
    $desc = implode("\n", $descLines);

    // 图片：各尺寸系列主图（fallback 缩略图），最多 6 张
    $urls = [];
    foreach ($subs as $s) {
        $u = !empty($s['main_image']) ? (string) $s['main_image'] : (string) ($s['thumb'] ?? '');
        if ($u !== '') $urls[] = $u;
    }
    $urls = array_slice(array_values(array_unique($urls)), 0, 6);

    $existing = null;
    if ($supplierId > 0) {
        $exists->execute([$supplierId, $name, $spec]);
        $existing = $exists->fetch() ?: null;
    }

    if ($existing !== null) {
        $curImages = json_decode((string) ($existing['images'] ?? '[]'), true);
        if (is_array($curImages) && count($curImages) > 0) {
            $skipped++;
            continue;
        }
        if (!$apply) {
            echo "  ~ 补图 {$name} | 计划 " . count($urls) . " 张\n";
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
        echo "  + {$name} | {$spec} | 含 " . count($subs) . " 个尺寸系列 | 图片 " . count($urls) . " 张\n";
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
echo $apply ? "\n" : "（dry-run，未写库未动图，--apply 执行）\n";
echo "商品以 pending 入库，后台补价后上架。\n";
