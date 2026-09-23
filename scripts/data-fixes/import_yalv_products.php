<?php
/**
 * 数据导入：亚铝（印尼亚铝订货商城）全量商品 → 供应商「亚铝」名下 products（tasks/20260918-26）
 *
 * 数据源：backend/data/yalv_products.json —— 🔴 不进仓库（含供货价，backend/.gitignore 已忽略 data/*）。
 *   由浏览器 hook（scripts/yalv_pull_hook.js）在老板登录态下拉取，每条是 14 列定位数组：
 *   [商城id, 商品编码, 名称, 规格型号, 品牌, 图片URL, 单位, 起订倍数, 一级分类, 供货价, 零售价, 可供数量, 已售罄(0/1), 英文名]
 *
 * 为什么不用门户「Excel 导入」：8000 行 + 每行在线下载一张图，一个 HTTP 请求跑不完（超时后既不回滚也不能续跑，
 * 重传会重复插入）。CLI 没有超时，且按 (supplier_id, model=商品编码) 幂等，可以反复续跑。
 *
 * 行为：
 *   1. 找供应商：--supplier=ID 指定，或按 name 含「亚铝」查找；都没有则创建「印尼亚铝」
 *   2. 逐条按 model（商品编码）判重：不存在 → 插入（status=pending, currency=IDR）；存在且 images 为空 → 补图
 *   3. 图片下载到 backend/storage/products/<supplier_id>/yalv_<md5(url)>.<ext>，同名文件已在则直接复用（断点续跑）
 *   4. 供货价为 0 的照样入库（base_price=0, pending）；02 号单的价格闸门会拦住 0 价上架，后台补价后再上
 *   5. 一级分类按 CAT_MAP 映射到货架 13 大类；映射不到的落「日杂用品」并在末尾汇报
 *
 * 用法（服务器项目根目录）：
 *   php scripts/data-fixes/import_yalv_products.php                        # dry-run 预览（不写库不下图）
 *   php scripts/data-fixes/import_yalv_products.php --apply                # 执行（含下载图片，8000 张约 1~2 小时）
 *   php scripts/data-fixes/import_yalv_products.php --apply --skip-images  # 先只入库（几十秒），之后再 --images-only 补图
 *   php scripts/data-fixes/import_yalv_products.php --apply --images-only  # 只给 images 为空的已入库商品补图，可多次续跑
 *   可选：--file=路径   --supplier=ID   --limit=N（只处理前 N 条，本地测试用）
 *
 * 不做的事：不更新已存在商品的价格（商城价格会变，改价走后台留痕，或另开单做「同步价格」模式）。
 */

require __DIR__ . '/../../backend/config/database.php';

$args = $argv ?? [];
$apply = in_array('--apply', $args, true);
$skipImages = in_array('--skip-images', $args, true);
$imagesOnly = in_array('--images-only', $args, true);
$opt = function (string $name, ?string $default = null) use ($args): ?string {
    foreach ($args as $a) {
        if (strpos($a, "--{$name}=") === 0) return substr($a, strlen($name) + 3);
    }
    return $default;
};
$root = dirname(__DIR__, 2);
$jsonFile = $opt('file', $root . '/backend/data/yalv_products.json');
$supplierOpt = (int) $opt('supplier', '0');
$limit = (int) $opt('limit', '0');

if (!is_file($jsonFile)) {
    fwrite(STDERR, "找不到数据文件: {$jsonFile}\n（JSON 不在仓库里，需单独拷到服务器 backend/data/ 下）\n");
    exit(1);
}
$rows = json_decode((string) file_get_contents($jsonFile), true);
if (!is_array($rows) || count($rows) === 0) {
    fwrite(STDERR, "数据文件解析失败或为空\n");
    exit(1);
}
if ($limit > 0) $rows = array_slice($rows, 0, $limit);

