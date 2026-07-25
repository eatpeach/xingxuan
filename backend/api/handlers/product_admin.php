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
