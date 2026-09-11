#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
// Quản lý graph Valhalla trên volume valhalla-data. Image valhalla-scripted chỉ băm TÊN PBF,
// vì vậy prepare phải dời tar và xoá tile directory để buộc build lại (spec A mục 2, 4.4).
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { copyFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  GRAPH_FILES,
  PREPARE_FAULT_POINTS,
  ROLLBACK_FAULT_POINTS,
  graphMeta,
  parseGraphMeta,
  parseRoutingGraphArgs,
  preparePlan,
  rollbackPlan,
} from './lib/routing-graph.mjs';

const RUNTIME = {
  journal: '.routing-graph.transaction.json',
  lock: '.routing-graph.lock',
  stagePrefix: '.routing-graph-txn-',
  inProgress: 'reload.in-progress',
  failed: 'reload.failed',
};
const WORK = process.env.MAPSLIBVN_WORK ?? '/app/work';
const GRAPH_DIR = process.env.MAPSLIBVN_VALHALLA ?? '/app/valhalla';
const SOURCE_PBF = resolve(WORK, 'data/sources/vietnam.osm.pbf');
const path = (/** @type {string} */ name) => resolve(GRAPH_DIR, name);
const prevPath = (/** @type {string} */ name) => resolve(GRAPH_DIR, GRAPH_FILES.prevDir, name);
const stageName = (/** @type {string} */ id, /** @type {string} */ suffix) =>
  `${RUNTIME.stagePrefix}${id}.${suffix}`;
const log = (/** @type {string} */ message) => console.log(`[routing-graph] ${message}`);

