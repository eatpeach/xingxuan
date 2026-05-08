<?php

const MARKUP_RULE_TYPES = ['flat_pct', 'per_item_pct', 'per_item_fixed', 'category_pct', 'stepped'];

function handle_listMarkupRules(PDO $pdo): void
{
    $rows = $pdo->query("SELECT * FROM markup_rules ORDER BY id DESC")->fetchAll();
    foreach ($rows as &$r) {
        $r['payload'] = $r['payload'] ? json_decode($r['payload'], true) : null;
    }
    jsonOk(['items' => $rows]);
}

function handle_createMarkupRule(PDO $pdo, array $input, array $user): void
{
    $type = (string) ($input['type'] ?? '');
    if (!in_array($type, MARKUP_RULE_TYPES, true)) jsonError('未知策略类型');
    $isDefault = !empty($input['is_default']) ? 1 : 0;
    if ($isDefault) {
        $pdo->exec("UPDATE markup_rules SET is_default=0");
    }
    $st = $pdo->prepare("INSERT INTO markup_rules (name, type, value, payload, is_default, remark, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)");
    $st->execute([
        (string) ($input['name'] ?? ''),
        $type,
        isset($input['value']) && $input['value'] !== '' ? (float) $input['value'] : null,
        isset($input['payload']) ? json_encode($input['payload'], JSON_UNESCAPED_UNICODE) : null,
        $isDefault,
        (string) ($input['remark'] ?? ''),
        (int) $user['id'],
    ]);
    jsonOk(['id' => (int) $pdo->lastInsertId()]);
}

function handle_updateMarkupRule(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT id FROM markup_rules WHERE id = ?");
    $st->execute([$id]);
    if (!$st->fetchColumn()) jsonError('策略不存在', 404);

    $type = (string) ($input['type'] ?? '');
    if (!in_array($type, MARKUP_RULE_TYPES, true)) jsonError('未知策略类型');
    $isDefault = !empty($input['is_default']) ? 1 : 0;
    if ($isDefault) {
        $pdo->prepare("UPDATE markup_rules SET is_default=0 WHERE id != ?")->execute([$id]);
    }
    $st = $pdo->prepare("UPDATE markup_rules SET name=?, type=?, value=?, payload=?, is_default=?, remark=?,
        updated_at=datetime('now','localtime') WHERE id = ?");
    $st->execute([
        (string) ($input['name'] ?? ''),
        $type,
        isset($input['value']) && $input['value'] !== '' ? (float) $input['value'] : null,
        isset($input['payload']) ? json_encode($input['payload'], JSON_UNESCAPED_UNICODE) : null,
        $isDefault,
        (string) ($input['remark'] ?? ''),
        $id,
    ]);
    jsonOk();
}

function handle_deleteMarkupRule(PDO $pdo, array $input): void
{
    $pdo->prepare("DELETE FROM markup_rules WHERE id = ?")->execute([(int) ($input['id'] ?? 0)]);
    jsonOk();
}
