<?php
/**
 * 进线客户超时提醒（20261001，由 cron 每天调用一次）
 *
 * 老板的原话里最后两条 ——「没完成就一直提醒 → 超时主动提醒」——
 * 前一条页面上已经做到了，这一条必须有人主动推，所以有了这个脚本。
 *
 * 用法：
 *   php scripts/lead_remind.php           # 试运行，只打印不发送
 *   php scripts/lead_remind.php --send    # 真正发企业微信
 *
 * 设计取舍：
 * - 一天发一条汇总，不是一个客户一条。十个客户十条消息，群里没人会看。
 * - 按负责人分组并 @ 出来，每个人一眼看到自己欠几笔。
 * - 没有超时的就【不发】。天天发"今日无待办"，三天后这个群就被静音了。
 */

$root = dirname(__DIR__);
require_once $root . '/backend/config/database.php';
require_once $root . '/backend/includes/helpers.php';
require_once $root . '/backend/includes/wecom.php';
require_once $root . '/backend/api/handlers/lead.php';

$send = in_array('--send', $argv, true);

$db = Database::getInstance();
$db->initialize();
$pdo = $db->getConnection();

$overdueDays = _leadOverdueDays($pdo);
$rows = $pdo->query("SELECT l.*, u.name AS owner_name, u.phone AS owner_phone
    FROM leads l LEFT JOIN users u ON u.id = l.owner_id
    WHERE l.status NOT IN ('won','invalid','paused')")->fetchAll();

$byOwner = [];
$mobiles = [];
$total = 0;
foreach ($rows as $r) {
    $p = _leadProgress($pdo, (int) $r['id'], $r, $overdueDays);
    if ($p['finished'] || !$p['overdue']) continue;
    $owner = trim((string) ($r['owner_name'] ?? '')) ?: '未指派负责人';
    $byOwner[$owner][] = sprintf('· %s — %s（卡 %d 天）', $r['name'], $p['todo'], $p['stalled_days']);
    $phone = preg_replace('/\D/', '', (string) ($r['owner_phone'] ?? ''));
    if ($phone !== '') $mobiles[$phone] = true;
    $total++;
}

if ($total === 0) {
    echo "没有超时客户，不发送。\n";
    exit(0);
}

$lines = [
    '🔴 进线客户待办提醒 · ' . date('m-d'),
    '',
    "有 {$total} 个客户卡住超过 {$overdueDays} 天没推进：",
    '',
];
foreach ($byOwner as $owner => $items) {
    $lines[] = $owner . '（' . count($items) . '）';
    foreach ($items as $it) $lines[] = $it;
    $lines[] = '';
}
$lines[] = '打开系统 → 进线跟进 处理。处理完点对应步骤的「完成」，红色提醒会自动消失。';
$content = implode("\n", $lines);

echo $content, "\n\n";
if (!$send) {
    echo "（试运行，没有发送。加 --send 才真正推送）\n";
    exit(0);
}
if (!wecomEnabled($pdo)) {
    echo "未配置企业微信机器人地址，跳过发送。\n";
    exit(0);
}
$r = wecomSendText($pdo, $content, array_keys($mobiles));
echo $r['ok'] ? "已发送。\n" : ('发送失败：' . $r['msg'] . "\n");
exit($r['ok'] ? 0 : 1);
