<?php

const SETTING_KEYS = [
    'hide_supplier_brand_default' => '客户报价单默认隐藏供应商品牌型号',
    'company_name'                => '对外公司抬头',
    'pdf_logo_path'               => '报价单 PDF logo 路径',
    'default_markup_pct'          => '默认整单加价百分比',
    'default_quote_valid_days'    => '默认报价有效天数',
    'ai.openai.api_key'           => 'OpenAI API Key（用于 AI 解析询价文本）',
    'ai.openai.model'             => 'OpenAI 模型（默认 gpt-4o-mini）',
    'ai.openai.endpoint'          => 'OpenAI API 端点（默认 https://api.openai.com/v1/chat/completions）',
];

function handle_listSettings(PDO $pdo): void
{
    // 自动补齐：SETTING_KEYS 中定义但 DB 里没有的，插入空值占位
    $st = $pdo->prepare("INSERT OR IGNORE INTO system_settings (key, value, description) VALUES (?, '', ?)");
    foreach (SETTING_KEYS as $key => $desc) {
        $st->execute([$key, $desc]);
    }
    // 同步可能过时的 description（key 一致但描述改过的情况）
    $stUpd = $pdo->prepare("UPDATE system_settings SET description = ? WHERE key = ? AND description != ?");
    foreach (SETTING_KEYS as $key => $desc) {
        $stUpd->execute([$desc, $key, $desc]);
    }

    $rows = $pdo->query("SELECT * FROM system_settings ORDER BY key ASC")->fetchAll();
    jsonOk(['items' => $rows]);
}

function handle_updateSetting(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可修改设置', 403);
    $key = (string) ($input['key'] ?? '');
    if (!isset(SETTING_KEYS[$key])) jsonError('未知配置项');
    setSetting($pdo, $key, (string) ($input['value'] ?? ''), SETTING_KEYS[$key]);
    opLog($pdo, 'setting', null, 'update', "{$key}={$input['value']}", (int) $user['id']);
    jsonOk();
}
