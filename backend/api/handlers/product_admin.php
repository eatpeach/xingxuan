<?php

/**
 * 商品库后台管理：审核 / 上下架 / 加价率覆盖 / 改价记录 / 供应商门户账号
 */

function handle_adminListProducts(PDO $pdo, array $input): void
{
    $page = pageInt($input['page'] ?? 1, 1);
    $pageSize = pageInt($input['page_size'] ?? 20, 20, 1, 100);
    $where = ['1=1'];
    $params = [];
    if (!empty($input['status'])) {
        $where[] = 'p.status = ?';
        $params[] = (string) $input['status'];
    }
    if (!empty($input['supplier_id'])) {
        $where[] = 'p.supplier_id = ?';
        $params[] = (int) $input['supplier_id'];
    }
    if (!empty($input['category'])) {
        $where[] = 'p.category = ?';
        $params[] = (string) $input['category'];
    }
    if (!empty($input['keyword'])) {
        $kw = '%' . trim((string) $input['keyword']) . '%';
        $where[] = '(p.name LIKE ? OR p.spec LIKE ? OR p.brand LIKE ? OR s.name LIKE ?)';
        array_push($params, $kw, $kw, $kw, $kw);
    }
    $sql = "SELECT p.*, s.name AS supplier_name, s.code AS supplier_code
        FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE " . implode(' AND ', $where) . " ORDER BY p.id DESC";
    $ret = paginate($pdo, $sql, $params, $page, $pageSize);

    $ctx = _shelfPricingCtx($pdo);
    foreach ($ret['items'] as &$p) {
        $p['images'] = json_decode((string) ($p['images'] ?? '[]'), true) ?: [];
        $p['markup_pct'] = _shelfMarkupPct($p, $ctx);
        $p['sell_price'] = _shelfSellPrice($p, $ctx);
    }
    unset($p);
    $counts = [];
    foreach ($pdo->query("SELECT status, COUNT(*) c FROM products GROUP BY status")->fetchAll() as $r) {
        $counts[(string) $r['status']] = (int) $r['c'];
    }
    $ret['status_counts'] = $counts;
    jsonOk($ret);
}

