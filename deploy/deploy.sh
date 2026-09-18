#!/usr/bin/env bash
# 一键部署：本地构建 → 打包上传 → 重载 nginx
#
# 用法：
#   ./deploy/deploy.sh user@your-server.example
#
# 只用系统自带的 tar + ssh，不装任何东西。
# 不用 rsync 的原因：macOS 自带的是 openrsync（协议 29），服务器是真 rsync 3.2.7
# （协议 31），协议对不上会报 "child exited with status 23"——文件传完了，
# 但退出码非零，会把后面的权限设置和 reload 一起中断。站点只有 1.4MB，tar 够用。
#
# 影响范围：只动 /var/www/pindou 这一个目录，不碰服务器上其他站点。
set -euo pipefail

HOST="${1:?用法: ./deploy/deploy.sh user@服务器}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/pindou}"
WEB_USER="${WEB_USER:-www-data}"
PUBLIC_URL="${PUBLIC_URL:-https://pindou.liangfeiyan.cn}"

[[ "$HOST" != -* ]] || { echo "HOST 不能以 - 开头" >&2; exit 2; }
[[ "$REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "REMOTE_DIR 只能是绝对路径" >&2; exit 2; }
[[ "$WEB_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || { echo "WEB_USER 不是合法用户名" >&2; exit 2; }

cd "$(dirname "$0")/.."

echo "▸ 构建…"
npm run build

STAMP="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="${REMOTE_DIR}.release-${STAMP}"
BACKUP_DIR="${REMOTE_DIR}.backup-${STAMP}"

echo "▸ 上传新版本到 $HOST:$RELEASE_DIR"
ssh "$HOST" "sudo mkdir -p '$RELEASE_DIR' && sudo chown \"\$(id -un):\$(id -gn)\" '$RELEASE_DIR'"
COPYFILE_DISABLE=1 tar -czf - -C dist . | ssh "$HOST" "tar -xzf - -C '$RELEASE_DIR'"

echo "▸ 切换版本 + 重载 nginx（旧版本保留为 ${BACKUP_DIR}）"
ssh "$HOST" "if [ -e '$REMOTE_DIR' ]; then sudo mv '$REMOTE_DIR' '$BACKUP_DIR'; fi; sudo mv '$RELEASE_DIR' '$REMOTE_DIR'; sudo chown -R '$WEB_USER:$WEB_USER' '$REMOTE_DIR' && sudo nginx -t && sudo systemctl reload nginx"

echo "✅ 部署完成 → $PUBLIC_URL"
