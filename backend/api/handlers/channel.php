<?php
/**
 * 渠道管理：介绍客户的渠道（客户来源选“渠道客户”时挂接）
 */

function handle_listChannels(PDO $pdo, array $input): void
{
    $kw = trim((string) ($input['keyword'] ?? ''));
    $activeOnly = !empty($input['active_only']);

    $where = '1=1';
    $params = [];
    if ($kw !== '') {
        $where .= " AND (ch.name LIKE ? OR ch.contact LIKE ? OR ch.phone LIKE ?)";
        $like = "%{$kw}%";
        $params = [$like, $like, $like];
    }
    if ($activeOnly) {
        $where .= " AND ch.is_active = 1";
    }
    $rows = $pdo->prepare("SELECT ch.*,
               (SELECT COUNT(*) FROM customers c WHERE c.channel_id = ch.id) AS customer_count
        FROM channels ch WHERE {$where}
        ORDER BY ch.is_active DESC, ch.id DESC");
    $rows->execute($params);
    jsonOk(['items' => $rows->fetchAll()]);
}

function handle_saveChannel(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') jsonError('请输入渠道名称');
    if (mb_strlen($name) > 100) jsonError('渠道名称过长');
    $contact = (string) ($input['contact'] ?? '');
    $phone = (string) ($input['phone'] ?? '');
    $wechat = (string) ($input['wechat'] ?? '');
    $remark = (string) ($input['remark'] ?? '');
    $commissionPct = (float) ($input['commission_pct'] ?? 0);
    if ($commissionPct < 0 || $commissionPct > 100) jsonError('分润比例需在 0~100 之间');

    // 同名去重
    $st = $pdo->prepare("SELECT id FROM channels WHERE name = ? AND id != ?");
    $st->execute([$name, $id]);
    if ($st->fetch()) jsonError('渠道名称已存在');

    if ($id) {
        $st = $pdo->prepare("UPDATE channels SET name=?, contact=?, phone=?, wechat=?, commission_pct=?, remark=?,
            updated_at=datetime('now','localtime') WHERE id=?");
        $st->execute([$name, $contact, $phone, $wechat, $commissionPct, $remark, $id]);
        jsonOk(['id' => $id]);
    }
    $st = $pdo->prepare("INSERT INTO channels (name, contact, phone, wechat, commission_pct, remark) VALUES (?, ?, ?, ?, ?, ?)");
    $st->execute([$name, $contact, $phone, $wechat, $commissionPct, $remark]);
    jsonOk(['id' => (int) $pdo->lastInsertId()]);
}

function handle_toggleChannelActive(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $pdo->prepare("UPDATE channels SET is_active = 1 - is_active,
        updated_at=datetime('now','localtime') WHERE id=?")->execute([$id]);
    jsonOk();
}

function handle_deleteChannel(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $st = $pdo->prepare("SELECT COUNT(*) FROM customers WHERE channel_id = ?");
    $st->execute([$id]);
    if ((int) $st->fetchColumn() > 0) jsonError('该渠道已介绍过客户，不能删除，可改为停用');
    $pdo->prepare("DELETE FROM channels WHERE id = ?")->execute([$id]);
    jsonOk();
}
