import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCatalog, getLegacyUsage, getPeriods, getUsage, sendCommand, unlockAcks } from './api';

const TENANT = '00000000-0000-4000-8000-0000000000cc';

const batFetch = (body: unknown = {}) => {
  const mock = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
};

afterEach(() => vi.unstubAllGlobals());

describe('lớp gọi API của mảng billing', () => {
  it('đọc đúng bốn đường dẫn', async () => {
    const mock = batFetch({ tiers: [], addOns: [], legacyDefaults: {} });
    await getUsage(TENANT);
    await getPeriods(TENANT);
    await getLegacyUsage(TENANT);
    await getCatalog();
    expect(mock.mock.calls.map(([path]) => String(path))).toEqual([
      `/v1/admin/billing/${TENANT}/usage`,
      `/v1/admin/billing/${TENANT}/periods`,
      `/v1/admin/billing/${TENANT}/legacy-usage`,
      '/v1/admin/plan-catalog',
    ]);
  });

  it('gửi lệnh với ĐÚNG tập trường của kind, không thừa một trường nào', async () => {
    // Máy chủ dùng allowlist đóng cả hai chiều: thừa `tenantId`, `actor` hay bất kỳ trường phụ nào
    // để hiển thị đều làm cả lệnh hỏng với invalid_command. Bài này khoá lại điều đó.
    const mock = batFetch({ operationId: 'op', revision: 1, status: 'active', tier: 'trial' });
    await sendCommand(TENANT, {
      kind: 'activateTrial',
      operationId: 'op-1',
      reason: 'khách xin dùng thử',
      expectedRevision: 0,
      startsAt: '2026-09-16T17:00:00.000Z',
    });

    const [path, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/admin/billing/${TENANT}/commands`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'activateTrial',
      operationId: 'op-1',
      reason: 'khách xin dùng thử',
      expectedRevision: 0,
      startsAt: '2026-09-16T17:00:00.000Z',
    });
  });

  it('lệnh mở khoá đi đường riêng, không qua /commands', async () => {
    const mock = batFetch({ unlocked: 2 });
    await unlockAcks(TENANT, 'op-2', 'công cụ khách quên ACK');
    const [path, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/admin/billing/${TENANT}/missing-acks/unlock`);
    expect(JSON.parse(String(init.body))).toEqual({
      operationId: 'op-2',
      reason: 'công cụ khách quên ACK',
    });
  });
});
