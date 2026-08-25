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
    // 20260824：默认模型从 gpt-4o-mini 升到 gpt-4o。
    // mini 读表格会漏行、串列，一张报价单差几行就得人工全表核对，省下的那点钱不值。
    // 两个模型分开配：视觉（图片/扫描件）比纯文本更吃模型能力。
    return [
        'api_key' => $key,
        'model' => trim(getSetting($pdo, 'ai.openai.model', 'gpt-4o')) ?: 'gpt-4o',
        'vision_model' => trim(getSetting($pdo, 'ai.openai.vision_model', '')) ?: (trim(getSetting($pdo, 'ai.openai.model', 'gpt-4o')) ?: 'gpt-4o'),
        'endpoint' => trim(getSetting($pdo, 'ai.openai.endpoint', 'https://api.openai.com/v1/chat/completions'))
            ?: 'https://api.openai.com/v1/chat/completions',
    ];
}

/**
 * 收集本次上传的所有图片，转成 data URL 数组（20260824）
 *
 * 为什么要支持多图：前端把 PDF 转图时，5 页会被**竖向拼成一张长图**再上传。
 * OpenAI 的视觉接口会把图缩到 2048×2048 以内 —— 一张 1190×8420 的长图缩完
 * 每页只剩 289px 宽，字全糊了，模型只能连蒙带猜，表现就是「识别不准、经常漏行」。
 * 改成一页一张分别送，每页都保住原分辨率。
 *
 * 字段约定：file（第一张，兼容老前端）、file_2、file_3 …
 */
/* ===== 表格直接解析（20260825）=====
 *
 * 起因：一份 143 行的 Excel，AI 只给回 141 行，漏掉的是第 83「PVC三通」和第 84「大小头」。
 * 查出来不是看不清，是这两行的**产品名和第 81、82 行一模一样**（只有规格和单价不同），
 * 模型把它们当重复行合并了。这类错误靠提示词压不住 —— 只要让模型决定"有几行"，
 * 它就有机会替你做减法。
 *
 * 所以 Excel / CSV 这条路彻底不让 AI 数行：表格本来就有表头和数据行，是确定的结构。
 * 用关键词认出表头列，然后在 PHP 里逐行取。多少行就是多少行，一行不多一行不少，
 * 顺带还快一大截、不花钱。
 *
 * AI 仍然负责它真正擅长的：图片识别、自由格式文本、以及表头认不出来时的兜底。
 */

const _TBL_NAME = ['产品名称', '产品名', '品名', '产品', '名称', '物料', '材料', '描述',
    'description', 'product', 'material', 'item', 'nama', 'barang'];
const _TBL_SPEC = ['规格参数', '规格', '型号', '参数', '尺寸', 'spec', 'ukuran', 'tipe', 'model'];
const _TBL_QTY  = ['数量', "q'ty", 'qty', 'quantity', 'jumlah', '数'];
const _TBL_UNIT = ['单位', 'unit', 'satuan', 'uom'];
// 明确不是明细字段的列。放在最后判定，避免「单价(Rp)」被 QTY 里的「数」之类误伤
const _TBL_IGNORE = ['序号', '单价', '金额', '小计', '合计', 'sap', '货号', '来源订单', '备注',
    'price', 'amount', 'total', 'no.'];

function _tblNorm(string $s): string
{
    return mb_strtolower(preg_replace('/[\s()（）:：\/、.．\-_]+/u', '', $s));
}

/** 单元格文本命中关键词表时返回命中长度（越长越具体），没命中返回 null */
function _tblMatch(string $cell, array $kws): ?int
{
    $c = _tblNorm($cell);
    if ($c === '') return null;
    $best = null;
    foreach ($kws as $k) {
        $kk = _tblNorm($k);
        if ($kk !== '' && mb_strpos($c, $kk) !== false) {
            $best = max($best ?? 0, mb_strlen($kk));
        }
    }
    return $best;
}

