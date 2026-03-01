#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ClawFeed Cron 定时任务安装脚本
# 用法: bash scripts/setup-cron.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 获取 node 路径
NODE_BIN="$(which node)"
if [ -z "$NODE_BIN" ]; then
  echo "❌ 未找到 node，请先安装 Node.js"
  exit 1
fi

FETCH_SCRIPT="$ROOT_DIR/scripts/fetch-and-digest.mjs"
LOG_DIR="$ROOT_DIR/data/logs"
mkdir -p "$LOG_DIR"

echo "==================================================="
echo "  ClawFeed Cron 定时任务安装"
echo "==================================================="
echo ""
echo "Node:    $NODE_BIN"
echo "Script:  $FETCH_SCRIPT"
echo "Logs:    $LOG_DIR"
echo ""

# 生成 cron 命令
# 格式: 分 时 日 月 周
CRON_4H="0 4,12,16,20 * * *  cd \"$ROOT_DIR\" && $NODE_BIN scripts/fetch-and-digest.mjs --type 4h >> \"$LOG_DIR/digest-4h.log\" 2>&1"
CRON_DAILY="0 8   * * *  cd \"$ROOT_DIR\" && $NODE_BIN scripts/fetch-and-digest.mjs --type daily >> \"$LOG_DIR/digest-daily.log\" 2>&1"
CRON_WEEKLY="0 9   * * 1  cd \"$ROOT_DIR\" && $NODE_BIN scripts/fetch-and-digest.mjs --type weekly >> \"$LOG_DIR/digest-weekly.log\" 2>&1"

echo "即将安装以下定时任务:"
echo ""
echo "  4h简报(04/12/16/20) → $CRON_4H"
echo "  每天 08:00 → $CRON_DAILY"
echo "  每周一09:00→ $CRON_WEEKLY"
echo ""

read -p "确认安装？(y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "已取消。"
  echo ""
  echo "如需手动添加，执行 'crontab -e' 并粘贴以下内容："
  echo ""
  echo "# ClawFeed Digest 定时生成"
  echo "$CRON_4H"
  echo "$CRON_DAILY"
  echo "$CRON_WEEKLY"
  exit 0
fi

# 备份当前 crontab
BACKUP="$ROOT_DIR/data/crontab.bak"
crontab -l > "$BACKUP" 2>/dev/null || true
echo "已备份当前 crontab → $BACKUP"

# 追加新任务（避免重复）
(
  crontab -l 2>/dev/null | grep -v "fetch-and-digest.mjs" || true
  echo ""
  echo "# ClawFeed Digest 定时生成 (auto-installed $(date '+%Y-%m-%d'))"
  echo "$CRON_4H"
  echo "$CRON_DAILY"
  echo "$CRON_WEEKLY"
) | crontab -

echo ""
echo "✅ Cron 安装成功！当前 crontab："
echo ""
crontab -l | grep -A1 "ClawFeed"
echo ""
echo "查看运行日志:"
echo "  tail -f $LOG_DIR/digest-4h.log"
echo "  tail -f $LOG_DIR/digest-daily.log"
