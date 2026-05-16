<?php
/**
 * 短视频矩阵：素材库 / 账号矩阵 / 排期任务
 * 当前阶段：仅本地调度 + 提醒；SaaS 对接通过 external_task_id 字段预留
 */

const SV_PLATFORMS = ['xiaohongshu', 'douyin', 'videohao', 'tiktok', 'instagram'];
const SV_PLATFORM_NAMES = [
    'xiaohongshu' => '小红书',
    'douyin' => '抖音',
    'videohao' => '视频号',
    'tiktok' => 'TikTok',
    'instagram' => 'Instagram',
];

// ============ 素材库 ============

function handle_listSvAssets(PDO $pdo, array $input): void
{
    $where = '1=1';
    $params = [];
    if (!empty($input['keyword'])) {
        $kw = '%' . trim($input['keyword']) . '%';
        $where .= " AND (title LIKE ? OR description LIKE ? OR tags LIKE ?)";
        for ($i = 0; $i < 3; $i++) $params[] = $kw;
    }
    $page = pageInt($input['page'] ?? 1, 1);
    $size = pageInt($input['page_size'] ?? 20, 20, 1, 100);
    $sql = "SELECT * FROM sv_assets WHERE {$where} ORDER BY id DESC";
    $countSql = "SELECT COUNT(*) FROM sv_assets WHERE {$where}";
    $data = paginate($pdo, $sql, $params, $page, $size, $countSql);
    foreach ($data['items'] as &$it) {
        if ($it['platform_copies']) {
            $it['platform_copies_obj'] = json_decode($it['platform_copies'], true) ?: new stdClass();
        }
    }
    jsonOk($data);
}

function handle_getSvAsset(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT * FROM sv_assets WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('素材不存在', 404);
    $row['platform_copies_obj'] = $row['platform_copies']
        ? (json_decode($row['platform_copies'], true) ?: new stdClass())
        : new stdClass();
    jsonOk(['data' => $row]);
}