/** 一行表头 → [字段 => 列号] */
function _tblFieldMap(array $cells): array
{
    $map = [];
    foreach ($cells as $i => $c) {
        $ign = _tblMatch((string) $c, _TBL_IGNORE);
        $best = null;
        foreach ([
            'product_name' => _TBL_NAME,
            'spec' => _TBL_SPEC,
            'qty' => _TBL_QTY,
            'unit' => _TBL_UNIT,
        ] as $field => $kws) {
            $len = _tblMatch((string) $c, $kws);
            if ($len !== null && ($best === null || $len > $best[1])) $best = [$field, $len];
        }
        // 更像"要忽略的列"就跳过
        if ($ign !== null && ($best === null || $ign >= $best[1])) continue;
        if ($best !== null && !isset($map[$best[0]])) $map[$best[0]] = $i;
    }
    return $map;
}

/** 在前 40 行里找表头。必须有产品名列，再加数量/规格/单位任一，才认 */
function _tblFindHeader(array $lines): array
{
    $limit = min(count($lines), 40);
    for ($i = 0; $i < $limit; $i++) {
        $map = _tblFieldMap(explode("\t", $lines[$i]));
        if (isset($map['product_name'])
            && (isset($map['qty']) || isset($map['spec']) || isset($map['unit']))) {
            return ['row' => $i, 'map' => $map];
        }
    }
    return ['row' => -1, 'map' => []];
}

/** 合计/小计这类汇总行不是产品 */
function _tblIsTotalRow(string $name): bool
{
    $n = _tblNorm($name);
    foreach (['合计', '小计', '总计', '共计', '总不含税', '总含税', '税额',
        'ppn', 'vat', 'subtotal', 'grandtotal', 'total'] as $w) {
        if (mb_strpos($n, _tblNorm($w)) === 0) return true;
    }
    return false;
}

function _tblParseQty(string $s): float
{
    // 千分位逗号/空格去掉；「2根」「6 个」这种取前面的数字
    $s = str_replace([',', ' ', '　'], '', trim($s));
    if (preg_match('/-?\d+(\.\d+)?/', $s, $m)) return (float) $m[0];
    return 0.0;
}

/**
 * 表格文本 → items[]。认不出表头返回 null，让调用方回退到 AI。
 * 多工作表：每页各自找表头，找不到的页（比如"订单汇总"这种汇总页）整页跳过。
 */
function _aiExtractTableItems(string $text): ?array
{
    $raw = preg_split('/\r?\n/', $text);
    // 按 _aiReadXlsxAsText 写的工作表分隔线切页
    $sheets = [];
    $cur = [];
    foreach ($raw as $line) {
        if (preg_match('/^\s*=====\s*工作表：/u', $line)) {
            if ($cur) $sheets[] = $cur;
            $cur = [];
            continue;
        }
        if (trim($line) !== '') $cur[] = $line;
    }
    if ($cur) $sheets[] = $cur;
    if (!$sheets) return null;

    $items = [];
    $remarkLines = [];
    $matchedSheets = 0;

    foreach ($sheets as $lines) {
        $h = _tblFindHeader($lines);
        if ($h['row'] < 0) continue;      // 汇总页 / 说明页，跳过
        $matchedSheets++;
        $map = $h['map'];

        // 表头之前的内容多半是抬头信息（客户、日期、收款方式…），收进备注
        if ($matchedSheets === 1) {
            for ($i = 0; $i < $h['row']; $i++) {
                $t = trim(str_replace("\t", ' ', $lines[$i]));
                $t = trim(preg_replace('/\s{2,}/u', ' ', $t));
                if ($t !== '') $remarkLines[] = $t;
            }
        }

        for ($i = $h['row'] + 1; $i < count($lines); $i++) {
            $cells = explode("\t", $lines[$i]);
            $get = function (string $f) use ($cells, $map): string {
                return isset($map[$f]) && isset($cells[$map[$f]]) ? trim($cells[$map[$f]]) : '';
            };
            $name = $get('product_name');
            if ($name === '' || _tblIsTotalRow($name)) continue;

            $items[] = [
                'line_no' => count($items) + 1,
                'product_name' => $name,
                'spec' => $get('spec'),
                'qty' => _tblParseQty($get('qty')),
                'unit' => $get('unit') ?: '件',
            ];
        }
    }

    if (!$items) return null;

    $remark = implode('；', array_slice($remarkLines, 0, 12));
    if (mb_strlen($remark) > 500) $remark = mb_substr($remark, 0, 500);

    return [
        'items' => $items,
        'remark' => $remark,
        'sheets' => $matchedSheets,
    ];
}

