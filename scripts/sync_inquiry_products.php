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
 * 2. 价格：base_price 存报价时的单价，原样保留。
 *    【实测】474 行对客报价里 469 行「对客售价 = 供应商报价」，报价单加价策略全是 none ——
 *    这门生意的利润走厂家返点，不在报价单价里。所以没有加价率可还原，也不去编一个：
 *    markup_pct_override 留空，上架时按货架现有的加价规则走，要改在商品库单独调。
 *
 * 3. 全部以【已下架】状态导入。货架只展示「已上架」的商品，
 *    一次性把几百个内部报价商品推到对外货架上，等于把进价体系摊给所有访客。
 *    要上架的，在商品库里一个个挑出来上。
 *
 * 4. 去重：同一供应商 + 同品名 + 同规格 + 同单位 = 同一个商品，取【最近一次】报价的价格；
 *    被报价的次数记进 sort_weight，常用的排前面。
 *
 * 5. 类目，三层：
 *    ① 关键词：类目名出现在品名里，或品名出现在类目名里（「镀锌钢管」⊂「热镀锌钢管」），
 *       再不行看最长公共片段 ≥3 字。跳过单字类目和「其他…」兜底类目，免得被单字带偏。
 *    ② 供应商经营品类（主力供应商陈总填的是「全部」，这层对他无效）
 *    ③ AI 从品类表里选。【只能选表里已有的类目】，选出表外的一律作废 ——
 *       不然 AI 会自己造类目名，货架导航就乱了。结果缓存到 storage，--apply 时不重复调用。
 *    三层都没结果才标「未分类」。第一版只用 ①② 时 67% 是未分类，这才加的第三层。
 *
 * 6. 只动 import_source='inquiry_sync' 的行。供应商自己在门户录的商品，一行都不碰。
 */

$root = dirname(__DIR__);
require_once $root . '/backend/config/database.php';
require_once $root . '/backend/includes/helpers.php';
require_once $root . '/backend/api/handlers/ai.php';

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

/** 最长公共片段：返回 [长度, 片段本身] */
function lcsSub(string $a, string $b): array
{
    $x = preg_split('//u', $a, -1, PREG_SPLIT_NO_EMPTY);
    $y = preg_split('//u', $b, -1, PREG_SPLIT_NO_EMPTY);
    $best = 0; $endI = 0;
    $prev = array_fill(0, count($y) + 1, 0);
    foreach ($x as $i => $cx) {
        $cur = array_fill(0, count($y) + 1, 0);
        foreach ($y as $j => $cy) {
            if ($cx === $cy) {
                $cur[$j + 1] = $prev[$j] + 1;
                if ($cur[$j + 1] > $best) { $best = $cur[$j + 1]; $endI = $i; }
            }
        }
        $prev = $cur;
    }
    return [$best, $best ? implode('', array_slice($x, $endI - $best + 1, $best)) : ''];
}

/** 两个串的最长公共片段长度（按字） */
function lcsLen(string $a, string $b): int
{
    $x = preg_split('//u', $a, -1, PREG_SPLIT_NO_EMPTY);
    $y = preg_split('//u', $b, -1, PREG_SPLIT_NO_EMPTY);
    $best = 0;
    $prev = array_fill(0, count($y) + 1, 0);
    foreach ($x as $i => $cx) {
        $cur = array_fill(0, count($y) + 1, 0);
        foreach ($y as $j => $cy) {
            if ($cx === $cy) {
                $cur[$j + 1] = $prev[$j] + 1;
                if ($cur[$j + 1] > $best) $best = $cur[$j + 1];
            }
        }
        $prev = $cur;
    }
    return $best;
}

/**
 * 关键词归类。$name 是品名（不含规格），$text 是品名+规格。
 * 打分取最高：类目⊂文本 > 品名⊂类目 > 公共片段≥3
 */