function handle_createSvAsset(PDO $pdo, array $input, array $user): void
{
    $title = trim((string) ($input['title'] ?? ''));
    if ($title === '') jsonError('请输入标题');
    $pdo->prepare("INSERT INTO sv_assets (title, video_path, cover_path, description, tags,
        duration, size_bytes, platform_copies, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        ->execute([
            $title,
            (string) ($input['video_path'] ?? ''),
            (string) ($input['cover_path'] ?? ''),
            (string) ($input['description'] ?? ''),
            (string) ($input['tags'] ?? ''),
            (int) ($input['duration'] ?? 0),
            (int) ($input['size_bytes'] ?? 0),
            isset($input['platform_copies']) ? json_encode($input['platform_copies'], JSON_UNESCAPED_UNICODE) : '',
            (int) $user['id'],
        ]);
    jsonOk(['id' => (int) $pdo->lastInsertId()]);
}

function handle_updateSvAsset(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $sets = [];
    $params = [];
    foreach (['title', 'video_path', 'cover_path', 'description', 'tags', 'duration', 'size_bytes'] as $f) {
        if (array_key_exists($f, $input)) {
            $sets[] = "{$f} = ?";
            $params[] = $input[$f];
        }
    }
    if (array_key_exists('platform_copies', $input)) {
        $sets[] = "platform_copies = ?";
        $params[] = is_array($input['platform_copies'])
            ? json_encode($input['platform_copies'], JSON_UNESCAPED_UNICODE)
            : (string) $input['platform_copies'];
    }
    if (empty($sets)) jsonError('无字段更新');
    $sets[] = "updated_at = datetime('now','localtime')";
    $params[] = $id;
    $pdo->prepare("UPDATE sv_assets SET " . implode(',', $sets) . " WHERE id = ?")->execute($params);
    jsonOk();
}

function handle_deleteSvAsset(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $pdo->prepare("DELETE FROM sv_assets WHERE id = ?")->execute([$id]);
    jsonOk();
}

/** 素材上传（视频 / 封面） */
function handle_uploadSvFile(PDO $pdo, array $input, array $user): void
{
    if (empty($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        jsonError('请上传文件');
    }
    $f = $_FILES['file'];
    if ((int) $f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败 code=' . (int) $f['error']);

    $kind = strtolower((string) ($_POST['kind'] ?? 'video')); // video | cover
    $maxBytes = $kind === 'cover' ? 10 * 1024 * 1024 : 500 * 1024 * 1024;
    if ((int) $f['size'] > $maxBytes) {
        jsonError('文件过大（' . ($kind === 'cover' ? '封面 10MB' : '视频 500MB') . '）');
    }
    $subdir = $kind === 'cover' ? 'covers' : 'videos';
    $base = __DIR__ . '/../../storage/sv/' . $subdir;
    if (!is_dir($base)) @mkdir($base, 0775, true);
    $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
    if (!preg_match('/^[a-z0-9]{1,5}$/', $ext)) $ext = 'bin';
    $name = date('YmdHis') . '_' . substr(md5($f['name'] . rand()), 0, 8) . '.' . $ext;
    $abs = $base . '/' . $name;
    if (!move_uploaded_file($f['tmp_name'], $abs)) jsonError('保存失败');
    $url = '/storage/sv/' . $subdir . '/' . $name;
    jsonOk(['url' => $url, 'name' => $f['name'], 'size' => (int) $f['size']]);
}

/** AI 一键生成 5 平台差异化文案 */
function handle_aiGeneratePlatformCopy(PDO $pdo, array $input, array $user): void
{
    $title = trim((string) ($input['title'] ?? ''));
    $desc = trim((string) ($input['description'] ?? ''));
    if ($title === '' && $desc === '') jsonError('请提供标题或文案做参考');

    $cfg = _aiOpenaiCfg($pdo);
    if (!$cfg) jsonError('AI 未配置：请到「系统设置」填 OpenAI API Key', 503);

    $sys = "你是短视频运营文案助手。根据用户给的视频主题，为 5 个平台分别生成发布文案。\n"
        . "**只输出严格 JSON**：{\"xiaohongshu\":{\"title\":\"\",\"description\":\"\",\"tags\":\"\"},\"douyin\":{...},\"videohao\":{...},\"tiktok\":{...},\"instagram\":{...}}\n"
        . "各平台风格要求：\n"
        . "- 小红书 xiaohongshu：emoji + 钩子开头，分享/种草口吻，3-5 行短文，话题 #xxx #xxx 用空格分隔，3-5 个\n"
        . "- 抖音 douyin：钩子开头第一句要让人想看下去，文案精炼，话题 #xxx 3-5 个\n"
        . "- 视频号 videohao：偏专业 / 行业 / 朋友圈式，话题 #xxx 1-3 个\n"
        . "- TikTok tiktok：英文文案，hashtag 用 #xxx 3-5 个\n"
        . "- Instagram instagram：英文文案，hashtag 5-10 个，可加 1-2 个 emoji";

    $userText = "标题：{$title}\n描述：{$desc}";
    $body = json_encode([
        'model' => $cfg['model'],
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => $userText],
        ],
        'response_format' => ['type' => 'json_object'],
        'temperature' => 0.7,
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init($cfg['endpoint']);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $cfg['api_key']],
        CURLOPT_TIMEOUT => 60,
    ]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200) jsonError('AI 调用失败 HTTP ' . $code, 500);
    $data = json_decode((string) $resp, true);
    $content = (string) ($data['choices'][0]['message']['content'] ?? '');
    $parsed = json_decode($content, true);
    if (!is_array($parsed)) jsonError('AI 返回异常', 500);
    jsonOk(['copies' => $parsed]);
}

// ============ 账号矩阵 ============

function handle_listSvAccounts(PDO $pdo, array $input): void
{
    $where = '1=1';
    $params = [];
    if (!empty($input['platform'])) {
        $where .= " AND platform = ?";
        $params[] = $input['platform'];
    }
    $st = $pdo->prepare("SELECT * FROM sv_accounts WHERE {$where} ORDER BY platform, id");
    $st->execute($params);
    jsonOk(['items' => $st->fetchAll()]);
}

