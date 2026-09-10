#!/usr/bin/env bash
# Bọc entrypoint gốc của image valhalla-scripted (spec dẫn đường A mục 4.3): chạy build+serve, đợi cờ
# /custom_files/reload.request do scripts/routing-graph.mjs ghi, rồi dừng CẢ NHÓM tiến trình (valhalla_service
# hoặc valhalla_build_tiles đang chạy) và chạy lại entrypoint — không cần Docker socket trong container
# pipeline. Entrypoint chạy qua setsid để có process group riêng: kill -TERM cả nhóm mới không để sót
# valhalla_build_tiles chạy mồ côi nếu cờ tới giữa lúc build (hai build chồng nhau làm hỏng graph).
set -euo pipefail
CUSTOM_FILES=/custom_files
FLAG="${CUSTOM_FILES}/reload.request"
ENTRYPOINT=/valhalla/scripts/docker-entrypoint.sh
POLL_SECONDS="${RELOAD_POLL_SECONDS:-30}"
FAIL_SLEEP_SECONDS="${FAIL_SLEEP_SECONDS:-600}"
log() { echo "[run.sh] $(date -u +%FT%TZ) $*"; }

while true; do
  rm -f "${FLAG}"
  setsid "${ENTRYPOINT}" build_tiles &
  child=$!
  log "entrypoint pid ${child} (build nếu thiếu tar, rồi phục vụ :8002)"
  while kill -0 "${child}" 2>/dev/null; do
    if [[ -f "${FLAG}" ]]; then
      log "thấy cờ '$(tr -d '\n' < "${FLAG}" 2>/dev/null || echo reload)' → dừng nhóm tiến trình ${child} để nạp lại graph"
      kill -TERM -- "-${child}" 2>/dev/null || kill -TERM "${child}" 2>/dev/null || true
      wait "${child}" || true
      break
    fi
    sleep "${POLL_SECONDS}"
  done
  if [[ ! -f "${FLAG}" ]]; then
    set +e
    wait "${child}"
    code=$?
    set -e
    if [[ "${code}" -eq 0 ]]; then
      log "entrypoint thoát mã 0 → thoát"
      exit 0
    fi
    # Không để Docker restart-loop build lại liên tục khi OOM/lỗi dữ liệu: ngủ rồi mới thoát.
    log "entrypoint thoát mã ${code} mà không có cờ reload (build lỗi/OOM?) — ngủ ${FAIL_SLEEP_SECONDS}s rồi để Docker khởi động lại; quay về graph cũ: scripts/routing-graph.mjs rollback"
    sleep "${FAIL_SLEEP_SECONDS}"
    exit "${code}"
  fi
done
