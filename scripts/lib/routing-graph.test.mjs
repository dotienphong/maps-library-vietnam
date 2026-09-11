import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GRAPH_FILES,
  PREPARE_FAULT_POINTS,
  ROLLBACK_FAULT_POINTS,
  graphMeta,
  parseGraphMeta,
  parseRoutingGraphArgs,
  preparePlan,
  rollbackPlan,
} from './routing-graph.mjs';

const SCRIPT = resolve(import.meta.dirname, '../routing-graph.mjs');
// bash trên Windows (MSYS/Git Bash) tự tách lại command line theo quy tắc POSIX và nuốt mất
// dấu '\' — path kiểu Windows truyền cho spawn('bash', [...]) phải dùng '/' mới sống sót.
const RUN_SH = resolve(import.meta.dirname, '../../infra/server/valhalla/run.sh').replaceAll(
  '\\',
  '/',
);
const SERVER_COMPOSE = resolve(import.meta.dirname, '../../infra/server/compose.yml');
const DEV_COMPOSE = resolve(import.meta.dirname, '../../infra/dev/compose.yml');
const HAS_FLOCK = spawnSync('flock', ['--version']).status === 0;
const HAS_LINUX_LIFECYCLE_TOOLS = HAS_FLOCK && spawnSync('setsid', ['--version']).status === 0;
// 'bash' trong PATH trên Windows là ngõ cụt: máy có cài WSL thì C:\Windows\System32\bash.exe
// (launcher WSL, không hiểu path 'D:/...') có thể đứng trước Git Bash tuỳ thứ tự PATH của
// từng shell/terminal — resolve status===0 với CẢ HAI nên không thể phân biệt bằng cách đó.
// Ở đây trỏ thẳng vào bash.exe của Git for Windows (bash thật sự hiểu path kiểu ổ đĩa Windows).
const BASH_BIN =
  process.platform === 'win32'
    ? ([
        process.env.MAPSLIBVN_GIT_BASH,
        process.env.ProgramFiles && `${process.env.ProgramFiles}\\Git\\bin\\bash.exe`,
        process.env['ProgramFiles(x86)'] &&
          `${process.env['ProgramFiles(x86)']}\\Git\\bin\\bash.exe`,
        process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
      ]
        .filter((candidate) => candidate !== undefined)
        .find((candidate) => existsSync(candidate)) ?? 'bash')
    : 'bash';
const HAS_BASH = spawnSync(BASH_BIN, ['--version']).status === 0;
/** @type {string[]} */
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** @param {string} content */
function md5(content) {
  return createHash('md5').update(content).digest('hex');
}

/** @param {string} pbfMd5 @param {string} [requestedAt] */
function metadata(
  pbfMd5,
  requestedAt = '2026-09-01T02:00:00.000Z',
  /** @type {string | undefined} */ vnRelease = undefined,
) {
  return {
    pbfMd5,
    pbfDate: '2026-09-01T00:00:00.000Z',
    requestedAt,
    previous: null,
    ...(vnRelease ? { vnRelease } : {}),
  };
}

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'mapslibvn-routing-graph-'));
  temporaryDirectories.push(root);
  const work = resolve(root, 'work');
  const graph = resolve(root, 'graph');
  mkdirSync(resolve(work, 'data/sources'), { recursive: true });
  mkdirSync(resolve(graph, GRAPH_FILES.prevDir), { recursive: true });
  writeFileSync(resolve(work, 'data/sources', GRAPH_FILES.pbf), 'source-new');
  writeFileSync(resolve(graph, GRAPH_FILES.tar), 'tar-current');
  writeFileSync(
    resolve(graph, GRAPH_FILES.meta),
    JSON.stringify(metadata('1'.repeat(32), undefined, 'vn-current')),
  );
  writeFileSync(resolve(graph, GRAPH_FILES.prevDir, GRAPH_FILES.tar), 'tar-previous');
  writeFileSync(
    resolve(graph, GRAPH_FILES.prevDir, GRAPH_FILES.meta),
    JSON.stringify(metadata('2'.repeat(32), undefined, 'vn-previous')),
  );
  mkdirSync(resolve(graph, GRAPH_FILES.tileDir));
  writeFileSync(resolve(graph, GRAPH_FILES.tileDir, 'stale'), 'tile');
  return { root, work, graph };
}