function _aiUploadedImages(int $max = 6): array
{
    $imageMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    $urls = [];
    foreach ($_FILES as $key => $f) {
        if ($key !== 'file' && strpos($key, 'file_') !== 0) continue;
        if (!is_string($f['tmp_name'] ?? null) || !is_uploaded_file($f['tmp_name'])) continue;
        if ((int) ($f['error'] ?? 1) !== UPLOAD_ERR_OK) continue;
        $mime = _aiDetectMime($f['tmp_name'], (string) $f['name']);
        if (!in_array($mime, $imageMimes, true)) continue;
        $bin = file_get_contents($f['tmp_name']);
        if ($bin === false) continue;
        $urls[$key] = 'data:' . $mime . ';base64,' . base64_encode($bin);
    }
    // file, file_2, file_3 … 按页序排好，别把第 3 页排到第 1 页前面
    uksort($urls, function ($a, $b) {
        $na = $a === 'file' ? 1 : (int) substr($a, 5);
        $nb = $b === 'file' ? 1 : (int) substr($b, 5);
        return $na <=> $nb;
    });
    return array_slice(array_values($urls), 0, $max);
}

function _aiInquirySystemPrompt(): string
{
    return "你是建材行业的询价单解析助手。\n"
        . "用户给你的内容可能是：纯文字、聊天截图、Excel/CSV 表格文本（用 Tab 或多空格分列）、PDF 抽出的文本、扫描件 OCR、表格图片。\n"
        . "请提取产品列表。**只输出严格 JSON**："
        . "{\"items\":[{\"product_name\":\"\",\"spec\":\"\",\"qty\":0,\"unit\":\"\"}],\"remark\":\"\",\"total_rows_seen\":0}\n"
        . "**最重要的一条：一行都不能漏。**\n"
        . "  - total_rows_seen 填你在原始内容里数到的产品行总数（不含表头、不含小计/合计行）\n"
        . "  - items 的条数必须等于 total_rows_seen；数到多少行就输出多少行\n"
        . "  - 内容多也要全部逐行输出，禁止用「...」「以下省略」「同上」之类的省略写法\n"
        . "  - 不要把相似的行合并成一行；型号只差一点也是两行\n"
        . "  - 看不清的字段留空，但这一行本身仍然要输出，不要因为某个字段读不出就整行丢掉\n"
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

/**
 * @param array $opts model=覆盖模型 / max_tokens
 *
 * 三个之前没做、直接导致「漏行」的事：
 *  1. 没设 max_tokens。50 行的清单 JSON 很容易顶到模型默认输出上限，
 *     返回的 JSON 从中间被切断 —— 要么解析失败，要么只拿到前半截，
 *     表现就是「识别不全，后面几行没了」。现在显式给足并检查 finish_reason。
 *  2. 模型配错（比如填了账号没开通的模型）时只抛一句 HTTP 404，
 *     现在自动回退到 gpt-4o-mini 并把情况带回前端。
 */
function _aiCallOpenAI(array $cfg, array $messages, array $opts = []): array
{
    $model = (string) ($opts['model'] ?? $cfg['model']);
    $payload = [
        'model' => $model,
        'messages' => $messages,
        'response_format' => ['type' => 'json_object'],
        'temperature' => 0,
        // 给足输出预算：长清单最容易在这里被腰斩
        'max_tokens' => (int) ($opts['max_tokens'] ?? 16000),
    ];
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);

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
        // 配了账号没开通的模型：别让整个功能挂掉，退到一定有的 mini 上先把活干了
        $isModelIssue = stripos($brief, 'model') !== false
            && (stripos($brief, 'not exist') !== false || stripos($brief, 'not found') !== false
                || stripos($brief, 'does not have access') !== false);
        if ($isModelIssue && $model !== 'gpt-4o-mini' && empty($opts['_fallback'])) {
            $out = _aiCallOpenAI($cfg, $messages, array_merge($opts, ['model' => 'gpt-4o-mini', '_fallback' => 1]));
            $out['_fallback_model'] = 'gpt-4o-mini';
            $out['_wanted_model'] = $model;
            return $out;
        }
        jsonError("AI HTTP {$code}: {$brief}", 500);
    }
    $data = json_decode((string) $resp, true);
    return $data ?: [];
}

