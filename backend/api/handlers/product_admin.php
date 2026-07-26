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
    if ($price <= 0) jsonError('请填写有效的供货底价');
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
        'currency' => in_array($input['currency'] ?? 'IDR', ['IDR', 'CNY', 'USD'], true) ? $input['currency'] : 'IDR',
        'stock_status' => ($input['stock_status'] ?? 'in_stock') === 'pre_order' ? 'pre_order' : 'in_stock',
        'lead_time' => trim((string) ($input['lead_time'] ?? '')),
        'freight_note' => trim((string) ($input['freight_note'] ?? '')),
        'images' => json_encode($images, JSON_UNESCAPED_UNICODE),
        'description' => trim((string) ($input['description'] ?? '')),
        'markup_pct_override' => $override,
        'sort_weight' => (int) ($input['sort_weight'] ?? 0),
    ];
    $status = in_array($input['status'] ?? '', ['pending', 'on', 'off', 'rejected'], true) ? $input['status'] : null;

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
    $pdo->prepare("INSERT INTO products (" . implode(', ', $cols) . ", status, price_updated_at)
        VALUES ({$ph}, ?, datetime('now','localtime'))")
        ->execute(array_merge(array_values($fields), [$status ?: 'on']));
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
    ['卫浴', '陶瓷连体马桶', '虹吸式 300mm 坑距', 'TOTO', '套', 1850000, 1, '', 5],
    ['卫浴', '不锈钢台下盆', '540×410mm 304 钢', 'Onda', '个', 320000, 1, '', 10],
    ['卫浴', '恒温淋浴花洒套装', '顶喷 250mm', 'American Standard', '套', 950000, 0, '7 天', 10],
    ['板材', '多层实木板', '1220×2440×18mm', 'Palem', '张', 285000, 1, '', 50],
    ['板材', '防潮石膏板', '1200×2400×9mm', 'Jayaboard', '张', 78000, 1, '', 200],
    ['板材', 'OSB 定向刨花板', '1220×2440×12mm', '', '张', 145000, 0, '5 天', 100],
    ['涂料', '内墙乳胶漆', '25kg/桶 哑光白', 'Dulux', '桶', 680000, 1, '', 10],
    ['涂料', '外墙防水涂料', '20kg/桶', 'Nippon', '桶', 720000, 1, '', 10],
    ['涂料', '环氧地坪漆', '20kg/组 双组份', 'Propan', '组', 890000, 0, '7 天', 20],
    ['灯具', 'LED 平板灯', '600×600 40W 白光', 'Philips', '个', 185000, 1, '', 20],
    ['灯具', 'LED 防水筒灯', '15W 嵌入式 IP65', 'Panasonic', '个', 68000, 1, '', 50],
    ['灯具', '工矿灯 UFO', '150W IP66', '', '个', 420000, 0, '10 天', 20],
    ['门窗', '断桥铝合金推拉窗', '定制尺寸 双层玻璃', 'YKK', '平方米', 1350000, 0, '15 天', 10],
    ['门窗', '钢质防火门', '甲级 定制尺寸', '', '樘', 2100000, 0, '20 天', 5],
    ['门窗', '室内生态门', '2100×900mm 免漆', '', '樘', 1250000, 0, '12 天', 10],
    ['五金', '304 不锈钢合页', '4寸 加厚 3mm', 'Dekkson', '对', 28000, 1, '', 100],
    ['五金', '膨胀螺栓', 'M10×100 镀锌 100支/盒', '', '盒', 95000, 1, '', 50],
    ['五金', '玻璃幕墙驳接爪', '250 型 304 钢', '', '个', 380000, 0, '10 天', 20],
    ['水泥', '硅酸盐水泥 PCC', '50kg/袋', 'Tiga Roda', '袋', 68000, 1, '', 200],
    ['水泥', '快干自流平水泥', '25kg/袋', 'Sika', '袋', 185000, 1, '', 100],
    ['水泥', '瓷砖胶', '25kg/袋 强力型', 'MU', '袋', 92000, 1, '', 100],
];

const DEMO_CAT_COLORS = [
    '瓷砖' => ['#e8eef9', '#5b7fc7'], '卫浴' => ['#e6f4f1', '#3a9e8c'],
    '板材' => ['#f6efe3', '#b08040'], '涂料' => ['#f3e9f5', '#9257a8'],
    '灯具' => ['#fdf3df', '#d99a2b'], '门窗' => ['#e9f0ea', '#5a8a5f'],
    '五金' => ['#ececf1', '#6a6f85'], '水泥' => ['#f0f0ed', '#8a877a'],
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

    $dir = __DIR__ . '/../../storage/products/demo';
    if (!is_dir($dir)) mkdir($dir, 0775, true);

    $insP = $pdo->prepare("INSERT INTO products
        (supplier_id, category, name, spec, brand, unit, moq, base_price, currency, stock_status, lead_time, images, status, is_demo, sort_weight, price_updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IDR', ?, ?, ?, 'on', 1, ?, datetime('now','localtime'))");
    $n = 0;
    foreach (DEMO_PRODUCTS as $i => $p) {
        [$cat, $name, $spec, $brand, $unit, $price, $inStock, $lead, $moq] = $p;
        [$bg, $fg] = DEMO_CAT_COLORS[$cat] ?? ['#eef0f3', '#7a8aa8'];
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">'
            . "<rect width='600' height='600' fill='{$bg}'/>"
            . "<text x='300' y='265' font-size='120' text-anchor='middle' fill='{$fg}' opacity='0.35'>" . htmlspecialchars($cat) . '</text>'
            . "<text x='300' y='380' font-size='34' text-anchor='middle' fill='{$fg}' font-weight='bold'>" . htmlspecialchars($name) . '</text>'
            . "<text x='300' y='430' font-size='24' text-anchor='middle' fill='{$fg}' opacity='0.7'>" . htmlspecialchars($spec) . '</text>'
            . "<text x='300' y='560' font-size='20' text-anchor='middle' fill='{$fg}' opacity='0.5'>演示图片 DEMO</text>"
            . '</svg>';
        $fname = 'demo_' . ($i + 1) . '.svg';
        file_put_contents($dir . '/' . $fname, $svg);
        $insP->execute([
            $sids[$i % count($sids)],
            $cat, $name, $spec, $brand, $unit, $moq, $price,
            $inStock ? 'in_stock' : 'pre_order',
            $lead,
            json_encode(['/storage/products/demo/' . $fname]),
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
