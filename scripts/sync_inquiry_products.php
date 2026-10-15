<?php
/**
 * 商机里报过价的产品 → 商品库（20261015）
 *
 * 老板：把商机管理里所有的产品同步到商品库，按建材类目分类，要保留价格。
 *
 * 用法：
 *   php scripts/sync_inquiry_products.php            # 试运行：只打印会导入什么，不写库
 *   php scripts/sync_inquiry_products.php --apply    # 真正写库（可重复跑，按去重键更新）
 *   php scripts/sync_inquiry_products.php --rollback # 撤回：只删本脚本导入的那批
 *
 * 几个决定（都写在这里，免得下一个人以为是随手定的）：
 *
 * 1. 只导【有价格】的产品。询价明细里还没人报过价的行没有价格，
 *    导进去是一堆 0 元商品，反而让商品库没法用。
 *
 * 2. 价格：base_price 存【成本价】（供应商报给我们的底价）——商品库这个字段本来就是底价。
 *    对客售价不丢：按当时实际 售价/成本 算出加价率，存进 markup_pct_override。
 *    以后上架到货架，显示的就是当时真实报给客户的价格。
 *
 * 3. 全部以【已下架】状态导入。货架只展示「已上架」的商品，
 *    一次性把几百个内部报价商品推到对外货架上，等于把进价体系摊给所有访客。
 *    要上架的，在商品库里一个个挑出来上。
 *
 * 4. 去重：同一供应商 + 同品名 + 同规格 + 同单位 = 同一个商品，取【最近一次】报价的价格；
 *    被报价的次数记进 sort_weight，常用的排前面。
 *
 * 5. 类目：先拿品名+规格去匹配品类表（最长匹配，跳过「销」「绳」这类单字类目和「其他…」兜底类目，
 *    否则「插销」「钢丝绳」以外的东西也会被单字带偏）；匹配不上再看供应商的经营品类；
 *    都不行才标「未分类」，留给人工归类。
 *
 * 6. 只动 import_source='inquiry_sync' 的行。供应商自己在门户录的商品，一行都不碰。
 */

$root = dirname(__DIR__);
require_once $root . '/backend/config/database.php';
require_once $root . '/backend/includes/helpers.php';

$apply = in_array('--apply', $argv, true);
$rollback = in_array('--rollback', $argv, true);

$db = Database::getInstance();
$db->initialize();
$pdo = $db->getConnection();

const SRC = 'inquiry_sync';

if ($rollback) {
    $n = (int) $pdo->query("SELECT COUNT(*) FROM products WHERE import_source = '" . SRC . "'")->fetchColumn();
    $pdo->exec("DELETE FROM products WHERE import_source = '" . SRC . "'");
    echo "已撤回：删除从商机同步的商品 {$n} 条（供应商自己录的商品未动）。\n";
    exit(0);
}

function norm(string $s): string
{
    $s = mb_strtolower(trim($s));
    $s = str_replace(['（', '）', '＊', '×', '　'], ['(', ')', '*', '*', ' '], $s);
    return preg_replace('/\s+/u', ' ', $s);
}

// ---------- 品类表 ----------
$cats = [];        // name => [id, parent_id]
$catParent = [];   // id => name（顶级名）
foreach ($pdo->query("SELECT id, name, parent_id FROM categories WHERE is_active = 1")->fetchAll() as $c) {
    $cats[trim($c['name'])] = ['id' => (int) $c['id'], 'parent' => (int) ($c['parent_id'] ?? 0)];
}
$idToName = [];
foreach ($cats as $n => $c) $idToName[$c['id']] = $n;

// 能拿来做关键词匹配的类目：至少两个字、不是「其他…」这种兜底类目
$matchable = array_values(array_filter(array_keys($cats), function ($n) {
    return mb_strlen($n) >= 2 && mb_strpos($n, '其他') !== 0;
}));
usort($matchable, fn ($a, $b) => mb_strlen($b) <=> mb_strlen($a));   // 长的优先

function matchCategory(string $text, array $matchable): string
{
    $t = norm($text);
    if ($t === '') return '';
    foreach ($matchable as $c) {
        if (mb_strpos($t, mb_strtolower($c)) !== false) return $c;
    }
    return '';
}

function topLevelOf(string $cat, array $cats, array $idToName): string
{
    if (!isset($cats[$cat])) return $cat === '' ? '未分类' : $cat;
    $p = $cats[$cat]['parent'];
    return $p && isset($idToName[$p]) ? $idToName[$p] : $cat;
}

// ---------- 供应商 ----------
$suppliers = [];      // id => [name, category]
$supByName = [];      // 规范化名 => id
foreach ($pdo->query("SELECT id, name, category FROM suppliers")->fetchAll() as $s) {
    $suppliers[(int) $s['id']] = ['name' => $s['name'], 'category' => (string) $s['category']];
    $supByName[norm((string) $s['name'])] = (int) $s['id'];
}

