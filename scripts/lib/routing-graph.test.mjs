import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
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
const RUN_SH = resolve(import.meta.dirname, '../../infra/server/valhalla/run.sh');
const SERVER_COMPOSE = resolve(import.meta.dirname, '../../infra/server/compose.yml');
const HAS_FLOCK = spawnSync('flock', ['--version']).status === 0;
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
function metadata(pbfMd5, requestedAt = '2026-09-01T02:00:00.000Z') {
  return {
    pbfMd5,
    pbfDate: '2026-09-01T00:00:00.000Z',
    requestedAt,
    previous: null,
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
  writeFileSync(resolve(graph, GRAPH_FILES.meta), JSON.stringify(metadata('1'.repeat(32))));
  writeFileSync(resolve(graph, GRAPH_FILES.prevDir, GRAPH_FILES.tar), 'tar-previous');
  writeFileSync(
    resolve(graph, GRAPH_FILES.prevDir, GRAPH_FILES.meta),
    JSON.stringify(metadata('2'.repeat(32))),
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
    expect(parseRoutingGraphArgs(['rollback'])).toEqual({ command: 'rollback', force: false });
    expect(parseRoutingGraphArgs(['status'])).toEqual({ command: 'status', force: false });
    for (const argv of [
      [],
      ['prepare', '--froce'],
      ['prepare', '--force', 'junk'],
      ['rollback', '--force'],
      ['status', 'junk'],
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

  it('run.sh từ chối mọi timeout không phải số nguyên dương trước khi chạy entrypoint', () => {
    for (const [name, value] of /** @type {[string, string][]} */ ([
      ['RELOAD_POLL_SECONDS', '0'],
      ['RELOAD_POLL_SECONDS', 'abc'],
      ['FAIL_SLEEP_SECONDS', '-1'],
      ['STOP_GRACE_SECONDS', '0'],
    ])) {
      const result = spawnSync('/bin/bash', [RUN_SH], {
        encoding: 'utf8',
        env: { ...process.env, [name]: value },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`${name} phải là số nguyên dương`);
    }
  });
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
    const crashed = run(state, ['rollback'], {
      NODE_ENV: 'test',
      MAPSLIBVN_ROUTING_FAULT_AFTER: point,
    });
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

  it('rollback được phép thay graph đang build lỗi và phát cờ rollback mới', () => {
    const state = fixture();
    writeFileSync(resolve(state.graph, 'reload.in-progress'), 'rebuild\n');
    const result = run(state, ['rollback']);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.tar), 'utf8')).toBe('tar-previous');
    expect(readFileSync(resolve(state.graph, GRAPH_FILES.flag), 'utf8')).toBe('rollback\n');
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
});

describe('Valhalla wrapper race contract', () => {
  it('cài PBF mới dưới journal trước khi dời tar và run.sh đợi journal trước setsid', () => {
    expect(PREPARE_FAULT_POINTS.indexOf('pbf-installed')).toBeLessThan(
      PREPARE_FAULT_POINTS.indexOf('current-tar-staged'),
    );
    const wrapper = readFileSync(RUN_SH, 'utf8');
    expect(wrapper).toContain('.routing-graph.transaction.json');
    expect(wrapper.indexOf('while [[ -f "${JOURNAL}" ]]')).toBeLessThan(
      wrapper.indexOf('setsid "${ENTRYPOINT}"'),
    );
  });

  it('compose cho wrapper đủ thời gian TERM grace trước Docker KILL', () => {
    const compose = readFileSync(SERVER_COMPOSE, 'utf8');
    expect(compose).toContain('stop_grace_period: 45s');
    expect(readFileSync(RUN_SH, 'utf8')).toContain('STOP_GRACE_SECONDS:-30');
  });
});
