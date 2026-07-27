<?php

/** 首页横幅幻灯片：公开读取 + 后台管理（上传图/链接/排序/启停/删除） */

function handle_shelfBanners(PDO $pdo): void
{
    $rows = $pdo->query("SELECT id, image_path, link_url FROM banners
        WHERE is_active = 1 AND image_path != '' ORDER BY sort_weight DESC, id ASC")->fetchAll();
    $items = array_map(function ($r) {
        $rel = ltrim($r['image_path'], '/');
        // 带 mtime 版本号：同名换图后 URL 变化，绕开 30 天强缓存
        $mt = @filemtime(__DIR__ . '/../../storage/' . $rel);
        return [
            'id' => (int) $r['id'],
            'image_url' => '/storage/' . $rel . ($mt ? '?v=' . $mt : ''),
            'link_url' => (string) $r['link_url'],
        ];
    }, $rows);
    jsonOk(['items' => $items]);
}

function handle_adminListBanners(PDO $pdo, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可管理横幅', 403);
    $rows = $pdo->query("SELECT * FROM banners ORDER BY sort_weight DESC, id ASC")->fetchAll();
    $items = array_map(fn($r) => [
        'id' => (int) $r['id'],
        'image_path' => (string) $r['image_path'],
        'image_url' => $r['image_path'] ? '/storage/' . ltrim($r['image_path'], '/') : '',
        'link_url' => (string) $r['link_url'],
        'sort_weight' => (int) $r['sort_weight'],
        'is_active' => (int) $r['is_active'],
    ], $rows);
    jsonOk(['items' => $items]);
}

function handle_uploadBannerImage(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可上传', 403);
    if (empty($_FILES['file'])) jsonError('请选择图片');
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) jsonError('上传失败，请重试');
    if ($f['size'] > 8 * 1024 * 1024) jsonError('图片不能超过 8MB');
    $mime = _aiDetectMime($f['tmp_name'], $f['name']);
    $extMap = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($extMap[$mime])) jsonError('仅支持 JPG / PNG / WebP 图片');
    $dir = __DIR__ . '/../../storage/banner';
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    $fname = date('YmdHis') . '_' . substr(md5($f['name'] . microtime(true)), 0, 8) . '.' . $extMap[$mime];
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) jsonError('保存失败', 500);
    jsonOk(['path' => 'banner/' . $fname, 'url' => '/storage/banner/' . $fname]);
}

function handle_saveBanner(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可管理横幅', 403);
    $id = (int) ($input['id'] ?? 0);
    $imagePath = trim((string) ($input['image_path'] ?? ''));
    $linkUrl = trim((string) ($input['link_url'] ?? ''));
    $isActive = isset($input['is_active']) ? (int) !!$input['is_active'] : 1;

    if ($id > 0) {
        $st = $pdo->prepare("SELECT id FROM banners WHERE id = ?");
        $st->execute([$id]);
        if (!$st->fetchColumn()) jsonError('横幅不存在', 404);
        $sets = ['link_url = ?', 'is_active = ?'];
        $vals = [$linkUrl, $isActive];
        if ($imagePath !== '') {
            $sets[] = 'image_path = ?';
            $vals[] = $imagePath;
        }
        $vals[] = $id;
        $pdo->prepare("UPDATE banners SET " . implode(', ', $sets) . " WHERE id = ?")->execute($vals);
        opLog($pdo, 'banner', $id, 'update', '', (int) $user['id']);
        jsonOk(['id' => $id]);
    }

    if ($imagePath === '') jsonError('请先上传横幅图片');
    $maxW = (int) $pdo->query("SELECT COALESCE(MAX(sort_weight), 0) FROM banners")->fetchColumn();
    $pdo->prepare("INSERT INTO banners (image_path, link_url, sort_weight, is_active) VALUES (?, ?, ?, ?)")
        ->execute([$imagePath, $linkUrl, $maxW + 1, $isActive]);
    $nid = (int) $pdo->lastInsertId();
    opLog($pdo, 'banner', $nid, 'create', '', (int) $user['id']);
    jsonOk(['id' => $nid]);
}

function handle_moveBanner(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可管理横幅', 403);
    $id = (int) ($input['id'] ?? 0);
    $dir = (string) ($input['direction'] ?? 'up');
    $st = $pdo->prepare("SELECT * FROM banners WHERE id = ?");
    $st->execute([$id]);
    $cur = $st->fetch();
    if (!$cur) jsonError('横幅不存在', 404);
    $cmp = $dir === 'up' ? '>' : '<';
    $ord = $dir === 'up' ? 'ASC' : 'DESC';
    $st = $pdo->query("SELECT * FROM banners WHERE sort_weight {$cmp} {$cur['sort_weight']}
        OR (sort_weight = {$cur['sort_weight']} AND id " . ($dir === 'up' ? '<' : '>') . " {$cur['id']})
        ORDER BY sort_weight {$ord}, id " . ($dir === 'up' ? 'DESC' : 'ASC') . " LIMIT 1");
    $other = $st->fetch();
    if (!$other) jsonOk();
    $a = (int) $cur['sort_weight'];
    $b = (int) $other['sort_weight'];
    if ($a === $b) $b = $dir === 'up' ? $a + 1 : $a - 1;
    $pdo->prepare("UPDATE banners SET sort_weight = ? WHERE id = ?")->execute([$b, (int) $cur['id']]);
    if ($a !== (int) $other['sort_weight']) {
        $pdo->prepare("UPDATE banners SET sort_weight = ? WHERE id = ?")->execute([$a, (int) $other['id']]);
    }
    jsonOk();
}

function handle_deleteBanner(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可管理横幅', 403);
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT image_path FROM banners WHERE id = ?");
    $st->execute([$id]);
    $b = $st->fetch();
    if (!$b) jsonError('横幅不存在', 404);
    $pdo->prepare("DELETE FROM banners WHERE id = ?")->execute([$id]);
    if ($b['image_path'] && strpos($b['image_path'], 'banner/') === 0) {
        @unlink(__DIR__ . '/../../storage/' . $b['image_path']);
    }
    opLog($pdo, 'banner', $id, 'delete', '', (int) $user['id']);
    jsonOk();
}
