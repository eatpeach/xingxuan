<?php
/**
 * 日历事件 + 工作日记
 * 数据按 user_id 隔离。每个用户只看自己。
 */

const _CAL_CATEGORIES = ['visit', 'follow', 'meeting', 'other'];

function _normCategory(string $c): string
{
    return in_array($c, _CAL_CATEGORIES, true) ? $c : 'other';
}

// ---------------- 日历事件 ----------------

function handle_listCalendarEvents(PDO $pdo, array $input, array $user): void
{
    $uid = (int) ($user['id'] ?? 0);
    $start = (string) ($input['start'] ?? '');
    $end = (string) ($input['end'] ?? '');
    if (!$start || !$end) jsonError('需要 start 和 end 参数');

    $st = $pdo->prepare("SELECT * FROM calendar_events
        WHERE user_id = ? AND start_at < ? AND COALESCE(end_at, start_at) >= ?
        ORDER BY start_at ASC, id ASC");
    $st->execute([$uid, $end, $start]);
    jsonOk(['items' => $st->fetchAll()]);
}

function handle_createCalendarEvent(PDO $pdo, array $input, array $user): void
{
    $uid = (int) ($user['id'] ?? 0);
    $title = trim((string) ($input['title'] ?? ''));
    if ($title === '') jsonError('请输入标题');
    if (mb_strlen($title) > 200) jsonError('标题过长（最多 200 字）');

    $startAt = trim((string) ($input['start_at'] ?? ''));
    if ($startAt === '') jsonError('请选择开始时间');
    $endAt = !empty($input['end_at']) ? (string) $input['end_at'] : null;
    $allDay = !empty($input['all_day']) ? 1 : 0;
    $category = _normCategory((string) ($input['category'] ?? 'other'));
    $description = (string) ($input['description'] ?? '');
    if (mb_strlen($description) > 2000) jsonError('描述过长（最多 2000 字）');

    $st = $pdo->prepare("INSERT INTO calendar_events
        (user_id, title, description, start_at, end_at, all_day, category)
        VALUES (?, ?, ?, ?, ?, ?, ?)");
    $st->execute([$uid, $title, $description, $startAt, $endAt, $allDay, $category]);
    jsonOk(['id' => (int) $pdo->lastInsertId()]);
}

function handle_updateCalendarEvent(PDO $pdo, array $input, array $user): void
{
    $uid = (int) ($user['id'] ?? 0);
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');

    $st = $pdo->prepare("SELECT user_id FROM calendar_events WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('事件不存在', 404);
    if ((int) $row['user_id'] !== $uid && ($user['role'] ?? '') !== 'admin') {
        jsonError('无权修改他人事件', 403);
    }

    $title = trim((string) ($input['title'] ?? ''));
    if ($title === '') jsonError('请输入标题');
    $startAt = trim((string) ($input['start_at'] ?? ''));
    if ($startAt === '') jsonError('请选择开始时间');
    $endAt = !empty($input['end_at']) ? (string) $input['end_at'] : null;
    $allDay = !empty($input['all_day']) ? 1 : 0;
    $category = _normCategory((string) ($input['category'] ?? 'other'));
    $description = (string) ($input['description'] ?? '');

    $st = $pdo->prepare("UPDATE calendar_events
        SET title=?, description=?, start_at=?, end_at=?, all_day=?, category=?,
            updated_at=datetime('now','localtime')
        WHERE id = ?");
    $st->execute([$title, $description, $startAt, $endAt, $allDay, $category, $id]);
    jsonOk();
}

function handle_deleteCalendarEvent(PDO $pdo, array $input, array $user): void
{
    $uid = (int) ($user['id'] ?? 0);
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');
    $st = $pdo->prepare("SELECT user_id FROM calendar_events WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('事件不存在', 404);
    if ((int) $row['user_id'] !== $uid && ($user['role'] ?? '') !== 'admin') {
        jsonError('无权删除', 403);
    }
    $pdo->prepare("DELETE FROM calendar_events WHERE id = ?")->execute([$id]);
    jsonOk();
}

// ---------------- 工作日记 ----------------

function handle_getDiary(PDO $pdo, array $input, array $user): void
{
    $uid = (int) ($user['id'] ?? 0);
    $date = trim((string) ($input['date'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) jsonError('日期格式应为 YYYY-MM-DD');
    $st = $pdo->prepare("SELECT * FROM diary_entries WHERE user_id = ? AND date = ?");
    $st->execute([$uid, $date]);
    $row = $st->fetch();
    jsonOk(['data' => $row ?: null]);
}

function handle_saveDiary(PDO $pdo, array $input, array $user): void
{
    $uid = (int) ($user['id'] ?? 0);
    $date = trim((string) ($input['date'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) jsonError('日期格式应为 YYYY-MM-DD');
    $content = (string) ($input['content'] ?? '');
    if (mb_strlen($content) > 50000) jsonError('内容过长（最多 50000 字）');

    if (trim($content) === '') {
        // 空内容：直接删除（保持表干净）
        $pdo->prepare("DELETE FROM diary_entries WHERE user_id = ? AND date = ?")
            ->execute([$uid, $date]);
        jsonOk(['deleted' => true]);
        return;
    }

    $st = $pdo->prepare("INSERT INTO diary_entries (user_id, date, content)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET content=excluded.content,
        updated_at=datetime('now','localtime')");
    $st->execute([$uid, $date, $content]);
    jsonOk();
}

function handle_listDiaryEntries(PDO $pdo, array $input, array $user): void
{
    $uid = (int) ($user['id'] ?? 0);
    $start = (string) ($input['start'] ?? '');
    $end = (string) ($input['end'] ?? '');
    if (!$start || !$end) jsonError('需要 start 和 end 参数');
    $st = $pdo->prepare("SELECT date, substr(content, 1, 100) as preview, length(content) as len, updated_at
        FROM diary_entries WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date DESC");
    $st->execute([$uid, $start, $end]);
    jsonOk(['items' => $st->fetchAll()]);
}
