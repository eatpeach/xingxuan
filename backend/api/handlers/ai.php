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

function _aiInquirySystemPrompt(): string
{
    return "你是建材行业的询价单解析助手。\n"
        . "用户给你的内容可能是：纯文字、聊天截图、Excel/CSV 表格文本（用 Tab 或多空格分列）、PDF 抽出的文本、扫描件 OCR、表格图片。\n"
        . "请提取产品列表。**只输出严格 JSON**：{\"items\":[{\"product_name\":\"\",\"spec\":\"\",\"qty\":0,\"unit\":\"\"}],\"remark\":\"\"}\n"
        . "规则：\n"
        . "1. 如果是**类表格内容**（每行字段对齐，开头多半有「序号/Sn./No.」「产品/Material」「规格/Spec」「数量/Q'ty/Qty」「单位/Unit」表头）：\n"
        . "   - 先识别表头判断各列含义；列顺序不固定，可能数量在前单位在后，也可能反之\n"
        . "   - 跳过表头行；每个有产品名 + 数量的行都是一个 item\n"
        . "   - 如果产品名是双语（中文 + 换行 + 英文，或英文 + 换行 + 中文），优先取中文；中文为空时再取英文\n"
        . "2. 如果是**自由格式文字**（聊天清单等）：\n"
        . "   - 每个有数量的产品独立成 item；标题/品牌偏好/颜色要求/没数量的散落描述 → 合并到 remark\n"
        . "3. product_name 要干净：剥离序号、数量、单位、冒号、列号；不含规格信息\n"
        . "4. 同一行带规格信息（如「15W 嵌入式筒灯」），切出规格：product_name=\"嵌入式筒灯\", spec=\"15W\"\n"
        . "5. 数字里逗号 / 空格当成千分位忽略；qty 用浮点；看不清留空字符串或 0，不要瞎猜\n"
        . "6. 整体备注（货期、品牌偏好、安装要求、标题等）放顶层 remark，多条用「；」分隔\n"
        . "7. 不输出 markdown，不输出解释，只输出 JSON";
}

