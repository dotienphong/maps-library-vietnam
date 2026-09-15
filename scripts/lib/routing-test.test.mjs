import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  assertPortAvailable,
  createProcessStopper,
  createRoutingCleanup,
  parseRoutingTestArgs,
  shouldStopAttemptedValhalla,
  TEST_KEY,
  testAuthInfo,
  waitForProcessOk,
} from './routing-test.mjs';

describe('parseRoutingTestArgs', () => {
  it('mặc định máy dev: dựng compose, valhalla 8002, api 8798', () => {
    expect(parseRoutingTestArgs([], {})).toEqual({
      compose: true,
      valhallaBase: 'http://127.0.0.1:8002',
      apiPort: 8798,
      capture: false,
      down: false,
    });
  });

  it('--no-compose bắt buộc VALHALLA_BASE; --capture/--down; VALHALLA_PORT đổi cổng', () => {
    expect(() => parseRoutingTestArgs(['--no-compose'], {})).toThrow(/VALHALLA_BASE/);
    expect(
      parseRoutingTestArgs(['--no-compose', '--capture', '--down'], {
        VALHALLA_BASE: 'http://valhalla:8002/',
      }),
    ).toEqual({
      compose: false,
      valhallaBase: 'http://valhalla:8002',
      apiPort: 8798,
      capture: true,
      down: true,
    });
    expect(parseRoutingTestArgs([], { VALHALLA_PORT: '8102' }).valhallaBase).toBe(
      'http://127.0.0.1:8102',
    );
  });
});

describe('testAuthInfo', () => {
  it('khoá test internal, scope places:read, quota null (KV cache của auth)', () => {
    expect(TEST_KEY).toMatch(/^mlv_live_[0-9A-Za-z]{24}$/);
    expect(testAuthInfo('abc')).toEqual({
      keyHash: 'abc',
      keyPrefix: TEST_KEY.slice(0, 17),
      tenantId: '00000000-0000-4000-8000-0000000000ee',
      plan: 'internal',
      kind: 'server',
      scopes: ['places:read'],
      allowedOrigins: [],
      quotaPlacesPerDay: null,
      quotaDirectionsPerDay: null,
    });
  });
});

