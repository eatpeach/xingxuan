<?php
/**
 * 每日金额对账（20261113）：报价单 / 订单 / 发票三处金额对不上的单全部列出来。
 * 有异常时发企业微信群（系统设置里配了群机器人才发），并以退出码 1 结束。
 *
 * 服务器 crontab：每天 9:00
 *   0 9 * * * cd /www/wwwroot/www.xingxuan.cc && /usr/bin/php scripts/money_audit.php --send >> backend/storage/money_audit.log 2>&1
 * 手动看一眼：php scripts/money_audit.php
 */
if (PHP_SAPI !== 'cli') exit;
$send = in_array('--send', $argv ?? [], true);

require __DIR__ . '/../backend/config/database.php';
require __DIR__ . '/../backend/includes/helpers.php';
require __DIR__ . '/../backend/includes/wecom.php';
require __DIR__ . '/../backend/includes/freight.php';
require __DIR__ . '/../backend/includes/money_audit.php';
$pdo = Database::getInstance()->getConnection();

$issues = moneyAudit($pdo);
echo '[' . date('Y-m-d H:i:s') . '] 金额对账：' . (count($issues) ? count($issues) . ' 处对不上' : '全部一致') . "\n";
foreach ($issues as $i) {
    echo "  {$i['quote_no']} {$i['customer']}：{$i['message']}\n";
}
if ($issues && $send && wecomEnabled($pdo)) {
    $lines = array_map(fn ($i) => "· {$i['quote_no']} {$i['customer']}：{$i['message']}", array_slice($issues, 0, 15));
    $msg = "【金额对账异常】发现 " . count($issues) . " 处报价 / 订单 / 发票金额对不上，相关单据已禁止导出，请尽快处理：\n"
        . implode("\n", $lines) . (count($issues) > 15 ? "\n…还有 " . (count($issues) - 15) . " 处，详见后台工作台" : '');
    wecomSendText($pdo, $msg);
}
exit($issues ? 1 : 0);
