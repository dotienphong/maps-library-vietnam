import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

// Phần thuần (test được) của scripts/routing-test.mjs — spec dẫn đường A mục 7.3.
export const TEST_KEY = 'mlv_live_routingtest0000000000000';
export const DEFAULT_API_PORT = 8798;

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {{ compose: boolean, valhallaBase: string, vroomBase: string, apiPort: number, capture: boolean, down: boolean }}
 */
export function parseRoutingTestArgs(argv, env) {
  const compose = !argv.includes('--no-compose');
  let valhallaBase = env.VALHALLA_BASE?.replace(/\/+$/, '') ?? '';
  let vroomBase = env.VROOM_BASE?.replace(/\/+$/, '') ?? '';
  if (!compose && !valhallaBase) {
    throw new Error('--no-compose cần VALHALLA_BASE trỏ tới Valhalla đang chạy');
  }
  if (!compose && !vroomBase) {
    throw new Error('--no-compose cần VROOM_BASE trỏ tới vroom-express đang chạy (…/fleet)');
  }
  if (compose) {
    valhallaBase = `http://127.0.0.1:${env.VALHALLA_PORT ?? '8002'}`;
    vroomBase = `http://127.0.0.1:${env.VROOM_PORT ?? '3000'}/fleet`;
  }
  return {
    compose,
    valhallaBase,
    vroomBase,
    apiPort: DEFAULT_API_PORT,
    capture: argv.includes('--capture'),
    down: argv.includes('--down'),
  };
}

/**
 * Entry KV `apikey:<sha256>` cho wrangler dev local: auth đọc KV trước nên không cần Postgres.
 * @param {string} keyHash
 */
export function testAuthInfo(keyHash) {
  return {
    keyHash,
    keyPrefix: TEST_KEY.slice(0, 17),
    tenantId: '00000000-0000-4000-8000-0000000000ee',
    plan: 'internal',
    kind: 'server',
    scopes: ['places:read'],
    allowedOrigins: [],
    quotaPlacesPerDay: null,
    quotaDirectionsPerDay: null,
  };
}

/**
 * Chờ URL trả 2xx.
 * @param {string} url
 * @param {number} timeoutMs
 * @param {{ fetchImpl?: typeof fetch, intervalMs?: number, onTick?: (ms: number) => void }} [options]
 */
export async function waitForOk(url, timeoutMs, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const interval = options.intervalMs ?? 5_000;
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return;
    } catch {
      // chưa lên
    }
    const elapsed = Date.now() - started;
    if (elapsed > timeoutMs) {
      throw new Error(`${url} không lên trong ${Math.round(timeoutMs / 1000)} giây`);
    }
    options.onTick?.(elapsed);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Không cho một Worker cũ trên cùng port làm readiness giả mạo.
 * @param {number} port
 * @param {{ createServerImpl?: typeof createServer }} [options]
 */
