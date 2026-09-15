import { describe, expect, it } from 'vitest';
import { expectEqual, parseSmokeArgs, runSmoke } from './smoke-commercial.mjs';

/**
 * Máy chủ giả có sổ quota thật sự hoạt động: chỉ ACK mới cộng `used`. Nhờ vậy test chứng minh
 * được smoke bắt đúng lỗi, thay vì chỉ chứng minh nó gọi đủ endpoint.
 * @param {{shared?: boolean, chargeWithoutAck?: boolean, chargeOnError?: boolean}} [broken]
 */
function fakeServer(broken = {}) {
  const state = {
    used: 0,
    status: 'active',
    revision: 3,
    maintenance: false,
    /** @type {Map<string, {token: string, acked: boolean}>} */
    receipts: new Map(),
  };
  /** @param {string} path @param {{key?: string, method?: string, body?: string}} [options] */
  const data = async (path, options = {}) => {
    const headers = new Headers();
    if (path.includes('/ack')) {
      const id = /receipts\/([^/]+)\/ack/.exec(path)?.[1] ?? '';
      const receipt = state.receipts.get(id);
      const token = JSON.parse(options.body ?? '{}').token;
      if (!receipt || receipt.token !== token) return { status: 403, headers, json: null };
      if (!receipt.acked) {
        receipt.acked = true;
        state.used += 1;
      }
      return { status: 200, headers, json: { state: 'committed' } };
    }
    if (options.method === 'HEAD') {
      headers.set('allow', 'GET');
      return { status: 405, headers, json: null };
    }
    if (state.maintenance) {
      return { status: 503, headers, json: { error: { code: 'quota_unavailable' } } };
    }
    if (state.status === 'suspended') {
      return { status: 403, headers, json: { error: { code: 'subscription_expired' } } };
    }
    if (path.includes('q=a&') || path.endsWith('q=a')) {
      if (broken.chargeOnError) state.used += 1;
      return { status: 400, headers, json: { error: { code: 'invalid_request' } } };
    }
    const id = `r${state.receipts.size + 1}`;
    const token = `t${state.receipts.size + 1}`;
    state.receipts.set(id, { token, acked: false });
    if (broken.chargeWithoutAck) state.used += 1;
    headers.set('x-mapslibvn-receipt-id', id);
    headers.set('x-mapslibvn-receipt-token', token);
    headers.set('x-mapslibvn-receipt-expires-at', '2026-09-15T12:00:00.000Z');
    headers.set('cache-control', 'private, no-store');
    return { status: 200, headers, json: { items: [] } };
  };
  /** @param {string} path @param {{method?: string, body?: string}} [init] */
  const admin = async (path, init = {}) => {
    if (path.endsWith('/usage')) {
      return {
        status: state.status,
        revision: state.revision,
        maintenance: state.maintenance,
        places: { limit: 2_000, used: state.used, reserved: 0, credits: 0, available: 2_000 },
        directions: { limit: 200, used: 0, reserved: 0, credits: 0, available: 200 },
      };
    }
    const body = JSON.parse(init.body ?? '{}');
    if (path.endsWith('/backup/maintenance')) {
      state.maintenance = body.enabled === true;
      return { maintenance: state.maintenance };
    }
    if (path.endsWith('/commands')) {
      if (body.expectedRevision !== state.revision) throw new Error('revision_conflict');
      state.revision += 1;
      state.status = body.kind === 'suspend' ? 'suspended' : 'active';
      return { revision: state.revision };
    }
    throw new Error(`đường dẫn lạ: ${path}`);
  };
  return { data, admin, state };
}

/** @param {ReturnType<typeof fakeServer>} server @param {string} [keyB] */
const run = (server, keyB) =>
  runSmoke({
    data: server.data,
    admin: server.admin,
    keyA: 'kA',
    ...(keyB ? { keyB } : {}),
    tenantId: 't1',
  });

describe('smoke commercial', () => {
  it('đạt hết khi sổ quota hành xử đúng', async () => {
    const result = await run(fakeServer(), 'kB');
    expect(result.failed.map((check) => check.name)).toEqual([]);
    expect(result.checks.length).toBeGreaterThan(15);
  });

  it('bắt được lỗi trừ lượt khi chưa ACK', async () => {
    const result = await run(fakeServer({ chargeWithoutAck: true }));
    expect(result.failed.map((check) => check.name)).toContain('chưa ACK thì chưa trừ lượt');
  });

  it('bắt được lỗi tính tiền cả request 4xx', async () => {
    const result = await run(fakeServer({ chargeOnError: true }));
    expect(result.failed.map((check) => check.name)).toContain('lỗi 4xx không trừ lượt');
  });

  it('bỏ qua bước hai khoá khi không có khoá thứ hai, và nói rõ là đã bỏ qua', async () => {
    const result = await run(fakeServer());
    const shared = result.checks.find((check) => check.name === 'hai khoá cộng chung một sổ');
    expect(shared?.ok).toBe(true);
    expect(shared?.detail).toContain('BỎ QUA');
  });

  it('trả sổ về đúng trạng thái hoạt động sau khi thử bảo trì và đình chỉ', async () => {
    const server = fakeServer();
    await run(server);
    expect(server.state.maintenance).toBe(false);
    expect(server.state.status).toBe('active');
  });
});

describe('expectEqual', () => {
  it('ghi rõ nhận gì, chờ gì khi lệch', () => {
    /** @type {{name: string, ok: boolean, detail: string}[]} */
    const checks = [];
    expectEqual(checks, 'x', 1, 2);
    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.detail).toBe('nhận 1, chờ 2');
  });
});

describe('parseSmokeArgs', () => {
  it('đọc cờ dạng --ten=gia-tri', () => {
    expect(parseSmokeArgs(['--tenant=t1', '--base=https://a.test'])).toEqual({
      tenant: 't1',
      base: 'https://a.test',
    });
  });
});
