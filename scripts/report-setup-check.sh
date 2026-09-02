#!/bin/sh
# Kiểm nhanh sau khi dán token vào infra/server/.env (M5 Task 8).
set -e
cd "$(dirname "$0")/.."
C="docker compose --env-file infra/server/.env -f infra/server/compose.yml"
echo "▶ 1/3 Nạp lại container pipeline"
$C up -d pipeline >/dev/null
sleep 5
echo "▶ 2/3 Biến trong container"
$C exec -T pipeline sh -c 'for v in CF_REPORT_API_TOKEN CLOUDFLARE_API_TOKEN REPORT_EMAIL_TO REPORT_EMAIL_FROM; do eval val=\$$v; [ -n "$val" ] && echo "  $v: có" || echo "  $v: RỖNG"; done'
echo "▶ 3/3 Thử báo cáo (không gửi mail)"
$C exec -T pipeline node scripts/weekly-report.mjs --dry-run --this-week