/**
 * 解析 AI 返回的 JSON，顺带把「被截断」这种情况显式报出来。
 * 以前截断了就是 json_decode 失败 → 报「返回格式异常」，
 * 老板看到的现象是「识别不出来 / 少了几行」，根本不知道是长度问题。
 */
function _aiDecodeJson(array $resp): array
{
    $finish = (string) ($resp['choices'][0]['finish_reason'] ?? '');
    $content = (string) ($resp['choices'][0]['message']['content'] ?? '');
    if ($finish === 'length') {
        jsonError('清单太长，AI 一次没输出完（结果被截断）。请把文件拆成两次上传，或截图分批识别。', 500);
    }
    $parsed = json_decode($content, true);
    if (!is_array($parsed)) {
        jsonError('AI 返回格式异常: ' . substr($content, 0, 300), 500);
    }
    return $parsed;
}

/**
 * 漏行自查 + 补一次（20260824）
 *
 * 让模型自己报「我数到 total_rows_seen 行」，如果实际输出的 items 比这个数少，
 * 说明它中途偷懒/省略了 —— 这正是老板反馈的「经常有遗漏」。
 * 遇到就把原始输入连同「你上次只给了 N 行，应该有 M 行」再送一次，取行数多的那份。
 *
 * 只补一次：补两次的收益很小，但每次都是一次完整的模型调用，用户要多等十几秒。
 */