function handle_createSvAccount(PDO $pdo, array $input, array $user): void
{
    $platform = (string) ($input['platform'] ?? '');
    if (!in_array($platform, SV_PLATFORMS, true)) jsonError('未知平台');
    $name = trim((string) ($input['account_name'] ?? ''));
    if ($name === '') jsonError('请输入账号名');
    $pdo->prepare("INSERT INTO sv_accounts (platform, account_name, handle, owner_phone, status, followers, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?)")
        ->execute([
            $platform, $name,
            (string) ($input['handle'] ?? ''),
            (string) ($input['owner_phone'] ?? ''),
            (string) ($input['status'] ?? 'active'),
            (int) ($input['followers'] ?? 0),
            (string) ($input['remark'] ?? ''),
        ]);
    jsonOk(['id' => (int) $pdo->lastInsertId()]);
}

function handle_updateSvAccount(PDO $pdo, array $input): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $sets = [];
    $params = [];
    foreach (['platform', 'account_name', 'handle', 'owner_phone', 'status', 'followers', 'remark'] as $f) {
        if (array_key_exists($f, $input)) {
            $sets[] = "{$f} = ?";
            $params[] = $input[$f];
        }
    }
    if (empty($sets)) jsonError('无字段更新');
    $params[] = $id;
    $pdo->prepare("UPDATE sv_accounts SET " . implode(',', $sets) . " WHERE id = ?")->execute($params);
    jsonOk();
}

function handle_deleteSvAccount(PDO $pdo, array $input): void
{
    $pdo->prepare("DELETE FROM sv_accounts WHERE id = ?")->execute([(int) ($input['id'] ?? 0)]);
    jsonOk();
}

// ============ 任务（排期 / 发布） ============

function handle_listSvTasks(PDO $pdo, array $input): void
{
    $where = '1=1';
    $params = [];
    if (!empty($input['asset_id'])) {
        $where .= " AND t.asset_id = ?";
        $params[] = (int) $input['asset_id'];
    }
    if (!empty($input['account_id'])) {
        $where .= " AND t.account_id = ?";
        $params[] = (int) $input['account_id'];
    }
    if (!empty($input['status'])) {
        $where .= " AND t.status = ?";
        $params[] = $input['status'];
    }
    if (!empty($input['start']) && !empty($input['end'])) {
        $where .= " AND t.scheduled_at >= ? AND t.scheduled_at < ?";
        $params[] = $input['start'];
        $params[] = $input['end'];
    }
    $sql = "SELECT t.*,
                   a.title AS asset_title, a.cover_path AS asset_cover, a.video_path AS asset_video,
                   acc.platform, acc.account_name, acc.owner_phone, acc.handle
            FROM sv_tasks t
            LEFT JOIN sv_assets a ON a.id = t.asset_id
            LEFT JOIN sv_accounts acc ON acc.id = t.account_id
            WHERE {$where}
            ORDER BY t.scheduled_at ASC, t.id ASC";
    $st = $pdo->prepare($sql);
    $st->execute($params);
    jsonOk(['items' => $st->fetchAll()]);
}

/**
 * 批量创建任务：素材 × 账号集合 × 时间 → 多条任务
 * 输入：asset_id, account_ids[], scheduled_at, （可选）title/description/tags 覆盖
 */