// 供应商经营品类 → 品类表里的类目（经营品类是自由文本，如「轻钢龙骨，石膏板，铝方通」）
function supplierCategory(int $sid, array $suppliers, array $matchable): string
{
    if (!isset($suppliers[$sid])) return '';
    foreach (preg_split('/[,，、\/\s]+/u', $suppliers[$sid]['category']) as $tok) {
        $tok = trim($tok);
        if ($tok === '' || $tok === '全部') continue;
        $hit = matchCategory($tok, $matchable);
        if ($hit !== '') return $hit;
    }
    return '';
}

// ---------- 来源 A：供应商报价（供应商明确、价格就是他报给我们的底价）----------
$rowsA = $pdo->query("
    SELECT sqi.id AS sqi_id, sqi.brand, sqi.model, sqi.spec AS sq_spec, sqi.supplier_price, sqi.unit AS sq_unit,
           sqi.lead_time, sq.supplier_id, sq.currency, sq.created_at,
           ii.product_name, ii.spec AS ii_spec, ii.unit AS ii_unit,
           (SELECT ci.sell_price FROM customer_quote_items ci
              WHERE ci.source_supplier_quote_item_id = sqi.id AND ci.sell_price > 0
              ORDER BY ci.id DESC LIMIT 1) AS sell_price
    FROM supplier_quote_items sqi
    JOIN supplier_quotes sq ON sq.id = sqi.quote_id
    LEFT JOIN inquiry_items ii ON ii.id = sqi.inquiry_item_id
    WHERE sqi.supplier_price > 0
")->fetchAll();

// ---------- 来源 B：对客报价里没挂供应商报价的行（多是历史补录订单）----------
$rowsB = $pdo->query("
    SELECT ci.id AS ci_id, ci.product_name, ci.spec, ci.unit, ci.cost_price, ci.sell_price,
           ci.brand_display AS brand, ci.model_display AS model, ci.lead_time,
           q.currency, q.created_at, o.supplier_name
    FROM customer_quote_items ci
    JOIN customer_quotes q ON q.id = ci.quote_id
    LEFT JOIN orders o ON o.quote_id = q.id
    WHERE (ci.source_supplier_quote_item_id IS NULL OR ci.source_supplier_quote_item_id = 0)
      AND ci.cost_price > 0
")->fetchAll();

// ---------- 合并去重 ----------
$items = [];   // key => record
$noSupplier = 0;

$push = function (array $r) use (&$items) {
    $key = $r['supplier_id'] . '|' . norm($r['name']) . '|' . norm($r['spec']) . '|' . norm($r['unit']);
    if (!isset($items[$key])) {
        $r['times'] = 1;
        $items[$key] = $r;
        return;
    }
    $items[$key]['times']++;
    // 取最近一次的价格
    if ((string) $r['at'] > (string) $items[$key]['at']) {
        $times = $items[$key]['times'];
        $items[$key] = $r;
        $items[$key]['times'] = $times;
    }
};

foreach ($rowsA as $r) {
    $name = trim((string) $r['product_name']);
    if ($name === '') continue;
    $push([
        'supplier_id' => (int) $r['supplier_id'],
        'name' => $name,
        // 规格以询价单为准（客户要的就是这个规格），供应商自己填的规格补充在后
        'spec' => trim((string) ($r['ii_spec'] ?: $r['sq_spec'])),
        'unit' => trim((string) ($r['ii_unit'] ?: $r['sq_unit'] ?: '件')),
        'brand' => trim((string) $r['brand']),
        'model' => trim((string) $r['model']),
        'cost' => (float) $r['supplier_price'],
        'sell' => (float) ($r['sell_price'] ?? 0),
        'currency' => strtoupper((string) ($r['currency'] ?: 'IDR')),
        'lead_time' => trim((string) $r['lead_time']),
        'at' => (string) $r['created_at'],
    ]);
}

foreach ($rowsB as $r) {
    $name = trim((string) $r['product_name']);
    if ($name === '') continue;
    // 订单上的供应商名可能是「A / B」多家，取第一家能对上的
    $sid = 0;
    foreach (preg_split('/\s*\/\s*/u', (string) $r['supplier_name']) as $sn) {
        $k = norm($sn);
        if ($k !== '' && isset($supByName[$k])) { $sid = $supByName[$k]; break; }
    }
    if ($sid === 0) $noSupplier++;
    $push([
        'supplier_id' => $sid,
        'name' => $name,
        'spec' => trim((string) $r['spec']),
        'unit' => trim((string) ($r['unit'] ?: '件')),
        'brand' => trim((string) $r['brand']),
        'model' => trim((string) $r['model']),
        'cost' => (float) $r['cost_price'],
        'sell' => (float) $r['sell_price'],
        'currency' => strtoupper((string) ($r['currency'] ?: 'IDR')),
        'lead_time' => trim((string) $r['lead_time']),
        'at' => (string) $r['created_at'],
    ]);
}

// ---------- 归类 + 加价率 ----------
$byTop = [];
$byHow = ['品名匹配' => 0, '供应商品类' => 0, '未分类' => 0];
foreach ($items as $k => &$it) {
    $cat = matchCategory($it['name'] . ' ' . $it['spec'], $matchable);
    $how = '品名匹配';
    if ($cat === '') {
        $cat = supplierCategory($it['supplier_id'], $suppliers, $matchable);
        $how = '供应商品类';
    }
    if ($cat === '') {
        $cat = '未分类';
        $how = '未分类';
    }
    $it['category'] = $cat;
    $it['how'] = $how;
    $byHow[$how]++;
    $top = $cat === '未分类' ? '未分类' : topLevelOf($cat, $cats, $idToName);
    $byTop[$top] = ($byTop[$top] ?? 0) + 1;

    // 当时实际的加价率：售价/成本 - 1。离谱的（亏本、或加价超过 300%）不存，免得上架价格失真
    $it['markup'] = null;
    if ($it['cost'] > 0 && $it['sell'] > $it['cost']) {
        $m = round(($it['sell'] / $it['cost'] - 1) * 100, 1);
        if ($m > 0 && $m <= 300) $it['markup'] = $m;
    }
    $it['import_key'] = substr(sha1($k), 0, 24);
}
unset($it);

arsort($byTop);

// ---------- 报告 ----------
echo "\n=== 商机 → 商品库 同步" . ($apply ? '' : '（试运行，未写库）') . " ===\n\n";
echo "原始报价行：供应商报价 " . count($rowsA) . " 行 + 未挂供应商报价的对客报价 " . count($rowsB) . " 行\n";
echo "去重后商品：" . count($items) . " 个\n";
echo "  其中供应商对不上（挂到「供应商待补」）：{$noSupplier} 行来源\n";
echo "  带历史加价率（可还原对客售价）：" . count(array_filter($items, fn ($x) => $x['markup'] !== null)) . " 个\n\n";
echo "归类方式：品名匹配 {$byHow['品名匹配']} / 按供应商经营品类 {$byHow['供应商品类']} / 未分类 {$byHow['未分类']}\n\n";
echo "按大类：\n";
foreach ($byTop as $t => $n) printf("  %-10s %d\n", $t, $n);

echo "\n样例（前 15 个，按被报价次数）：\n";
$sample = $items;
usort($sample, fn ($a, $b) => $b['times'] <=> $a['times']);
foreach (array_slice($sample, 0, 15) as $it) {
    printf("  [%s] %s %s | %s %s | 底价 %s%s | 报过 %d 次\n",
        $it['category'], $it['name'], $it['spec'] ? "（{$it['spec']}）" : '',
        $suppliers[$it['supplier_id']]['name'] ?? '供应商待补', $it['unit'],
        number_format($it['cost']), $it['markup'] !== null ? " · 加价 {$it['markup']}%" : '',
        $it['times']);
}

if (!$apply) {
    echo "\n（试运行，没有写库。确认无误后加 --apply 执行）\n";
    exit(0);
}

// ---------- 写库：按 import_key 插入或更新 ----------
$find = $pdo->prepare("SELECT id FROM products WHERE import_key = ? AND import_source = ?");
$ins = $pdo->prepare("INSERT INTO products
    (supplier_id, category, name, spec, brand, model, unit, base_price, currency, lead_time,
     status, markup_pct_override, sort_weight, price_updated_at, import_source, import_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'off', ?, ?, ?, ?, ?)");
// 已存在的只更新价格和类目，不改状态 —— 老板手动上架过的，重跑同步不能把它打回下架
$upd = $pdo->prepare("UPDATE products SET base_price = ?, currency = ?, markup_pct_override = ?,
    category = CASE WHEN category = '' OR category = '未分类' THEN ? ELSE category END,
    sort_weight = ?, price_updated_at = ?, updated_at = datetime('now','localtime')
    WHERE id = ?");

$added = $updated = 0;
$pdo->beginTransaction();
try {
    foreach ($items as $it) {
        $find->execute([$it['import_key'], SRC]);
        $pid = (int) $find->fetchColumn();
        if ($pid) {
            $upd->execute([$it['cost'], $it['currency'], $it['markup'], $it['category'],
                $it['times'], $it['at'], $pid]);
            $updated++;
        } else {
            $ins->execute([$it['supplier_id'], $it['category'], $it['name'], $it['spec'],
                $it['brand'], $it['model'], $it['unit'], $it['cost'], $it['currency'], $it['lead_time'],
                $it['markup'], $it['times'], $it['at'], SRC, $it['import_key']]);
            $added++;
        }
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "写库失败，已整体回滚：" . $e->getMessage() . "\n");
    exit(1);
}
echo "\n已写入：新增 {$added} 个，更新 {$updated} 个。全部为「已下架」状态，不会出现在对外货架上。\n";
echo "撤回命令：php scripts/sync_inquiry_products.php --rollback\n";
