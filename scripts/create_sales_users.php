<?php
/**
 * 批量建员工账号（命令行版，20260825）
 *
 * 后台「系统设置 → 账户管理 → 批量开账号」是同一套规则的界面版；
 * 这个脚本是给「服务器上一次性建好、把清单打印出来」用的 ——
 * 老板不想点界面时，部署完直接跑这一条就行。
 *
 * 用法：
 *   php scripts/create_sales_users.php 曦冉 周洁 雨露 露雨            # 试运行，只看会生成什么
 *   php scripts/create_sales_users.php --apply 曦冉 周洁 雨露 露雨    # 真正写库
 *   php scripts/create_sales_users.php --apply --role=ops 张三        # 换角色
 *
 * 规则与供应商门户一致：
 *   用户名 = 名字拼音（重名自动加数字）
 *   密码   = 随机好读密码（无 0/1/O/l），首次登录强制改
 *
 * 🔴 密码只在本次运行的输出里出现。库里存 bcrypt，另存一份 initial_pwd 供
 *    「忘密码时老板能当场告知」，本人改密后自动清空。
 *    **不要把输出粘到任何文件、任何仓库里**（本仓库是公开仓库）。
 */

$root = dirname(__DIR__);
require_once $root . '/backend/config/database.php';
require_once $root . '/backend/includes/pinyin.php';

$args = array_slice($argv, 1);
$apply = false;
$role = 'sales';
$names = [];
foreach ($args as $a) {
    if ($a === '--apply') { $apply = true; continue; }
    if (strpos($a, '--role=') === 0) { $role = substr($a, 7); continue; }
    if (strpos($a, '--') === 0) continue;
    $a = trim($a);
    if ($a !== '') $names[] = $a;
}
if (!$names) {
    fwrite(STDERR, "用法：php scripts/create_sales_users.php [--apply] [--role=sales] 姓名1 姓名2 ...\n");
    exit(1);
}
if (!in_array($role, ['sales', 'ops', 'finance', 'legal'], true)) {
    fwrite(STDERR, "role 只能是 sales / ops / finance / legal\n");
    exit(1);
}

$pdo = Database::getInstance()->getConnection();

function readablePassword(): string
{
    $cons = ['b', 'd', 'f', 'g', 'h', 'j', 'k', 'm', 'n', 'p', 'r', 's', 't', 'w', 'z'];
    $vows = ['a', 'e', 'u', 'o'];
    $s = '';
    for ($i = 0; $i < 2; $i++) {
        $s .= $cons[random_int(0, count($cons) - 1)] . $vows[random_int(0, count($vows) - 1)];
    }
    for ($i = 0; $i < 4; $i++) $s .= (string) random_int(2, 9);
    return $s;
}

$taken = [];
foreach ($pdo->query("SELECT username FROM users")->fetchAll(PDO::FETCH_COLUMN) as $u) {
    $taken[strtolower((string) $u)] = 1;
}

$plan = [];
foreach ($names as $name) {
    $base = preg_replace('/[^a-z0-9]/', '', strtolower(hanziToPinyin($name)));
    if ($base === '') $base = 'user';
    if (strlen($base) < 2) $base .= 'x';
    $try = $base;
    $n = 1;
    while (isset($taken[strtolower($try)])) { $n++; $try = $base . $n; }
    $taken[strtolower($try)] = 1;
    $plan[] = ['name' => $name, 'username' => $try, 'password' => readablePassword()];
}

echo "\n";
echo $apply ? "== 已创建 ==\n" : "== 试运行（加 --apply 才真正写库）==\n";
printf("%-10s %-16s %-12s %s\n", '姓名', '账号', '密码', '角色');
echo str_repeat('-', 56), "\n";

if ($apply) {
    $ins = $pdo->prepare("INSERT INTO users (username, password_hash, name, role, phone, initial_pwd, must_change_pwd)
        VALUES (?, ?, ?, ?, '', ?, 1)");
    $pdo->beginTransaction();
    try {
        foreach ($plan as $p) {
            $ins->execute([$p['username'], password_hash($p['password'], PASSWORD_BCRYPT), $p['name'], $role, $p['password']]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fwrite(STDERR, "创建失败：" . $e->getMessage() . "\n");
        exit(1);
    }
}

foreach ($plan as $p) {
    printf("%-10s %-16s %-12s %s\n", $p['name'], $p['username'], $p['password'], $role);
}
echo str_repeat('-', 56), "\n";
echo "登录地址：/login（首次登录会强制改密码）\n";
if (!$apply) echo "\n以上是试运行结果，重新加 --apply 才会真正建号（密码会重新随机）。\n";
echo "\n";