function matchCategory(string $text, array $matchable, string $name = ''): string
{
    $t = norm($text);
    $n = norm($name !== '' ? $name : $text);
    if ($t === '') return '';
    $best = '';
    $bestScore = 0.0;
    foreach ($matchable as $c) {
        $cl = mb_strtolower($c);
        $len = mb_strlen($cl);
        $score = 0.0;
        if (mb_strpos($t, $cl) !== false) {
            $score = $len * 2.0;                              // 类目名整个出现在品名里
        } elseif (mb_strlen($n) >= 2 && mb_strpos($cl, $n) !== false) {
            $score = mb_strlen($n) * 1.5;                     // 品名是类目名的一部分：镀锌钢管 ⊂ 热镀锌钢管
        } else {
            // 公共片段要 ≥3 字且至少含 2 个汉字。只撞上「PVC」这种英文缩写不算 ——
            // 第二次试运行里「PVC90°弯头」就是这么被错归到「双壁波纹管件」的
            [$l, $sub] = lcsSub($n, $cl);
            if ($l >= 3 && preg_match_all('/\p{Han}/u', $sub) >= 2) $score = (float) $l;
        }
        if ($score > $bestScore) { $bestScore = $score; $best = $c; }
    }
    return $best;
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
        'unit' => _aiNormalizeUnit(trim((string) ($r['ii_unit'] ?: $r['sq_unit'] ?: '件'))),
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
        'unit' => _aiNormalizeUnit(trim((string) ($r['unit'] ?: '件'))),
        'brand' => trim((string) $r['brand']),
        'model' => trim((string) $r['model']),
        'cost' => (float) $r['cost_price'],
        'sell' => (float) $r['sell_price'],
        'currency' => strtoupper((string) ($r['currency'] ?: 'IDR')),
        'lead_time' => trim((string) $r['lead_time']),
        'at' => (string) $r['created_at'],
    ]);
}

// ---------- 归类 ----------
// ①② 关键词 + 供应商经营品类
$byHow = ['关键词' => 0, '供应商品类' => 0, 'AI' => 0, '未分类' => 0];
$pending = [];   // 前两层没归上的，交给 AI
foreach ($items as $k => &$it) {
    $cat = matchCategory($it['name'] . ' ' . $it['spec'], $matchable, $it['name']);
    $how = '关键词';
    if ($cat === '') {
        $cat = supplierCategory($it['supplier_id'], $suppliers, $matchable);
        $how = '供应商品类';
    }
    if ($cat === '') {
        $how = '';
        $pending[$k] = $it['name'] . ($it['spec'] ? '（' . $it['spec'] . '）' : '');
    }
    $it['category'] = $cat;
    $it['how'] = $how;
    // 利润走返点不走单价（见头注释第 2 条），不编加价率
    $it['markup'] = null;
    $it['import_key'] = substr(sha1($k), 0, 24);
}
unset($it);

// ③ AI：只许从品类表里选。结果缓存，--apply 时直接复用，不重复花钱
$cacheFile = $root . '/backend/storage/sync_category_cache.json';
$cache = is_file($cacheFile) ? (json_decode((string) file_get_contents($cacheFile), true) ?: []) : [];
$leafNames = array_values(array_filter(array_keys($cats), fn ($n) => mb_strpos($n, '其他') !== 0));