function _aiCallOpenAI(array $cfg, array $messages): array
{
    $body = json_encode([
        'model' => $cfg['model'],
        'messages' => $messages,
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
        CURLOPT_TIMEOUT => 90,
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
    return $data ?: [];
}

function _aiDetectMime(string $path, string $name): string
{
    if (function_exists('mime_content_type')) {
        $m = @mime_content_type($path);
        if ($m) return $m;
    }
    if (function_exists('finfo_open')) {
        $finfo = @finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo) {
            $m = @finfo_file($finfo, $path);
            @finfo_close($finfo);
            if ($m) return $m;
        }
    }
    // Magic bytes
    $h = @file_get_contents($path, false, null, 0, 16);
    if ($h !== false && strlen($h) >= 4) {
        if (substr($h, 0, 8) === "\x89PNG\r\n\x1a\n") return 'image/png';
        if (substr($h, 0, 3) === "\xFF\xD8\xFF") return 'image/jpeg';
        if (substr($h, 0, 6) === 'GIF87a' || substr($h, 0, 6) === 'GIF89a') return 'image/gif';
        if (substr($h, 0, 4) === 'RIFF' && substr($h, 8, 4) === 'WEBP') return 'image/webp';
        if (substr($h, 0, 4) === '%PDF') return 'application/pdf';
        if (substr($h, 0, 2) === 'PK') {
            // ZIP / xlsx / docx 等。看扩展名定
            $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
            if ($ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            return 'application/zip';
        }
    }
    // 退化到扩展名
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    static $extMap = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif',
        'pdf' => 'application/pdf',
        'csv' => 'text/csv', 'txt' => 'text/plain',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    return $extMap[$ext] ?? 'application/octet-stream';
}

function _findShellCommand(string $cmd): string
{
    if (!function_exists('exec')) return '';
    // 先在常见路径找
    foreach (['/usr/bin/', '/usr/local/bin/', '/opt/homebrew/bin/', '/bin/'] as $dir) {
        if (is_executable($dir . $cmd)) return $dir . $cmd;
    }
    // 再用 which
    $out = [];
    @exec('which ' . escapeshellarg($cmd) . ' 2>/dev/null', $out);
    foreach ($out as $line) {
        $line = trim($line);
        if ($line !== '' && is_executable($line)) return $line;
    }
    return '';
}

function _hasShellCommand(string $cmd): bool
{
    return _findShellCommand($cmd) !== '';
}

function _aiReadXlsxAsText(string $path): string
{
    if (!class_exists('ZipArchive')) return '';
    $z = new ZipArchive();
    if ($z->open($path) !== true) return '';

    $shared = [];
    $idx = $z->locateName('xl/sharedStrings.xml');
    if ($idx !== false) {
        $xml = $z->getFromIndex($idx);
        if ($xml) {
            $sx = @simplexml_load_string($xml);
            if ($sx) {
                foreach ($sx->si as $si) {
                    $direct = (string) $si->t;
                    if ($direct !== '') {
                        $val = $direct;
                    } else {
                        $parts = [];
                        foreach ($si->r ?: [] as $r) $parts[] = (string) $r->t;
                        $val = implode('', $parts);
                    }
                    // Excel 双语标题里常塞大段空格做对齐 → 折叠成一个空格，保留换行
                    $val = preg_replace('/[ \t]{2,}/u', ' ', $val);
                    $shared[] = trim($val);
                }
            }
        }
    }

    // 找第一个 sheet 文件（xl/worksheets/sheet1.xml 不一定存在，按实际文件找）
    $sheetXml = '';
    for ($i = 0; $i < $z->numFiles; $i++) {
        $name = $z->getNameIndex($i);
        if (strpos($name, 'xl/worksheets/') === 0 && substr($name, -4) === '.xml') {
            $sheetXml = $z->getFromIndex($i);
            break;
        }
    }
    $z->close();
    if (!$sheetXml) return '';

    $sx = @simplexml_load_string($sheetXml);
    if (!$sx) return '';

    $lines = [];
    foreach ($sx->sheetData->row ?: [] as $row) {
        $cells = [];
        foreach ($row->c ?: [] as $c) {
            $type = (string) $c['t'];
            if ($type === 's') {
                $i2 = (int) $c->v;
                $cells[] = $shared[$i2] ?? '';
            } elseif ($type === 'inlineStr') {
                $cells[] = (string) ($c->is->t ?? '');
            } else {
                $cells[] = (string) $c->v;
            }
        }
        $line = implode("\t", $cells);
        if (trim($line) !== '') $lines[] = $line;
    }
    return implode("\n", $lines);
}

function _aiReadCsvAsText(string $path): string
{
    $bin = (string) file_get_contents($path);
    if (substr($bin, 0, 3) === "\xEF\xBB\xBF") $bin = substr($bin, 3);
    if (!mb_check_encoding($bin, 'UTF-8')) {
        $conv = @mb_convert_encoding($bin, 'UTF-8', 'GBK,GB18030,BIG5,UTF-8');
        if ($conv !== false) $bin = $conv;
    }
    return $bin;
}

function _aiReadPdfAsText(string $path): string
{
    $bin = _findShellCommand('pdftotext');
    if ($bin === '') return '';
    $out = [];
    $code = 0;
    @exec(escapeshellarg($bin) . ' -layout ' . escapeshellarg($path) . ' - 2>/dev/null', $out, $code);
    if ($code !== 0) return '';
    return implode("\n", $out);
}

function _aiExtractTextFromUpload(string $path, string $mime, string $name): string
{
    $lcName = strtolower($name);
    if ($mime === 'text/csv' || str_ends_with($lcName, '.csv')) {
        return _aiReadCsvAsText($path);
    }
    if ($mime === 'text/plain' || str_ends_with($lcName, '.txt')) {
        return _aiReadCsvAsText($path); // 同样的编码处理
    }
    if (str_ends_with($lcName, '.xlsx')
        || $mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
        return _aiReadXlsxAsText($path);
    }
    if ($mime === 'application/pdf' || str_ends_with($lcName, '.pdf')) {
        return _aiReadPdfAsText($path);
    }
    return '';
}

function _aiCallOpenAIText(array $cfg, string $userText): array
{
    return _aiCallOpenAI($cfg, [
        ['role' => 'system', 'content' => _aiInquirySystemPrompt()],
        ['role' => 'user', 'content' => $userText],
    ]);
}

function _aiNormalizeItems(array $parsed): array
{
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
    return $items;
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

/**
 * 内部销售代录入：上传供应商报价图/Excel/PDF → AI 识别并匹配到询价单行
 * 已登录销售调用，凭 inquiry_id（不需要 token）
 */
function handle_aiParseSupplierQuoteForInquiry(PDO $pdo, array $input, array $user): void
{
    $iid = (int) ($_POST['inquiry_id'] ?? $_GET['inquiry_id'] ?? 0);
    if (!$iid) jsonError('缺少 inquiry_id');

    if (empty($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        jsonError('请上传文件');
    }
    $f = $_FILES['file'];
    if ((int) $f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败 code=' . (int) $f['error']);
    if ((int) $f['size'] > 20 * 1024 * 1024) jsonError('文件不能超过 20MB');

    $mime = _aiDetectMime($f['tmp_name'], (string) $f['name']);
    $name = (string) $f['name'];
    $isImage = in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true);

    $cfg = _aiOpenaiCfg($pdo);
    if (!$cfg) jsonError('AI 未配置，请到「系统设置」填 OpenAI API Key', 503);

    // 询价行 catalog
    $st = $pdo->prepare("SELECT id, line_no, product_name, spec, unit, qty
        FROM inquiry_items WHERE inquiry_id = ? ORDER BY line_no ASC, id ASC");
    $st->execute([$iid]);
    $catalog = [];
    foreach ($st->fetchAll() as $row) {
        $catalog[] = [
            'id' => (int) $row['id'],
            'line_no' => (int) $row['line_no'],
            'product_name' => (string) $row['product_name'],
            'spec' => (string) $row['spec'],
            'unit' => (string) $row['unit'],
            'qty' => (float) $row['qty'],
        ];
    }
    if (empty($catalog)) jsonError('该询价单没有明细');
    $catalogJson = json_encode($catalog, JSON_UNESCAPED_UNICODE);

    $sys = "你是建材行业的供应商报价单识别助手。\n"
        . "**目标**：把上传内容里识别到的每一项报价，映射到询价单已有的某一行，输出 inquiry_item_id 与品牌/型号/单价/货期/备注。\n"
        . "**询价单已有行（只输出能匹配到的行）**：\n{$catalogJson}\n"
        . "**只输出严格 JSON**：{\"items\":[{\"inquiry_item_id\":0,\"brand\":\"\",\"model\":\"\",\"supplier_price\":0,\"lead_time\":\"\",\"remark\":\"\"}],\"remark\":\"\"}\n"
        . "规则：\n"
        . "1. 必须根据产品名 + 规格匹配到 catalog 里的某一行，inquiry_item_id 必须取自 catalog\n"
        . "2. 若 catalog 里没合理对应行，跳过该行\n"
        . "3. supplier_price 是数字（人民币 / 印尼盾 / 当地货币每单位单价），看不清填 0\n"
        . "4. 千分位逗号去掉；带「不开票/总价/合计」等行跳过\n"
        . "5. 不输出 markdown，只输出 JSON";

    if ($isImage) {
        $bin = file_get_contents($f['tmp_name']);
        if ($bin === false) jsonError('读取上传文件失败');
        $dataUrl = 'data:' . $mime . ';base64,' . base64_encode($bin);
        $resp = _aiCallOpenAI($cfg, [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => [
                ['type' => 'text', 'text' => '请识别这张供应商报价单并按规则映射'],
                ['type' => 'image_url', 'image_url' => ['url' => $dataUrl, 'detail' => 'high']],
            ]],
        ]);
    } else {
        $text = _aiExtractTextFromUpload($f['tmp_name'], $mime, $name);
        if (trim($text) === '') {
            jsonError('无法识别该文件（' . $mime . '）。PDF 扫描件请截图上传。');
        }
        if (mb_strlen($text) > 30000) $text = mb_substr($text, 0, 30000);
        $resp = _aiCallOpenAI($cfg, [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => "供应商报价单提取的文本：\n{$text}"],
        ]);
    }

    $content = (string) ($resp['choices'][0]['message']['content'] ?? '');
    $parsed = json_decode($content, true);
    if (!is_array($parsed)) jsonError('AI 返回格式异常: ' . substr($content, 0, 300), 500);

    $allowedIds = array_column($catalog, 'id');
    $items = [];
    foreach (($parsed['items'] ?? []) as $it) {
        $iid2 = (int) ($it['inquiry_item_id'] ?? 0);
        if (!in_array($iid2, $allowedIds, true)) continue;
        $items[] = [
            'inquiry_item_id' => $iid2,
            'brand' => (string) ($it['brand'] ?? ''),
            'model' => (string) ($it['model'] ?? ''),
            'supplier_price' => (float) ($it['supplier_price'] ?? 0),
            'lead_time' => (string) ($it['lead_time'] ?? ''),
            'remark' => (string) ($it['remark'] ?? ''),
        ];
    }

    opLog($pdo, 'inquiry', $iid, 'internal_ai_parse_supplier',
        sprintf('%s (%s, %.1fKB) → %d 行', $name, $mime, $f['size'] / 1024, count($items)),
        (int) ($user['id'] ?? 0));

    jsonOk([
        'items' => $items,
        'remark' => trim((string) ($parsed['remark'] ?? '')),
        'matched' => count($items),
        'total_inquiry_items' => count($catalog),
    ]);
}

/**
 * 通过供应商上传的报价单图片，识别并匹配到询价单各行
 * 公开 action（凭 dispatch token 调用，无需登录）
 *
 * 输入：multipart/form-data
 *   - file: image (jpg/png/webp/gif)
 *   - token: dispatch.token
 * 输出：{ items: [{ inquiry_item_id, brand, model, supplier_price, lead_time, remark }], remark }
 */
function handle_publicAiParseSupplierQuote(PDO $pdo, array $input): void
{
    $token = (string) ($_POST['token'] ?? $_GET['token'] ?? '');
    if (!$token) jsonError('缺少 token');

    require_once __DIR__ . '/public_quote.php';
    $d = _loadDispatchByToken($pdo, $token);

    if (empty($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        jsonError('请上传图片');
    }
    $f = $_FILES['file'];
    if ((int) $f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败: code=' . (int) $f['error']);
    if ((int) $f['size'] > 10 * 1024 * 1024) jsonError('图片过大，请小于 10MB');

    $mime = _aiDetectMime($f['tmp_name'], (string) $f['name']);
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
        jsonError('暂只支持图片（jpg/png/webp/gif）。Excel/PDF 请截图后上传。当前: ' . $mime);
    }

    $cfg = _aiOpenaiCfg($pdo);
    if (!$cfg) jsonError('AI 解析未配置（系统侧未填 API Key），请直接手填', 503);

    // 加载该询价单全部行，让 AI 匹配
    $st = $pdo->prepare("SELECT id, line_no, product_name, spec, unit, qty
        FROM inquiry_items WHERE inquiry_id = ? ORDER BY line_no ASC, id ASC");
    $st->execute([(int) $d['inquiry_id']]);
    $inqItems = $st->fetchAll();

    $catalog = [];
    foreach ($inqItems as $row) {
        $catalog[] = [
            'id' => (int) $row['id'],
            'line_no' => (int) $row['line_no'],
            'product_name' => (string) $row['product_name'],
            'spec' => (string) $row['spec'],
            'unit' => (string) $row['unit'],
            'qty' => (float) $row['qty'],
        ];
    }
    $catalogJson = json_encode($catalog, JSON_UNESCAPED_UNICODE);

    $sys = "你是建材行业的供应商报价单识别助手。\n"
        . "客户给你一张供应商发回的报价单图片（可能是 Excel 截图、PDF 截图、手写、聊天截图）。\n"
        . "**目标**：把图片里识别到的每一项报价，映射到询价单已有的某一行，输出该行 inquiry_item_id 与品牌/型号/单价/货期/备注。\n"
        . "**询价单已有行（请只输出能匹配到的行）**：\n{$catalogJson}\n"
        . "**只输出严格 JSON**：{\"items\":[{\"inquiry_item_id\":0,\"brand\":\"\",\"model\":\"\",\"supplier_price\":0,\"lead_time\":\"\",\"remark\":\"\"}],\"remark\":\"\"}\n"
        . "规则：\n"
        . "1. 必须根据产品名 + 规格匹配到 catalog 里的某一行，inquiry_item_id 必须取自 catalog\n"
        . "2. 若 catalog 里没合理对应行，就跳过该行，不要瞎填 inquiry_item_id\n"
        . "3. supplier_price 是数字（人民币每个单位的单价），看不清就填 0\n"
        . "4. lead_time 写如「7 天」「现货」等\n"
        . "5. brand / model 看不到留空字符串\n"
        . "6. 整体备注（付款条件、运费、有效期等说明）放在顶层 remark\n"
        . "7. 不输出 markdown，不输出解释，只输出 JSON";

    $bin = file_get_contents($f['tmp_name']);
    if ($bin === false) jsonError('读取上传文件失败');
    $dataUrl = 'data:' . $mime . ';base64,' . base64_encode($bin);

    $resp = _aiCallOpenAI($cfg, [
        ['role' => 'system', 'content' => $sys],
        ['role' => 'user', 'content' => [
            ['type' => 'text', 'text' => '请识别这张供应商报价单，按规则映射到询价单的对应行。'],
            ['type' => 'image_url', 'image_url' => ['url' => $dataUrl]],
        ]],
    ]);

    $content = (string) ($resp['choices'][0]['message']['content'] ?? '');
    $parsed = json_decode($content, true);
    if (!is_array($parsed)) jsonError('AI 返回格式异常: ' . substr($content, 0, 300), 500);

    $allowedIds = array_column($catalog, 'id');
    $items = [];
    foreach (($parsed['items'] ?? []) as $it) {
        $iid = (int) ($it['inquiry_item_id'] ?? 0);
        if (!in_array($iid, $allowedIds, true)) continue;
        $items[] = [
            'inquiry_item_id' => $iid,
            'brand' => (string) ($it['brand'] ?? ''),
            'model' => (string) ($it['model'] ?? ''),
            'supplier_price' => (float) ($it['supplier_price'] ?? 0),
            'lead_time' => (string) ($it['lead_time'] ?? ''),
            'remark' => (string) ($it['remark'] ?? ''),
        ];
    }

    opLog($pdo, 'inquiry', (int) $d['inquiry_id'], 'public_ai_parse_supplier_file',
        sprintf('token=%s 图片 %s (%s, %.1fKB) → %d 行',
            substr($token, 0, 8), $f['name'], $mime, $f['size'] / 1024, count($items)),
        null);

    jsonOk([
        'items' => $items,
        'remark' => trim((string) ($parsed['remark'] ?? '')),
        'matched' => count($items),
        'total_inquiry_items' => count($catalog),
    ]);
}

/**
 * 通过上传图片解析询价（multipart/form-data）
 * 字段：file（image/jpeg|png|webp|gif）；可选 hint 文本（用户附加说明）
 */
function handle_aiParseInquiryFile(PDO $pdo, array $input, array $user): void
{
    if (empty($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        jsonError('请上传文件');
    }
    $f = $_FILES['file'];
    if ((int) $f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败: code=' . (int) $f['error']);
    if ((int) $f['size'] > 20 * 1024 * 1024) jsonError('文件过大，请小于 20MB');

    $mime = _aiDetectMime($f['tmp_name'], (string) $f['name']);
    $name = (string) $f['name'];
    $imageMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    $isImage = in_array($mime, $imageMimes, true);

    $cfg = _aiOpenaiCfg($pdo);
    if (!$cfg) jsonError('AI 解析未配置：请到「系统设置」填写 OpenAI API Key', 503);

    $hint = trim((string) ($_POST['hint'] ?? ''));

    if ($isImage) {
        // 图片走 vision
        $bin = file_get_contents($f['tmp_name']);
        if ($bin === false) jsonError('读取上传文件失败');
        $dataUrl = 'data:' . $mime . ';base64,' . base64_encode($bin);
        $userContent = [
            ['type' => 'text', 'text' => $hint !== '' ? "客户附加说明：{$hint}\n请基于图片提取询价明细。" : '请基于图片提取询价明细。'],
            ['type' => 'image_url', 'image_url' => ['url' => $dataUrl]],
        ];
        $resp = _aiCallOpenAI($cfg, [
            ['role' => 'system', 'content' => _aiInquirySystemPrompt()],
            ['role' => 'user', 'content' => $userContent],
        ]);
        $logKind = '图片';
    } else {
        // 尝试以文本方式抽取（xlsx/csv/txt/pdf）
        $extracted = _aiExtractTextFromUpload($f['tmp_name'], $mime, $name);
        if (trim($extracted) === '') {
            $hintMsg = '';
            if ($mime === 'application/pdf' || str_ends_with(strtolower($name), '.pdf')) {
                $hintMsg = ' PDF 文字抽取失败（可能是扫描件 / 服务器没装 poppler-utils）。请把 PDF 截图后上传。';
            } elseif (str_ends_with(strtolower($name), '.xls')) {
                $hintMsg = ' 旧版 .xls 格式不支持，请另存为 .xlsx 或 .csv 再上传。';
            }
            jsonError('无法识别文件内容（' . $mime . '/' . $name . '）。' . $hintMsg);
        }
        if (mb_strlen($extracted) > 30000) $extracted = mb_substr($extracted, 0, 30000);
        $userText = $hint !== ''
            ? "客户附加说明：{$hint}\n\n以下是从客户上传的文件中提取的文本：\n{$extracted}"
            : "以下是从客户上传的文件中提取的文本：\n{$extracted}";
        $resp = _aiCallOpenAIText($cfg, $userText);
        $logKind = strtoupper(pathinfo($name, PATHINFO_EXTENSION) ?: 'FILE');
    }

    $content = (string) ($resp['choices'][0]['message']['content'] ?? '');
    $parsed = json_decode($content, true);
    if (!is_array($parsed)) jsonError('AI 返回格式异常: ' . substr($content, 0, 300), 500);

    $items = _aiNormalizeItems($parsed);

    opLog($pdo, 'inquiry', null, 'ai_parse_file',
        sprintf('%s %s (%s, %.1fKB) → %d 行',
            $logKind, $name, $mime, $f['size'] / 1024, count($items)),
        (int) $user['id']);

    jsonOk([
        'items' => $items,
        'remark' => trim((string) ($parsed['remark'] ?? '')),
        'usage' => $resp['usage'] ?? null,
    ]);
}