/** @param {string} file */
async function md5(file) {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** @param {string} target */
function syncPath(target) {
  const descriptor = openSync(target, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** @param {string} file @param {string} content */
function writeAtomic(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content);
  syncPath(temporary);
  renameSync(temporary, file);
  syncPath(dirname(file));
}

/** @param {string} file @returns {import('./lib/routing-graph.mjs').GraphMeta | null} */
function readMeta(file) {
  if (!existsSync(file)) return null;
  return parseGraphMeta(JSON.parse(readFileSync(file, 'utf8')), file);
}

/** @param {string} file @param {import('./lib/routing-graph.mjs').GraphMeta} meta */
function stageMeta(file, meta) {
  writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`);
  syncPath(file);
}

/** @param {string} content */
function requestReload(content) {
  writeAtomic(path(GRAPH_FILES.flag), `${content}\n`);
  log(`đã ghi cờ ${GRAPH_FILES.flag} (${content}) — container valhalla nhận trong ≤ 30 giây`);
}

/** @typedef {'prepare' | 'rollback'} TransactionType */
/**
 * @typedef {{ version: 1, id: string, type: TransactionType, phase: string, hadCurrentTar: boolean, hadCurrentMeta: boolean, hadPreviousMeta: boolean }} Journal
 */

/** @param {unknown} value @returns {Journal} */
function parseJournal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Transaction journal không hợp lệ');
  }
  const journal = /** @type {Record<string, unknown>} */ (value);
  const phases =
    journal.type === 'prepare'
      ? PREPARE_FAULT_POINTS
      : journal.type === 'rollback'
        ? ROLLBACK_FAULT_POINTS
        : [];
  if (
    journal.version !== 1 ||
    typeof journal.id !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(journal.id) ||
    !phases.includes(/** @type {string} */ (journal.phase)) ||
    typeof journal.hadCurrentTar !== 'boolean' ||
    typeof journal.hadCurrentMeta !== 'boolean' ||
    typeof journal.hadPreviousMeta !== 'boolean'
  ) {
    throw new Error('Transaction journal không hợp lệ');
  }
  return /** @type {Journal} */ (journal);
}

/** @returns {Journal | null} */
function readJournal() {
  const file = path(RUNTIME.journal);
  if (!existsSync(file)) return null;
  return parseJournal(JSON.parse(readFileSync(file, 'utf8')));
}

/** @param {Journal} journal */
function writeJournal(journal) {
  writeAtomic(path(RUNTIME.journal), `${JSON.stringify(journal, null, 2)}\n`);
}

/** @param {Journal} journal @param {string} phase */
function setPhase(journal, phase) {
  journal.phase = phase;
  writeJournal(journal);
}

/** @param {string} point */
function injectFault(point) {
  if (process.env.NODE_ENV === 'test' && process.env.MAPSLIBVN_ROUTING_FAULT_AFTER === point) {
    process.exit(91);
  }
}

/** @param {string} id */
function stages(id) {
  return {
    currentTar: path(stageName(id, 'current.tar')),
    newPbf: path(stageName(id, 'new.pbf')),
    newMeta: path(stageName(id, 'new-meta.json')),
    activeMeta: path(stageName(id, 'active-meta.json')),
    previousMeta: path(stageName(id, 'previous-meta.json')),
  };
}

/** @param {Journal} journal @param {boolean} recovering */
async function finishPrepare(journal, recovering) {
  const files = stages(journal.id);
  const at = PREPARE_FAULT_POINTS.indexOf(journal.phase);
  if (at <= PREPARE_FAULT_POINTS.indexOf('pbf-installed')) {
    setPhase(journal, 'pbf-installed');
    if (existsSync(files.newPbf)) renameSync(files.newPbf, path(GRAPH_FILES.pbf));
    syncPath(GRAPH_DIR);
    injectFault('pbf-installed');
  }
  if (at <= PREPARE_FAULT_POINTS.indexOf('current-tar-staged')) {
    setPhase(journal, 'current-tar-staged');
    if (journal.hadCurrentTar && !existsSync(files.currentTar)) {
      if (!existsSync(path(GRAPH_FILES.tar))) throw new Error('Mất cả tar hiện tại và tar stage');
      renameSync(path(GRAPH_FILES.tar), files.currentTar);
      syncPath(GRAPH_DIR);
    }
    injectFault('current-tar-staged');
  }
  if (at <= PREPARE_FAULT_POINTS.indexOf('previous-tar-installed')) {
    setPhase(journal, 'previous-tar-installed');
    if (journal.hadCurrentTar && existsSync(files.currentTar)) {
      renameSync(files.currentTar, prevPath(GRAPH_FILES.tar));
      syncPath(prevPath(''));
    }
    injectFault('previous-tar-installed');
  }
  if (at <= PREPARE_FAULT_POINTS.indexOf('previous-meta-installed')) {
    setPhase(journal, 'previous-meta-installed');
    if (journal.hadCurrentTar) {
      if (journal.hadCurrentMeta && existsSync(files.previousMeta)) {
        renameSync(files.previousMeta, prevPath(GRAPH_FILES.meta));
      } else if (!journal.hadCurrentMeta) {
        rmSync(prevPath(GRAPH_FILES.meta), { force: true });
      }
    }
    syncPath(prevPath(''));
    injectFault('previous-meta-installed');
  }
  if (at <= PREPARE_FAULT_POINTS.indexOf('tiles-removed')) {
    setPhase(journal, 'tiles-removed');
    await rm(path(GRAPH_FILES.tileDir), { recursive: true, force: true });
    syncPath(GRAPH_DIR);
    injectFault('tiles-removed');
  }
  if (at <= PREPARE_FAULT_POINTS.indexOf('active-meta-installed')) {
    setPhase(journal, 'active-meta-installed');
    if (existsSync(files.newMeta)) renameSync(files.newMeta, path(GRAPH_FILES.meta));
    syncPath(GRAPH_DIR);
    injectFault('active-meta-installed');
  }
  if (at <= PREPARE_FAULT_POINTS.indexOf('reload-written')) {
    setPhase(journal, 'reload-written');
    requestReload('rebuild');
    injectFault('reload-written');
  }
  rmSync(path(RUNTIME.journal), { force: true });
  for (const file of Object.values(files)) rmSync(file, { force: true });
  syncPath(GRAPH_DIR);
  if (recovering)
    console.error('[routing-graph] đã phục hồi xong transaction prepare bị gián đoạn');
}

/** @param {Journal} journal @param {boolean} recovering */
function finishRollback(journal, recovering) {
  const files = stages(journal.id);
  const at = ROLLBACK_FAULT_POINTS.indexOf(journal.phase);
  if (at <= ROLLBACK_FAULT_POINTS.indexOf('current-tar-staged')) {
    setPhase(journal, 'current-tar-staged');
    if (journal.hadCurrentTar && !existsSync(files.currentTar)) {
      if (!existsSync(path(GRAPH_FILES.tar))) throw new Error('Mất cả tar hiện tại và tar stage');
      renameSync(path(GRAPH_FILES.tar), files.currentTar);
      syncPath(GRAPH_DIR);
    }
    injectFault('current-tar-staged');
  }
  if (at <= ROLLBACK_FAULT_POINTS.indexOf('previous-tar-activated')) {
    setPhase(journal, 'previous-tar-activated');
    if (existsSync(prevPath(GRAPH_FILES.tar))) {
      renameSync(prevPath(GRAPH_FILES.tar), path(GRAPH_FILES.tar));
      syncPath(GRAPH_DIR);
      syncPath(prevPath(''));
    }
    injectFault('previous-tar-activated');
  }
  if (at <= ROLLBACK_FAULT_POINTS.indexOf('current-tar-stored')) {
    setPhase(journal, 'current-tar-stored');
    if (journal.hadCurrentTar && existsSync(files.currentTar)) {
      renameSync(files.currentTar, prevPath(GRAPH_FILES.tar));
      syncPath(prevPath(''));
    }
    injectFault('current-tar-stored');
  }
  if (at <= ROLLBACK_FAULT_POINTS.indexOf('active-meta-installed')) {
    setPhase(journal, 'active-meta-installed');
    if (journal.hadPreviousMeta && existsSync(files.activeMeta)) {
      renameSync(files.activeMeta, path(GRAPH_FILES.meta));
    } else if (!journal.hadPreviousMeta) {
      rmSync(path(GRAPH_FILES.meta), { force: true });
    }
    syncPath(GRAPH_DIR);
    injectFault('active-meta-installed');
  }
  if (at <= ROLLBACK_FAULT_POINTS.indexOf('previous-meta-installed')) {
    setPhase(journal, 'previous-meta-installed');
    if (journal.hadCurrentTar && journal.hadCurrentMeta && existsSync(files.previousMeta)) {
      renameSync(files.previousMeta, prevPath(GRAPH_FILES.meta));
    } else if (!journal.hadCurrentTar || !journal.hadCurrentMeta) {
      rmSync(prevPath(GRAPH_FILES.meta), { force: true });
    }
    syncPath(prevPath(''));
    injectFault('previous-meta-installed');
  }
  if (at <= ROLLBACK_FAULT_POINTS.indexOf('reload-written')) {
    setPhase(journal, 'reload-written');
    requestReload('rollback');
    injectFault('reload-written');
  }
  rmSync(path(RUNTIME.journal), { force: true });
  for (const file of Object.values(files)) rmSync(file, { force: true });
  syncPath(GRAPH_DIR);
  if (recovering)
    console.error('[routing-graph] đã phục hồi xong transaction rollback bị gián đoạn');
}

function cleanOrphanStages() {
  if (existsSync(path(RUNTIME.journal))) return;
  for (const name of readdirSync(GRAPH_DIR)) {
    if (
      name.startsWith(RUNTIME.stagePrefix) ||
      (/^(\.routing-graph\.transaction\.json|reload\.request)\..+\.tmp$/.test(name) &&
        !name.includes('/'))
    ) {
      rmSync(path(name), { force: true });
    }
  }
  syncPath(GRAPH_DIR);
}

/** @param {'prepare' | 'rollback'} command */
function assertMutationAllowed(command) {
  const pending = existsSync(path(GRAPH_FILES.flag));
  const active = existsSync(path(RUNTIME.inProgress));
  const failed = existsSync(path(RUNTIME.failed));
  if (command === 'prepare' && (pending || active || failed)) {
    throw new Error(
      'reload/build trước vẫn đang chờ hoặc đang chạy — đợi status Valhalla 200 rồi thử lại',
    );
  }
  if (command === 'rollback' && (pending || active) && !failed) {
    throw new Error(
      'reload/build đang chạy — rollback chỉ được phép sau khi wrapper ghi reload.failed',
    );
  }
}

async function pauseAfterAuthorizationForTest() {
  const ready = process.env.MAPSLIBVN_ROUTING_TEST_PAUSE_AFTER_AUTH_FILE;
  if (process.env.NODE_ENV !== 'test' || !ready) return;
  writeAtomic(ready, 'authorized\n');
  while (!existsSync(`${ready}.release`)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

async function main() {
  // Boundary validation chạy trước cả kiểm tra directory/lock để typo không gây mutation.
  const options = parseRoutingGraphArgs(process.argv.slice(2));
  if (!existsSync(GRAPH_DIR)) {
    throw new Error(
      `${GRAPH_DIR} không tồn tại — volume valhalla-data chưa gắn vào container pipeline (infra/server/compose.yml)`,
    );
  }

  try {
    const interrupted = readJournal();
    if (interrupted) {
      if (interrupted.type === 'prepare') await finishPrepare(interrupted, true);
      else finishRollback(interrupted, true);
    }
    cleanOrphanStages();

    if (options.command === 'status') {
      const activeGraph = readMeta(path(GRAPH_FILES.meta));
      const previousGraph = readMeta(prevPath(GRAPH_FILES.meta));
      const copiedPbfExists = existsSync(path(GRAPH_FILES.pbf));
      const copiedPbfMd5 = copiedPbfExists ? await md5(path(GRAPH_FILES.pbf)) : null;
      const size = (/** @type {string} */ file) => (existsSync(file) ? statSync(file).size : null);
      console.log(
        JSON.stringify(
          {
            activeGraph,
            previousGraph,
            tarBytes: size(path(GRAPH_FILES.tar)),
            prevTarBytes: size(prevPath(GRAPH_FILES.tar)),
            copiedPbf: {
              bytes: size(path(GRAPH_FILES.pbf)),
              md5: copiedPbfMd5,
              matchesActiveGraph: copiedPbfMd5 !== null && copiedPbfMd5 === activeGraph?.pbfMd5,
            },
            pendingReload: existsSync(path(GRAPH_FILES.flag)),
            buildInProgress: existsSync(path(RUNTIME.inProgress)),
            buildFailed: existsSync(path(RUNTIME.failed)),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (options.command === 'reset-empty') {
      if (!existsSync(path(RUNTIME.failed))) {
        throw new Error('reset-empty cần reload.failed từ bootstrap lỗi trước đó');
      }
      if (
        existsSync(path(GRAPH_FILES.pbf)) ||
        existsSync(path(GRAPH_FILES.tar)) ||
        existsSync(path(GRAPH_FILES.tileDir)) ||
        existsSync(path(GRAPH_FILES.meta)) ||
        existsSync(prevPath(GRAPH_FILES.tar)) ||
        existsSync(prevPath(GRAPH_FILES.meta))
      ) {
        throw new Error('reset-empty chỉ dùng khi volume graph chưa có PBF/tar/tile');
      }
      rmSync(path(GRAPH_FILES.flag), { force: true });
      rmSync(path(RUNTIME.inProgress), { force: true });
      rmSync(path(RUNTIME.failed), { force: true });
      syncPath(GRAPH_DIR);
      log('đã xoá marker build lỗi trên volume graph rỗng');
      return;
    }

    mkdirSync(prevPath(''), { recursive: true });
    syncPath(GRAPH_DIR);

    if (options.command === 'prepare') {
      assertMutationAllowed('prepare');
      if (!existsSync(SOURCE_PBF)) {
        const plan = preparePlan({
          hasSource: false,
          sourceMd5: null,
          currentMd5: null,
          hasTar: existsSync(path(GRAPH_FILES.tar)),
          force: options.force,
        });
        if (plan.action === 'error') throw new Error(plan.reason);
      }

      const id = randomUUID();
      const files = stages(id);
      const sourceBefore = statSync(SOURCE_PBF);
      await copyFile(SOURCE_PBF, files.newPbf);
      syncPath(files.newPbf);
      const sourceAfter = statSync(SOURCE_PBF);
      if (sourceBefore.size !== sourceAfter.size || sourceBefore.mtimeMs !== sourceAfter.mtimeMs) {
        rmSync(files.newPbf, { force: true });
        throw new Error('PBF nguồn thay đổi trong lúc chép — chạy lại prepare');
      }
      utimesSync(files.newPbf, sourceAfter.atime, sourceAfter.mtime);
      syncPath(files.newPbf);
      const stagedPbf = statSync(files.newPbf);
      const sourceMd5 = await md5(files.newPbf);
      const current = readMeta(path(GRAPH_FILES.meta));
      const hasTar = existsSync(path(GRAPH_FILES.tar));
      const plan = preparePlan({
        hasSource: true,
        sourceMd5,
        currentMd5: current?.pbfMd5 ?? null,
        hasTar,
        force: options.force,
      });
      if (plan.action === 'skip') {
        rmSync(files.newPbf, { force: true });
        syncPath(GRAPH_DIR);
        log(`${plan.reason} — không làm gì`);
        return;
      }
      if (plan.action !== 'rebuild') throw new Error(plan.reason);

      const next = graphMeta(
        sourceMd5,
        stagedPbf.mtime,
        new Date(),
        current,
        options.vnRelease ?? current?.vnRelease ?? null,
      );
      stageMeta(files.newMeta, next);
      if (hasTar && current) stageMeta(files.previousMeta, current);
      syncPath(GRAPH_DIR);
      /** @type {Journal} */
      const journal = {
        version: 1,
        id,
        type: 'prepare',
        phase: 'journaled',
        hadCurrentTar: hasTar,
        hadCurrentMeta: current !== null,
        hadPreviousMeta: existsSync(prevPath(GRAPH_FILES.meta)),
      };
      writeJournal(journal);
      injectFault('journaled');
      await finishPrepare(journal, false);
      log(`PBF md5 ${next.pbfMd5} — theo dõi build: docker compose … logs -f valhalla`);
      return;
    }

    assertMutationAllowed('rollback');
    await pauseAfterAuthorizationForTest();
    const plan = rollbackPlan({ hasPrevTar: existsSync(prevPath(GRAPH_FILES.tar)) });
    if (plan.action === 'error') throw new Error(plan.reason);
    const id = randomUUID();
    const files = stages(id);
    const current = readMeta(path(GRAPH_FILES.meta));
    const previous = readMeta(prevPath(GRAPH_FILES.meta));
    const hasCurrentTar = existsSync(path(GRAPH_FILES.tar));
    if (previous) {
      stageMeta(files.activeMeta, { ...previous, requestedAt: new Date().toISOString() });
    }
    if (hasCurrentTar && current) stageMeta(files.previousMeta, current);
    syncPath(GRAPH_DIR);
    /** @type {Journal} */
    const journal = {
      version: 1,
      id,
      type: 'rollback',
      phase: 'journaled',
      hadCurrentTar: hasCurrentTar,
      hadCurrentMeta: current !== null,
      hadPreviousMeta: previous !== null,
    };
    writeJournal(journal);
    injectFault('journaled');
    finishRollback(journal, false);
    log(`đã đổi chỗ tar hiện tại ↔ prev/ (graph ${previous?.pbfMd5 ?? '?'} sẽ được nạp)`);
  } finally {
    if (!existsSync(path(RUNTIME.journal))) cleanOrphanStages();
  }
}

async function entry() {
  const argv = process.argv.slice(2);
  parseRoutingGraphArgs(argv);
  if (!existsSync(GRAPH_DIR)) {
    throw new Error(
      `${GRAPH_DIR} không tồn tại — volume valhalla-data chưa gắn vào container pipeline (infra/server/compose.yml)`,
    );
  }
  if (process.env.NODE_ENV === 'test' && process.env.MAPSLIBVN_ROUTING_TEST_SKIP_FLOCK === '1') {
    await main();
    return;
  }
  const available = spawnSync('flock', ['--version'], { stdio: 'ignore' });
  if (available.error || available.status !== 0) {
    throw new Error('Thiếu lệnh `flock` (util-linux) — không thể cập nhật graph an toàn');
  }
  // Helper giữ kernel lock trong suốt mutation. stdin là pipe do Node sở hữu: parent crash
  // làm pipe đóng, `cat` thoát và flock tự nhả lock, không cần re-exec hay env bypass.
  const locker = spawn(
    'flock',
    [
      '--exclusive',
      '--nonblock',
      '--conflict-exit-code',
      '75',
      path(RUNTIME.lock),
      'sh',
      '-c',
      'printf "locked\\n"; cat >/dev/null',
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  let lockAcquired = false;
  let releasingLock = false;
  locker.once('close', (code) => {
    if (!lockAcquired || releasingLock) return;
    console.error(`[routing-graph] tiến trình giữ flock thoát bất ngờ (mã ${code ?? 1})`);
    process.kill(process.pid, 'SIGTERM');
  });
  await new Promise((resolveReady, rejectReady) => {
    let ready = false;
    locker.stdout.setEncoding('utf8');
    locker.stdout.on('data', (chunk) => {
      if (!ready && chunk.includes('locked\n')) {
        ready = true;
        lockAcquired = true;
        resolveReady(undefined);
      }
    });
    locker.once('error', rejectReady);
    locker.once('exit', (code) => {
      if (ready) return;
      rejectReady(
        Object.assign(
          new Error(
            code === 75
              ? 'routing-graph đang được tiến trình khác giữ kernel flock'
              : `flock thoát mã ${code ?? 1}`,
          ),
          { exitCode: code ?? 1 },
        ),
      );
    });
  });
  try {
    await main();
  } finally {
    releasingLock = true;
    if (locker.exitCode === null) {
      const closed = new Promise((resolveClose) => locker.once('close', resolveClose));
      locker.stdin.end();
      await closed;
    }
  }
}

try {
  await entry();
} catch (cause) {
  /** @type {Error & { exitCode?: number }} */
  const error = cause instanceof Error ? cause : new Error(String(cause));
  console.error(`[routing-graph] ${error.message}`);
  process.exitCode = /** @type {number} */ (error.exitCode ?? 1);
}