/**
 * @param {{ work: string, graph: string }} state
 * @param {string[]} args
 * @param {Record<string, string>} [extraEnv]
 */
function run({ work, graph }, args, extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MAPSLIBVN_WORK: work,
      MAPSLIBVN_VALHALLA: graph,
      NODE_ENV: 'test',
      MAPSLIBVN_ROUTING_TEST_SKIP_FLOCK: '1',
      ...extraEnv,
    },
  });
}

/** @param {() => boolean} predicate @param {number} [timeoutMs] */
async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timeout waiting for lifecycle condition');
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

/** @param {import('node:child_process').ChildProcess} child */
function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit) => child.once('exit', resolveExit));
}

/** @param {import('node:stream').Readable} stream */
function firstLine(stream) {
  return new Promise((resolveLine) => {
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffered += chunk;
      const newline = buffered.indexOf('\n');
      if (newline >= 0) resolveLine(buffered.slice(0, newline));
    });
  });
}

describe('preparePlan', () => {
  const md5 = 'a'.repeat(32);

  it('không có PBF nguồn → error', () => {
    expect(
      preparePlan({
        hasSource: false,
        sourceMd5: null,
        currentMd5: null,
        hasTar: false,
        force: false,
      }),
    ).toEqual({ action: 'error', reason: expect.stringContaining('download.mjs') });
  });

  it('md5 trùng và đã có tar → skip (idempotent); --force vẫn rebuild', () => {
    const state = {
      hasSource: true,
      sourceMd5: md5,
      currentMd5: md5,
      hasTar: true,
      force: false,
    };
    expect(preparePlan(state)).toEqual({
      action: 'skip',
      reason: expect.stringContaining(md5),
    });
    expect(preparePlan({ ...state, force: true })).toEqual({ action: 'rebuild', keepPrev: true });
  });

  it('chỉ skip khi cả PBF hash và VN release đều trùng', () => {
    const base = {
      hasSource: true,
      sourceMd5: md5,
      currentMd5: md5,
      hasTar: true,
      force: false,
      currentVnRelease: 'vn-b',
      desiredVnRelease: 'vn-b',
    };
    expect(preparePlan(base).action).toBe('skip');
    expect(preparePlan({ ...base, desiredVnRelease: 'vn-c' })).toEqual({
      action: 'rebuild',
      keepPrev: true,
    });
  });

  it('md5 khác hoặc chưa có tar → rebuild; keepPrev theo tar hiện có', () => {
    expect(
      preparePlan({
        hasSource: true,
        sourceMd5: md5,
        currentMd5: 'b'.repeat(32),
        hasTar: true,
        force: false,
      }),
    ).toEqual({ action: 'rebuild', keepPrev: true });
    expect(
      preparePlan({
        hasSource: true,
        sourceMd5: md5,
        currentMd5: null,
        hasTar: false,
        force: false,
      }),
    ).toEqual({ action: 'rebuild', keepPrev: false });
  });
});

describe('rollbackPlan / graphMeta / GRAPH_FILES', () => {
  it('rollback cần prev tar', () => {
    expect(rollbackPlan({ hasPrevTar: true })).toEqual({ action: 'swap' });
    expect(rollbackPlan({ hasPrevTar: false })).toEqual({
      action: 'error',
      reason: expect.stringContaining('prev/valhalla_tiles.tar'),
    });
  });

  it('graphMeta ghi md5, ngày PBF, thời điểm và bản trước', () => {
    const prev = {
      pbfMd5: 'x',
      pbfDate: '2026-09-01T00:00:00.000Z',
      requestedAt: '2026-09-01T02:00:00.000Z',
    };
    expect(
      graphMeta('y', new Date('2026-09-14T00:00:00Z'), new Date('2026-09-15T02:00:00Z'), prev),
    ).toEqual({
      pbfMd5: 'y',
      pbfDate: '2026-09-14T00:00:00.000Z',
      requestedAt: '2026-09-15T02:00:00.000Z',
      previous: {
        pbfMd5: 'x',
        pbfDate: '2026-09-01T00:00:00.000Z',
        requestedAt: '2026-09-01T02:00:00.000Z',
      },
    });
    expect(graphMeta('y', new Date(0), new Date(0), null).previous).toBeNull();
  });

  it('tên file khớp image valhalla-scripted (tileset_name=valhalla_tiles)', () => {
    expect(GRAPH_FILES).toEqual({
      pbf: 'vietnam.osm.pbf',
      tar: 'valhalla_tiles.tar',
      tileDir: 'valhalla_tiles',
      prevDir: 'prev',
      flag: 'reload.request',
      meta: 'graph.json',
    });
  });
});

