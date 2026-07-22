<?php
/**
 * 工作计划（参考 BantuCRM 工作计划：按天 + 四象限 + 完成勾选）
 * 数据按 user_id 隔离，admin 可改他人。
 */

// 列出某日期区间的计划（start / end 均为 YYYY-MM-DD，含端点）
function handle_listWorkPlans(PDO $pdo, array $input, array $user): void
{
    $uid = (int) ($user['id'] ?? 0);
    $start = trim((string) ($input['start'] ?? ''));
    $end = trim((string) ($input['end'] ?? ''));
    if (!$start || !$end) jsonError('需要 start 和 end 参数');

    $st = $pdo->prepare("SELECT w.*, c.name AS customer_name, c.short_name AS customer_short_name
        FROM work_plans w
        LEFT JOIN customers c ON c.id = w.customer_id
        WHERE w.user_id = ? AND w.plan_date >= ? AND w.plan_date <= ?
        ORDER BY w.plan_date ASC, w.status DESC, w.quadrant ASC, w.id ASC");
    $st->execute([$uid, $start, $end]);
    jsonOk(['items' => $st->fetchAll()]);
}

// 新建 / 编辑（带 id 为编辑）
function handle_saveWorkPlan(PDO $pdo, array $input, array $user): void
{
    $uid = (int) ($user['id'] ?? 0);
    $id = (int) ($input['id'] ?? 0);

    $title = trim((string) ($input['title'] ?? ''));
    if ($title === '') jsonError('请输入计划内容');
    if (mb_strlen($title) > 200) jsonError('内容过长（最多 200 字）');
    $planDate = trim((string) ($input['plan_date'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $planDate)) jsonError('日期格式错误');
    $quadrant = (int) ($input['quadrant'] ?? 2);
    if ($quadrant < 1 || $quadrant > 4) $quadrant = 2;
    $customerId = (int) ($input['customer_id'] ?? 0);
    $remark = (string) ($input['remark'] ?? '');
    if (mb_strlen($remark) > 2000) jsonError('备注过长（最多 2000 字）');

    if ($id) {
        $st = $pdo->prepare("SELECT user_id FROM work_plans WHERE id = ?");
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) jsonError('计划不存在', 404);
        if ((int) $row['user_id'] !== $uid && ($user['role'] ?? '') !== 'admin') {
            jsonError('无权修改他人计划', 403);
        }
        $st = $pdo->prepare("UPDATE work_plans
            SET title=?, plan_date=?, quadrant=?, customer_id=?, remark=?,
                updated_at=datetime('now','localtime')
            WHERE id = ?");
        $st->execute([$title, $planDate, $quadrant, $customerId, $remark, $id]);
        jsonOk(['id' => $id]);
    }

    $st = $pdo->prepare("INSERT INTO work_plans (user_id, plan_date, title, quadrant, customer_id, remark)
        VALUES (?, ?, ?, ?, ?, ?)");
    $st->execute([$uid, $planDate, $title, $quadrant, $customerId, $remark]);
    jsonOk(['id' => (int) $pdo->lastInsertId()]);
}

function handle_deleteWorkPlan(PDO $pdo, array $input, array $user): void
{
    $uid = (int) ($user['id'] ?? 0);
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');

    $st = $pdo->prepare("SELECT user_id FROM work_plans WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('计划不存在', 404);
    if ((int) $row['user_id'] !== $uid && ($user['role'] ?? '') !== 'admin') {
        jsonError('无权删除他人计划', 403);
    }
    $pdo->prepare("DELETE FROM work_plans WHERE id = ?")->execute([$id]);
    jsonOk();
}

// 勾选完成 / 取消完成
function handle_toggleWorkPlanDone(PDO $pdo, array $input, array $user): void
{
    $uid = (int) ($user['id'] ?? 0);
    $id = (int) ($input['id'] ?? 0);
    if (!$id) jsonError('参数缺失');

    $st = $pdo->prepare("SELECT user_id, status FROM work_plans WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) jsonError('计划不存在', 404);
    if ((int) $row['user_id'] !== $uid && ($user['role'] ?? '') !== 'admin') {
        jsonError('无权操作他人计划', 403);
    }

    if ($row['status'] === 'done') {
        $pdo->prepare("UPDATE work_plans SET status='pending', done_at=NULL,
            updated_at=datetime('now','localtime') WHERE id = ?")->execute([$id]);
        jsonOk(['status' => 'pending']);
    }
    $pdo->prepare("UPDATE work_plans SET status='done', done_at=datetime('now','localtime'),
        updated_at=datetime('now','localtime') WHERE id = ?")->execute([$id]);
    jsonOk(['status' => 'done']);
}