function handle_createSvTasks(PDO $pdo, array $input, array $user): void
{
    $aid = (int) ($input['asset_id'] ?? 0);
    $accountIds = array_values(array_filter(array_map('intval', $input['account_ids'] ?? [])));
    $sched = (string) ($input['scheduled_at'] ?? '');
    if (!$aid || empty($accountIds) || $sched === '') jsonError('参数缺失');

    $st = $pdo->prepare("SELECT * FROM sv_assets WHERE id = ?");
    $st->execute([$aid]);
    $asset = $st->fetch();
    if (!$asset) jsonError('素材不存在');
    $platformCopies = $asset['platform_copies']
        ? (json_decode($asset['platform_copies'], true) ?: [])
        : [];

    // 拉账号平台映射
    $ph = implode(',', array_fill(0, count($accountIds), '?'));
    $st = $pdo->prepare("SELECT * FROM sv_accounts WHERE id IN ({$ph})");
    $st->execute($accountIds);
    $accMap = [];
    foreach ($st->fetchAll() as $a) $accMap[(int) $a['id']] = $a;

    $insert = $pdo->prepare("INSERT INTO sv_tasks
        (asset_id, account_id, scheduled_at, status, title, description, tags)
        VALUES (?, ?, ?, 'scheduled', ?, ?, ?)");

    $created = 0;
    foreach ($accountIds as $accId) {
        $acc = $accMap[$accId] ?? null;
        if (!$acc) continue;
        $copy = $platformCopies[$acc['platform']] ?? [];
        $title = (string) ($copy['title'] ?? $input['title'] ?? $asset['title']);
        $desc = (string) ($copy['description'] ?? $input['description'] ?? $asset['description']);
        $tags = (string) ($copy['tags'] ?? $input['tags'] ?? $asset['tags']);
        $insert->execute([$aid, $accId, $sched, $title, $desc, $tags]);
        $created++;
    }
    opLog($pdo, 'sv_task', null, 'batch_create', "asset {$aid} → {$created} 账号", (int) $user['id']);
    jsonOk(['created' => $created]);
}

function handle_updateSvTask(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $sets = [];
    $params = [];
    foreach (['scheduled_at', 'status', 'title', 'description', 'tags', 'error', 'external_task_id'] as $f) {
        if (array_key_exists($f, $input)) {
            $sets[] = "{$f} = ?";
            $params[] = $input[$f];
        }
    }
    if (!empty($input['status']) && $input['status'] === 'done') {
        $sets[] = "executed_at = datetime('now','localtime')";
    }
    if (empty($sets)) jsonError('无字段更新');
    $sets[] = "updated_at = datetime('now','localtime')";
    $params[] = $id;
    $pdo->prepare("UPDATE sv_tasks SET " . implode(',', $sets) . " WHERE id = ?")->execute($params);
    jsonOk();
}

function handle_deleteSvTask(PDO $pdo, array $input): void
{
    $pdo->prepare("DELETE FROM sv_tasks WHERE id = ?")->execute([(int) ($input['id'] ?? 0)]);
    jsonOk();
}

function handle_svDashboard(PDO $pdo): void
{
    $stats = [];
    foreach (SV_PLATFORMS as $p) {
        $st = $pdo->prepare("SELECT COUNT(*) FROM sv_accounts WHERE platform = ? AND status = 'active'");
        $st->execute([$p]);
        $stats[$p] = (int) $st->fetchColumn();
    }
    $todayStart = date('Y-m-d 00:00:00');
    $todayEnd = date('Y-m-d 23:59:59');
    $tomorrowEnd = date('Y-m-d 23:59:59', strtotime('+1 day'));
    $taskCounts = [
        'today_total' => (int) $pdo->query("SELECT COUNT(*) FROM sv_tasks WHERE scheduled_at >= '{$todayStart}' AND scheduled_at <= '{$todayEnd}'")->fetchColumn(),
        'today_done' => (int) $pdo->query("SELECT COUNT(*) FROM sv_tasks WHERE scheduled_at >= '{$todayStart}' AND scheduled_at <= '{$todayEnd}' AND status='done'")->fetchColumn(),
        'today_pending' => (int) $pdo->query("SELECT COUNT(*) FROM sv_tasks WHERE scheduled_at >= '{$todayStart}' AND scheduled_at <= '{$todayEnd}' AND status='scheduled'")->fetchColumn(),
        'upcoming_24h' => (int) $pdo->query("SELECT COUNT(*) FROM sv_tasks WHERE scheduled_at >= datetime('now','localtime') AND scheduled_at <= '{$tomorrowEnd}' AND status='scheduled'")->fetchColumn(),
        'overdue' => (int) $pdo->query("SELECT COUNT(*) FROM sv_tasks WHERE scheduled_at < datetime('now','localtime') AND status='scheduled'")->fetchColumn(),
    ];
    jsonOk(['accounts' => $stats, 'tasks' => $taskCounts]);
}