/** 管理端新增/编辑商品（可代供应商录入；可直接改状态 / 加价率覆盖 / 排序权重） */
function handle_adminSaveProduct(PDO $pdo, array $input, array $user): void
{
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') jsonError('请填写商品名称');
    $price = (float) ($input['base_price'] ?? 0);
    // base_price 是我们的出售价。只有成本价、还没定售价的商品也允许先存进库（不能上架，下面有闸门）
    $costIn = _pricingNum($input['cost_price'] ?? null);
    if ($price < 0) $price = 0;
    if ($price <= 0 && ($costIn === null || $costIn <= 0)) jsonError('出售价和成本价至少填一个');
    $supplierId = (int) ($input['supplier_id'] ?? 0);
    if ($supplierId <= 0) jsonError('请选择供应商');

    $images = $input['images'] ?? [];
    if (!is_array($images)) $images = [];
    $images = array_values(array_filter(array_map('strval', $images)));
    if (count($images) > 6) $images = array_slice($images, 0, 6);

    $override = $input['markup_pct_override'] ?? null;
    $override = ($override === '' || $override === null) ? null : (float) $override;

    $fields = [
        'supplier_id' => $supplierId,
        'category' => trim((string) ($input['category'] ?? '')),
        'name' => $name,
        'spec' => trim((string) ($input['spec'] ?? '')),
        'brand' => trim((string) ($input['brand'] ?? '')),
        'model' => trim((string) ($input['model'] ?? '')),
        'unit' => trim((string) ($input['unit'] ?? '')) ?: '件',
        'moq' => (float) ($input['moq'] ?? 0),
        'base_price' => $price,
        'currency' => in_array($input['currency'] ?? 'IDR', ['IDR', 'CNY', 'USD'], true) ? ($input['currency'] ?? 'IDR') : 'IDR',
        'stock_status' => ($input['stock_status'] ?? 'in_stock') === 'pre_order' ? 'pre_order' : 'in_stock',
        'lead_time' => trim((string) ($input['lead_time'] ?? '')),
        'freight_note' => trim((string) ($input['freight_note'] ?? '')),
        'images' => json_encode($images, JSON_UNESCAPED_UNICODE),
        'description' => trim((string) ($input['description'] ?? '')),
        // 产品通用信息（收集表新增列，与 vendor.php 保持一致）
        'material' => trim((string) ($input['material'] ?? '')),
        'origin' => trim((string) ($input['origin'] ?? '')),
        'package_spec' => trim((string) ($input['package_spec'] ?? '')),
        'weight' => trim((string) ($input['weight'] ?? '')),
        'certification' => trim((string) ($input['certification'] ?? '')),
        'warranty' => trim((string) ($input['warranty'] ?? '')),
        'markup_pct_override' => $override,
        'sort_weight' => (int) ($input['sort_weight'] ?? 0),
    ];
    // 内部定价字段：只有前端带了才改。表格里「上架/下架」走的也是这个接口，
    // 不能因为它没带成本价就把已经填好的成本价清空
    foreach (['cost_price', 'quote_min', 'quote_max', 'quote_pt_min', 'quote_pt_max'] as $k) {
        if (array_key_exists($k, $input)) $fields[$k] = _pricingNum($input[$k]);
    }
    $status = in_array($input['status'] ?? '', ['pending', 'on', 'off', 'rejected'], true) ? $input['status'] : null;

    // 上架闸门：显式要求上架的一律先验价，新建/编辑两条分支都走这里。
    // 后台商品列表的「上架」行操作也是打到这个 action（前端 Products.tsx 传 status='on'）。
    if ($status === 'on' && $price <= 0) {
        jsonError('商品还没有出售价，不能上架。请先填写出售价再上架。');
    }

    $id = (int) ($input['id'] ?? 0);
    if ($id > 0) {
        $st = $pdo->prepare("SELECT * FROM products WHERE id = ?");
        $st->execute([$id]);
        $old = $st->fetch();
        if (!$old) jsonError('商品不存在', 404);

        $priceChanged = abs((float) $old['base_price'] - $price) > 0.0001;
        if ($priceChanged) {
            $oldPrice = (float) $old['base_price'];
            $pct = $oldPrice > 0 ? round(($price - $oldPrice) / $oldPrice * 100, 2) : 0.0;
            $pdo->prepare("INSERT INTO product_price_logs (product_id, supplier_id, old_price, new_price, change_pct, changed_by, flagged)
                VALUES (?, ?, ?, ?, ?, ?, 0)")
                ->execute([$id, $supplierId, $oldPrice, $price, $pct, 'admin:' . (int) $user['id']]);
        }

        $sets = [];
        $vals = [];
        foreach ($fields as $k => $v) {
            $sets[] = "{$k} = ?";
            $vals[] = $v;
        }
        if ($status !== null) {
            $sets[] = "status = ?";
            $vals[] = $status;
        }
        if ($priceChanged) $sets[] = "price_updated_at = datetime('now','localtime')";
        $sets[] = "updated_at = datetime('now','localtime')";
        $vals[] = $id;
        $pdo->prepare("UPDATE products SET " . implode(', ', $sets) . " WHERE id = ?")->execute($vals);
        opLog($pdo, 'product', $id, 'admin_update', $name, (int) $user['id']);
        jsonOk(['id' => $id]);
    }

    $cols = array_keys($fields);
    $ph = implode(', ', array_fill(0, count($cols), '?'));
    // 新建默认 pending 而不是 on：不定价就直接上架是本次事故的成因，改为默认走审核
    $pdo->prepare("INSERT INTO products (" . implode(', ', $cols) . ", status, price_updated_at)
        VALUES ({$ph}, ?, datetime('now','localtime'))")
        ->execute(array_merge(array_values($fields), [$status ?: 'pending']));
    $pid = (int) $pdo->lastInsertId();
    opLog($pdo, 'product', $pid, 'admin_create', $name, (int) $user['id']);
    jsonOk(['id' => $pid]);
}

/** 审核：approve → 上架；reject → 驳回（附原因，供应商门户可见） */
function handle_adminReviewProduct(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $decision = (string) ($input['decision'] ?? '');
    if (!in_array($decision, ['approve', 'reject'], true)) jsonError('无效操作');
    $st = $pdo->prepare("SELECT * FROM products WHERE id = ?");
    $st->execute([$id]);
    $p = $st->fetch();
    if (!$p) jsonError('商品不存在', 404);

    if ($decision === 'approve') {
        // 上架闸门：未定价的商品不许审核通过，直接返回错误且不产生任何状态变更
        if ((float) $p['base_price'] <= 0) {
            jsonError('商品未定价（底价为 0），不能上架。请先在商品详情里填写底价再审核。');
        }
        $pdo->prepare("UPDATE products SET status='on', reject_reason='', updated_at=datetime('now','localtime') WHERE id = ?")
            ->execute([$id]);
    } else {
        $reason = trim((string) ($input['reason'] ?? ''));
        $pdo->prepare("UPDATE products SET status='rejected', reject_reason=?, updated_at=datetime('now','localtime') WHERE id = ?")
            ->execute([$reason, $id]);
    }
    opLog($pdo, 'product', $id, 'review_' . $decision, (string) ($input['reason'] ?? ''), (int) $user['id']);
    jsonOk();
}

function handle_adminDeleteProduct(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("DELETE FROM products WHERE id = ?");
    $st->execute([$id]);
    if ($st->rowCount() === 0) jsonError('商品不存在', 404);
    opLog($pdo, 'product', $id, 'admin_delete', '', (int) $user['id']);
    jsonOk();
}

function handle_adminListPriceLogs(PDO $pdo, array $input): void
{
    $page = pageInt($input['page'] ?? 1, 1);
    $pageSize = pageInt($input['page_size'] ?? 20, 20, 1, 100);
    $where = ['1=1'];
    $params = [];
    if (!empty($input['product_id'])) {
        $where[] = 'l.product_id = ?';
        $params[] = (int) $input['product_id'];
    }
    if (!empty($input['flagged'])) {
        $where[] = 'l.flagged = 1';
    }
    $sql = "SELECT l.*, p.name AS product_name, s.name AS supplier_name
        FROM product_price_logs l
        LEFT JOIN products p ON p.id = l.product_id
        LEFT JOIN suppliers s ON s.id = l.supplier_id
        WHERE " . implode(' AND ', $where) . " ORDER BY l.id DESC";
    jsonOk(paginate($pdo, $sql, $params, $page, $pageSize));
}

// ============ 演示数据（后台一键生成 / 一键清除，仅 admin） ============

const DEMO_PRODUCTS = [
    // [品类, 名称, 规格, 品牌, 单位, 底价IDR, 现货1/0, 交期, 起订量]
    ['瓷砖', '通体大理石瓷砖', '800×800mm 亮光', 'ARNA', '张', 78000, 1, '', 100],
    ['瓷砖', '哑光防滑地砖', '600×600mm', 'Mulia', '张', 52000, 1, '', 200],
    ['瓷砖', '木纹砖', '200×1000mm', 'Granito', '张', 65000, 0, '10 天', 300],
    ['瓷砖', '厨卫墙砖', '300×600mm 釉面', 'Roman', '张', 38000, 1, '', 200],
    ['瓷砖', '仿古小花砖', '200×200mm', '', '张', 24000, 0, '15 天', 500],
    ['瓷砖', '户外广场砖', '300×300mm 防滑面', 'Mulia', '张', 29000, 1, '', 400],
    ['卫浴', '陶瓷连体马桶', '虹吸式 300mm 坑距', 'TOTO', '套', 1850000, 1, '', 5],
    ['卫浴', '不锈钢台下盆', '540×410mm 304 钢', 'Onda', '个', 320000, 1, '', 10],
    ['卫浴', '恒温淋浴花洒套装', '顶喷 250mm', 'American Standard', '套', 950000, 0, '7 天', 10],
    ['卫浴', '浴室柜组合', '800mm 岩板台面', '', '套', 2350000, 0, '12 天', 3],
    ['卫浴', '感应水龙头', '冷热两用 304 钢', 'Onda', '个', 480000, 1, '', 20],
    ['卫浴', '蹲便器水箱套装', '节水型', 'INA', '套', 520000, 1, '', 10],
    ['板材', '多层实木板', '1220×2440×18mm', 'Palem', '张', 285000, 1, '', 50],
    ['板材', '防潮石膏板', '1200×2400×9mm', 'Jayaboard', '张', 78000, 1, '', 200],
    ['板材', 'OSB 定向刨花板', '1220×2440×12mm', '', '张', 145000, 0, '5 天', 100],
    ['板材', '生态免漆板', '1220×2440×17mm 暖白', '', '张', 320000, 1, '', 50],
    ['板材', '阻燃密度板', '1220×2440×15mm', '', '张', 195000, 0, '7 天', 100],
    ['板材', '竹木纤维集成墙板', '300×2800mm', '', '米', 45000, 1, '', 500],
    ['涂料', '内墙乳胶漆', '25kg/桶 哑光白', 'Dulux', '桶', 680000, 1, '', 10],
    ['涂料', '外墙防水涂料', '20kg/桶', 'Nippon', '桶', 720000, 1, '', 10],
    ['涂料', '环氧地坪漆', '20kg/组 双组份', 'Propan', '组', 890000, 0, '7 天', 20],
    ['涂料', '真石漆', '25kg/桶 米黄', 'Mowilex', '桶', 560000, 0, '10 天', 30],
    ['涂料', '防锈底漆', '5L/桶 红丹', 'Avian', '桶', 210000, 1, '', 20],
    ['涂料', '木器清漆', '5L/桶 高光', 'Propan', '桶', 340000, 1, '', 20],
    ['灯具', 'LED 平板灯', '600×600 40W 白光', 'Philips', '个', 185000, 1, '', 20],
    ['灯具', 'LED 防水筒灯', '15W 嵌入式 IP65', 'Panasonic', '个', 68000, 1, '', 50],
    ['灯具', '工矿灯 UFO', '150W IP66', '', '个', 420000, 0, '10 天', 20],
    ['灯具', 'LED 路灯头', '100W 太阳能一体', '', '个', 780000, 0, '15 天', 10],
    ['灯具', 'T8 灯管', '1.2m 18W 一体化', 'Osram', '支', 32000, 1, '', 100],
    ['灯具', '轨道射灯', '30W COB 可调角', '', '个', 95000, 1, '', 50],
    ['门窗', '断桥铝合金推拉窗', '定制尺寸 双层玻璃', 'YKK', '平方米', 1350000, 0, '15 天', 10],
    ['门窗', '钢质防火门', '甲级 定制尺寸', '', '樘', 2100000, 0, '20 天', 5],
    ['门窗', '室内生态门', '2100×900mm 免漆', '', '樘', 1250000, 0, '12 天', 10],
    ['门窗', '卫生间铝合金门', '2000×700mm 磨砂玻璃', '', '樘', 850000, 1, '', 10],
    ['门窗', '不锈钢防盗纱窗', '定制尺寸 304 网', '', '平方米', 380000, 0, '10 天', 20],
    ['门窗', '自动感应玻璃门机组', '双开 150kg', 'Dorma', '套', 6800000, 0, '20 天', 2],
    ['五金', '304 不锈钢合页', '4寸 加厚 3mm', 'Dekkson', '对', 28000, 1, '', 100],
    ['五金', '膨胀螺栓', 'M10×100 镀锌 100支/盒', '', '盒', 95000, 1, '', 50],
    ['五金', '玻璃幕墙驳接爪', '250 型 304 钢', '', '个', 380000, 0, '10 天', 20],
    ['五金', '静音门锁三件套', '磁吸 太空铝', 'Dekkson', '套', 165000, 1, '', 50],
    ['五金', '重型滑轨', '450mm 三节 缓冲', 'Huben', '副', 78000, 1, '', 100],
    ['五金', '脚手架扣件', '48mm 直角 铸铁', '', '个', 12000, 1, '', 1000],
    ['水泥', '硅酸盐水泥 PCC', '50kg/袋', 'Tiga Roda', '袋', 68000, 1, '', 200],
    ['水泥', '快干自流平水泥', '25kg/袋', 'Sika', '袋', 185000, 1, '', 100],
    ['水泥', '瓷砖胶', '25kg/袋 强力型', 'MU', '袋', 92000, 1, '', 100],
    ['水泥', '防水砂浆', '25kg/袋 聚合物', 'Sika', '袋', 135000, 1, '', 100],
    ['水泥', '灌浆料', '25kg/袋 高强无收缩', '', '袋', 98000, 0, '5 天', 200],
    ['水泥', '白水泥', '40kg/袋 装饰用', 'Tiga Roda', '袋', 88000, 1, '', 100],
];

// 演示图片：LoremFlickr 按品类关键词出真实产品照片，lock 固定每张图
const DEMO_CAT_IMG_KW = [
    '瓷砖' => 'ceramic,tile', '卫浴' => 'bathroom,sink', '板材' => 'plywood,wood',
    '涂料' => 'paint,bucket', '灯具' => 'led,lamp', '门窗' => 'door',
    '五金' => 'hardware,tools', '水泥' => 'cement,concrete',
];

/** 生成演示数据：3 家演示供应商 + 24 个演示商品（直接上架）+ SVG 占位图 */
function handle_seedDemoProducts(PDO $pdo, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可操作', 403);
    $cnt = (int) $pdo->query("SELECT COUNT(*) FROM products WHERE is_demo = 1")->fetchColumn();
    if ($cnt > 0) jsonError("已有 {$cnt} 条演示商品，请先一键清除再重新生成");

    $demoSuppliers = [
        ['【演示】佳美陶瓷厂', '瓷砖', 1],
        ['【演示】万隆建材制造', '板材', 1],
        ['【演示】雅加达五金城', '五金', 0],
    ];
    $sids = [];
    $ins = $pdo->prepare("INSERT INTO suppliers (code, name, category, rating, is_active, is_verified, is_demo, portal_enabled)
        VALUES (?, ?, ?, ?, 1, ?, 1, 0)");
    foreach ($demoSuppliers as $i => $s) {
        $ins->execute([nextSupplierCode($pdo), $s[0], $s[1], 5 - $i, $s[2]]);
        $sids[] = (int) $pdo->lastInsertId();
    }

    $insP = $pdo->prepare("INSERT INTO products
        (supplier_id, category, name, spec, brand, unit, moq, base_price, currency, stock_status, lead_time, images, status, is_demo, sort_weight, price_updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IDR', ?, ?, ?, 'on', 1, ?, datetime('now','localtime'))");
    $n = 0;
    foreach (DEMO_PRODUCTS as $i => $p) {
        [$cat, $name, $spec, $brand, $unit, $price, $inStock, $lead, $moq] = $p;
        $kw = DEMO_CAT_IMG_KW[$cat] ?? 'construction';
        // 每个商品 2 张真实照片，lock 值固定图片内容
        $images = [
            "https://loremflickr.com/600/600/{$kw}?lock=" . ($i * 2 + 1),
            "https://loremflickr.com/600/600/{$kw}?lock=" . ($i * 2 + 2),
        ];
        $insP->execute([
            $sids[$i % count($sids)],
            $cat, $name, $spec, $brand, $unit, $moq, $price,
            $inStock ? 'in_stock' : 'pre_order',
            $lead,
            json_encode($images),
            count(DEMO_PRODUCTS) - $i,
        ]);
        $n++;
    }
    opLog($pdo, 'product', null, 'seed_demo', "suppliers=3 products={$n}", (int) $user['id']);
    jsonOk(['suppliers' => count($sids), 'products' => $n]);
}

/** 一键清除演示数据：商品 + 改价记录 + 演示供应商 + 占位图目录 */
function handle_clearDemoProducts(PDO $pdo, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可操作', 403);
    $pids = array_map('intval', $pdo->query("SELECT id FROM products WHERE is_demo = 1")->fetchAll(PDO::FETCH_COLUMN));
    if ($pids) {
        $ph = implode(',', $pids);
        $pdo->exec("DELETE FROM product_price_logs WHERE product_id IN ({$ph})");
        $pdo->exec("DELETE FROM products WHERE id IN ({$ph})");
    }
    // 演示供应商只删自己名下已无任何商品的，避免误删挂了真实商品的
    $removedSuppliers = 0;
    foreach ($pdo->query("SELECT id FROM suppliers WHERE is_demo = 1")->fetchAll() as $s) {
        $sid = (int) $s['id'];
        $left = (int) $pdo->query("SELECT COUNT(*) FROM products WHERE supplier_id = {$sid}")->fetchColumn();
        if ($left === 0) {
            $pdo->prepare("DELETE FROM suppliers WHERE id = ?")->execute([$sid]);
            $removedSuppliers++;
        }
    }
    $dir = __DIR__ . '/../../storage/products/demo';
    if (is_dir($dir)) {
        foreach (glob($dir . '/*.svg') ?: [] as $f) @unlink($f);
        @rmdir($dir);
    }
    opLog($pdo, 'product', null, 'clear_demo', 'products=' . count($pids) . " suppliers={$removedSuppliers}", (int) $user['id']);
    jsonOk(['products' => count($pids), 'suppliers' => $removedSuppliers]);
}

/** 管理端上传商品图（代录用），按供应商归目录 */
function handle_adminUploadProductImage(PDO $pdo, array $input, array $user): void
{
    $sid = (int) ($input['supplier_id'] ?? 0);
    if ($sid <= 0) jsonError('缺少供应商');
    if (empty($_FILES['file'])) jsonError('请选择图片');
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败，请重试');
    if ($f['size'] > 10 * 1024 * 1024) jsonError('图片不能超过 10MB');
    $mime = _aiDetectMime($f['tmp_name'], $f['name']);
    $extMap = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($extMap[$mime])) jsonError('仅支持 JPG / PNG / WebP 图片');
    $dir = __DIR__ . '/../../storage/products/' . $sid;
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    $fname = date('YmdHis') . '_' . substr(md5($f['name'] . microtime(true)), 0, 8) . '.' . $extMap[$mime];
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) jsonError('保存失败', 500);
    jsonOk(['url' => '/storage/products/' . $sid . '/' . $fname]);
}

/** 供应商门户账号管理（仅 admin）：开通 / 重置密码 / 停启用 / 验厂标 */
function handle_setSupplierPortal(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可管理门户账号', 403);
    $sid = (int) ($input['supplier_id'] ?? 0);
    $st = $pdo->prepare("SELECT * FROM suppliers WHERE id = ?");
    $st->execute([$sid]);
    $s = $st->fetch();
    if (!$s) jsonError('供应商不存在', 404);

    $sets = [];
    $vals = [];
    if (array_key_exists('username', $input)) {
        $username = trim((string) $input['username']);
        if ($username !== '') {
            $st = $pdo->prepare("SELECT COUNT(*) FROM suppliers WHERE username = ? AND id != ?");
            $st->execute([$username, $sid]);
            if ((int) $st->fetchColumn() > 0) jsonError('该用户名已被其他供应商使用');
        }
        $sets[] = 'username = ?';
        $vals[] = $username;
    }
    if (!empty($input['password'])) {
        $pwd = (string) $input['password'];
        if (strlen($pwd) < 6) jsonError('密码至少 6 位');
        $sets[] = 'password_hash = ?';
        $vals[] = password_hash($pwd, PASSWORD_BCRYPT);
        // 管理员手动设的密码同样是「下发的」，留明文供随时告知；
        // 同时打上首次改密标记，供应商登录后自己改掉，明文随即清空
        $sets[] = 'initial_pwd = ?';
        $vals[] = $pwd;
        $sets[] = 'must_change_pwd = ?';
        $vals[] = 1;
    }
    if (array_key_exists('portal_enabled', $input)) {
        $sets[] = 'portal_enabled = ?';
        $vals[] = (int) !!$input['portal_enabled'];
    }
    if (array_key_exists('is_verified', $input)) {
        $sets[] = 'is_verified = ?';
        $vals[] = (int) !!$input['is_verified'];
    }
    if (empty($sets)) jsonError('没有要更新的内容');
    $sets[] = "updated_at = datetime('now','localtime')";
    $vals[] = $sid;
    $pdo->prepare("UPDATE suppliers SET " . implode(', ', $sets) . " WHERE id = ?")->execute($vals);
    opLog($pdo, 'supplier', $sid, 'set_portal', json_encode(array_intersect_key($input, array_flip(['username', 'portal_enabled', 'is_verified'])), JSON_UNESCAPED_UNICODE), (int) $user['id']);
    jsonOk();
}


/* ================= 商品库定价：成本价 / 对客报价区间 / 点位 / Excel 录入（20261103） ================= */

/** 空字符串 / null → null（= 没填），其余转成非负数 */
function _pricingNum($v): ?float
{
    if ($v === null) return null;
    if (is_string($v)) {
        $v = str_replace([',', ' ', 'Rp', 'rp', 'IDR'], '', trim($v));
        if ($v === '') return null;
    }
    if (!is_numeric($v)) return null;
    $f = (float) $v;
    return $f < 0 ? 0.0 : $f;
}

/** 四舍五入到指定单位：1 = 个位，100 = 百位，1000 = 千位；0 = 保留两位小数 */
function _pricingRound(float $v, float $unit): float
{
    if ($unit <= 0) return round($v, 2);
    return round($v / $unit) * $unit;
}

/** 表格里直接改成本价 / 出售价 / 区间（只改传了的字段） */
function handle_adminPatchProductPricing(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT * FROM products WHERE id = ?");
    $st->execute([$id]);
    $old = $st->fetch();
    if (!$old) jsonError('商品不存在', 404);

    $sets = [];
    $vals = [];
    foreach (['cost_price', 'quote_min', 'quote_max'] as $k) {
        if (!array_key_exists($k, $input)) continue;
        $sets[] = "{$k} = ?";
        $vals[] = _pricingNum($input[$k]);
        // 手工改了区间，原来记的点位就对不上了，清掉免得误导
        if ($k !== 'cost_price') {
            $sets[] = $k === 'quote_min' ? 'quote_pt_min = NULL' : 'quote_pt_max = NULL';
        }
    }
    if (array_key_exists('base_price', $input)) {
        $price = (float) (_pricingNum($input['base_price']) ?? 0);
        if ($price <= 0 && $old['status'] === 'on') jsonError('已上架的商品出售价不能为 0，先下架再清空');
        if (abs((float) $old['base_price'] - $price) > 0.0001) {
            _pricingLogChange($pdo, $old, $price, $user);
            $sets[] = 'base_price = ?';
            $vals[] = $price;
            $sets[] = "price_updated_at = datetime('now','localtime')";
        }
    }
    if (!$sets) jsonOk(['id' => $id]);
    $sets[] = "updated_at = datetime('now','localtime')";
    $vals[] = $id;
    $pdo->prepare("UPDATE products SET " . implode(', ', $sets) . " WHERE id = ?")->execute($vals);
    jsonOk(['id' => $id]);
}

function _pricingLogChange(PDO $pdo, array $old, float $newPrice, array $user): void
{
    $oldPrice = (float) $old['base_price'];
    $pct = $oldPrice > 0 ? round(($newPrice - $oldPrice) / $oldPrice * 100, 2) : 0.0;
    $pdo->prepare("INSERT INTO product_price_logs (product_id, supplier_id, old_price, new_price, change_pct, changed_by, flagged)
        VALUES (?, ?, ?, ?, ?, ?, 0)")
        ->execute([(int) $old['id'], (int) $old['supplier_id'], $oldPrice, $newPrice, $pct, 'admin:' . (int) $user['id']]);
}

/**
 * 批量按点位生成对客报价区间：区间 = 成本价 × (1 + 点位%)，再四舍五入。
 * 没填成本价的商品算不了，跳过并报给前端。
 * sell_from 可选 'min' / 'max' / 'mid'：顺手把出售价也设成区间的某个值
 */
function handle_adminApplyPricePoints(PDO $pdo, array $input, array $user): void
{
    $ids = array_values(array_unique(array_filter(array_map('intval', (array) ($input['ids'] ?? [])))));
    if (!$ids) jsonError('请先勾选商品');
    if (count($ids) > 2000) jsonError('一次最多 2000 个商品');
    $ptMin = (float) ($input['pt_min'] ?? 0);
    $ptMax = (float) ($input['pt_max'] ?? 0);
    if ($ptMin < 0 || $ptMax < 0 || $ptMin > 500 || $ptMax > 500) jsonError('点位要在 0–500% 之间');
    if ($ptMax < $ptMin) [$ptMin, $ptMax] = [$ptMax, $ptMin];
    $unit = (float) ($input['round_unit'] ?? 100);
    $sellFrom = in_array($input['sell_from'] ?? '', ['min', 'max', 'mid'], true) ? $input['sell_from'] : '';

    $ph = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT * FROM products WHERE id IN ({$ph})");
    $st->execute($ids);
    $rows = $st->fetchAll();

    $upd = $pdo->prepare("UPDATE products SET quote_min = ?, quote_max = ?, quote_pt_min = ?, quote_pt_max = ?,
        updated_at = datetime('now','localtime') WHERE id = ?");
    $updSell = $pdo->prepare("UPDATE products SET base_price = ?, price_updated_at = datetime('now','localtime') WHERE id = ?");
    $ok = 0;
    $noCost = 0;
    $pdo->beginTransaction();
    try {
        foreach ($rows as $r) {
            $cost = (float) ($r['cost_price'] ?? 0);
            if ($cost <= 0) { $noCost++; continue; }
            $lo = _pricingRound($cost * (1 + $ptMin / 100), $unit);
            $hi = _pricingRound($cost * (1 + $ptMax / 100), $unit);
            $upd->execute([$lo, $hi, $ptMin, $ptMax, (int) $r['id']]);
            if ($sellFrom !== '') {
                $sell = $sellFrom === 'min' ? $lo : ($sellFrom === 'max' ? $hi : _pricingRound(($lo + $hi) / 2, $unit));
                if (abs((float) $r['base_price'] - $sell) > 0.0001) {
                    _pricingLogChange($pdo, $r, $sell, $user);
                    $updSell->execute([$sell, (int) $r['id']]);
                }
            }
            $ok++;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    opLog($pdo, 'product', null, 'apply_price_points', "ok={$ok} no_cost={$noCost} pt={$ptMin}-{$ptMax} unit={$unit} sell={$sellFrom}", (int) $user['id']);
    jsonOk(['updated' => $ok, 'no_cost' => $noCost]);
}

/**
 * 供应商发来的表格 → 原样的表格数据（每页一组行），交给前端预览、对列、改数再入库。
 * 不在后端猜列：供应商的表五花八门，让人在预览里确认比自动猜更靠谱
 */
function handle_adminParseProductSheet(PDO $pdo, array $input): void
{
    if (empty($_FILES['file'])) jsonError('请选择表格文件');
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败，请重试');
    if ($f['size'] > 15 * 1024 * 1024) jsonError('文件不能超过 15MB');
    $name = (string) ($f['name'] ?? '');
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));

    $sheets = [];
    if ($ext === 'csv' || $ext === 'txt') {
        $text = _aiReadCsvAsText($f['tmp_name']);
        $rows = [];
        foreach (preg_split('/\r?\n/', $text) as $line) {
            if (trim($line) === '') continue;
            $rows[] = str_getcsv($line, strpos($line, "\t") !== false ? "\t" : ',');
        }
        $sheets[] = ['name' => $name, 'rows' => $rows];
    } elseif ($ext === 'xlsx') {
        $text = _aiReadXlsxAsText($f['tmp_name']);
        if ($text === '') jsonError('没读出内容，请确认是 .xlsx 文件（老的 .xls 请先另存为 .xlsx）');
        $cur = null;
        foreach (explode("\n", $text) as $line) {
            if (preg_match('/^===== 工作表：(.*) =====$/u', trim($line), $m)) {
                if ($cur && $cur['rows']) $sheets[] = $cur;
                $cur = ['name' => $m[1], 'rows' => []];
                continue;
            }
            if ($cur === null) $cur = ['name' => 'Sheet1', 'rows' => []];
            if (trim($line) === '') continue;
            $cur['rows'][] = array_map('trim', explode("\t", $line));
        }
        if ($cur && $cur['rows']) $sheets[] = $cur;
    } else {
        jsonError('只支持 .xlsx 或 .csv（老的 .xls 请先另存为 .xlsx）');
    }
    foreach ($sheets as &$sh) $sh['rows'] = array_slice($sh['rows'], 0, 3000);
    unset($sh);
    if (!$sheets) jsonError('表格是空的');
    jsonOk(['sheets' => $sheets]);
}

/**
 * 预览确认后的行批量入库。同一供应商下「品名 + 规格」相同的视为同一个商品：
 * 有就更新价格（不动图片、描述），没有就新建。
 */
function handle_adminImportProducts(PDO $pdo, array $input, array $user): void
{
    $sid = (int) ($input['supplier_id'] ?? 0);
    if ($sid <= 0) jsonError('请选择供应商');
    $chk = $pdo->prepare("SELECT id FROM suppliers WHERE id = ?");
    $chk->execute([$sid]);
    if (!$chk->fetchColumn()) jsonError('供应商不存在');
    $rows = (array) ($input['rows'] ?? []);
    if (!$rows) jsonError('没有要导入的行');
    if (count($rows) > 3000) jsonError('一次最多 3000 行');
    $status = in_array($input['status'] ?? '', ['off', 'pending'], true) ? $input['status'] : 'off';
    $category = trim((string) ($input['category'] ?? ''));

    $find = $pdo->prepare("SELECT * FROM products WHERE supplier_id = ? AND name = ? AND spec = ? ORDER BY id LIMIT 1");
    $created = 0;
    $updated = 0;
    $skipped = 0;
    $pdo->beginTransaction();
    try {
        foreach ($rows as $r) {
            if (!is_array($r)) { $skipped++; continue; }
            $name = trim((string) ($r['name'] ?? ''));
            $spec = trim((string) ($r['spec'] ?? ''));
            $cost = _pricingNum($r['cost_price'] ?? null);
            $sell = _pricingNum($r['base_price'] ?? null);
            if ($name === '' || (($cost ?? 0) <= 0 && ($sell ?? 0) <= 0)) { $skipped++; continue; }
            $data = [
                'brand' => trim((string) ($r['brand'] ?? '')),
                'model' => trim((string) ($r['model'] ?? '')),
                'unit' => trim((string) ($r['unit'] ?? '')),
                'category' => trim((string) ($r['category'] ?? '')) ?: $category,
                'description' => trim((string) ($r['description'] ?? '')),
                'moq' => _pricingNum($r['moq'] ?? null),
                'cost_price' => $cost,
                'base_price' => $sell,
                'quote_min' => _pricingNum($r['quote_min'] ?? null),
                'quote_max' => _pricingNum($r['quote_max'] ?? null),
                'quote_pt_min' => _pricingNum($r['quote_pt_min'] ?? null),
                'quote_pt_max' => _pricingNum($r['quote_pt_max'] ?? null),
            ];

            $find->execute([$sid, $name, $spec]);
            $old = $find->fetch();
            if ($old) {
                // 只覆盖表里有值的字段：供应商这次只报了价，别把我们之前填的品牌、单位清空
                $sets = [];
                $vals = [];
                foreach ($data as $k => $v) {
                    if ($v === null || $v === '') continue;
                    if ($k === 'base_price') {
                        if ($v <= 0) continue; // 表里没售价不等于要把售价清零
                        if (abs((float) $old['base_price'] - $v) <= 0.0001) continue;
                        _pricingLogChange($pdo, $old, (float) $v, $user);
                        $sets[] = "price_updated_at = datetime('now','localtime')";
                    }
                    $sets[] = "{$k} = ?";
                    $vals[] = $v;
                }
                if ($sets) {
                    $sets[] = "updated_at = datetime('now','localtime')";
                    $vals[] = (int) $old['id'];
                    $pdo->prepare("UPDATE products SET " . implode(', ', $sets) . " WHERE id = ?")->execute($vals);
                }
                $updated++;
                continue;
            }
            $pdo->prepare("INSERT INTO products
                (supplier_id, name, spec, brand, model, unit, category, description, moq, cost_price, base_price,
                 quote_min, quote_max, quote_pt_min, quote_pt_max, currency, stock_status, images, status, import_source, price_updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IDR', 'in_stock', '[]', ?, 'admin_excel', datetime('now','localtime'))")
                ->execute([
                    $sid, $name, $spec, $data['brand'], $data['model'], $data['unit'] ?: '件', $data['category'],
                    $data['description'], $data['moq'] ?? 0, $cost, $sell ?? 0,
                    $data['quote_min'], $data['quote_max'], $data['quote_pt_min'], $data['quote_pt_max'], $status,
                ]);
            $created++;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    opLog($pdo, 'product', null, 'admin_excel_import', "supplier={$sid} new={$created} upd={$updated} skip={$skipped}", (int) $user['id']);
    jsonOk(['created' => $created, 'updated' => $updated, 'skipped' => $skipped]);
}
