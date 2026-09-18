import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv, Env } from '../src/env';
import { errorResponse } from '../src/errors';
import { consoleRoutesWith } from '../src/routes/console';

const moiTruong = (them: Record<string, unknown> = {}) =>
  ({
    ...env,
    ENVIRONMENT: 'test',
    SELF_SERVE: '1',
    SESSION_PEPPER: 'pepper-thu',
    ...them,
  }) as unknown as Env;

const app = (deps: Parameters<typeof consoleRoutesWith>[0] = {}) => {
  const a = new Hono<AppEnv>();
  a.onError((err, c) => errorResponse(c, err));
  a.route('/', consoleRoutesWith(deps));
  return a;
};

const goi = (moi: Env, duong: string, init: RequestInit = {}) =>
  app().request(`https://api${duong}`, init, moi);

describe('GET /v1/console/config', () => {
  it('công khai, không cần đăng nhập, và trả được cả khi cổng đang đóng', async () => {
    const res = await goi(moiTruong({ SELF_SERVE: '0' }), '/v1/console/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { selfServe: boolean };
    // SPA phải đọc được cờ này để hiện màn "Sắp mở", thay vì một form đăng nhập vô dụng.
    expect(body.selfServe).toBe(false);
  });

  it('báo Google đã bật hay chưa, và KHÔNG lộ secret nào', async () => {
    const res = await goi(
      moiTruong({ GOOGLE_CLIENT_ID: 'client-1', GOOGLE_CLIENT_SECRET: 'bi-mat' }),
      '/v1/console/config',
    );
    const text = await res.text();
    expect(JSON.parse(text).googleEnabled).toBe(true);
    expect(text).not.toContain('bi-mat');
    expect(text).not.toContain('pepper-thu');
  });

  it('thiếu cấu hình Google thì googleEnabled false — đường mã một lần vẫn dùng được', async () => {
    const res = await goi(moiTruong(), '/v1/console/config');
    expect(((await res.json()) as { googleEnabled: boolean }).googleEnabled).toBe(false);
  });
});

describe('cổng đăng nhập', () => {
  for (const [duong, method] of [
    ['/v1/console/me', 'GET'],
    ['/v1/console/usage', 'GET'],
    ['/v1/console/periods', 'GET'],
    ['/v1/console/tenant', 'POST'],
  ] as const) {
    it(`${method} ${duong} chưa đăng nhập → 401 not_signed_in dạng JSON`, async () => {
      const res = await goi(moiTruong(), duong, { method });
      expect(res.status).toBe(401);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_signed_in');
    });
  }

  it('thiếu SESSION_PEPPER → 503 server_misconfigured chứ không băm yếu', async () => {
    const res = await goi(moiTruong({ SESSION_PEPPER: undefined }), '/v1/console/me');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'server_misconfigured',
    );
  });
});

describe('nhóm khoá API của khách', () => {
  for (const [duong, method] of [
    ['/v1/console/keys', 'GET'],
    ['/v1/console/keys', 'POST'],
    [`/v1/console/keys/${'a'.repeat(64)}/revoke`, 'POST'],
  ] as const) {
    it(`${method} ${duong} chưa đăng nhập → 401`, async () => {
      const res = await goi(moiTruong(), duong, { method });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_signed_in');
    });
  }
});
