<?php

/**
 * 对外电子货架（公开，无需登录）
 * 只展示已上架商品的星选对外价，永不返回供应商身份 / 底价。
 * 对外价 = base_price × (1 + 加价率/100)
 * 加价率优先级：单品覆盖 markup_pct_override > 品类加价率 shelf.category_markup > 默认 shelf.default_markup_pct
 */

/** 一次性加载定价上下文（品类加价率映射 + 默认加价率） */
function _shelfPricingCtx(PDO $pdo): array
{
    $map = [];
    foreach (preg_split('/\r?\n/', getSetting($pdo, 'shelf.category_markup', '')) as $line) {
        $line = trim($line);
        if ($line === '') continue;
        $parts = preg_split('/[:：]/u', $line, 2);
        if (count($parts) === 2 && trim($parts[0]) !== '') {
            $map[trim($parts[0])] = (float) trim($parts[1]);
        }
    }
    return [
        'category_map' => $map,
        'default_pct' => (float) getSetting($pdo, 'shelf.default_markup_pct', '15'),
    ];
}

function _shelfMarkupPct(array $product, array $ctx): float
{
    if ($product['markup_pct_override'] !== null && $product['markup_pct_override'] !== '') {
        return (float) $product['markup_pct_override'];
    }
    $cat = (string) ($product['category'] ?? '');
    if ($cat !== '' && isset($ctx['category_map'][$cat])) {
        return $ctx['category_map'][$cat];
    }
    return $ctx['default_pct'];
}

function _shelfSellPrice(array $product, array $ctx): float
{
    return round(((float) $product['base_price']) * (1 + _shelfMarkupPct($product, $ctx) / 100), 2);
}

/** 对外货架商品脱敏输出（列表用） */
function _shelfPublicRow(array $p, array $ctx): array
{
    $images = json_decode((string) ($p['images'] ?? '[]'), true) ?: [];
    return [
        'id' => (int) $p['id'],
        'name' => $p['name'],
        'spec' => $p['spec'],
        'brand' => $p['brand'],
        'category' => $p['category'],
        'unit' => $p['unit'],
        'moq' => (float) $p['moq'],
        'currency' => $p['currency'],
        'sell_price' => _shelfSellPrice($p, $ctx),
        'stock_status' => $p['stock_status'],
        'lead_time' => $p['lead_time'],
        'cover' => $images[0] ?? '',
    ];
}

/* 对外货架统一兜底：status='on' 之外再要求 base_price > 0，
   即使库里混进 0 价脏数据，客户侧也一条都看不到（20260808-02） */

/** 货架元信息：品类树（大类含子类、在售数量）+ 联系方式 + 品牌抬头 */
function handle_shelfMeta(PDO $pdo): void
{
    $counts = [];
    foreach ($pdo->query("SELECT category, COUNT(*) c FROM products WHERE status='on' AND base_price > 0 GROUP BY category")->fetchAll() as $r) {
        $counts[(string) $r['category']] = (int) $r['c'];
    }
    // 递归输出三级树，count 为自身 + 全部后代在售数
    $mapNode = function (array $t) use (&$mapNode, $counts) {
        $node = [
            'id' => (int) $t['id'],
            'name' => $t['name'],
            'count' => $counts[$t['name']] ?? 0,
            'children' => [],
        ];
        foreach ($t['children'] as $c) {
            $child = $mapNode($c);
            $node['count'] += $child['count'];
            $node['children'][] = $child;
        }
        return $node;
    };
    $cats = array_map($mapNode, _categoryTree($pdo, true));
    $logoRel = trim((string) getSetting($pdo, 'pdf_logo_path', ''));
    $qrDouyin = trim((string) getSetting($pdo, 'shelf.qr_douyin', ''));
    $qrChannels = trim((string) getSetting($pdo, 'shelf.qr_channels', ''));
    $qrWecom = trim((string) getSetting($pdo, 'shelf.qr_wecom', ''));
    jsonOk([
        'company_name' => getSetting($pdo, 'company_name', '星选建材'),
        'logo_url' => $logoRel !== '' ? '/storage/' . ltrim($logoRel, '/') : '',
        'contact_phone' => getSetting($pdo, 'shelf.contact_phone', ''),
        'contact_wechat' => getSetting($pdo, 'shelf.contact_wechat', ''),
        'qr_douyin_url' => $qrDouyin !== '' ? '/storage/' . ltrim($qrDouyin, '/') : '',
        'qr_channels_url' => $qrChannels !== '' ? '/storage/' . ltrim($qrChannels, '/') : '',
        'qr_wecom_url' => $qrWecom !== '' ? '/storage/' . ltrim($qrWecom, '/') : '',
        'categories' => $cats,
        'total_on' => (int) $pdo->query("SELECT COUNT(*) FROM products WHERE status='on' AND base_price > 0")->fetchColumn(),
    ]);
}