describe('validation boundary', () => {
  it('chỉ chấp nhận đúng ba command và duy nhất --force cho prepare', () => {
    expect(parseRoutingGraphArgs(['prepare'])).toEqual({ command: 'prepare', force: false });
    expect(parseRoutingGraphArgs(['prepare', '--force'])).toEqual({
      command: 'prepare',
      force: true,
    });
    expect(
      parseRoutingGraphArgs([
        'rollback',
        '--expected-current',
        'vn-current',
        '--expected-target',
        'vn-previous',
      ]),
    ).toEqual({
      command: 'rollback',
      force: false,
      expectedCurrent: 'vn-current',
      expectedTarget: 'vn-previous',
    });
    expect(
      parseRoutingGraphArgs([
        'rollback',
        '--expected-current-md5',
        'a'.repeat(32),
        '--expected-target-md5',
        'b'.repeat(32),
      ]),
    ).toEqual({
      command: 'rollback',
      force: false,
      expectedCurrentMd5: 'a'.repeat(32),
      expectedTargetMd5: 'b'.repeat(32),
    });
    expect(parseRoutingGraphArgs(['status'])).toEqual({ command: 'status', force: false });
    expect(parseRoutingGraphArgs(['prepare', '--vn-release', 'vn-20260911'])).toEqual({
      command: 'prepare',
      force: false,
      vnRelease: 'vn-20260911',
    });
    expect(parseRoutingGraphArgs(['prepare', '--force', '--vn-release', 'vn-20260911'])).toEqual({
      command: 'prepare',
      force: true,
      vnRelease: 'vn-20260911',
    });
    expect(parseRoutingGraphArgs(['reset-empty'])).toEqual({
      command: 'reset-empty',
      force: false,
      vnRelease: null,
    });
    for (const argv of [
      [],
      ['prepare', '--froce'],
      ['prepare', '--force', 'junk'],
      ['rollback', '--force'],
      ['rollback'],
      ['rollback', '--expected-current-md5', 'a'.repeat(32)],
      [
        'rollback',
        '--expected-current',
        'vn-a',
        '--expected-target',
        'vn-b',
        '--expected-current-md5',
        'a'.repeat(32),
        '--expected-target-md5',
        'b'.repeat(32),
      ],
      ['status', 'junk'],
      ['prepare', '--vn-release', '../bad'],
      ['wat'],
    ]) {
      expect(() => parseRoutingGraphArgs(argv)).toThrow('Dùng:');
    }
  });

  it('từ chối graph.json sai schema thay vì dùng metadata không tin cậy', () => {
    expect(parseGraphMeta(metadata('a'.repeat(32)), 'graph.json').pbfMd5).toBe('a'.repeat(32));
    for (const value of [
      null,
      {},
      metadata('not-md5'),
      { ...metadata('a'.repeat(32)), requestedAt: 'not-a-date' },
    ]) {
      expect(() => parseGraphMeta(value, 'graph.json')).toThrow('graph.json');
    }
  });

  it('argv sai bị từ chối trước mọi mutation', () => {
    const state = fixture();
    const before = readdirSync(state.graph).sort();
    const result = run(state, ['prepare', '--froce']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Dùng:');
    expect(readdirSync(state.graph).sort()).toEqual(before);
  });

  it('prepare gắn VN release identity vào graph metadata', () => {
    const state = fixture();
    const result = run(state, ['prepare', '--vn-release', 'vn-20260911']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(resolve(state.graph, GRAPH_FILES.meta), 'utf8')).vnRelease).toBe(
      'vn-20260911',
    );
  });

  it('reset-empty chỉ dọn marker bootstrap lỗi khi volume thật sự rỗng', () => {
    const state = fixture();
    writeFileSync(resolve(state.graph, 'reload.in-progress'), 'initial-build\n');
    writeFileSync(resolve(state.graph, 'reload.failed'), '1\n');
    expect(run(state, ['reset-empty']).status).not.toBe(0);

    rmSync(resolve(state.graph, GRAPH_FILES.pbf), { force: true });
    rmSync(resolve(state.graph, GRAPH_FILES.tar), { force: true });
    rmSync(resolve(state.graph, GRAPH_FILES.tileDir), { recursive: true, force: true });
    rmSync(resolve(state.graph, GRAPH_FILES.meta), { force: true });
    rmSync(resolve(state.graph, GRAPH_FILES.prevDir), { recursive: true, force: true });
    const reset = run(state, ['reset-empty']);
    expect(reset.status, reset.stderr).toBe(0);
    expect(existsSync(resolve(state.graph, 'reload.in-progress'))).toBe(false);
    expect(existsSync(resolve(state.graph, 'reload.failed'))).toBe(false);
  });

  it.runIf(HAS_BASH)(
    'run.sh từ chối mọi timeout không phải số nguyên dương trước khi chạy entrypoint',
    () => {
      for (const [name, value] of /** @type {[string, string][]} */ ([
        ['RELOAD_POLL_SECONDS', '0'],
        ['RELOAD_POLL_SECONDS', 'abc'],
        ['FAIL_SLEEP_SECONDS', '-1'],
        ['STOP_GRACE_SECONDS', '0'],
      ])) {
        // Validation ở đây (positive_integer) chạy trước bước check flock trong run.sh,
        // nên chỉ cần bash là đủ — không cần flock/setsid như các test dưới "Valhalla wrapper race contract".
        const result = spawnSync(BASH_BIN, [RUN_SH], {
          encoding: 'utf8',
          env: { ...process.env, [name]: value },
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`${name} phải là số nguyên dương`);
      }
    },
  );
});

describe('transaction recovery', () => {
  it.each(PREPARE_FAULT_POINTS)('recover prepare sau fault tại %s', (point) => {
    const state = fixture();
    const crashed = run(state, ['prepare', '--force'], {
      NODE_ENV: 'test',
      MAPSLIBVN_ROUTING_FAULT_AFTER: point,
    });
    expect(crashed.status).toBe(91);

    const recovered = run(state, ['status']);
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(existsSync(resolve(state.graph, GRAPH_FILES.tar))).toBe(false);
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.prevDir, GRAPH_FILES.tar), 'utf8')).toBe(
      'tar-current',
    );
    const active = JSON.parse(readFileSync(resolve(state.graph, GRAPH_FILES.meta), 'utf8'));
    const previous = JSON.parse(
      readFileSync(resolve(state.graph, GRAPH_FILES.prevDir, GRAPH_FILES.meta), 'utf8'),
    );
    expect(active.pbfMd5).toBe(md5('source-new'));
    expect(previous.pbfMd5).toBe('1'.repeat(32));
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.pbf), 'utf8')).toBe('source-new');
    expect(existsSync(resolve(state.graph, GRAPH_FILES.tileDir))).toBe(false);
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.flag), 'utf8')).toBe('rebuild\n');
    expect(readdirSync(state.graph).some((name) => name.includes('.txn-'))).toBe(false);
    expect(existsSync(resolve(state.graph, '.routing-graph.lock'))).toBe(false);
    expect(existsSync(resolve(state.graph, '.routing-graph.transaction.json'))).toBe(false);
  });

  it.each(ROLLBACK_FAULT_POINTS)('recover rollback sau fault tại %s', (point) => {
    const state = fixture();
    const crashed = run(
      state,
      ['rollback', '--expected-current', 'vn-current', '--expected-target', 'vn-previous'],
      {
        NODE_ENV: 'test',
        MAPSLIBVN_ROUTING_FAULT_AFTER: point,
      },
    );
    expect(crashed.status).toBe(91);

    const recovered = run(state, ['status']);
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.tar), 'utf8')).toBe('tar-previous');
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.prevDir, GRAPH_FILES.tar), 'utf8')).toBe(
      'tar-current',
    );
    const active = JSON.parse(readFileSync(resolve(state.graph, GRAPH_FILES.meta), 'utf8'));
    const previous = JSON.parse(
      readFileSync(resolve(state.graph, GRAPH_FILES.prevDir, GRAPH_FILES.meta), 'utf8'),
    );
    expect(active.pbfMd5).toBe('2'.repeat(32));
    expect(previous.pbfMd5).toBe('1'.repeat(32));
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.flag), 'utf8')).toBe('rollback\n');
    expect(readdirSync(state.graph).some((name) => name.includes('.txn-'))).toBe(false);
    expect(existsSync(resolve(state.graph, '.routing-graph.lock'))).toBe(false);
    expect(existsSync(resolve(state.graph, '.routing-graph.transaction.json'))).toBe(false);
  });

  it.runIf(HAS_FLOCK)('kernel flock từ chối contention và tự nhả sau crash', () => {
    const state = fixture();
    const lock = resolve(state.graph, '.routing-graph.lock');
    const contention = spawnSync(
      'flock',
      [lock, 'sh', '-c', 'flock --nonblock "$LOCK_FILE" true'],
      { env: { ...process.env, LOCK_FILE: lock } },
    );
    expect(contention.status).not.toBe(0);
    const crashed = spawnSync('flock', [lock, 'sh', '-c', 'kill -KILL $$']);
    expect(crashed.status).not.toBe(0);
    expect(spawnSync('flock', ['--nonblock', lock, 'true']).status).toBe(0);
  });

  it('từ chối transaction mới khi reload/build trước còn pending', () => {
    const state = fixture();
    writeFileSync(resolve(state.graph, GRAPH_FILES.flag), 'rebuild\n');
    const result = run(state, ['prepare']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('reload/build trước');
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.tar), 'utf8')).toBe('tar-current');
  });

  it('rollback bị từ chối khi build còn active, chưa có failed marker', () => {
    const state = fixture();
    writeFileSync(resolve(state.graph, 'reload.in-progress'), 'rebuild\n');
    const result = run(state, [
      'rollback',
      '--expected-current',
      'vn-current',
      '--expected-target',
      'vn-previous',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('đang chạy');
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.tar), 'utf8')).toBe('tar-current');
  });

  it('rollback được phép thay graph đã build lỗi và phát cờ rollback mới', () => {
    const state = fixture();
    writeFileSync(resolve(state.graph, 'reload.in-progress'), 'rebuild\n');
    writeFileSync(resolve(state.graph, 'reload.failed'), '42\n');
    const result = run(state, [
      'rollback',
      '--expected-current',
      'vn-current',
      '--expected-target',
      'vn-previous',
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.tar), 'utf8')).toBe('tar-previous');
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.flag), 'utf8')).toBe('rollback\n');
    const status = run(state, ['status']);
    expect(JSON.parse(status.stdout).buildFailed).toBe(true);
  });

  it('prepare không có tar hiện tại giữ nguyên cặp prev tar/meta đã có', () => {
    const state = fixture();
    rmSync(resolve(state.graph, GRAPH_FILES.tar));
    rmSync(resolve(state.graph, GRAPH_FILES.meta));
    const result = run(state, ['prepare', '--force']);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.prevDir, GRAPH_FILES.tar), 'utf8')).toBe(
      'tar-previous',
    );
    expect(
      JSON.parse(readFileSync(resolve(state.graph, GRAPH_FILES.prevDir, GRAPH_FILES.meta), 'utf8'))
        .pbfMd5,
    ).toBe('2'.repeat(32));
  });

  it('retry release B không thay prev A; sau đó rollback B về A', () => {
    const state = fixture();
    const first = run(state, ['prepare', '--vn-release', 'vn-b']);
    expect(first.status, first.stderr).toBe(0);
    writeFileSync(resolve(state.graph, GRAPH_FILES.tar), 'tar-b');
    rmSync(resolve(state.graph, GRAPH_FILES.flag), { force: true });

    const retry = run(state, ['prepare', '--vn-release', 'vn-b']);
    expect(retry.status, retry.stderr).toBe(0);
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.prevDir, GRAPH_FILES.tar), 'utf8')).toBe(
      'tar-current',
    );
    expect(
      JSON.parse(readFileSync(resolve(state.graph, GRAPH_FILES.prevDir, GRAPH_FILES.meta), 'utf8'))
        .vnRelease,
    ).toBe('vn-current');

    const rollback = run(state, [
      'rollback',
      '--expected-current',
      'vn-b',
      '--expected-target',
      'vn-current',
    ]);
    expect(rollback.status, rollback.stderr).toBe(0);
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.tar), 'utf8')).toBe('tar-current');
  });

  it('revalidate expected identities dưới lock sau status để chặn TOCTOU', async () => {
    const state = fixture();
    const before = run(state, ['status']);
    expect(JSON.parse(before.stdout).activeGraph.vnRelease).toBe('vn-current');
    const pause = resolve(state.graph, 'rollback-revalidate');
    const child = spawn(
      process.execPath,
      [SCRIPT, 'rollback', '--expected-current', 'vn-current', '--expected-target', 'vn-previous'],
      {
        env: {
          ...process.env,
          MAPSLIBVN_WORK: state.work,
          MAPSLIBVN_VALHALLA: state.graph,
          NODE_ENV: 'test',
          MAPSLIBVN_ROUTING_TEST_SKIP_FLOCK: '1',
          MAPSLIBVN_ROUTING_TEST_PAUSE_AFTER_AUTH_FILE: pause,
        },
        stdio: 'ignore',
      },
    );
    await waitFor(() => existsSync(pause));
    writeFileSync(
      resolve(state.graph, GRAPH_FILES.meta),
      JSON.stringify(metadata('1'.repeat(32), undefined, 'vn-changed')),
    );
    writeFileSync(`${pause}.release`, 'release\n');
    expect(await waitForExit(child)).not.toBe(0);
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.tar), 'utf8')).toBe('tar-current');
    expect(existsSync(resolve(state.graph, GRAPH_FILES.flag))).toBe(false);
  });

  it('plain prepare A → force B → rollback legacy bằng expected MD5 B/A', () => {
    const state = fixture();
    rmSync(state.graph, { recursive: true, force: true });
    mkdirSync(state.graph, { recursive: true });

    const prepareA = run(state, ['prepare']);
    expect(prepareA.status, prepareA.stderr).toBe(0);
    const metaA = JSON.parse(readFileSync(resolve(state.graph, GRAPH_FILES.meta), 'utf8'));
    expect(metaA.vnRelease).toBeUndefined();
    writeFileSync(resolve(state.graph, GRAPH_FILES.tar), 'tar-a');
    rmSync(resolve(state.graph, GRAPH_FILES.flag), { force: true });

    writeFileSync(resolve(state.work, 'data/sources', GRAPH_FILES.pbf), 'source-b');
    const prepareB = run(state, ['prepare', '--force']);
    expect(prepareB.status, prepareB.stderr).toBe(0);
    const metaB = JSON.parse(readFileSync(resolve(state.graph, GRAPH_FILES.meta), 'utf8'));
    writeFileSync(resolve(state.graph, GRAPH_FILES.tar), 'tar-b');
    rmSync(resolve(state.graph, GRAPH_FILES.flag), { force: true });

    const mismatch = run(state, [
      'rollback',
      '--expected-current-md5',
      'f'.repeat(32),
      '--expected-target-md5',
      metaA.pbfMd5,
    ]);
    expect(mismatch.status).not.toBe(0);
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.tar), 'utf8')).toBe('tar-b');
    expect(existsSync(resolve(state.graph, '.routing-graph.transaction.json'))).toBe(false);

    const rollback = run(state, [
      'rollback',
      '--expected-current-md5',
      metaB.pbfMd5,
      '--expected-target-md5',
      metaA.pbfMd5,
    ]);
    expect(rollback.status, rollback.stderr).toBe(0);
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.tar), 'utf8')).toBe('tar-a');
  });
});