// 亚铝一级分类 → 货架 13 大类（与 frontend CAT_ICONS / 收集表模板 CATEGORIES 同名）
const CAT_MAP = [
    'DELIXI德力西' => '电工电气',
    'BOSI波斯工具' => '工具耗材',
    'Bridge大桥焊材' => '工具耗材',
    'Welding焊机及配件' => '机械设备',
    'Lifting吊具' => '五金紧固',
    'Sabuk&Jaring安全带/网' => '安全防护',
    'Webbing Sling吊带' => '五金紧固',
    'Safety劳保产品' => '安全防护',
    'Mesin施工机械' => '机械设备',
    '货架' => '日杂用品',
    '国内及本地采购' => '日杂用品',
    'MCB人民电器开关' => '电工电气',
    'Tangga铝合金爬梯' => '工具耗材',
    '脚手架' => '建筑钢材',
    'Alat survei测绘工具' => '工具耗材',
    'Kawat Besi铁丝' => '建筑钢材',
    'Pompa奥利水泵' => '给水排水',
    'Lampu照明灯具' => '卫浴照明',
    'Sanitary箭牌家居' => '卫浴照明',
    'Scaffolding扣件' => '建筑钢材',
    'Baut紧固件10月' => '五金紧固',
    'Baut紧固件' => '五金紧固',
    'Pengencang通丝' => '五金紧固',
    'Plywwod建筑模板' => '装饰材料',
    '德高树脂瓦' => '防水保温',
    '油漆化工类' => '装饰材料',
    '东成工具' => '工具耗材',
    'Bahan Abrasif磨具' => '工具耗材',
    '钢丝软管' => '给水排水',
    '托盘物流箱周转筐' => '日杂用品',
    '金桥焊材' => '工具耗材',
    'SOMY水泵' => '给水排水',
];
const CAT_FALLBACK = '日杂用品';

// 商城单位写法「个/PCS」「KG」「套/Set」→ 取「/」前的中文；纯英文的按表翻
const UNIT_EN = [
    'PCS' => '个', 'PC' => '个', 'KG' => '公斤', 'M' => '米', 'METER' => '米', 'SET' => '套', 'BOX' => '盒',
    'ROLL' => '卷', 'BAG' => '袋', 'PACK' => '包', 'PAIR' => '副', 'TON' => '吨', 'L' => '升', 'SHEET' => '张',
];
function yalvUnit(string $raw): string
{
    $raw = trim($raw);
    if ($raw === '') return '件';
    $first = trim(explode('/', $raw)[0]);
    if ($first === '') return '件';
    if (preg_match('/^[A-Za-z]+$/', $first)) return UNIT_EN[strtoupper($first)] ?? $first;
    return $first;
}

/** 「漏电断路器/CDM3LS-125C/4300B 125A」→ [名称, 规格]；名称取第一个「/」前，规格优先用商城 specNo */
function yalvSplitName(string $name, string $spec): array
{
    $name = trim($name);
    $spec = trim($spec);
    if (strpos($name, '/') !== false) {
        [$head, $tail] = explode('/', $name, 2);
        $head = trim($head);
        if ($head !== '') return [$head, $spec !== '' ? $spec : trim($tail)];
    }
    return [$name, $spec];
}

function yalvNum($v): float
{
    return is_numeric($v) ? (float) $v : 0.0;
}

/** 把一条定位数组整理成 products 列（不含图片） */
function yalvMap(array $r, array &$unknownCats): array
{
    [$id, $code, $rawName, $specNo, $brand, $img, $uom, $moq, $cat, $price, $retail, $avail, $soldOut, $desc] = array_pad($r, 14, '');
    $cat = trim((string) $cat);
    $category = CAT_MAP[$cat] ?? null;
    if ($category === null) {
        $unknownCats[$cat] = ($unknownCats[$cat] ?? 0) + 1;
        $category = CAT_FALLBACK;
    }
    [$name, $spec] = yalvSplitName((string) $rawName, (string) $specNo);

    $descLines = [];
    if (trim((string) $desc) !== '') $descLines[] = trim((string) $desc);
    $descLines[] = "亚铝商城编码 {$code}，一级分类「{$cat}」";
    $retailN = yalvNum($retail);
    if ($retailN > 0) $descLines[] = '商城零售价 Rp ' . number_format($retailN, 0, '.', ',');
    $availN = yalvNum($avail);
    if ($availN > 0) $descLines[] = '拉取时可供数量 ' . rtrim(rtrim(number_format($availN, 2, '.', ''), '0'), '.') . ' ' . yalvUnit((string) $uom);

    return [
        'model' => trim((string) $code),
        'name' => $name,
        'spec' => $spec,
        'brand' => trim((string) $brand),
        'unit' => yalvUnit((string) $uom),
        'moq' => yalvNum($moq),
        'base_price' => yalvNum($price),
        'category' => $category,
        'stock_status' => ((int) $soldOut) === 1 ? 'pre_order' : 'in_stock',
        'description' => implode("\n", $descLines),
        'img' => trim((string) $img),
    ];
}

