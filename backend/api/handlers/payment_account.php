<?php

/**
 * 收款主体 / 收款账户
 * 主体 = 开票抬头（PT 公司），一个主体下挂多个收款账户（不同银行 / 币种 / 收款码）。
 * 开发票时选主体 + 账户，两者信息快照进 customer_quotes 的 invoice_* 字段。
 */

/** 主体列表（带账户数）；public=1 时只返回启用的，供开票下拉用 */
function handle_listPaymentEntities(PDO $pdo, array $input): void
{
    $onlyActive = !empty($input['only_active']);
    $where = $onlyActive ? "WHERE e.status = 'active'" : '';
    $rows = $pdo->query("SELECT e.*,
            (SELECT COUNT(*) FROM payment_accounts WHERE entity_id = e.id) AS accounts_count
        FROM payment_entities e {$where}
        ORDER BY e.sort_weight DESC, e.id ASC")->fetchAll();
    $items = array_map(function ($r) {
        $r['id'] = (int) $r['id'];
        $r['accounts_count'] = (int) $r['accounts_count'];
        $r['logo_url'] = $r['logo_path'] ? '/storage/' . ltrim($r['logo_path'], '/') : '';
        $r['seal_url'] = $r['seal_path'] ? '/storage/' . ltrim($r['seal_path'], '/') : '';
        return $r;
    }, $rows);
    jsonOk(['items' => $items]);
}

function handle_savePaymentEntity(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可维护收款主体', 403);
    $id = (int) ($input['id'] ?? 0);
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') jsonError('请填写主体名称');

    $fields = [
        'name' => $name,
        'tax_no' => trim((string) ($input['tax_no'] ?? '')),
        'address' => trim((string) ($input['address'] ?? '')),
        'phone' => trim((string) ($input['phone'] ?? '')),
        'logo_path' => trim((string) ($input['logo_path'] ?? '')),
        'seal_path' => trim((string) ($input['seal_path'] ?? '')),
        'status' => ($input['status'] ?? 'active') === 'inactive' ? 'inactive' : 'active',
        'sort_weight' => (int) ($input['sort_weight'] ?? 0),
        'remark' => trim((string) ($input['remark'] ?? '')),
    ];

    if ($id > 0) {
        $sets = implode(', ', array_map(fn($k) => "{$k} = ?", array_keys($fields)));
        $vals = array_values($fields);
        $vals[] = $id;
        $pdo->prepare("UPDATE payment_entities SET {$sets}, updated_at = datetime('now','localtime') WHERE id = ?")
            ->execute($vals);
        opLog($pdo, 'payment_entity', $id, 'update', $name, (int) $user['id']);
        jsonOk(['id' => $id]);
    }

    $cols = implode(', ', array_keys($fields));
    $ph = implode(', ', array_fill(0, count($fields), '?'));
    $pdo->prepare("INSERT INTO payment_entities ({$cols}) VALUES ({$ph})")->execute(array_values($fields));
    $nid = (int) $pdo->lastInsertId();
    opLog($pdo, 'payment_entity', $nid, 'create', $name, (int) $user['id']);
    jsonOk(['id' => $nid]);
}

function handle_deletePaymentEntity(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可维护收款主体', 403);
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('请指定主体');
    // 已开过的发票存的是快照，删主体不影响历史发票
    $pdo->prepare("DELETE FROM payment_entities WHERE id = ?")->execute([$id]);
    opLog($pdo, 'payment_entity', $id, 'delete', '', (int) $user['id']);
    jsonOk();
}

/** 账户列表；传 entity_id 只看该主体的 */
function handle_listPaymentAccounts(PDO $pdo, array $input): void
{
    $where = '1=1';
    $params = [];
    if (!empty($input['entity_id'])) {
        $where .= ' AND a.entity_id = ?';
        $params[] = (int) $input['entity_id'];
    }
    if (!empty($input['only_active'])) {
        $where .= " AND a.status = 'active'";
    }
    $st = $pdo->prepare("SELECT a.*, e.name AS entity_name
        FROM payment_accounts a
        LEFT JOIN payment_entities e ON e.id = a.entity_id
        WHERE {$where}
        ORDER BY a.is_default DESC, a.sort_weight DESC, a.id ASC");
    $st->execute($params);
    $items = array_map(function ($r) {
        $r['id'] = (int) $r['id'];
        $r['entity_id'] = (int) $r['entity_id'];
        $r['is_default'] = (int) $r['is_default'];
        $r['qr_url'] = $r['qr_path'] ? '/storage/' . ltrim($r['qr_path'], '/') : '';
        return $r;
    }, $st->fetchAll());
    jsonOk(['items' => $items]);
}

function handle_savePaymentAccount(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可维护收款账户', 403);
    $id = (int) ($input['id'] ?? 0);
    $entityId = (int) ($input['entity_id'] ?? 0);
    if (!$entityId) jsonError('请选择所属收款主体');
    $st = $pdo->prepare("SELECT id FROM payment_entities WHERE id = ?");
    $st->execute([$entityId]);
    if (!$st->fetchColumn()) jsonError('收款主体不存在', 404);

    $currency = strtoupper(trim((string) ($input['currency'] ?? 'IDR')));
    if (!in_array($currency, ['IDR', 'CNY', 'USD'], true)) $currency = 'IDR';

    $fields = [
        'entity_id' => $entityId,
        'type' => trim((string) ($input['type'] ?? 'idr_public')),
        'bank_name' => trim((string) ($input['bank_name'] ?? '')),
        'account_name' => trim((string) ($input['account_name'] ?? '')),
        'account_number' => trim((string) ($input['account_number'] ?? '')),
        'branch' => trim((string) ($input['branch'] ?? '')),
        'swift' => trim((string) ($input['swift'] ?? '')),
        'currency' => $currency,
        'qr_path' => trim((string) ($input['qr_path'] ?? '')),
        'is_default' => !empty($input['is_default']) ? 1 : 0,
        'status' => ($input['status'] ?? 'active') === 'inactive' ? 'inactive' : 'active',
        'remark' => trim((string) ($input['remark'] ?? '')),
        'sort_weight' => (int) ($input['sort_weight'] ?? 0),
    ];

    $pdo->beginTransaction();
    try {
        if ($id > 0) {
            $sets = implode(', ', array_map(fn($k) => "{$k} = ?", array_keys($fields)));
            $vals = array_values($fields);
            $vals[] = $id;
            $pdo->prepare("UPDATE payment_accounts SET {$sets}, updated_at = datetime('now','localtime') WHERE id = ?")
                ->execute($vals);
        } else {
            $cols = implode(', ', array_keys($fields));
            $ph = implode(', ', array_fill(0, count($fields), '?'));
            $pdo->prepare("INSERT INTO payment_accounts ({$cols}) VALUES ({$ph})")->execute(array_values($fields));
            $id = (int) $pdo->lastInsertId();
        }
        // 同主体同币种只能有一个默认账户
        if ($fields['is_default']) {
            $pdo->prepare("UPDATE payment_accounts SET is_default = 0
                WHERE entity_id = ? AND currency = ? AND id <> ?")
                ->execute([$entityId, $currency, $id]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    opLog($pdo, 'payment_account', $id, 'save', $fields['bank_name'] . ' ' . $fields['account_number'], (int) $user['id']);
    jsonOk(['id' => $id]);
}

function handle_deletePaymentAccount(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可维护收款账户', 403);
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('请指定账户');
    $pdo->prepare("DELETE FROM payment_accounts WHERE id = ?")->execute([$id]);
    opLog($pdo, 'payment_account', $id, 'delete', '', (int) $user['id']);
    jsonOk();
}

/** 主体 logo / 公章 / 收款码上传，统一放 storage/payment/ */
function handle_uploadPaymentImage(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可上传', 403);
    if (empty($_FILES['file'])) jsonError('请选择图片');
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败，请重试');
    if ($f['size'] > 5 * 1024 * 1024) jsonError('图片不能超过 5MB');
    $mime = _aiDetectMime($f['tmp_name'], $f['name']);
    $extMap = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($extMap[$mime])) jsonError('仅支持 JPG / PNG / WebP 图片');

    $dir = __DIR__ . '/../../storage/payment';
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    $fname = date('YmdHis') . '_' . substr(md5($f['name'] . microtime(true)), 0, 8) . '.' . $extMap[$mime];
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) jsonError('保存失败', 500);
    jsonOk(['path' => 'payment/' . $fname, 'url' => '/storage/payment/' . $fname]);
}
