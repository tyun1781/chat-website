#!/usr/bin/env bash
# 每日数据库备份。由 /etc/cron.d/inch-backup 调用，也可以手动跑。
#   bash backup.sh
# 做三件事：导出 → 校验 gzip 与 pg_dump 结束标记 → 清理 7 天前的旧备份。
# 任何一步失败都返回非零，并删除半成品，避免留下一个看起来正常的坏备份。
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

backup_dir="${BACKUP_DIR:-/opt/backups}"
keep_days="${BACKUP_KEEP_DAYS:-7}"

mkdir -p "$backup_dir"
stamp="$(date +%F-%H%M)"
target="$backup_dir/inch-$stamp.sql.gz"
tmp="$target.part"

cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

echo "[$(date -Is)] 开始备份 -> $target"

# -T 关闭 TTY 分配，否则在 cron / 管道里 docker compose exec 会报错。
docker compose exec -T db pg_dump -U inch -d inch \
  --no-owner --clean --if-exists | gzip -9 > "$tmp"

# 1) gzip 结构完整
gzip -t "$tmp"

# 2) pg_dump 正常跑完会写这一行结尾；没有它说明导出被截断了
if ! zcat "$tmp" | tail -5 | grep -q 'PostgreSQL database dump complete'; then
  echo "[$(date -Is)] 校验失败：导出内容不完整" >&2
  exit 1
fi

mv "$tmp" "$target"
trap - EXIT

# 3) 清理过期备份
find "$backup_dir" -name 'inch-*.sql.gz' -type f -mtime "+$keep_days" -delete

echo "[$(date -Is)] 完成 $(du -h "$target" | cut -f1) 当前共 $(find "$backup_dir" -name 'inch-*.sql.gz' | wc -l) 份"
