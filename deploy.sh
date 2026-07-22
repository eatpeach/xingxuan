#!/usr/bin/env bash
# 星选建材 一键部署脚本（在服务器项目根目录跑：bash deploy.sh）
# 前端 dist 已经随仓库一起推过来，无需服务器再 npm install / build

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "[1/4] git pull 拉最新代码..."
git pull --ff-only

echo "[2/4] 检查前端 dist 是否就位..."
if [ ! -f "frontend/dist/index.html" ]; then
    echo "  ✗ frontend/dist/index.html 不存在！"
    echo "  说明本地忘记 npm run build 后再 push。"
    echo "  本地执行：cd frontend && npm run build && cd .. && git add frontend/dist && git commit -m 'build dist' && git push"
    exit 1
fi
echo "  ✓ dist OK"

echo "[3/4] 修正后端写权限（SQLite + 上传目录）..."
chown -R www:www backend/data backend/storage 2>/dev/null || true
chmod -R 775 backend/data backend/storage
echo "  ✓ www 用户可写"

echo "[4/5] 重载 nginx..."
nginx -t && (systemctl reload nginx || /etc/init.d/nginx reload)
echo "  ✓ nginx reloaded"

echo "[5/5] 重启 PHP-FPM（清 OPcache，防止旧 handler.php 报『未知 action』）..."
RESTARTED=0
for svc in php-fpm php-fpm-84 php-fpm-83 php-fpm-82 php-fpm-81 php-fpm-80 php-fpm-74; do
    if systemctl restart "$svc" 2>/dev/null || /etc/init.d/"$svc" restart >/dev/null 2>&1; then
        echo "  ✓ $svc restarted"
        RESTARTED=1
        break
    fi
done
[ "$RESTARTED" = "1" ] || echo "  ⚠ 未找到 php-fpm 服务，请在宝塔面板手动重启 PHP"

echo ""
echo "部署完成。访问：https://$(grep -m1 server_name /www/server/panel/vhost/nginx/*.conf 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';' || echo 'your-domain')"