export async function assertPortAvailable(port, options = {}) {
  const createServerImpl = options.createServerImpl ?? createServer;
  /** @type {Promise<void>} */
  const available = new Promise((resolve, reject) => {
    const server = createServerImpl();
    server.once('error', (error) => {
      if ('code' in error && error.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Cổng API ${port} đang được dùng; dừng tiến trình cũ trước khi chạy test:routing`,
          ),
        );
        return;
      }
      reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  await available;
}

/** @param {{ exitCode: number | null }} child */
function assertProcessRunning(child) {
  if (child.exitCode !== null) {
    throw new Error(`wrangler dev thoát sớm (exit ${child.exitCode})`);
  }
}

/**
 * Chờ Worker vừa spawn trả 2xx và vẫn còn sống — không chấp nhận healthz của tiến trình cũ.
 * @param {string} url
 * @param {{ exitCode: number | null }} child
 * @param {number} timeoutMs
 * @param {{ expectedEnvironment: string, fetchImpl?: typeof fetch, intervalMs?: number, getError?: () => Error | undefined }} options
 */
export async function waitForProcessOk(url, child, timeoutMs, options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const interval = options.intervalMs ?? 1_000;
  const started = Date.now();
  for (;;) {
    const spawnError = options.getError?.();
    if (spawnError) throw spawnError;
    assertProcessRunning(child);
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) {
        const health = await response.json();
        const afterFetchError = options.getError?.();
        if (afterFetchError) throw afterFetchError;
        assertProcessRunning(child);
        if (health?.environment === options.expectedEnvironment) return;
      }
    } catch {
      const afterFetchError = options.getError?.();
      if (afterFetchError) throw afterFetchError;
      assertProcessRunning(child);
    }
    const elapsed = Date.now() - started;
    if (elapsed > timeoutMs) {
      throw new Error(`${url} không lên trong ${Math.round(timeoutMs / 1000)} giây`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * `docker compose up` có thể tạo container rồi mới trả lỗi; khi `--down`, luôn thử stop lại.
 * @param {{ compose: boolean, down: boolean }} opts
 * @param {boolean} startAttempted
 */
export function shouldStopAttemptedValhalla(opts, startAttempted) {
  return opts.compose && opts.down && startAttempted;
}

/** @param {import('node:child_process').ChildProcess} child */
function observeChildClose(child) {
  let closed = false;
  /** @type {(value: void | PromiseLike<void>) => void} */
  let resolve;
  /** @type {(reason?: unknown) => void} */
  let reject;
  /** @type {Promise<void>} */
  const completion = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const onClose = () => {
    closed = true;
    resolve();
  };
  const onError = (/** @type {unknown} */ error) => {
    closed = true;
    reject(error);
  };
  child.once('close', onClose);
  child.once('error', onError);
  return {
    closed: () => closed,
    detach: () => {
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
    },
    wait: async () => {
      if (closed) return;
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timeoutId;
      /** @type {Promise<void>} */
      const timeout = new Promise((_, timeoutReject) => {
        timeoutId = setTimeout(
          () => timeoutReject(new Error('wrangler dev không dừng trong 5 giây')),
          5_000,
        );
      });
      try {
        await Promise.race([completion, timeout]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        child.removeListener('close', onClose);
        child.removeListener('error', onError);
      }
    },
  };
}

/**
 * Dừng cây process Wrangler, kể cả khi Windows chỉ spawn launcher pnpm.
 * @param {import('node:child_process').ChildProcess} child
 * @param {{ platform?: NodeJS.Platform, spawnSyncImpl?: (command: string, args: string[], options: import('node:child_process').SpawnSyncOptions) => { status: number | null, error?: Error }, killProcessGroup?: typeof process.kill }} [options]
 */
export function createProcessStopper(child, options = {}) {
  const platform = options.platform ?? process.platform;
  const spawnSyncImpl =
    options.spawnSyncImpl ??
    ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));
  const killProcessGroup = options.killProcessGroup ?? process.kill;
  let stopped = false;

  return async () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode !== null) return;
    const observed = observeChildClose(child);
    if (child.exitCode !== null) {
      observed.detach();
      return;
    }
    /** @type {Error | undefined} */
    let taskkillError;
    try {
      if (platform === 'win32' && child.pid) {
        const result = spawnSyncImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
        });
        if (result.error) throw result.error;
        if (result.status !== 0) taskkillError = new Error(`taskkill thoát mã ${result.status}`);
      } else if (child.pid) {
        killProcessGroup(-child.pid, 'SIGTERM');
      } else {
        child.kill('SIGTERM');
      }
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') {
        observed.detach();
        throw error;
      }
    }
    if (child.exitCode !== null || observed.closed()) {
      observed.detach();
      return;
    }
    if (taskkillError && platform !== 'win32') {
      observed.detach();
      throw taskkillError;
    }
    await observed.wait();
  };
}

/**
 * Một cleanup promise dùng chung cho failure sớm, finally, SIGINT và SIGTERM.
 * @param {{ stopWrangler: () => Promise<void>, stopValhalla: () => Promise<void> }} actions
 */
export function createRoutingCleanup(actions) {
  let cleanup;
  return () => {
    cleanup ??= (async () => {
      try {
        await actions.stopWrangler();
      } finally {
        await actions.stopValhalla();
      }
    })();
    return cleanup;
  };
}