describe('Valhalla wrapper race contract', () => {
  it('cài PBF mới dưới journal trước khi dời tar và run.sh đợi journal trước setsid', () => {
    expect(PREPARE_FAULT_POINTS.indexOf('pbf-installed')).toBeLessThan(
      PREPARE_FAULT_POINTS.indexOf('current-tar-staged'),
    );
    const wrapper = readFileSync(RUN_SH, 'utf8');
    expect(wrapper).toContain('.routing-graph.transaction.json');
    const journalCheck = wrapper.indexOf('[[ -f "${JOURNAL}" ]]');
    const childSpawn = wrapper.indexOf('setsid "${ENTRYPOINT}"');
    expect(journalCheck).toBeGreaterThanOrEqual(0);
    expect(childSpawn).toBeGreaterThanOrEqual(0);
    expect(journalCheck).toBeLessThan(childSpawn);
  });

  it('compose cho wrapper đủ thời gian TERM grace trước Docker KILL', () => {
    const compose = readFileSync(SERVER_COMPOSE, 'utf8');
    expect(compose).toContain('stop_grace_period: 45s');
    expect(readFileSync(RUN_SH, 'utf8')).toContain('STOP_GRACE_SECONDS:-30');
  });

  it('readiness curl có connect/total timeout hữu hạn dưới stop grace', () => {
    const wrapper = readFileSync(RUN_SH, 'utf8');
    expect(wrapper).toContain('--connect-timeout "${READY_CONNECT_TIMEOUT_SECONDS}"');
    expect(wrapper).toContain('--max-time "${READY_MAX_TIME_SECONDS}"');
    expect(wrapper).toContain('READY_MAX_TIME_SECONDS >= STOP_GRACE_SECONDS');
  });

  it('dev compose dùng cùng Valhalla digest đã xác minh như server', () => {
    const digest =
      'ghcr.io/valhalla/valhalla-scripted:3.8.3@sha256:24ef7955899dececb94e26c6dfb89d64fabfae875f980432694b0261eb6c251b';
    expect(readFileSync(DEV_COMPOSE, 'utf8')).toContain(`image: ${digest}`);
    expect(readFileSync(SERVER_COMPOSE, 'utf8')).toContain(`image: ${digest}`);
  });

  it('không có biến môi trường công khai để bỏ qua kernel flock', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    expect(script).not.toContain('MAPSLIBVN_ROUTING_FLOCK_CHILD');
    expect(script).toContain('process.exitCode = /** @type {number} */ (error.exitCode ?? 1)');
  });

  it('wrapper chỉ công bố failed sau khi child lỗi và xoá marker trước lần start kế', () => {
    const wrapper = readFileSync(RUN_SH, 'utf8');
    expect(wrapper.indexOf('wait "${child}"')).toBeLessThan(
      wrapper.indexOf('mv -f "${failed_tmp}" "${FAILED}"'),
    );
    expect(wrapper.indexOf('rm -f "${FAILED}"')).toBeLessThan(
      wrapper.indexOf('setsid "${ENTRYPOINT}"'),
    );
    expect(wrapper).toContain('if [[ -f "${FLAG}" ]]');
    expect(wrapper).toContain('continue 2');
    expect(wrapper).toContain(
      'docker compose -f infra/server/compose.yml --env-file infra/server/.env run --rm pipeline node scripts/data-rollback.mjs',
    );
    expect(wrapper).not.toContain('rollback an toàn: pnpm data:rollback');
  });

  it('wrapper giữ cùng kernel lock từ trước journal check đến sau child spawn', () => {
    const wrapper = readFileSync(RUN_SH, 'utf8');
    const lifecycleLoop = wrapper.indexOf('while true; do');
    const acquire = wrapper.indexOf('acquire_start_lock', lifecycleLoop);
    const journalCheck = wrapper.indexOf('[[ -f "${JOURNAL}" ]]', lifecycleLoop);
    const spawnChild = wrapper.indexOf('setsid "${ENTRYPOINT}"', lifecycleLoop);
    const release = wrapper.indexOf('release_start_lock', spawnChild);
    expect(wrapper).toContain('.routing-graph.lock');
    expect(acquire).toBeLessThan(journalCheck);
    expect(journalCheck).toBeLessThan(spawnChild);
    expect(spawnChild).toBeLessThan(release);
  });

  it('volume rỗng chờ bootstrap dưới lock và không spawn upstream', () => {
    const wrapper = readFileSync(RUN_SH, 'utf8');
    const emptyCheck = wrapper.indexOf(
      '[[ ! -f "${CUSTOM_FILES}/vietnam.osm.pbf" && ! -f "${CUSTOM_FILES}/valhalla_tiles.tar" ]]',
    );
    const childSpawn = wrapper.indexOf('setsid "${ENTRYPOINT}"');
    expect(emptyCheck).toBeGreaterThanOrEqual(0);
    expect(childSpawn).toBeGreaterThanOrEqual(0);
    expect(emptyCheck).toBeLessThan(childSpawn);
  });

  it.runIf(HAS_LINUX_LIFECYCLE_TOOLS)(
    'wrapper retry đợi rollback commit và nhả cùng lock rồi mới spawn upstream',
    async () => {
      const state = fixture();
      const pause = resolve(state.graph, 'rollback-authorized');
      const upstreamPid = resolve(state.graph, 'upstream.pid');
      const fakeEntrypoint = resolve(state.root, 'fake-entrypoint.sh');
      writeFileSync(
        fakeEntrypoint,
        `#!/usr/bin/env bash\nprintf '%s\\n' "\$\$" > "${upstreamPid}"\ntrap 'exit 0' TERM INT\nwhile true; do sleep 1; done\n`,
      );
      chmodSync(fakeEntrypoint, 0o755);
      writeFileSync(resolve(state.graph, 'reload.in-progress'), 'rebuild\n');
      writeFileSync(resolve(state.graph, 'reload.failed'), '42\n');

      const rollback = spawn(
        process.execPath,
        [
          SCRIPT,
          'rollback',
          '--expected-current',
          'vn-current',
          '--expected-target',
          'vn-previous',
        ],
        {
          env: {
            ...process.env,
            MAPSLIBVN_WORK: state.work,
            MAPSLIBVN_VALHALLA: state.graph,
            NODE_ENV: 'test',
            MAPSLIBVN_ROUTING_TEST_PAUSE_AFTER_AUTH_FILE: pause,
          },
          stdio: 'ignore',
        },
      );
      await waitFor(() => existsSync(pause));

      const wrapper = spawn(BASH_BIN, [RUN_SH], {
        env: {
          ...process.env,
          CUSTOM_FILES: state.graph,
          VALHALLA_ENTRYPOINT: fakeEntrypoint,
          RELOAD_POLL_SECONDS: '1',
          FAIL_SLEEP_SECONDS: '5',
          STOP_GRACE_SECONDS: '3',
          READY_CONNECT_TIMEOUT_SECONDS: '1',
          READY_MAX_TIME_SECONDS: '2',
        },
        stdio: 'ignore',
      });
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      expect(existsSync(upstreamPid)).toBe(false);

      writeFileSync(`${pause}.release`, 'release\n');
      expect(await waitForExit(rollback)).toBe(0);
      await waitFor(() => existsSync(upstreamPid));
      wrapper.kill('SIGTERM');
      expect(await waitForExit(wrapper)).toBe(143);
    },
  );

  it.runIf(HAS_LINUX_LIFECYCLE_TOOLS)(
    'readiness endpoint treo vẫn nhường vòng lặp cho reload trong timeout hữu hạn',
    async () => {
      const state = fixture();
      const countFile = resolve(state.graph, 'start-count');
      const fakeEntrypoint = resolve(state.root, 'fake-hanging-ready.sh');
      writeFileSync(
        fakeEntrypoint,
        `#!/usr/bin/env bash\ncount=0\n[[ -f "${countFile}" ]] && count=\$(cat "${countFile}")\nprintf '%s\\n' \$((count + 1)) > "${countFile}"\ntrap 'exit 0' TERM INT\nwhile true; do sleep 1; done\n`,
      );
      chmodSync(fakeEntrypoint, 0o755);
      writeFileSync(resolve(state.graph, 'reload.in-progress'), 'rebuild\n');
      const hangingReady = spawn(
        process.execPath,
        [
          '-e',
          "const n=require('node:net');const s=n.createServer(()=>{});s.listen(0,'127.0.0.1',()=>console.log(s.address().port))",
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const port = await firstLine(hangingReady.stdout);
      const wrapper = spawn(BASH_BIN, [RUN_SH], {
        env: {
          ...process.env,
          CUSTOM_FILES: state.graph,
          VALHALLA_ENTRYPOINT: fakeEntrypoint,
          VALHALLA_READY_URL: `http://127.0.0.1:${port}/status`,
          RELOAD_POLL_SECONDS: '1',
          FAIL_SLEEP_SECONDS: '5',
          STOP_GRACE_SECONDS: '3',
          READY_CONNECT_TIMEOUT_SECONDS: '1',
          READY_MAX_TIME_SECONDS: '2',
        },
        stdio: 'ignore',
      });
      try {
        await waitFor(() => existsSync(countFile));
        writeFileSync(resolve(state.graph, GRAPH_FILES.flag), 'rollback\n');
        await waitFor(() => Number(readFileSync(countFile, 'utf8')) >= 2, 7_000);
      } finally {
        wrapper.kill('SIGTERM');
        hangingReady.kill('SIGTERM');
        await Promise.all([waitForExit(wrapper), waitForExit(hangingReady)]);
      }
    },
  );
});
