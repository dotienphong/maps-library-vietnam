import { describe, expect, it } from 'vitest';
import { TEST_KEY, parseRoutingTestArgs, testAuthInfo } from './routing-test.mjs';

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