/** 最新星选视频（公开）：短视频矩阵里已上传的成品，用于货架首页展示 */
function handle_shelfLatestVideos(PDO $pdo, array $input): void
{
    $limit = pageInt($input['limit'] ?? 6, 6, 1, 20);
    $rows = $pdo->query("SELECT id, title, cover_path, video_path, duration
        FROM sv_assets WHERE video_path != '' ORDER BY id DESC LIMIT {$limit}")->fetchAll();
    $items = array_map(function ($r) {
        return [
            'id' => (int) $r['id'],
            'title' => $r['title'] !== '' ? $r['title'] : '星选建材视频',
            'cover_url' => $r['cover_path'] ? '/storage/' . ltrim($r['cover_path'], '/') : '',
            'video_url' => $r['video_path'] ? '/storage/' . ltrim($r['video_path'], '/') : '',
            'duration' => (int) $r['duration'],
        ];
    }, $rows);
    jsonOk(['items' => $items]);
}

function handle_shelfListProducts(PDO $pdo, array $input): void
{
    $page = pageInt($input['page'] ?? 1, 1);
    $pageSize = pageInt($input['page_size'] ?? 24, 24, 1, 60);

    $where = ["p.status = 'on'", 'p.base_price > 0'];
    $params = [];
    if (!empty($input['category'])) {
        // 大类：命中自身 + 全部子类
        $names = categoryLeafNames($pdo, (string) $input['category']);
        $where[] = 'p.category IN (' . implode(',', array_fill(0, count($names), '?')) . ')';
        array_push($params, ...$names);
    }
    if (!empty($input['keyword'])) {
        $kw = '%' . trim((string) $input['keyword']) . '%';
        $where[] = '(p.name LIKE ? OR p.spec LIKE ? OR p.brand LIKE ? OR p.model LIKE ?)';
        array_push($params, $kw, $kw, $kw, $kw);
    }
    if (!empty($input['in_stock'])) {
        $where[] = "p.stock_status = 'in_stock'";
    }
    // 排序：综合(默认) / 最新 / 价格升降（按底价排，品类内加价率一致，顺序等价于对外价）
    $order = 'p.sort_weight DESC, p.id DESC';
    switch ((string) ($input['sort'] ?? '')) {
        case 'newest':     $order = 'p.id DESC'; break;
        case 'price_asc':  $order = 'p.base_price ASC, p.id DESC'; break;
        case 'price_desc': $order = 'p.base_price DESC, p.id DESC'; break;
    }
    $sql = 'SELECT p.* FROM products p WHERE ' . implode(' AND ', $where)
        . ' ORDER BY ' . $order;
    $ret = paginate($pdo, $sql, $params, $page, $pageSize);

    $ctx = _shelfPricingCtx($pdo);
    $ret['items'] = array_map(fn($p) => _shelfPublicRow($p, $ctx), $ret['items']);
    jsonOk($ret);
}

function handle_shelfGetProduct(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT * FROM products WHERE id = ? AND status = 'on' AND base_price > 0");
    $st->execute([$id]);
    $p = $st->fetch();
    if (!$p) jsonError('商品不存在或已下架', 404);

    $ctx = _shelfPricingCtx($pdo);
    $row = _shelfPublicRow($p, $ctx);
    $row['images'] = json_decode((string) ($p['images'] ?? '[]'), true) ?: [];
    $row['freight_note'] = $p['freight_note'];
    $row['model'] = $p['model'];
    $row['description'] = $p['description'];

    // 信任要素：验厂标 + 合作次数（订单按供应商名匹配统计），不露供应商身份
    $sup = null;
    $st = $pdo->prepare("SELECT name, rating, is_verified FROM suppliers WHERE id = ?");
    $st->execute([(int) $p['supplier_id']]);
    $sup = $st->fetch();
    $dealCount = 0;
    if ($sup) {
        $st = $pdo->prepare("SELECT COUNT(*) FROM orders WHERE supplier_name = ? AND supplier_name != ''");
        $st->execute([(string) $sup['name']]);
        $dealCount = (int) $st->fetchColumn();
    }
    $row['trust'] = [
        'is_verified' => $sup ? (int) $sup['is_verified'] : 0,
        'rating' => $sup ? (int) $sup['rating'] : 0,
        'deal_count' => $dealCount,
    ];

    // 同品类推荐
    $st = $pdo->prepare("SELECT * FROM products WHERE status='on' AND base_price > 0 AND category = ? AND id != ? ORDER BY sort_weight DESC, id DESC LIMIT 8");
    $st->execute([(string) $p['category'], $id]);
    $row['related'] = array_map(fn($r) => _shelfPublicRow($r, $ctx), $st->fetchAll());

    jsonOk(['product' => $row]);
}