function _aiRetryIfShort(array $cfg, array $messages, array $parsed, array $opts = []): array
{
    $seen = (int) ($parsed['total_rows_seen'] ?? 0);
    $got = is_array($parsed['items'] ?? null) ? count($parsed['items']) : 0;
    // 差 1 行不折腾（表头/合计行的口径差异很常见），差 2 行及以上才补
    if ($seen <= 0 || $got >= $seen || ($seen - $got) < 2) return $parsed;

    $retry = array_merge($messages, [[
        'role' => 'assistant',
        'content' => json_encode(['items' => $parsed['items'] ?? []], JSON_UNESCAPED_UNICODE),
    ], [
        'role' => 'user',
        'content' => "你自己数到 {$seen} 行，但只输出了 {$got} 行，漏了 " . ($seen - $got) . " 行。"
            . "请重新完整输出**全部 {$seen} 行**，一行都不要少，格式不变。",
    ]]);

    $resp2 = _aiCallOpenAI($cfg, $retry, $opts);
    $finish2 = (string) ($resp2['choices'][0]['finish_reason'] ?? '');
    if ($finish2 === 'length') return $parsed;     // 补的时候被截断，那就用第一次的
    $p2 = json_decode((string) ($resp2['choices'][0]['message']['content'] ?? ''), true);
    if (!is_array($p2) || !is_array($p2['items'] ?? null)) return $parsed;

    // 取行数多的那份；备注保留原来的（重试时模型常把 remark 丢掉）
    if (count($p2['items']) > $got) {
        $p2['remark'] = $p2['remark'] ?? ($parsed['remark'] ?? '');
        if (trim((string) $p2['remark']) === '') $p2['remark'] = (string) ($parsed['remark'] ?? '');
        $p2['_retried'] = 1;
        return $p2;
    }
    return $parsed;
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

    // 1. which / command -v（shell 层查，不受 open_basedir 限制）
    $out = [];
    @exec('which ' . escapeshellarg($cmd) . ' 2>/dev/null', $out);
    if (!empty($out) && trim($out[0]) !== '') return trim($out[0]);

    $out = [];
    @exec('command -v ' . escapeshellarg($cmd) . ' 2>/dev/null', $out);
    if (!empty($out) && trim($out[0]) !== '') return trim($out[0]);

    // 2. 直接试运行，能跑就接受（绕过 is_executable，因为 open_basedir 会让它误报）
    foreach (['/usr/bin/', '/usr/local/bin/', '/opt/homebrew/bin/', '/bin/'] as $dir) {
        $full = $dir . $cmd;
        $out = [];
        $code = 1;
        @exec(escapeshellarg($full) . ' -v 2>&1', $out, $code);
        // pdftoppm/pdftotext 看到未知参数 -v 也会输出版本信息或用法 → 只要 code 不是 127（命令不存在）就可用
        if ($code !== 127 && !empty($out)) return $full;
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

    // 工作表显示名：workbook.xml 里的 <sheet name="报价表" r:id="rId1"/>，
    // 按 workbook 中的出现顺序对应 xl/worksheets/sheetN.xml 的编号
    $sheetNames = [];
    $wbIdx = $z->locateName('xl/workbook.xml');
    if ($wbIdx !== false) {
        $wbXml = $z->getFromIndex($wbIdx);
        if ($wbXml) {
            $wb = @simplexml_load_string($wbXml);
            if ($wb && isset($wb->sheets->sheet)) {
                foreach ($wb->sheets->sheet as $sh) $sheetNames[] = (string) $sh['name'];
            }
        }
    }

    // 读**全部** worksheet：原先找到第一个就 break，多 sheet 的表只解析了第一页
    $sheets = [];
    for ($i = 0; $i < $z->numFiles; $i++) {
        $name = $z->getNameIndex($i);
        if (strpos($name, 'xl/worksheets/') === 0 && substr($name, -4) === '.xml') {
            $sheets[$name] = $z->getFromIndex($i);
        }
    }
    $z->close();
    if (!$sheets) return '';

    // sheet1.xml, sheet2.xml … 按编号排，保证与 workbook 里的顺序一致
    uksort($sheets, function ($a, $b) {
        preg_match('/(\d+)\.xml$/', $a, $ma);
        preg_match('/(\d+)\.xml$/', $b, $mb);
        return ((int) ($ma[1] ?? 0)) <=> ((int) ($mb[1] ?? 0));
    });

    $lines = [];
    $sheetNo = 0;
    foreach ($sheets as $sheetXml) {
        $sheetNo++;
        $sx = @simplexml_load_string($sheetXml);
        if (!$sx) continue;

        $sheetLines = [];
        foreach ($sx->sheetData->row ?: [] as $row) {
            // 【20260824 修】按 r 属性（A1/B1/C1）定位列，不能顺序追加。
            // Excel 存文件时会**整个省略空单元格**：一行如果 B 列是空的，
            // XML 里就只有 A 和 C 两个 <c>，顺序追加会把 C 的值塞进 B 的位置，
            // 整行往左错一格。表现就是「数量跑到规格列」「单位变成数字」这类识别错误，
            // 而且越是格式松散的客户表越容易中招。
            $cells = [];
            foreach ($row->c ?: [] as $c) {
                $ref = (string) $c['r'];              // 如 "C12"
                $colIdx = -1;
                if ($ref !== '' && preg_match('/^([A-Z]+)/', $ref, $m)) {
                    $colIdx = 0;
                    foreach (str_split($m[1]) as $ch) {
                        $colIdx = $colIdx * 26 + (ord($ch) - 64);
                    }
                    $colIdx--;                        // A → 0
                }

                $type = (string) $c['t'];
                if ($type === 's') {
                    $i2 = (int) $c->v;
                    $val = $shared[$i2] ?? '';
                } elseif ($type === 'inlineStr') {
                    $val = (string) ($c->is->t ?? '');
                } else {
                    $val = (string) $c->v;
                }

                if ($colIdx >= 0) {
                    $cells[$colIdx] = $val;
                } else {
                    $cells[] = $val;                  // 没有 r 属性的兜底
                }
            }
            if (!$cells) continue;
            // 补齐中间的空列，保持列位对齐
            $maxCol = max(array_keys($cells));
            $flat = [];
            for ($ci = 0; $ci <= $maxCol; $ci++) $flat[] = $cells[$ci] ?? '';

            $line = implode("\t", $flat);
            if (trim($line) !== '') $sheetLines[] = $line;
        }
        if (!$sheetLines) continue;   // 空白页不占篇幅

        // 多页时标出页名，AI 才知道这是不同工作表，不会把两页的表头混在一起
        if (count($sheets) > 1) {
            $title = $sheetNames[$sheetNo - 1] ?? ('Sheet' . $sheetNo);
            $lines[] = ($lines ? "\n" : '') . "===== 工作表：{$title} =====";
        }
        foreach ($sheetLines as $l) $lines[] = $l;
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
        . "**只输出严格 JSON**："
        . "{\"items\":[{\"product_name\":\"\",\"spec\":\"\",\"qty\":0,\"unit\":\"\"}],\"remark\":\"\",\"total_rows_seen\":0}\n"
        . "**一行都不能漏**：total_rows_seen 填你数到的产品行数，items 条数必须等于它；\n"
        . "内容多也要逐行全部输出，禁止用省略号、禁止合并相似行、禁止因为某个字段读不清就整行丢掉。\n"
        . "规则：\n"
        . "1. 每个**有数量**的产品独立成一行 item，提取产品名（不含数量和单位）、规格（如型号/功率/尺寸/颜色等显式标注的规格）、数量（数字，可小数）、单位（个/件/套/平方米/米/卷/张/对/包/箱/支/根/台/卷/盒/瓶 等，按客户原文）\n"
        . "2. 描述性、说明性、整体备注（颜色要求/安装要求/品牌偏好/标题/小节标题/没数量的孤立产品名）合并到 remark，多条用「；」分隔\n"
        . "3. 产品名要干净，剥离数量、单位、冒号\n"
        . "4. 同一行如果包含规格信息（如「15W 嵌入式筒灯」），把规格识别出来：product_name=\"嵌入式筒灯\", spec=\"15W\"；如果不能明确切分则保留在 product_name\n"
        . "5. 不输出 markdown，不输出解释，只输出 JSON";

    // 原来这里手抄了一遍 curl，没设 max_tokens 也没查截断 —— 长清单会被腰斩且无声无息。
    // 统一走公共调用，顺带拿到漏行自查。
    $messages = [
        ['role' => 'system', 'content' => $sys],
        ['role' => 'user', 'content' => $text],
    ];
    $resp = _aiCallOpenAI($cfg, $messages);
    $parsed = _aiDecodeJson($resp);
    $parsed = _aiRetryIfShort($cfg, $messages, $parsed);

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

    // 两种输入：① 文件 ② 直接粘贴文字
    $hasFile = !empty($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name']);
    $pastedText = trim((string) ($_POST['text'] ?? ''));
    if (!$hasFile && $pastedText === '') {
        jsonError('请上传文件或粘贴报价文本');
    }
    $f = null;
    $mime = '';
    $name = '文本输入';
    $isImage = false;
    if ($hasFile) {
        $f = $_FILES['file'];
        if ((int) $f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败 code=' . (int) $f['error']);
        if ((int) $f['size'] > 30 * 1024 * 1024) jsonError('文件不能超过 30MB');
        $mime = _aiDetectMime($f['tmp_name'], (string) $f['name']);
        $name = (string) $f['name'];
        $isImage = in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true);
    }

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

    // 造 3 行 catalog 参考渲染，让 AI 看清询价单
    $sampleLines = [];
    foreach (array_slice($catalog, 0, 3) as $c) {
        $sampleLines[] = sprintf('  · id=%d 第%d行 · %s%s · 需 %s %s',
            $c['id'], $c['line_no'], $c['product_name'],
            $c['spec'] ? '（' . $c['spec'] . '）' : '',
            $c['qty'], $c['unit']);
    }
    $samples = implode("\n", $sampleLines);

    $sys = "你是建材供应商报价单识别助手。任务：逐行提取供应商报价，匹配到下面的询价 catalog，输出 inquiry_item_id + 品牌/型号/单价/货期/备注。\n\n"
        . "**询价 catalog（inquiry_item_id 必须取自这里）**：\n{$catalogJson}\n\n"
        . "**catalog 渲染参考**（帮助辨识）：\n{$samples}\n\n"
        . "**输出严格 JSON**：{\"items\":[{\"inquiry_item_id\":0,\"brand\":\"\",\"model\":\"\",\"supplier_price\":0,\"lead_time\":\"\",\"remark\":\"\"}],\"remark\":\"\"}\n\n"
        . "**匹配规则（务必仔细）**：\n"
        . "1. 每行报价先找 catalog 里最像的项：产品名相似（关键字/别名）+ 规格（型号/尺寸参数）\n"
        . "2. 数字型号必须严格对（1*25 和 1*35 不同行；50 平方 和 35 平方 不同）\n"
        . "3. 允许近似：'角铁 3.5' 可对 catalog 里 '角铝 3.5'；'铜线 NYA 1x25' 对 catalog 里 '铜电缆 NYA-0.6/1kv-1*25'\n"
        . "4. inquiry_item_id 必须是 catalog 里 id 的数字，不能瞎编\n"
        . "5. 找不到合理对应就跳过该行\n\n"
        . "**数字处理**：\n"
        . "- supplier_price 是每单位单价（数字）\n"
        . "- 千分位处理：中文用逗号 '350,000' → 350000；印尼有时用点作千分位 'Rp 12.500' → 12500\n"
        . "- 若表里只给行总价（total）、没给单价，用 total/qty 反算单价\n"
        . "- 看不清填 0\n\n"
        . "**跳过**：表头行、'合计/PPN/税额/总计/subtotal/total' 等汇总行、'不开票/张军税点2.5%' 等特殊标注行\n\n"
        . "**顶层 remark**：把付款方式/交货期/收款账户/整体说明放在这里\n\n"
        . "只输出 JSON，不要 markdown，不要解释。";

    if (!$hasFile) {
        // 纯文本粘贴
        $text = $pastedText;
        if (mb_strlen($text) > 30000) $text = mb_substr($text, 0, 30000);
        $resp = _aiCallOpenAI($cfg, [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => "供应商粘贴的报价文本：\n{$text}"],
        ]);
    } elseif ($isImage) {
        $bin = file_get_contents($f['tmp_name']);
        if ($bin === false) jsonError('读取上传文件失败');
        $dataUrl = 'data:' . $mime . ';base64,' . base64_encode($bin);
        $resp = _aiCallOpenAI($cfg, [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => [
                ['type' => 'text', 'text' => '识别这张供应商报价单，每行按规则匹配到 catalog 的 inquiry_item_id。看清每个数字位数。'],
                ['type' => 'image_url', 'image_url' => ['url' => $dataUrl, 'detail' => 'high']],
            ]],
        ], ['model' => $cfg['vision_model']]);
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

    // 统一走 _aiDecodeJson：能把「被截断」和「格式坏了」分开报，
    // 老板看到的就不再是笼统的「识别不出来」
    $parsed = _aiDecodeJson($resp);

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

    $sizeInfo = $hasFile ? sprintf('%.1fKB', $f['size'] / 1024) : (mb_strlen($pastedText) . '字');
    opLog($pdo, 'inquiry', $iid, 'internal_ai_parse_supplier',
        sprintf('%s (%s, %s) → %d 行', $name, $mime ?: 'text', $sizeInfo, count($items)),
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
            // detail=high 必须显式给：默认 auto 会把图缩小，长清单直接糊成漏行
            ['type' => 'image_url', 'image_url' => ['url' => $dataUrl, 'detail' => 'high']],
        ]],
    ], ['model' => $cfg['vision_model']]);

    // 统一走 _aiDecodeJson：能把「被截断」和「格式坏了」分开报，
    // 老板看到的就不再是笼统的「识别不出来」
    $parsed = _aiDecodeJson($resp);

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
        // 图片走 vision。多页 PDF 由前端逐页转图上传（file / file_2 / …），
        // 一页一张分别送，别拼成长图 —— 拼完会被缩到看不清（见 _aiUploadedImages 说明）
        $dataUrls = _aiUploadedImages();
        if (!$dataUrls) jsonError('读取上传文件失败');
        $pageNote = count($dataUrls) > 1
            ? "共 " . count($dataUrls) . " 张图，是同一份清单的连续几页，请**按顺序把所有页的行都提取出来**，不要只看第一页。\n"
            : '';
        $userContent = [
            ['type' => 'text', 'text' => ($hint !== '' ? "客户附加说明：{$hint}\n" : '') . $pageNote . '请基于图片提取询价明细。'],
        ];
        foreach ($dataUrls as $du) {
            // detail=high 必须显式给：默认 auto 会把图缩小，长清单直接糊成漏行
            $userContent[] = ['type' => 'image_url', 'image_url' => ['url' => $du, 'detail' => 'high']];
        }
        $messages = [
            ['role' => 'system', 'content' => _aiInquirySystemPrompt()],
            ['role' => 'user', 'content' => $userContent],
        ];
        $callOpts = ['model' => $cfg['vision_model']];
        $resp = _aiCallOpenAI($cfg, $messages, $callOpts);
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
        // ① 先试确定性表格解析。Excel/CSV 本来就有表头和数据行，是确定的结构，
        //    没必要让 AI 去"数"有几行 —— 一让它数，它就可能把产品名相同的行当重复合并
        //    （143 行的单子回来 141 行，就是这么丢的）。
        $table = _aiExtractTableItems($extracted);
        if ($table !== null) {
            $items = $table['items'];
            opLog($pdo, 'inquiry', null, 'ai_parse_file',
                sprintf('表格直读 %s (%s, %.1fKB) → %d 行',
                    $name, $mime, $f['size'] / 1024, count($items)),
                (int) $user['id']);
            jsonOk([
                'items' => $items,
                'remark' => $hint !== '' ? trim($hint . '；' . $table['remark'], '；') : $table['remark'],
                'mode' => 'table',           // 前端据此提示"逐行直读，未经 AI 概括"
                'rows_seen' => count($items),
                'sheets' => $table['sheets'],
            ]);
        }

        // ② 表头认不出来（自由格式的表、说明性文档）才交给 AI
        if (mb_strlen($extracted) > 30000) $extracted = mb_substr($extracted, 0, 30000);
        $userText = $hint !== ''
            ? "客户附加说明：{$hint}\n\n以下是从客户上传的文件中提取的文本：\n{$extracted}"
            : "以下是从客户上传的文件中提取的文本：\n{$extracted}";
        $messages = [
            ['role' => 'system', 'content' => _aiInquirySystemPrompt()],
            ['role' => 'user', 'content' => $userText],
        ];
        $callOpts = [];
        $resp = _aiCallOpenAI($cfg, $messages, $callOpts);
        $logKind = strtoupper(pathinfo($name, PATHINFO_EXTENSION) ?: 'FILE');
    }

    $parsed = _aiDecodeJson($resp);
    $parsed = _aiRetryIfShort($cfg, $messages, $parsed, $callOpts);

    $items = _aiNormalizeItems($parsed);

    opLog($pdo, 'inquiry', null, 'ai_parse_file',
        sprintf('%s %s (%s, %.1fKB) → %d 行',
            $logKind, $name, $mime, $f['size'] / 1024, count($items)),
        (int) $user['id']);

    jsonOk([
        'items' => $items,
        'remark' => trim((string) ($parsed['remark'] ?? '')),
        'usage' => $resp['usage'] ?? null,
        // 界面上据此提示「AI 自己数到 N 行、实际给出 M 行」，让人知道该不该逐行核对
        'rows_seen' => (int) ($parsed['total_rows_seen'] ?? 0),
        'retried' => (int) ($parsed['_retried'] ?? 0),
        'fallback_model' => $resp['_fallback_model'] ?? null,
    ]);
}