$need = array_filter($pending, fn ($label) => !isset($cache[$label]));
$cfg = _aiOpenaiCfg($pdo);
if ($need && !$cfg) {
    echo "（未配置 OpenAI，跳过 AI 归类，剩下的标未分类）\n";
} elseif ($need) {
    $labels = array_values(array_unique($need));
    $catList = implode('、', $leafNames);
    // 25 个一批：60 个一批时有整批回复解析失败，60 个商品一起掉成「未分类」
    $chunks = array_chunk($labels, 25);
    echo "AI 归类中：" . count($labels) . " 个品名，分 " . count($chunks) . " 批…\n";
    $sys = "你是印尼建材行业的商品归类员。给你一批商品名，每个从【类目表】里选一个最贴切的类目。\n"
        . "规则：\n"
        . "1. 类目必须一字不差地取自类目表，不许自己造、不许改写\n"
        . "2. 选【最具体】的那个：沟槽弯头选「沟槽管件」而不是「管件」，镀锌三通选「镀锌/玛钢管件」，"
        . "PVC 排水弯头选「PVC-U排水管件」，灯按类型选对应的灯类\n"
        . "3. 只有和建材完全无关、类目表里确实没有沾边的，才填空字符串\n"
        . "4. 只输出 JSON：{\"r\":{\"1\":\"类目\",\"2\":\"类目\"}}，键是商品前面的序号\n\n"
        . "【类目表】\n" . $catList;
    foreach ($chunks as $ci => $chunk) {
        $numbered = [];
        foreach ($chunk as $i => $lbl) $numbered[] = ($i + 1) . '. ' . $lbl;
        $r = [];
        for ($try = 0; $try < 2 && !$r; $try++) {
            // 归类是 900 选 1，小模型挑不准具体类目，这里点名用 gpt-4o（账号没有会自动退回 mini）
            $resp = _aiCallOpenAI($cfg, [
                ['role' => 'system', 'content' => $sys],
                ['role' => 'user', 'content' => implode("\n", $numbered)],
            ], ['max_tokens' => 3000, 'model' => 'gpt-4o']);
            $parsed = json_decode((string) ($resp['choices'][0]['message']['content'] ?? ''), true);
            $r = is_array($parsed['r'] ?? null) ? $parsed['r'] : (is_array($parsed) ? $parsed : []);
        }
        $ok = 0;
        foreach ($chunk as $i => $lbl) {
            // 模型有时用序号当键，有时直接用商品名当键，两种都认
            $pick = trim((string) ($r[(string) ($i + 1)] ?? $r[$i + 1] ?? $r[$lbl] ?? ''));
            if ($pick !== '' && !isset($cats[$pick])) {
                // AI 常把「镀锌/玛钢管件」写成「镀锌管件」——不是乱造，是改写了。
                // 就近映射回表里真实存在的类目，映射不上才作废；表外名字绝不落库
                $pick = matchCategory($pick, $matchable, $pick);
            }
            $cache[$lbl] = isset($cats[$pick]) ? $pick : '';
            if ($cache[$lbl] !== '') $ok++;
        }
        echo "  第 " . ($ci + 1) . " 批：" . count($chunk) . " 个，归上 {$ok} 个" . ($r ? '' : '（回复解析失败）') . "\n";
    }
    @file_put_contents($cacheFile, json_encode($cache, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
}

$byTop = [];
foreach ($items as $k => &$it) {
    if ($it['how'] === '') {
        $lbl = $pending[$k];
        $ai = $cache[$lbl] ?? '';
        if ($ai !== '') { $it['category'] = $ai; $it['how'] = 'AI'; }
        else { $it['category'] = '未分类'; $it['how'] = '未分类'; }
    }
    $byHow[$it['how']]++;
    $top = $it['category'] === '未分类' ? '未分类' : topLevelOf($it['category'], $cats, $idToName);
    $byTop[$top] = ($byTop[$top] ?? 0) + 1;
}
unset($it);

arsort($byTop);

// ---------- 报告 ----------
echo "\n=== 商机 → 商品库 同步" . ($apply ? '' : '（试运行，未写库）') . " ===\n\n";
echo "原始报价行：供应商报价 " . count($rowsA) . " 行 + 未挂供应商报价的对客报价 " . count($rowsB) . " 行\n";
echo "去重后商品：" . count($items) . " 个\n";
echo "  其中供应商对不上（挂到「供应商待补」）：{$noSupplier} 行来源\n";
echo "\n归类方式：关键词 {$byHow['关键词']} / 供应商经营品类 {$byHow['供应商品类']} / AI {$byHow['AI']} / 未分类 {$byHow['未分类']}\n\n";
echo "按大类：\n";
foreach ($byTop as $t => $n) printf("  %-10s %d\n", $t, $n);

echo "\n样例（前 15 个，按被报价次数）：\n";
$sample = $items;
usort($sample, fn ($a, $b) => $b['times'] <=> $a['times']);
foreach (array_slice($sample, 0, 15) as $it) {
    printf("  [%s] %s %s | %s %s | 底价 %s%s | 报过 %d 次\n",
        $it['category'], $it['name'], $it['spec'] ? "（{$it['spec']}）" : '',
        $suppliers[$it['supplier_id']]['name'] ?? '供应商待补', $it['unit'],
        number_format($it['cost']), " · {$it['how']}",
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
