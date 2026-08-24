<?php

/**
 * 供应商门户（/vendor，账户密码登录）
 * token payload: {uid: supplier_id, role: 'vendor'}，与后台 users 体系完全隔离
 * 供应商只能维护自己的商品；改价超阈值自动转待审核
 */

function handle_vendorLogin(PDO $pdo, array $input): void
{
    $username = trim((string) ($input['username'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    if (!$username || !$password) jsonError('用户名和密码不能为空');

    // 与后台登录共用 login_attempts 限流（15 分钟 5 次）
    $ip = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '');
    $ip = trim(explode(',', $ip)[0]);
    $pdo->exec("DELETE FROM login_attempts WHERE created_at < datetime('now','localtime','-1 day')");
    $st = $pdo->prepare("SELECT COUNT(*) FROM login_attempts
        WHERE (username = ? OR ip = ?) AND created_at > datetime('now','localtime','-15 minutes')");
    $st->execute([$username, $ip]);
    if ((int) $st->fetchColumn() >= 5) {
        jsonError('失败次数过多，已临时锁定，请 15 分钟后再试', 429);
    }

    $st = $pdo->prepare("SELECT * FROM suppliers WHERE username = ? AND is_active = 1 AND portal_enabled = 1");
    $st->execute([$username]);
    $s = $st->fetch();
    if (!$s || !$s['password_hash'] || !password_verify($password, $s['password_hash'])) {
        $pdo->prepare("INSERT INTO login_attempts (username, ip) VALUES (?, ?)")->execute([$username, $ip]);
        jsonError('用户名或密码错误', 401);
    }
    $pdo->prepare("DELETE FROM login_attempts WHERE username = ?")->execute([$username]);
    $pdo->prepare("UPDATE suppliers SET last_login_at = datetime('now','localtime') WHERE id = ?")->execute([(int) $s['id']]);
    $token = makeToken(['uid' => (int) $s['id'], 'role' => 'vendor']);
    jsonOk([
        'access_token' => $token,
        'token_type' => 'bearer',
        'supplier_id' => (int) $s['id'],
        'name' => $s['name'],
        'code' => $s['code'] ?? '',
        // 批量开号给的是我们生成的初始密码，改过一次之前不能算只有他知道
        'must_change_pwd' => (int) ($s['must_change_pwd'] ?? 0),
    ]);
}

function handle_vendorMe(PDO $pdo, array $vendor): void
{
    jsonOk(['supplier' => [
        'id' => (int) $vendor['id'],
        'code' => $vendor['code'] ?? '',
        'name' => $vendor['name'],
        'contact' => $vendor['contact'],
        'phone' => $vendor['phone'],
        'category' => $vendor['category'],
        'is_verified' => (int) ($vendor['is_verified'] ?? 0),
        'must_change_pwd' => (int) ($vendor['must_change_pwd'] ?? 0),
        'last_login_at' => $vendor['last_login_at'] ?? null,
    ]]);
}

function handle_vendorChangePassword(PDO $pdo, array $input, array $vendor): void
{
    $oldPwd = (string) ($input['old_password'] ?? '');
    $newPwd = (string) ($input['new_password'] ?? '');
    if (!$oldPwd || !$newPwd) jsonError('请输入当前密码和新密码');
    if (strlen($newPwd) < 6) jsonError('新密码至少 6 位');
    if (!password_verify($oldPwd, $vendor['password_hash'])) jsonError('当前密码不正确', 401);
    // 首次强制改密要是能填回原密码，这道闸门就白设了
    if ($newPwd === $oldPwd) jsonError('新密码不能和当前密码一样');
    $hash = password_hash($newPwd, PASSWORD_BCRYPT);
    $pdo->prepare("UPDATE suppliers SET password_hash = ?, must_change_pwd = 0, updated_at = datetime('now','localtime') WHERE id = ?")
        ->execute([$hash, (int) $vendor['id']]);
    opLog($pdo, 'supplier', (int) $vendor['id'], 'vendor_change_password', '', null, "vendor:{$vendor['id']}");
    jsonOk();
}

function handle_vendorListProducts(PDO $pdo, array $input, array $vendor): void
{
    $page = pageInt($input['page'] ?? 1, 1);
    $pageSize = pageInt($input['page_size'] ?? 20, 20, 1, 100);
    $where = ['supplier_id = ?'];
    $params = [(int) $vendor['id']];
    if (!empty($input['status'])) {
        $where[] = 'status = ?';
        $params[] = (string) $input['status'];
    }
    if (!empty($input['keyword'])) {
        $kw = '%' . trim((string) $input['keyword']) . '%';
        $where[] = '(name LIKE ? OR spec LIKE ? OR brand LIKE ?)';
        array_push($params, $kw, $kw, $kw);
    }
    $sql = 'SELECT * FROM products WHERE ' . implode(' AND ', $where) . ' ORDER BY id DESC';
    $ret = paginate($pdo, $sql, $params, $page, $pageSize);
    foreach ($ret['items'] as &$p) {
        $p['images'] = json_decode((string) ($p['images'] ?? '[]'), true) ?: [];
    }
    unset($p);
    // 状态统计（Tab 角标）
    $counts = ['all' => 0];
    foreach ($pdo->query("SELECT status, COUNT(*) c FROM products WHERE supplier_id = " . (int) $vendor['id'] . " GROUP BY status")->fetchAll() as $r) {
        $counts[(string) $r['status']] = (int) $r['c'];
        $counts['all'] += (int) $r['c'];
    }
    $ret['status_counts'] = $counts;
    jsonOk($ret);
}

/** 供应商新增/编辑商品。改价记日志；上架中的商品改价超阈值转待审核 */
function handle_vendorSaveProduct(PDO $pdo, array $input, array $vendor): void
{
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') jsonError('请填写商品名称');
    $price = (float) ($input['base_price'] ?? 0);
    if ($price <= 0) jsonError('请填写有效的供货底价');

    $images = $input['images'] ?? [];
    if (!is_array($images)) $images = [];
    $images = array_values(array_filter(array_map('strval', $images)));
    if (count($images) > 6) $images = array_slice($images, 0, 6);

    $fields = [
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
    ];

    $id = (int) ($input['id'] ?? 0);
    if ($id > 0) {
        $st = $pdo->prepare("SELECT * FROM products WHERE id = ? AND supplier_id = ?");
        $st->execute([$id, (int) $vendor['id']]);
        $old = $st->fetch();
        if (!$old) jsonError('商品不存在', 404);

        $status = $old['status'];
        if ($status === 'rejected') $status = 'pending'; // 被驳回后重新提交 → 待审核

        $priceChanged = abs((float) $old['base_price'] - $price) > 0.0001;
        if ($priceChanged) {
            $oldPrice = (float) $old['base_price'];
            $pct = $oldPrice > 0 ? round(($price - $oldPrice) / $oldPrice * 100, 2) : 0.0;
            $threshold = (float) getSetting($pdo, 'shelf.price_change_threshold_pct', '15');
            $flagged = abs($pct) > $threshold ? 1 : 0;
            if ($flagged && $old['status'] === 'on') $status = 'pending'; // 超阈值改价 → 下架转审核
            $pdo->prepare("INSERT INTO product_price_logs (product_id, supplier_id, old_price, new_price, change_pct, changed_by, flagged)
                VALUES (?, ?, ?, ?, ?, ?, ?)")
                ->execute([$id, (int) $vendor['id'], $oldPrice, $price, $pct, 'vendor', $flagged]);
        }

        $sets = [];
        $vals = [];
        foreach ($fields as $k => $v) {
            $sets[] = "{$k} = ?";
            $vals[] = $v;
        }
        $sets[] = "status = ?";
        $vals[] = $status;
        if ($priceChanged) $sets[] = "price_updated_at = datetime('now','localtime')";
        $sets[] = "updated_at = datetime('now','localtime')";
        $vals[] = $id;
        $pdo->prepare("UPDATE products SET " . implode(', ', $sets) . " WHERE id = ?")->execute($vals);
        opLog($pdo, 'product', $id, 'vendor_update', $name, null, "vendor:{$vendor['id']}");
        jsonOk(['id' => $id, 'status' => $status]);
    }

    $cols = array_keys($fields);
    $ph = implode(', ', array_fill(0, count($cols), '?'));
    $pdo->prepare("INSERT INTO products (supplier_id, " . implode(', ', $cols) . ", status, price_updated_at)
        VALUES (?, {$ph}, 'pending', datetime('now','localtime'))")
        ->execute(array_merge([(int) $vendor['id']], array_values($fields)));
    $pid = (int) $pdo->lastInsertId();
    opLog($pdo, 'product', $pid, 'vendor_create', $name, null, "vendor:{$vendor['id']}");
    jsonOk(['id' => $pid, 'status' => 'pending']);
}

/** 供应商上下架：下架直接生效；重新上架需审核（转 pending） */
function handle_vendorToggleProduct(PDO $pdo, array $input, array $vendor): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT * FROM products WHERE id = ? AND supplier_id = ?");
    $st->execute([$id, (int) $vendor['id']]);
    $p = $st->fetch();
    if (!$p) jsonError('商品不存在', 404);

    if ($p['status'] === 'on') {
        $new = 'off';
    } elseif (in_array($p['status'], ['off', 'rejected'], true)) {
        $new = 'pending';
    } else {
        jsonError('当前状态不可操作');
        return;
    }
    $pdo->prepare("UPDATE products SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        ->execute([$new, $id]);
    opLog($pdo, 'product', $id, 'vendor_toggle', "{$p['status']} -> {$new}", null, "vendor:{$vendor['id']}");
    jsonOk(['status' => $new]);
}

function handle_vendorDeleteProduct(PDO $pdo, array $input, array $vendor): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("DELETE FROM products WHERE id = ? AND supplier_id = ?");
    $st->execute([$id, (int) $vendor['id']]);
    if ($st->rowCount() === 0) jsonError('商品不存在', 404);
    opLog($pdo, 'product', $id, 'vendor_delete', '', null, "vendor:{$vendor['id']}");
    jsonOk();
}

function handle_vendorUploadProductImage(PDO $pdo, array $input, array $vendor): void
{
    if (empty($_FILES['file'])) jsonError('请选择图片');
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败，请重试');
    if ($f['size'] > 10 * 1024 * 1024) jsonError('图片不能超过 10MB');
    $mime = _aiDetectMime($f['tmp_name'], $f['name']);
    $extMap = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($extMap[$mime])) jsonError('仅支持 JPG / PNG / WebP 图片');

    $dir = __DIR__ . '/../../storage/products/' . (int) $vendor['id'];
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    $fname = date('YmdHis') . '_' . substr(md5($f['name'] . microtime(true)), 0, 8) . '.' . $extMap[$mime];
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) jsonError('保存失败', 500);
    jsonOk(['url' => '/storage/products/' . (int) $vendor['id'] . '/' . $fname]);
}

/** 拍照/截图 AI 识别商品清单（价格表照片 → 结构化商品数组，预填录入表单） */
function handle_vendorAiParseProducts(PDO $pdo, array $input, array $vendor): void
{
    $cfg = _aiOpenaiCfg($pdo);
    if (!$cfg) jsonError('AI 功能未配置，请联系平台');
    if (empty($_FILES['file'])) jsonError('请上传图片');
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败，请重试');
    if ($f['size'] > 10 * 1024 * 1024) jsonError('图片不能超过 10MB');
    $mime = _aiDetectMime($f['tmp_name'], $f['name']);
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
        jsonError('仅支持图片（JPG/PNG/WebP）');
    }

    $b64 = base64_encode((string) file_get_contents($f['tmp_name']));
    $system = "你是建材供应商商品清单解析助手。用户上传的是价格表 / 产品目录 / 手写清单的照片。\n"
        . "请提取商品列表，**只输出严格 JSON**：\n"
        . "{\"items\":[{\"name\":\"\",\"spec\":\"\",\"brand\":\"\",\"model\":\"\",\"unit\":\"\",\"base_price\":0,\"category\":\"\",\"lead_time\":\"\",\"remark\":\"\"}]}\n"
        . "规则：\n"
        . "1. name 干净的商品名，不含规格；规格型号切到 spec / model\n"
        . "2. base_price 是单价数字，千分位逗号/点按印尼习惯判断；看不清填 0，不要瞎猜\n"
        . "3. unit 常见：件/张/桶/平方米/米/套/箱；没有就留空\n"
        . "4. category 从商品判断：瓷砖/卫浴/板材/涂料/灯具/门窗/五金/水泥 等，判断不了留空\n"
        . "5. 不输出 markdown，只输出 JSON";
    $messages = [
        ['role' => 'system', 'content' => $system],
        ['role' => 'user', 'content' => [
            ['type' => 'text', 'text' => '解析这张商品价格表'],
            ['type' => 'image_url', 'image_url' => ['url' => "data:{$mime};base64,{$b64}"]],
        ]],
    ];
    $resp = _aiCallOpenAI($cfg, $messages);
    $content = $resp['choices'][0]['message']['content'] ?? '';
    $data = json_decode((string) $content, true);
    $items = is_array($data) && isset($data['items']) && is_array($data['items']) ? $data['items'] : [];
    jsonOk(['items' => array_values($items)]);
}

/** Excel 批量导入商品（表头：品名/规格/品牌/型号/单位/底价/品类/现货/交期/起订量/描述） */
function handle_vendorImportProductsExcel(PDO $pdo, array $input, array $vendor): void
{
    if (empty($_FILES['file'])) jsonError('请选择 Excel 文件');
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败，请重试');
    if ($f['size'] > 10 * 1024 * 1024) jsonError('文件不能超过 10MB');

    $rows = _vendorXlsxRows($f['tmp_name']);
    if (empty($rows)) jsonError('未能解析出数据，请确认是 .xlsx 文件且首行为表头（品名/规格/单位/底价...）');

    $ins = $pdo->prepare("INSERT INTO products
        (supplier_id, category, name, spec, brand, model, unit, moq, base_price, stock_status, lead_time, description, images, status, price_updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now','localtime'))");
    $ok = 0;
    $skip = 0;
    $imgOk = 0;
    $imgFail = 0;
    foreach ($rows as $r) {
        $name = trim((string) ($r['name'] ?? ''));
        $price = (float) str_replace([',', ' '], '', (string) ($r['base_price'] ?? '0'));
        if ($name === '' || $price <= 0) {
            $skip++;
            continue;
        }
        $stock = trim((string) ($r['stock_status'] ?? ''));
        $imgs = _vendorFetchImages((string) ($r['images'] ?? ''), (int) $vendor['id'], $imgOk, $imgFail);
        $ins->execute([
            (int) $vendor['id'],
            trim((string) ($r['category'] ?? '')),
            $name,
            trim((string) ($r['spec'] ?? '')),
            trim((string) ($r['brand'] ?? '')),
            trim((string) ($r['model'] ?? '')),
            trim((string) ($r['unit'] ?? '')) ?: '件',
            (float) str_replace(',', '', (string) ($r['moq'] ?? '0')),
            $price,
            ($stock === '' || mb_strpos($stock, '是') !== false || mb_strpos($stock, '现货') !== false) ? 'in_stock' : 'pre_order',
            trim((string) ($r['lead_time'] ?? '')),
            trim((string) ($r['description'] ?? '')),
            json_encode($imgs, JSON_UNESCAPED_UNICODE),
        ]);
        $ok++;
    }
    opLog($pdo, 'product', null, 'vendor_import', "ok={$ok} skip={$skip} img={$imgOk}/{$imgFail}", null, "vendor:{$vendor['id']}");
    jsonOk(['imported' => $ok, 'skipped' => $skip, 'images_ok' => $imgOk, 'images_failed' => $imgFail]);
}

/**
 * Excel「图片链接」列 → 下载到 storage 并返回相对 URL 数组。
 * 支持逗号/分号/换行/空格分隔多个链接，单个商品最多 6 张（与手工录入一致）。
 */
function _vendorFetchImages(string $raw, int $vendorId, int &$okCount, int &$failCount): array
{
    $raw = trim($raw);
    if ($raw === '') return [];
    $urls = preg_split('/[\s,;，；\r\n]+/u', $raw, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $urls = array_slice($urls, 0, 6);

    $dir = __DIR__ . '/../../storage/products/' . $vendorId;
    $out = [];
    foreach ($urls as $u) {
        if (!preg_match('#^https?://#i', $u)) { $failCount++; continue; }

        $ch = curl_init($u);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT => 'Mozilla/5.0',
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($body === false || $code !== 200 || strlen($body) < 128 || strlen($body) > 10 * 1024 * 1024) {
            $failCount++;
            continue;
        }

        // 按真实内容判类型，不信任 URL 后缀
        $tmp = tempnam(sys_get_temp_dir(), 'vimg');
        file_put_contents($tmp, $body);
        $mime = _aiDetectMime($tmp, basename(parse_url($u, PHP_URL_PATH) ?: ''));
        $extMap = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
        if (!isset($extMap[$mime])) { @unlink($tmp); $failCount++; continue; }

        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $fname = date('YmdHis') . '_' . substr(md5($u . microtime(true)), 0, 8) . '.' . $extMap[$mime];
        if (!rename($tmp, $dir . '/' . $fname)) { @unlink($tmp); $failCount++; continue; }
        @chmod($dir . '/' . $fname, 0664);

        $out[] = '/storage/products/' . $vendorId . '/' . $fname;
        $okCount++;
    }
    return $out;
}

/** xlsx → 商品行（首行表头，按别名映射字段） */
function _vendorXlsxRows(string $path): array
{
    if (!class_exists('ZipArchive')) return [];
    $z = new ZipArchive();
    if ($z->open($path) !== true) return [];

    $shared = [];
    $idx = $z->locateName('xl/sharedStrings.xml');
    if ($idx !== false) {
        $xml = $z->getFromIndex($idx);
        if ($xml) {
            $sx = @simplexml_load_string($xml);
            if ($sx) {
                foreach ($sx->si as $si) {
                    $val = (string) $si->t;
                    if ($val === '') {
                        $parts = [];
                        foreach ($si->r ?: [] as $r) $parts[] = (string) $r->t;
                        $val = implode('', $parts);
                    }
                    $shared[] = trim($val);
                }
            }
        }
    }

    $sheetXml = '';
    for ($i = 0; $i < $z->numFiles; $i++) {
        $nm = $z->getNameIndex($i);
        if (strpos($nm, 'xl/worksheets/') === 0 && substr($nm, -4) === '.xml') {
            $sheetXml = $z->getFromIndex($i);
            break;
        }
    }
    $z->close();
    if (!$sheetXml) return [];
    $sx = @simplexml_load_string($sheetXml);
    if (!$sx) return [];

    $rowsRaw = [];
    foreach ($sx->sheetData->row ?: [] as $row) {
        $cells = [];
        foreach ($row->c ?: [] as $c) {
            $ref = (string) $c['r'];
            $col = preg_replace('/\d+/', '', $ref);
            $type = (string) $c['t'];
            if ($type === 's') {
                $cells[$col] = $shared[(int) $c->v] ?? '';
            } elseif ($type === 'inlineStr') {
                $cells[$col] = (string) ($c->is->t ?? '');
            } else {
                $cells[$col] = (string) $c->v;
            }
        }
        $rowsRaw[] = $cells;
    }
    if (count($rowsRaw) < 2) return [];

    $aliasMap = [
        // images 必须排在 name 之前：name 的别名含「商品」，否则「商品图片」会被误判为品名
        'images' => ['图片', '图片链接', '图片地址', '主图'],
        'name' => ['品名', '商品名', '产品名', '名称', '商品'],
        'spec' => ['规格'],
        'brand' => ['品牌'],
        'model' => ['型号'],
        'unit' => ['单位'],
        'base_price' => ['底价', '供货价', '价格', '单价'],
        'category' => ['品类', '分类', '类目'],
        'stock_status' => ['现货', '库存'],
        'lead_time' => ['交期', '货期'],
        'moq' => ['起订', '起订量'],
        'description' => ['描述', '备注', '说明'],
    ];
    $headerMap = [];
    foreach ($rowsRaw[0] as $col => $name) {
        $name = trim((string) $name);
        if ($name === '') continue;
        foreach ($aliasMap as $field => $aliases) {
            foreach ($aliases as $alias) {
                if (mb_strpos($name, $alias) !== false) {
                    $headerMap[$col] = $field;
                    break 2;
                }
            }
        }
    }
    if (!in_array('name', $headerMap, true)) return [];

    $result = [];
    for ($i = 1; $i < count($rowsRaw); $i++) {
        $assoc = [];
        foreach ($headerMap as $col => $field) {
            $assoc[$field] = trim((string) ($rowsRaw[$i][$col] ?? ''));
        }
        if (empty(array_filter($assoc, fn($v) => $v !== ''))) continue;
        $result[] = $assoc;
    }
    return $result;
}
