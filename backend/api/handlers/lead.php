<?php

/**
 * 进线客户跟进（20261001）
 *
 * 老板的原话：目的不是记录客户，而是
 * 「客户进来了 → 系统留下记录 → 每一步都有状态 → 没完成就一直提醒 → 超时主动提醒 → 每次反馈都有历史」。
 *
 * 所以这个模块的核心不是台账，是【红色待办】：
 * 当前步骤没点完成，这条线索就一直顶在待办里，超过阈值标超时。
 * 待办是**算出来的**，不是存字段 —— 存字段必然和实际步骤对不上（有人改了步骤忘了改待办）。
 */

/** 九步流程的固定文案 */
function _leadSteps(): array
{
    return [
        1 => '客户进线',
        2 => '已了解客户需求',
        3 => '已拿到需求清单/具体规格',
        4 => '报价资料准备完成',
        5 => '报价完成',
        6 => '报价已发送客户',
        7 => '客户已确认收到',
        8 => '已获得客户反馈',
        9 => '已完成下一次跟进',
    ];
}

/** 卡在第 N 步时，红色待办显示什么 */
function _leadTodoText(int $nextStep): string
{
    $map = [
        1 => '待联系客户',
        2 => '待了解客户需求',
        3 => '待获取需求清单',
        4 => '待完成报价',
        5 => '待完成报价',
        6 => '报价完成，待发送客户',
        7 => '已报价，待客户反馈',
        8 => '已报价，待客户反馈',
        9 => '客户暂无反馈，待再次跟进',
    ];
    return $map[$nextStep] ?? '';
}

/** 超时阈值（天）。老板定的是 1 天，可在系统设置改 */
function _leadOverdueDays(PDO $pdo): int
{
    $d = (int) getSetting($pdo, 'lead.overdue_days', '1');
    return $d > 0 ? $d : 1;
}

/**
 * 算出一条线索的进度和待办。
 * 「卡了多久」从**最后一次推进**算起，而不是进线日 —— 昨天刚推进过的不该算超时。
 */
function _leadProgress(PDO $pdo, int $leadId, array $lead, int $overdueDays): array
{
    $st = $pdo->prepare("SELECT step_no, done_at FROM lead_steps WHERE lead_id = ? ORDER BY step_no ASC");
    $st->execute([$leadId]);
    $done = [];
    $lastAt = '';
    foreach ($st->fetchAll() as $r) {
        $done[(int) $r['step_no']] = (string) $r['done_at'];
        if ($r['done_at'] > $lastAt) $lastAt = (string) $r['done_at'];
    }

    // 下一个没完成的步骤 = 当前卡点
    $next = 0;
    for ($i = 1; $i <= 9; $i++) {
        if (!isset($done[$i])) { $next = $i; break; }
    }
    $finished = $next === 0;

    // 没推进过就从进线日算起
    $since = $lastAt !== '' ? $lastAt : ((string) ($lead['lead_date'] ?? '') . ' 00:00:00');
    $stalledDays = 0;
    if (!$finished && $since !== ' 00:00:00') {
        $ts = strtotime($since);
        if ($ts) $stalledDays = (int) floor((time() - $ts) / 86400);
    }

    return [
        'done_steps' => array_keys($done),
        'done_at' => $done,
        'done_count' => count($done),
        'progress' => (int) round(count($done) / 9 * 100),
        'next_step' => $next,
        'finished' => $finished ? 1 : 0,
        'todo' => $finished ? '' : _leadTodoText($next),
        'stalled_days' => $stalledDays,
        'overdue' => (!$finished && $stalledDays >= $overdueDays) ? 1 : 0,
        'last_step_at' => $lastAt,
    ];
}