/** 下载商城图片到 storage；同 URL 已下过直接复用。返回相对 URL 或 null */
function yalvFetchImage(string $url, string $dir, int $supplierId): ?string
{
    if (!preg_match('#^https?://#i', $url)) return null;
    $fname = 'yalv_' . md5($url);
    foreach (['jpg', 'png', 'webp'] as $e) {
        if (is_file("{$dir}/{$fname}.{$e}")) return "/storage/products/{$supplierId}/{$fname}.{$e}";
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    // 不调 curl_close：PHP 8.0 起无效果，8.5 直接报弃用（本地 8.5 / 生产 8.2 都要过）
    if ($body === false || $code !== 200 || strlen($body) < 128 || strlen($body) > 10 * 1024 * 1024) return null;
    // 按真实内容判类型，不信任 URL 后缀
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

$pdo = Database::getInstance()->getConnection();
$mode = $apply ? '[APPLY]' : '[DRY-RUN]';
echo "{$mode} 数据源 {$jsonFile}：" . count($rows) . " 条" . ($imagesOnly ? '（仅补图模式）' : '') . ($skipImages ? '（跳过图片）' : '') . "\n";

// 数据源自检：商品编码是幂等键，重复的要知道
$codes = [];
$dupCodes = 0;
foreach ($rows as $r) {
    $c = trim((string) ($r[1] ?? ''));
    if ($c === '') continue;
    if (isset($codes[$c])) $dupCodes++;
    $codes[$c] = true;
}
if ($dupCodes > 0) echo "⚠ 数据源里有 {$dupCodes} 个重复商品编码，后出现的会被当作已存在跳过\n";

// 1) 供应商
$supplierId = 0;
if ($supplierOpt > 0) {
    $st = $pdo->prepare("SELECT id, name FROM suppliers WHERE id = ?");
    $st->execute([$supplierOpt]);
    $s = $st->fetch();
    if (!$s) { fwrite(STDERR, "供应商 #{$supplierOpt} 不存在\n"); exit(1); }
    $supplierId = (int) $s['id'];
    echo "供应商（指定）: #{$supplierId} {$s['name']}\n";
} else {
    $st = $pdo->query("SELECT id, name FROM suppliers WHERE name LIKE '%亚铝%' ORDER BY id LIMIT 2");
    $found = $st->fetchAll();
    if (count($found) > 1) {
        fwrite(STDERR, "有多个名字含「亚铝」的供应商，请用 --supplier=ID 指定：" . implode('，', array_map(fn($x) => "#{$x['id']} {$x['name']}", $found)) . "\n");
        exit(1);
    }
    if ($found) {
        $supplierId = (int) $found[0]['id'];
        echo "供应商已存在: #{$supplierId} {$found[0]['name']}\n";
    } else {
        echo "将创建供应商: 印尼亚铝（category=五金工具）\n";
        if ($apply) {
            $pdo->prepare("INSERT INTO suppliers (name, category, remark) VALUES (?, ?, ?)")
                ->execute(['印尼亚铝', '五金工具', '商品目录由 import_yalv_products.php 从亚铝订货商城导入']);
            $supplierId = (int) $pdo->lastInsertId();
            echo "已创建供应商 #{$supplierId}\n";
        }
    }
}

// 2) 逐条导入
$imgDir = $root . '/backend/storage/products/' . $supplierId;
$findByModel = $pdo->prepare("SELECT id, images FROM products WHERE supplier_id = ? AND model = ? LIMIT 1");
$updImages = $pdo->prepare("UPDATE products SET images = ?, updated_at = datetime('now','localtime') WHERE id = ?");
$insert = $pdo->prepare(
    "INSERT INTO products (supplier_id, category, name, spec, brand, model, unit, moq, base_price, currency,
        stock_status, images, description, status, price_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IDR', ?, ?, ?, 'pending', datetime('now','localtime'))"
);

$stat = ['added' => 0, 'exists' => 0, 'repaired' => 0, 'noCode' => 0, 'zeroPrice' => 0, 'imgOk' => 0, 'imgFail' => 0, 'imgNone' => 0];
$catDist = [];
$unknownCats = [];
$failed = [];
$seenCodes = [];
$n = 0;
$total = count($rows);
foreach ($rows as $r) {
    $n++;
    $m = yalvMap($r, $unknownCats);
    if ($m['model'] === '') { $stat['noCode']++; continue; }
    if (isset($seenCodes[$m['model']])) { $stat['exists']++; continue; }
    $seenCodes[$m['model']] = true;
    if ($m['base_price'] <= 0) $stat['zeroPrice']++;
    $catDist[$m['category']] = ($catDist[$m['category']] ?? 0) + 1;

    $existing = null;
    if ($supplierId > 0) {
        $findByModel->execute([$supplierId, $m['model']]);
        $existing = $findByModel->fetch() ?: null;
    }

    if ($existing !== null) {
        $cur = json_decode((string) ($existing['images'] ?? '[]'), true);
        if ((is_array($cur) && count($cur) > 0) || $skipImages || $m['img'] === '') {
            $stat['exists']++;
        } else {
            $stat['repaired']++;
            if ($apply) {
                $rel = yalvFetchImage($m['img'], $imgDir, $supplierId);
                if ($rel !== null) {
                    $updImages->execute([json_encode([$rel], JSON_UNESCAPED_SLASHES), (int) $existing['id']]);
                    $stat['imgOk']++;
                } else {
                    $stat['imgFail']++;
                    $failed[] = $m['model'] . ' 补图失败';
                }
            }
        }
    } elseif ($imagesOnly) {
        // 仅补图模式不新增
    } else {
        $stat['added']++;
        if (!$apply) {
            if ($stat['added'] <= 5) {
                echo "  + {$m['name']} | {$m['spec']} | {$m['brand']} | {$m['model']} | {$m['unit']} | Rp {$m['base_price']} | {$m['category']} | {$m['stock_status']}\n";
            }
        } else {
            $images = [];
            if ($m['img'] === '') {
                $stat['imgNone']++;
            } elseif (!$skipImages) {
                $rel = yalvFetchImage($m['img'], $imgDir, $supplierId);
                if ($rel !== null) { $images[] = $rel; $stat['imgOk']++; }
                else { $stat['imgFail']++; $failed[] = $m['model'] . ' 图片下载失败'; }
            }
            $insert->execute([
                $supplierId, $m['category'], $m['name'], $m['spec'], $m['brand'], $m['model'], $m['unit'],
                $m['moq'], $m['base_price'], $m['stock_status'],
                json_encode($images, JSON_UNESCAPED_SLASHES), $m['description'],
            ]);
        }
    }

    if ($apply && $n % 100 === 0) {
        echo "  … {$n}/{$total}  新增 {$stat['added']}  补图 {$stat['repaired']}  已存在 {$stat['exists']}  图片 {$stat['imgOk']}/{$stat['imgFail']}\n";
    }
}

echo "\n完成：新增 {$stat['added']}，补图 {$stat['repaired']}，已存在跳过 {$stat['exists']}，无编码跳过 {$stat['noCode']}，其中 0 价 {$stat['zeroPrice']}（pending 待补价）\n";
if ($apply && !$skipImages) echo "图片：成功 {$stat['imgOk']}，失败 {$stat['imgFail']}，源无图 {$stat['imgNone']}（失败的可再跑 --apply --images-only 续补）\n";
if (!$apply) echo "（dry-run，未写库未下图；--apply 才执行）\n";
arsort($catDist);
echo "品类分布：" . implode('，', array_map(fn($k, $v) => "{$k} {$v}", array_keys($catDist), $catDist)) . "\n";
if ($unknownCats) echo "⚠ 未映射的一级分类（落「" . CAT_FALLBACK . "」）：" . implode('，', array_map(fn($k, $v) => "{$k}×{$v}", array_keys($unknownCats), $unknownCats)) . "\n";
if ($failed) {
    fwrite(STDERR, "失败明细（" . count($failed) . "）：\n  " . implode("\n  ", array_slice($failed, 0, 50)) . (count($failed) > 50 ? "\n  …" : '') . "\n");
}
echo "商品以 pending 入库，后台「商品库」审核后上架；0 价商品补价前上不了架（02 号单闸门）。\n";
