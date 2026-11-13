#!/usr/bin/env bash
# 星选建材 一键部署脚本（在服务器项目根目录跑：bash deploy.sh）
# 前端 dist 已经随仓库一起推过来，无需服务器再 npm install / build

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "[0/6] 上线前自动测试（在临时目录跑新代码，不碰正式库；不通过就不上线）..."
git fetch -q origin
TEST_DIR="$(mktemp -d)"
git archive "$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo origin/main)" backend | tar -x -C "$TEST_DIR"
mkdir -p "$TEST_DIR/backend/data"
if [ -f "$TEST_DIR/backend/tests/freight_alloc_test.php" ]; then
    php "$TEST_DIR/backend/tests/freight_alloc_test.php" > "$TEST_DIR/t1.log" 2>&1 || { cat "$TEST_DIR/t1.log"; echo "  ✗ 运费分摊测试没通过，已停止上线"; rm -rf "$TEST_DIR"; exit 1; }
    php "$TEST_DIR/backend/tests/invoice_flow_test.php" > "$TEST_DIR/t2.log" 2>&1 || { cat "$TEST_DIR/t2.log"; echo "  ✗ 报价 / 开票金额测试没通过，已停止上线"; rm -rf "$TEST_DIR"; exit 1; }
    echo "  ✓ 测试全部通过"
fi
rm -rf "$TEST_DIR"

echo "[1/6] git pull 拉最新代码..."
git pull --ff-only

echo "[2/6] 检查前端 dist 是否就位..."
if [ ! -f "frontend/dist/index.html" ]; then
    echo "  ✗ frontend/dist/index.html 不存在！"
    echo "  说明本地忘记 npm run build 后再 push。"
    echo "  本地执行：cd frontend && npm run build && cd .. && git add frontend/dist && git commit -m 'build dist' && git push"
    exit 1
fi
echo "  ✓ dist OK"

echo "[3/6] 同步内置横幅图到 storage（幂等，图变了才有效果）..."
if [ -f "scripts/data-fixes/seed_shelf_banners.php" ]; then
    php scripts/data-fixes/seed_shelf_banners.php --apply
else
    echo "  - 跳过：脚本不存在"
fi

echo "[4/6] 修正后端写权限（SQLite + 上传目录）..."
chown -R www:www backend/data backend/storage 2>/dev/null || true
chmod -R 775 backend/data backend/storage
echo "  ✓ www 用户可写"

echo "[5/6] 重载 nginx..."
nginx -t && (systemctl reload nginx || /etc/init.d/nginx reload)
echo "  ✓ nginx reloaded"

echo "[6/6] 重启 PHP-FPM（清 OPcache，防止旧 handler.php 报『未知 action』）..."
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