function handle_listLeads(PDO $pdo, array $input, array $user): void
{
    $where = '1=1';
    $params = [];
    if (!empty($input['keyword'])) {
        $kw = '%' . trim((string) $input['keyword']) . '%';
        $where .= " AND (l.name LIKE ? OR l.contact LIKE ? OR l.demand LIKE ?)";
        array_push($params, $kw, $kw, $kw);
    }
    foreach (['source', 'level', 'status'] as $f) {
        if (!empty($input[$f])) { $where .= " AND l.{$f} = ?"; $params[] = (string) $input[$f]; }
    }
    if (!empty($input['owner_id'])) { $where .= " AND l.owner_id = ?"; $params[] = (int) $input['owner_id']; }
    if (!empty($input['date_from'])) { $where .= " AND l.lead_date >= ?"; $params[] = (string) $input['date_from']; }
    if (!empty($input['date_to'])) { $where .= " AND l.lead_date <= ?"; $params[] = (string) $input['date_to']; }
    // 销售只看自己名下的线索
    if (isSalesScoped($user)) { $where .= " AND l.owner_id = ?"; $params[] = (int) $user['id']; }

    $st = $pdo->prepare("SELECT l.*, u.name AS owner_name, u.username AS owner_username
        FROM leads l LEFT JOIN users u ON u.id = l.owner_id
        WHERE {$where} ORDER BY l.lead_date DESC, l.id DESC");
    $st->execute($params);
    $rows = $st->fetchAll();

    $overdueDays = _leadOverdueDays($pdo);
    $items = [];
    foreach ($rows as $r) {
        $p = _leadProgress($pdo, (int) $r['id'], $r, $overdueDays);
        $items[] = array_merge($r, $p);
    }

    // 「只看有红色待办的」——老板每天开工第一眼要看的就是这个
    if (!empty($input['todo_only'])) {
        $items = array_values(array_filter($items, fn ($x) => $x['finished'] === 0));
    }
    if (!empty($input['overdue_only'])) {
        $items = array_values(array_filter($items, fn ($x) => $x['overdue'] === 1));
    }

    jsonOk(['items' => $items, 'total' => count($items), 'overdue_days' => $overdueDays]);
}

function handle_getLead(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT l.*, u.name AS owner_name FROM leads l
        LEFT JOIN users u ON u.id = l.owner_id WHERE l.id = ?");
    $st->execute([$id]);
    $lead = $st->fetch();
    if (!$lead) jsonError('线索不存在', 404);
    if (isSalesScoped($user) && (int) $lead['owner_id'] !== (int) $user['id']) {
        jsonError('这条线索不属于你', 403);
    }

    $p = _leadProgress($pdo, $id, $lead, _leadOverdueDays($pdo));

    $st = $pdo->prepare("SELECT f.*, u.name AS created_by_name FROM lead_follows f
        LEFT JOIN users u ON u.id = f.created_by
        WHERE f.lead_id = ? ORDER BY f.id DESC");
    $st->execute([$id]);

    jsonOk([
        'data' => array_merge($lead, $p),
        'steps' => _leadSteps(),
        'follows' => $st->fetchAll(),
    ]);
}

function handle_saveLead(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') jsonError('请填写客户名称');

    $fields = [
        'lead_date' => (string) ($input['lead_date'] ?? date('Y-m-d')),
        'name' => $name,
        'contact' => (string) ($input['contact'] ?? ''),
        'source' => (string) ($input['source'] ?? ''),
        'level' => (string) ($input['level'] ?? 'normal'),
        'demand' => (string) ($input['demand'] ?? ''),
        'demand_list' => (string) ($input['demand_list'] ?? ''),
        'status' => (string) ($input['status'] ?? 'new'),
        'next_follow_at' => (string) ($input['next_follow_at'] ?? ''),
        'remark' => (string) ($input['remark'] ?? ''),
    ];
    // 销售只能把线索挂自己名下，不能塞给别人
    $fields['owner_id'] = isSalesScoped($user)
        ? (int) $user['id']
        : (int) ($input['owner_id'] ?? $user['id']);

    if ($id) {
        $st = $pdo->prepare("SELECT owner_id FROM leads WHERE id = ?");
        $st->execute([$id]);
        $cur = $st->fetch();
        if (!$cur) jsonError('线索不存在', 404);
        if (isSalesScoped($user) && (int) $cur['owner_id'] !== (int) $user['id']) {
            jsonError('这条线索不属于你', 403);
        }
        $sets = implode(', ', array_map(fn ($k) => "{$k} = ?", array_keys($fields)));
        $st = $pdo->prepare("UPDATE leads SET {$sets}, updated_at = datetime('now','localtime') WHERE id = ?");
        $st->execute(array_merge(array_values($fields), [$id]));
        opLog($pdo, 'lead', $id, 'update', $name, (int) $user['id']);
        jsonOk(['id' => $id]);
    }

    $cols = implode(', ', array_keys($fields));
    $ph = implode(', ', array_fill(0, count($fields), '?'));
    $st = $pdo->prepare("INSERT INTO leads ({$cols}, created_by) VALUES ({$ph}, ?)");
    $st->execute(array_merge(array_values($fields), [(int) $user['id']]));
    $newId = (int) $pdo->lastInsertId();

    // 建档即第 ① 步完成 —— 客户已经进线了，不该让人再点一次
    $pdo->prepare("INSERT OR IGNORE INTO lead_steps (lead_id, step_no, done_by) VALUES (?, 1, ?)")
        ->execute([$newId, (int) $user['id']]);

    opLog($pdo, 'lead', $newId, 'create', $name, (int) $user['id']);
    jsonOk(['id' => $newId]);
}

function handle_deleteLead(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT owner_id, name FROM leads WHERE id = ?");
    $st->execute([$id]);
    $lead = $st->fetch();
    if (!$lead) jsonError('线索不存在', 404);
    if (isSalesScoped($user) && (int) $lead['owner_id'] !== (int) $user['id']) {
        jsonError('这条线索不属于你', 403);
    }
    $pdo->prepare("DELETE FROM leads WHERE id = ?")->execute([$id]);
    opLog($pdo, 'lead', $id, 'delete', (string) $lead['name'], (int) $user['id']);
    jsonOk();
}

/**
 * 点完成某一步。
 * 自动补齐前面的步骤：直接点第 ⑤ 步，说明 ②③④ 实际上已经做了，
 * 不该逼人回头补点四次 —— 那种表没人会好好填。
 */
function handle_completeLeadStep(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $step = (int) ($input['step_no'] ?? 0);
    if (!$id || $step < 1 || $step > 9) jsonError('参数错误');

    $st = $pdo->prepare("SELECT owner_id, name FROM leads WHERE id = ?");
    $st->execute([$id]);
    $lead = $st->fetch();
    if (!$lead) jsonError('线索不存在', 404);
    if (isSalesScoped($user) && (int) $lead['owner_id'] !== (int) $user['id']) {
        jsonError('这条线索不属于你', 403);
    }

    $ins = $pdo->prepare("INSERT OR IGNORE INTO lead_steps (lead_id, step_no, done_by) VALUES (?, ?, ?)");
    for ($i = 1; $i <= $step; $i++) $ins->execute([$id, $i, (int) $user['id']]);

    // 状态跟着步骤自动走，不用人再选一次
    $statusByStep = [1 => 'new', 2 => 'understanding', 3 => 'wait_list', 4 => 'wait_quote',
        5 => 'wait_quote', 6 => 'quoted', 7 => 'wait_feedback', 8 => 'wait_feedback', 9 => 'following'];
    $newStatus = $step >= 9 ? 'following' : ($statusByStep[$step + 1] ?? 'following');
    $pdo->prepare("UPDATE leads SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        ->execute([$newStatus, $id]);

    opLog($pdo, 'lead', $id, 'step_done', "第{$step}步 " . (_leadSteps()[$step] ?? ''), (int) $user['id']);
    jsonOk(_leadProgress($pdo, $id, ['lead_date' => ''], _leadOverdueDays($pdo)));
}

/** 点错了要能撤销：撤销这一步连同它之后的所有步骤 */
function handle_undoLeadStep(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['id'] ?? 0);
    $step = (int) ($input['step_no'] ?? 0);
    if (!$id || $step < 1 || $step > 9) jsonError('参数错误');

    $st = $pdo->prepare("SELECT owner_id FROM leads WHERE id = ?");
    $st->execute([$id]);
    $lead = $st->fetch();
    if (!$lead) jsonError('线索不存在', 404);
    if (isSalesScoped($user) && (int) $lead['owner_id'] !== (int) $user['id']) {
        jsonError('这条线索不属于你', 403);
    }
    // 第 ③ 步撤了，④⑤⑥ 就不可能还成立
    $pdo->prepare("DELETE FROM lead_steps WHERE lead_id = ? AND step_no >= ?")->execute([$id, $step]);
    opLog($pdo, 'lead', $id, 'step_undo', "撤销第{$step}步及之后", (int) $user['id']);
    jsonOk(_leadProgress($pdo, $id, ['lead_date' => ''], _leadOverdueDays($pdo)));
}

/** 新增一条跟进记录。只增不改 —— 历史被覆盖就看不出这单怎么走到今天的 */
function handle_addLeadFollow(PDO $pdo, array $input, array $user): void
{
    $id = (int) ($input['lead_id'] ?? 0);
    $content = trim((string) ($input['content'] ?? ''));
    if (!$id || $content === '') jsonError('请填写跟进内容');

    $st = $pdo->prepare("SELECT owner_id FROM leads WHERE id = ?");
    $st->execute([$id]);
    $lead = $st->fetch();
    if (!$lead) jsonError('线索不存在', 404);
    if (isSalesScoped($user) && (int) $lead['owner_id'] !== (int) $user['id']) {
        jsonError('这条线索不属于你', 403);
    }

    $pdo->prepare("INSERT INTO lead_follows (lead_id, content, created_by) VALUES (?, ?, ?)")
        ->execute([$id, $content, (int) $user['id']]);
    // 记了跟进就顺手更新下次跟进日期
    if (!empty($input['next_follow_at'])) {
        $pdo->prepare("UPDATE leads SET next_follow_at = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            ->execute([(string) $input['next_follow_at'], $id]);
    }
    opLog($pdo, 'lead', $id, 'follow', mb_substr($content, 0, 40), (int) $user['id']);
    jsonOk(['id' => (int) $pdo->lastInsertId()]);
}

/** 顶部统计：今日/本月进线、各状态计数、超时数、按来源 */
function handle_leadStats(PDO $pdo, array $input, array $user): void
{
    $scope = isSalesScoped($user) ? ' AND l.owner_id = ' . (int) $user['id'] : '';
    $today = date('Y-m-d');
    $monthStart = date('Y-m-01');

    $q = fn (string $sql) => (int) $pdo->query($sql)->fetchColumn();
    $todayIn = $q("SELECT COUNT(*) FROM leads l WHERE l.lead_date = '{$today}'{$scope}");
    $monthIn = $q("SELECT COUNT(*) FROM leads l WHERE l.lead_date >= '{$monthStart}'{$scope}");
    $precise = $q("SELECT COUNT(*) FROM leads l WHERE l.level = 'precise'{$scope}");
    $won = $q("SELECT COUNT(*) FROM leads l WHERE l.status = 'won'{$scope}");

    // 待报价/已报价/待反馈按【实际步骤】算，不按 status —— status 可能被人手改歪
    $st = $pdo->query("SELECT l.id, l.lead_date, l.source, l.level, l.status FROM leads l WHERE 1=1{$scope}");
    $overdueDays = _leadOverdueDays($pdo);
    $waitQuote = $waitSend = $waitFeedback = $overdue = $todoTotal = 0;
    $bySource = [];
    foreach ($st->fetchAll() as $r) {
        $p = _leadProgress($pdo, (int) $r['id'], $r, $overdueDays);
        if (!$p['finished']) {
            $todoTotal++;
            if ($p['overdue']) $overdue++;
            if ($p['next_step'] <= 5) $waitQuote++;
            elseif ($p['next_step'] === 6) $waitSend++;
            else $waitFeedback++;
        }
        $src = (string) ($r['source'] ?: 'other');
        if (!isset($bySource[$src])) $bySource[$src] = ['source' => $src, 'total' => 0, 'precise' => 0, 'won' => 0];
        $bySource[$src]['total']++;
        if ($r['level'] === 'precise') $bySource[$src]['precise']++;
        if ($r['status'] === 'won') $bySource[$src]['won']++;
    }

    jsonOk([
        'today_in' => $todayIn,
        'month_in' => $monthIn,
        'precise' => $precise,
        'wait_quote' => $waitQuote,
        'wait_send' => $waitSend,
        'wait_feedback' => $waitFeedback,
        'won' => $won,
        'overdue' => $overdue,
        'todo_total' => $todoTotal,
        'by_source' => array_values($bySource),
        'overdue_days' => $overdueDays,
    ]);
}
