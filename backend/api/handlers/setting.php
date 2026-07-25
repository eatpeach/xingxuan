<?php

const SETTING_KEYS = [
    'hide_supplier_brand_default' => '客户报价单默认隐藏供应商品牌型号',
    'company_name'                => '对外公司抬头',
    'pdf_logo_path'               => '报价单 PDF logo 路径',
    'company_address'             => '公司地址（发票 / 报价单底部展示）',
    'company_phone'               => '公司电话',
    'default_markup_pct'          => '默认整单加价百分比',
    'default_quote_valid_days'    => '默认报价有效天数',
    'invoice_no_prefix'           => '发票号前缀（如 INV）',
    'invoice_due_days'            => '默认账期天数',
    'bank_name'                   => '收款银行（如 BCA）',
    'bank_account_no'             => '银行账号',
    'bank_account_name'           => '账户名',
    'bank_swift'                  => 'SWIFT 代码（可选，跨境付款用）',
    'ai.openai.api_key'           => 'OpenAI API Key（用于 AI 解析询价文本）',
    'ai.openai.model'             => 'OpenAI 模型（默认 gpt-4o-mini）',
    'ai.openai.endpoint'          => 'OpenAI API 端点（默认 https://api.openai.com/v1/chat/completions）',
    'customer_sources'            => '客户来源选项（每行一个，客户管理下拉可选）',
    'customer_categories'         => '客户分类选项（每行一个，客户管理下拉可选）',
    'theme_color'                 => '界面主题色',
    'shelf.default_markup_pct'    => '货架默认加价百分比（对外价 = 底价 × (1+加价率)）',
    'shelf.category_markup'       => '货架品类加价率（每行一条：品类:百分比，如 瓷砖:12）',
    'shelf.price_change_threshold_pct' => '供应商改价幅度超过此百分比时自动转待审核',
    'shelf.categories'            => '货架商品品类（每行一个，供应商录入与货架导航共用）',
    'shelf.contact_phone'         => '货架页联系电话 / WhatsApp',
    'shelf.contact_wechat'        => '货架页微信号',
];

// 部分配置项首次出现时的默认值
const SETTING_DEFAULTS = [
    'customer_sources' => "抖音-阿星在印尼\n抖音-星选建材\n视频号-阿星在印尼\n视频号-星选建材",
    'customer_categories' => "项目业主\n项目总包\n项目分包\n物资公司\n装修公司",
    'theme_color' => '#1d57e0',
    'shelf.default_markup_pct' => '15',
    'shelf.price_change_threshold_pct' => '15',
    'shelf.categories' => "瓷砖\n卫浴\n板材\n涂料\n灯具\n门窗\n五金\n水泥",
];

function handle_listSettings(PDO $pdo): void
{
    // 自动补齐：SETTING_KEYS 中定义但 DB 里没有的，插入空值占位
    $st = $pdo->prepare("INSERT OR IGNORE INTO system_settings (key, value, description) VALUES (?, ?, ?)");
    foreach (SETTING_KEYS as $key => $desc) {
        $st->execute([$key, SETTING_DEFAULTS[$key] ?? '', $desc]);
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