describe('routing harness lifecycle', () => {
  it('chặn cổng API đã có tiến trình lắng nghe trước khi spawn Wrangler', async () => {
    /** @type {(error: { code: string }) => void} */
    let onError = () => {
      throw new Error('server không đăng ký error handler');
    };
    /** @type {any} */
    const server = {
      once(/** @type {string} */ event, /** @type {any} */ callback) {
        if (event === 'error') onError = callback;
        return this;
      },
      listen() {
        queueMicrotask(() => onError({ code: 'EADDRINUSE' }));
        return this;
      },
    };

    const createServerImpl = /** @type {typeof import('node:net').createServer} */ (
      /** @type {unknown} */ (() => server)
    );
    await expect(assertPortAvailable(8798, { createServerImpl })).rejects.toThrow(
      /8798.*đang được dùng/,
    );
  });

  it('dừng đúng cây tiến trình Windows một lần và chờ child đóng', async () => {
    /** @type {any} */
    const child = new EventEmitter();
    child.pid = 4321;
    child.exitCode = null;
    /** @type {[string, string[]][]} */
    const calls = [];
    const stop = createProcessStopper(child, {
      platform: 'win32',
      spawnSyncImpl: (command, args) => {
        calls.push([command, args]);
        queueMicrotask(() => {
          child.exitCode = 0;
          child.emit('close');
        });
        return { status: 0 };
      },
    });

    await stop();
    await stop();

    expect(calls).toEqual([['taskkill', ['/PID', '4321', '/T', '/F']]]);
  });

  it('không bỏ lỡ close khi taskkill báo nonzero sau khi child vừa thoát', async () => {
    /** @type {any} */
    const child = new EventEmitter();
    child.pid = 9876;
    child.exitCode = null;
    const stop = createProcessStopper(child, {
      platform: 'win32',
      spawnSyncImpl: () => {
        queueMicrotask(() => {
          child.exitCode = 0;
          child.emit('close');
        });
        return { status: 1 };
      },
    });

    await expect(stop()).resolves.toBeUndefined();
  });

  it('không chấp nhận healthz của tiến trình cũ khi Wrangler vừa thoát', async () => {
    const child = { exitCode: 1 };
    const fetchImpl = async () => {
      throw new Error('không được fetch healthz khi child đã thoát');
    };

    await expect(
      waitForProcessOk('http://127.0.0.1:8798/healthz', child, 10, {
        expectedEnvironment: 'routing-test-current',
        fetchImpl,
      }),
    ).rejects.toThrow(/wrangler dev thoát sớm/);
  });

  it('bỏ qua healthz 2xx cũ có environment khác rồi báo child đã thoát', async () => {
    /** @type {{ exitCode: number | null }} */
    const child = { exitCode: null };
    const fetchImpl = /** @type {typeof fetch} */ (
      async () => {
        child.exitCode = 1;
        return /** @type {Response} */ (
          /** @type {unknown} */ ({
            ok: true,
            json: async () => ({ ok: true, environment: 'routing-test-stale' }),
          })
        );
      }
    );

    await expect(
      waitForProcessOk('http://127.0.0.1:8798/healthz', child, 10, {
        expectedEnvironment: 'routing-test-current',
        fetchImpl,
        intervalMs: 0,
      }),
    ).rejects.toThrow(/wrangler dev thoát sớm/);
  });

  it('không coi healthz 2xx environment cũ là ready khi child vẫn sống', async () => {
    /** @type {{ exitCode: number | null }} */
    const child = { exitCode: null };

    await expect(
      waitForProcessOk('http://127.0.0.1:8798/healthz', child, 0, {
        expectedEnvironment: 'routing-test-current',
        fetchImpl: /** @type {typeof fetch} */ (
          async () =>
            /** @type {Response} */ (
              /** @type {unknown} */ ({
                ok: true,
                json: async () => ({ ok: true, environment: 'routing-test-stale' }),
              })
            )
        ),
        intervalMs: 0,
      }),
    ).rejects.toThrow(/không lên/);
  });

  it('chỉ sẵn sàng khi healthz trả environment của chính run này', async () => {
    /** @type {{ exitCode: number | null }} */
    const child = { exitCode: null };
    await expect(
      waitForProcessOk('http://127.0.0.1:8798/healthz', child, 10, {
        expectedEnvironment: 'routing-test-current',
        fetchImpl: /** @type {typeof fetch} */ (
          async () =>
            /** @type {Response} */ (
              /** @type {unknown} */ ({
                ok: true,
                json: async () => ({ ok: true, environment: 'routing-test-current' }),
              })
            )
        ),
      }),
    ).resolves.toBeUndefined();
  });

  it('cleanup ngoài cùng chỉ dừng Wrangler và Valhalla một lần sau lỗi sớm', async () => {
    let wranglerStops = 0;
    let valhallaStops = 0;
    const cleanup = createRoutingCleanup({
      stopWrangler: async () => {
        wranglerStops += 1;
      },
      stopValhalla: async () => {
        valhallaStops += 1;
      },
    });

    await Promise.all([cleanup(), cleanup()]);

    expect(wranglerStops).toBe(1);
    expect(valhallaStops).toBe(1);
  });

  it('dừng Valhalla khi --down đã thử compose start, kể cả up thất bại một phần', () => {
    expect(shouldStopAttemptedValhalla({ compose: true, down: true }, true)).toBe(true);
    expect(shouldStopAttemptedValhalla({ compose: true, down: true }, false)).toBe(false);
    expect(shouldStopAttemptedValhalla({ compose: false, down: true }, true)).toBe(false);
  });
});
