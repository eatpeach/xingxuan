<?php
/**
 * 入口路由：
 *   /api/handler.php?action=xxx  → 走 api/handler.php
 *   其它访问根路径返回简单首页
 */
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

if (str_starts_with($uri, '/api/handler.php') || $uri === '/api/handler.php') {
    require __DIR__ . '/api/handler.php';
    exit;
}

// 直接 php -S 时静态资源直通
$abs = __DIR__ . $uri;
if ($uri !== '/' && is_file($abs)) {
    return false;
}

header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><meta charset="utf-8"><title>星选建材后台</title>'
   . '<h2 style="font-family:sans-serif">星选建材 后端 API 已启动</h2>'
   . '<p>API 入口：<code>/api/handler.php?action=xxx</code></p>'
   . '<p>前端请见 frontend/ 目录，<code>npm run dev</code> 后访问 http://localhost:5173/</p>';
