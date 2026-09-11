#!/usr/bin/env bash
# Bọc entrypoint gốc của image valhalla-scripted (spec dẫn đường A mục 4.3): chạy build+serve, đợi cờ
# /custom_files/reload.request do scripts/routing-graph.mjs ghi, rồi dừng CẢ NHÓM tiến trình (valhalla_service
# hoặc valhalla_build_tiles đang chạy) và chạy lại entrypoint — không cần Docker socket trong container
# pipeline. Entrypoint chạy qua setsid để có process group riêng: kill -TERM cả nhóm mới không để sót
# valhalla_build_tiles chạy mồ côi nếu cờ tới giữa lúc build (hai build chồng nhau làm hỏng graph).
set -euo pipefail
CUSTOM_FILES="${CUSTOM_FILES:-/custom_files}"
FLAG="${CUSTOM_FILES}/reload.request"
IN_PROGRESS="${CUSTOM_FILES}/reload.in-progress"
ENTRYPOINT="${VALHALLA_ENTRYPOINT:-/valhalla/scripts/docker-entrypoint.sh}"
READY_URL="${VALHALLA_READY_URL:-http://localhost:8002/status}"
POLL_SECONDS="${RELOAD_POLL_SECONDS:-30}"
FAIL_SLEEP_SECONDS="${FAIL_SLEEP_SECONDS:-600}"
STOP_GRACE_SECONDS="${STOP_GRACE_SECONDS:-30}"
child=""
log() { echo "[run.sh] $(date -u +%FT%TZ) $*"; }

positive_integer() {
  local name="$1" value="$2"
  if [[ ! "${value}" =~ ^[1-9][0-9]*$ ]]; then
    echo "[run.sh] ${name} phải là số nguyên dương (nhận '${value}')" >&2
    exit 64
  fi
}

positive_integer RELOAD_POLL_SECONDS "${POLL_SECONDS}"
positive_integer FAIL_SLEEP_SECONDS "${FAIL_SLEEP_SECONDS}"
positive_integer STOP_GRACE_SECONDS "${STOP_GRACE_SECONDS}"

child_alive() {
  [[ -n "${child}" ]] && {
    kill -0 -- "-${child}" 2>/dev/null || kill -0 "${child}" 2>/dev/null
  }
}

stop_child() {
  [[ -n "${child}" ]] || return 0
  kill -TERM -- "-${child}" 2>/dev/null || kill -TERM "${child}" 2>/dev/null || true
  local deadline=$((SECONDS + STOP_GRACE_SECONDS))
  while child_alive && (( SECONDS < deadline )); do sleep 1; done
  if child_alive; then
    log "nhóm tiến trình ${child} chưa dừng sau ${STOP_GRACE_SECONDS}s → gửi KILL"
    kill -KILL -- "-${child}" 2>/dev/null || kill -KILL "${child}" 2>/dev/null || true
  fi
  wait "${child}" 2>/dev/null || true
  child=""
}

on_signal() {
  local signal="$1" code="$2"
  trap - TERM INT
  log "nhận ${signal} → dừng tiến trình con"
  stop_child
  exit "${code}"
}

trap 'on_signal TERM 143' TERM
trap 'on_signal INT 130' INT

while true; do
  if [[ -f "${FLAG}" ]]; then
    mv -f "${FLAG}" "${IN_PROGRESS}"
    log "đánh dấu reload/build đang chạy"
  elif [[ -f "${CUSTOM_FILES}/vietnam.osm.pbf" && ! -f "${CUSTOM_FILES}/valhalla_tiles.tar" && ! -f "${IN_PROGRESS}" ]]; then
    printf 'initial-build\n' > "${IN_PROGRESS}"
  fi
  setsid "${ENTRYPOINT}" build_tiles &
  child=$!
  log "entrypoint pid ${child} (build nếu thiếu tar, rồi phục vụ :8002)"
  reload=false
  while child_alive; do
    if [[ -f "${FLAG}" ]]; then
      log "thấy cờ '$(tr -d '\n' < "${FLAG}" 2>/dev/null || echo reload)' → dừng nhóm tiến trình ${child} để nạp lại graph"
      mv -f "${FLAG}" "${IN_PROGRESS}"
      stop_child
      reload=true
      break
    fi
    if [[ -f "${IN_PROGRESS}" ]] && curl -fsS "${READY_URL}" >/dev/null 2>&1; then
      rm -f "${IN_PROGRESS}"
      log "graph mới đã sẵn sàng"
    fi
    sleep "${POLL_SECONDS}"
  done
  if [[ "${reload}" == true ]]; then continue; fi

  set +e
  wait "${child}"
  code=$?
  set -e
  child=""
  if [[ "${code}" -eq 0 ]]; then
    log "entrypoint thoát mã 0 → thoát"
    exit 0
  fi
  # Giữ IN_PROGRESS để lệnh graph khác không xen vào khi Docker khởi động lại sau OOM/lỗi dữ liệu.
  log "entrypoint thoát mã ${code} mà không có cờ reload (build lỗi/OOM?) — ngủ ${FAIL_SLEEP_SECONDS}s rồi để Docker khởi động lại; quay về graph cũ: scripts/routing-graph.mjs rollback"
  sleep "${FAIL_SLEEP_SECONDS}"
  exit "${code}"
done
