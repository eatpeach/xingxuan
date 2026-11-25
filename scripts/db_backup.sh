#!/usr/bin/env bash
# 数据库自动备份（20261125）
#
# 为什么：之前只有大改前手动留的备份，服务器出事或误删最多会丢一个多星期的单子。
# 做什么：用 sqlite3 的 .backup 拿一份一致的副本（系统在用也不会拷坏）→ 校验 → 压缩 → 存到网站目录之外。
# 保留：最近 7 天每 3 小时一份；7 天以前每天只留凌晨 03 点那份；超过 90 天的删掉。
# 必须用 www 身份跑（root 跑会把 -wal/-shm 变成 root 的，网站就写不了库了）：
#   0 */3 * * * cd /www/wwwroot/www.xingxuan.cc && sudo -u www bash scripts/db_backup.sh >> /www/xingxuan-db-backup/backup.log 2>&1
#
# 恢复方法（先停一下手，别让人同时在录单）：
#   gunzip -c /www/xingxuan-db-backup/xingxuan-YYYYmmdd-HHMM.db.gz > /tmp/restore.db
#   sudo -u www cp backend/data/xingxuan.db backend/data/xingxuan.db.bak-before-restore
#   sudo -u www sqlite3 backend/data/xingxuan.db ".restore /tmp/restore.db"
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${XX_DB_PATH:-$PROJECT_DIR/backend/data/xingxuan.db}"
DEST="${XX_BACKUP_DIR:-/www/xingxuan-db-backup}"
STAMP="$(date +%Y%m%d-%H%M)"
TMP="$DEST/.tmp-$STAMP.db"
OUT="$DEST/xingxuan-$STAMP.db.gz"

mkdir -p "$DEST"
trap 'rm -f "$TMP"' EXIT

sqlite3 "$SRC" ".timeout 20000" ".backup '$TMP'"

CHECK="$(sqlite3 "$TMP" 'PRAGMA integrity_check;' | head -1)"
if [ "$CHECK" != "ok" ]; then
    echo "[$(date '+%F %T')] ✗ 备份校验没通过：$CHECK"
    exit 1
fi
ORDERS="$(sqlite3 "$TMP" 'SELECT COUNT(*) FROM orders;')"

gzip -c "$TMP" > "$OUT.part"
mv "$OUT.part" "$OUT"
chmod 600 "$OUT"

# 清理：7 天前的只留每天 03 点那份；90 天前的全删
find "$DEST" -name 'xingxuan-*.db.gz' -mtime +7 ! -name 'xingxuan-*-03??.db.gz' -delete
find "$DEST" -name 'xingxuan-*.db.gz' -mtime +90 -delete

echo "[$(date '+%F %T')] ✓ $(basename "$OUT") $(du -h "$OUT" | cut -f1)，订单 $ORDERS 条，现存 $(ls "$DEST"/xingxuan-*.db.gz | wc -l | tr -d ' ') 份"
