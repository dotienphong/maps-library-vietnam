#!/usr/bin/env node
// Quản lý graph Valhalla trên volume valhalla-data (spec dẫn đường A mục 4.4). Chạy TRONG container
// pipeline của compose máy chủ (volume gắn tại /app/valhalla):
//   node scripts/routing-graph.mjs prepare [--force]  PBF mới → dời tar cũ vào prev/, xoá thư mục tile,
//                                                    chép PBF, ghi graph.json + cờ reload → valhalla tự build
//   node scripts/routing-graph.mjs rollback           đổi chỗ tar hiện tại ↔ prev/, cờ reload → phục vụ tar cũ
//   node scripts/routing-graph.mjs status             in graph.json + kích cỡ tar (JSON)
// Image valhalla-scripted chỉ băm TÊN file PBF, nên không thể kích hoạt build bằng ghi đè PBF —
// phải dời tar và xoá thư mục tile (use_tiles_ignore_pbf=True; xem spec mục 2).
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { GRAPH_FILES, graphMeta, preparePlan, rollbackPlan } from './lib/routing-graph.mjs';

const WORK = process.env.MAPSLIBVN_WORK ?? '/app/work';
const GRAPH_DIR = process.env.MAPSLIBVN_VALHALLA ?? '/app/valhalla';
const SOURCE_PBF = resolve(WORK, 'data/sources/vietnam.osm.pbf');
const path = (/** @type {string} */ name) => resolve(GRAPH_DIR, name);
const prevPath = (/** @type {string} */ name) => resolve(GRAPH_DIR, GRAPH_FILES.prevDir, name);
const log = (/** @type {string} */ message) => console.log(`[routing-graph] ${message}`);

/** @param {string} file */
async function md5(file) {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** @param {string} file @returns {import('./lib/routing-graph.mjs').GraphMeta | null} */
function readMeta(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** @param {string} file @param {string} content */
function writeAtomic(file, content) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, file);
}

/** @param {string} content */
function requestReload(content) {
  writeAtomic(path(GRAPH_FILES.flag), `${content}\n`);
  log(`đã ghi cờ ${GRAPH_FILES.flag} (${content}) — container valhalla nhận trong ≤ 30 giây`);
}

if (!existsSync(GRAPH_DIR)) {
  throw new Error(
    `${GRAPH_DIR} không tồn tại — volume valhalla-data chưa gắn vào container pipeline (infra/server/compose.yml)`,
  );
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'prepare') {
  const current = readMeta(path(GRAPH_FILES.meta));
  const hasSource = existsSync(SOURCE_PBF);
  const sourceMd5 = hasSource ? await md5(SOURCE_PBF) : null;
  const plan = preparePlan({
    hasSource,
    sourceMd5,
    currentMd5: current?.pbfMd5 ?? null,
    hasTar: existsSync(path(GRAPH_FILES.tar)),
    force: rest.includes('--force'),
  });
  if (plan.action === 'error') throw new Error(plan.reason);
  if (plan.action === 'skip') {
    log(`${plan.reason} — không làm gì`);
    process.exit(0);
  }

  const meta = graphMeta(
    /** @type {string} */ (sourceMd5),
    statSync(SOURCE_PBF).mtime,
    new Date(),
    current,
  );
  const stagedPbf = path(`${GRAPH_FILES.pbf}.next`);
  const stagedMeta = path(`${GRAPH_FILES.meta}.next`);
  // Hoàn tất các thao tác có thể lỗi do đọc/ghi trước khi dời graph đang phục vụ.
  copyFileSync(SOURCE_PBF, stagedPbf);
  writeFileSync(stagedMeta, `${JSON.stringify(meta, null, 2)}\n`);

  mkdirSync(prevPath(''), { recursive: true });
  if (plan.keepPrev) {
    // Cùng volume nên rename thay thế prev cũ một cách nguyên tử; không xoá prev trước để tránh
    // mất bản rollback nếu tiến trình bị dừng giữa hai thao tác.
    renameSync(path(GRAPH_FILES.tar), prevPath(GRAPH_FILES.tar));
    if (current) {
      writeAtomic(prevPath(GRAPH_FILES.meta), `${JSON.stringify(current, null, 2)}\n`);
    } else {
      rmSync(prevPath(GRAPH_FILES.meta), { force: true });
    }
    log('đã giữ tar hiện tại vào prev/ (rollback được một bản)');
  }

  // configure_valhalla.sh chỉ build khi cả tar và tile directory đều vắng.
  rmSync(path(GRAPH_FILES.tileDir), { recursive: true, force: true });
  renameSync(stagedPbf, path(GRAPH_FILES.pbf));
  renameSync(stagedMeta, path(GRAPH_FILES.meta));
  requestReload('rebuild');
  log(`PBF md5 ${meta.pbfMd5} — theo dõi build: docker compose … logs -f valhalla`);
} else if (command === 'rollback') {
  const plan = rollbackPlan({ hasPrevTar: existsSync(prevPath(GRAPH_FILES.tar)) });
  if (plan.action === 'error') throw new Error(plan.reason);

  const tar = path(GRAPH_FILES.tar);
  const prevTar = prevPath(GRAPH_FILES.tar);
  const tarSwap = path(`${GRAPH_FILES.tar}.swap`);
  const hasCurrent = existsSync(tar);
  if (hasCurrent) renameSync(tar, tarSwap);
  renameSync(prevTar, tar);
  if (hasCurrent) renameSync(tarSwap, prevTar);

  const meta = path(GRAPH_FILES.meta);
  const prevMeta = prevPath(GRAPH_FILES.meta);
  const metaSwap = path(`${GRAPH_FILES.meta}.swap`);
  const hasCurrentMeta = existsSync(meta);
  const hasPreviousMeta = existsSync(prevMeta);
  if (hasCurrentMeta) renameSync(meta, metaSwap);
  if (hasPreviousMeta) renameSync(prevMeta, meta);
  if (hasCurrent && hasCurrentMeta) renameSync(metaSwap, prevMeta);
  else rmSync(metaSwap, { force: true });
  if (!hasCurrent) rmSync(prevMeta, { force: true });

  const active = readMeta(meta);
  if (active) {
    writeAtomic(
      meta,
      `${JSON.stringify({ ...active, requestedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  }
  requestReload('rollback');
  log(`đã đổi chỗ tar hiện tại ↔ prev/ (graph ${active?.pbfMd5 ?? '?'} sẽ được nạp)`);
} else if (command === 'status') {
  const size = (/** @type {string} */ file) => (existsSync(file) ? statSync(file).size : null);
  console.log(
    JSON.stringify(
      {
        graph: readMeta(path(GRAPH_FILES.meta)),
        tarBytes: size(path(GRAPH_FILES.tar)),
        prevTarBytes: size(prevPath(GRAPH_FILES.tar)),
        pbfBytes: size(path(GRAPH_FILES.pbf)),
        pendingReload: existsSync(path(GRAPH_FILES.flag)),
      },
      null,
      2,
    ),
  );
} else {
  throw new Error('Dùng: routing-graph.mjs prepare [--force] | rollback | status');
}
