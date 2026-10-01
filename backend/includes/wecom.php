<?php

/**
 * 企业微信推送（20261001）
 *
 * 走【群机器人 webhook】，不走应用消息：
 * 群机器人在群里点两下就能建，拿到地址填进系统设置即可；
 * 应用消息要进企业微信后台建应用、配可信 IP、管 access_token，
 * 对老板来说是三天起步的事，而这件事今天就要能用。
 *
 * 代价是消息发到群里而不是私聊 —— 用 @手机号 把人点出来，效果够了。
 *
 * 【公开仓库纪律】webhook 地址是凭据，只存 system_settings，
 * 绝不写进代码、注释或 git。
 */

/** 配了 webhook 才算开通 */
function wecomEnabled(PDO $pdo): bool
{
    return trim((string) getSetting($pdo, 'wecom.webhook_url', '')) !== '';
}

/**
 * 发一条文本消息到企业微信群。
 * @param array $mobiles 要 @ 的手机号；传 ['@all'] 可以 @ 所有人
 * @return array ['ok'=>bool, 'msg'=>string]
 */
function wecomSendText(PDO $pdo, string $content, array $mobiles = []): array
{
    $url = trim((string) getSetting($pdo, 'wecom.webhook_url', ''));
    if ($url === '') return ['ok' => false, 'msg' => '还没配置企业微信机器人地址'];
    if (strpos($url, 'qyapi.weixin.qq.com') === false) {
        return ['ok' => false, 'msg' => '这个地址不像企业微信机器人地址（应包含 qyapi.weixin.qq.com）'];
    }
    if (trim($content) === '') return ['ok' => false, 'msg' => '消息内容为空'];

    // 企业微信单条文本上限 2048 字节，超了整条会被拒收
    if (strlen($content) > 1900) $content = mb_substr($content, 0, 600) . "\n…（内容过长已截断，详见系统）";

    $body = ['msgtype' => 'text', 'text' => ['content' => $content]];
    $mobiles = array_values(array_filter(array_map('trim', $mobiles)));
    if ($mobiles) $body['text']['mentioned_mobile_list'] = $mobiles;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
    ]);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($resp === false) return ['ok' => false, 'msg' => '发送失败：' . $err];
    $data = json_decode((string) $resp, true);
    if (!is_array($data)) return ['ok' => false, 'msg' => '企业微信返回异常：' . substr((string) $resp, 0, 120)];
    if ((int) ($data['errcode'] ?? -1) !== 0) {
        // 把企业微信的原始错误带出来，不然排查全靠猜
        return ['ok' => false, 'msg' => '企业微信拒收：' . ($data['errmsg'] ?? '未知') . '（errcode ' . ($data['errcode'] ?? '?') . '）'];
    }
    return ['ok' => true, 'msg' => '已发送'];
}

/** 系统设置里的「测试推送」按钮 */
function handle_wecomTest(PDO $pdo, array $input, array $user): void
{
    if (($user['role'] ?? '') !== 'admin') jsonError('仅管理员可测试推送', 403);
    $r = wecomSendText(
        $pdo,
        "✅ 星选建材 · 企业微信推送测试\n\n收到这条说明配置成功。\n以后进线客户卡住超时，会自动发到这个群并 @ 负责人。",
        []
    );
    if (!$r['ok']) jsonError($r['msg']);
    jsonOk(['msg' => $r['msg']]);
}
