<?php

/**
 * AI 解析询价文本
 *
 * 客户发来的自由格式文本（如微信里一行一行的物料清单）→ 结构化 items[] + remark
 * 用 OpenAI Chat Completions API + JSON mode，温度 0
 *
 * 配置（system_settings 表）：
 *   ai.openai.api_key   API Key（必需）
 *   ai.openai.model     默认 gpt-4o-mini
 *   ai.openai.endpoint  默认 https://api.openai.com/v1/chat/completions
 */

function _aiOpenaiCfg(PDO $pdo): ?array
{
    $key = trim(getSetting($pdo, 'ai.openai.api_key', ''));
    if ($key === '') return null;
    return [
        'api_key' => $key,
        'model' => trim(getSetting($pdo, 'ai.openai.model', 'gpt-4o-mini')) ?: 'gpt-4o-mini',
        'endpoint' => trim(getSetting($pdo, 'ai.openai.endpoint', 'https://api.openai.com/v1/chat/completions'))
            ?: 'https://api.openai.com/v1/chat/completions',
    ];
}

function handle_aiParseInquiryText(PDO $pdo, array $input, array $user): void
{
    $text = trim((string) ($input['text'] ?? ''));
    if ($text === '') jsonError('请输入文本');
    if (mb_strlen($text) > 10000) jsonError('文本过长，请少于 1 万字符');

    $cfg = _aiOpenaiCfg($pdo);
    if (!$cfg) jsonError('AI 解析未配置：请到「系统设置」填写 OpenAI API Key', 503);

    $sys = "你是建材行业的询价单解析助手。\n"
        . "用户给你一段客户发来的询价文本（中文为主，可能很零散），请提取出产品列表。\n"
        . "**只输出严格 JSON**：{\"items\":[{\"product_name\":\"\",\"spec\":\"\",\"qty\":0,\"unit\":\"\"}],\"remark\":\"\"}\n"
        . "规则：\n"
        . "1. 每个**有数量**的产品独立成一行 item，提取产品名（不含数量和单位）、规格（如型号/功率/尺寸/颜色等显式标注的规格）、数量（数字，可小数）、单位（个/件/套/平方米/米/卷/张/对/包/箱/支/根/台/卷/盒/瓶 等，按客户原文）\n"
        . "2. 描述性、说明性、整体备注（颜色要求/安装要求/品牌偏好/标题/小节标题/没数量的孤立产品名）合并到 remark，多条用「；」分隔\n"
        . "3. 产品名要干净，剥离数量、单位、冒号\n"
        . "4. 同一行如果包含规格信息（如「15W 嵌入式筒灯」），把规格识别出来：product_name=\"嵌入式筒灯\", spec=\"15W\"；如果不能明确切分则保留在 product_name\n"
        . "5. 不输出 markdown，不输出解释，只输出 JSON";

    $body = json_encode([
        'model' => $cfg['model'],
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => $text],
        ],
        'response_format' => ['type' => 'json_object'],
        'temperature' => 0,
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init($cfg['endpoint']);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $cfg['api_key'],
        ],
        CURLOPT_TIMEOUT => 60,
        CURLOPT_CONNECTTIMEOUT => 15,
    ]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($resp === false) jsonError("AI 调用失败: {$err}", 500);
    if ($code !== 200) {
        $brief = substr((string) $resp, 0, 300);
        jsonError("AI HTTP {$code}: {$brief}", 500);
    }

    $data = json_decode((string) $resp, true);
    $content = (string) ($data['choices'][0]['message']['content'] ?? '');
    $parsed = json_decode($content, true);
    if (!is_array($parsed)) jsonError('AI 返回格式异常: ' . substr($content, 0, 300), 500);

    $items = [];
    foreach (($parsed['items'] ?? []) as $i => $it) {
        $name = trim((string) ($it['product_name'] ?? ''));
        if ($name === '') continue;
        $items[] = [
            'line_no' => $i + 1,
            'product_name' => $name,
            'spec' => (string) ($it['spec'] ?? ''),
            'qty' => (float) ($it['qty'] ?? 1),
            'unit' => (string) ($it['unit'] ?? '件') ?: '件',
        ];
    }

    opLog(
        $pdo,
        'inquiry',
        null,
        'ai_parse',
        sprintf('源文本 %d 字符 → %d 行', mb_strlen($text), count($items)),
        (int) $user['id'],
    );

    jsonOk([
        'items' => $items,
        'remark' => trim((string) ($parsed['remark'] ?? '')),
        'usage' => $data['usage'] ?? null,
    ]);
}
