import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv, Env } from '../src/env';
import { errorResponse } from '../src/errors';
import { consoleAuthWith } from '../src/routes/console-auth';

/**
 * Tầng này KHÔNG có Postgres (binding Hyperdrive của apps/api/test trỏ cổng đóng), nên chỉ kiểm
 * những nhánh dừng TRƯỚC khi chạm DB: cổng tự phục vụ, Turnstile, tần suất, ngân sách thư, và
 * hợp đồng lỗi. Nhánh đi qua DB nằm ở bộ e2e trên harness thật.
 */
/**
 * Repo bật `exactOptionalPropertyTypes`, nên không gán thẳng `undefined` vào một prop tuỳ chọn
 * được. Dùng `Record<string, unknown>` cho phần ghi đè và ép kiểu một lần ở cuối: đây là môi
 * trường giả của test, không phải hợp đồng công khai.
 */
const moiTruong = (them: Record<string, unknown> = {}) =>
  ({
    ...env,
    ENVIRONMENT: 'test',
    SELF_SERVE: '1',
    SESSION_PEPPER: 'pepper-thu',
    OTP_DELIVERY: 'debug',
    ...them,
  }) as unknown as Env;

const guiThu = vi.fn().mockResolvedValue({ id: 'thu-1' });
const cong = (them: Parameters<typeof consoleAuthWith>[0] = {}) =>
  consoleAuthWith({
    emailPort: () => ({ ten: 'debug', send: guiThu }),
    kiemTurnstile: async () => true,
    daGuiHomNay: async () => 0,
    ...them,
  });

const app = (deps: Parameters<typeof consoleAuthWith>[0] = {}) => {
  const a = new Hono<AppEnv>();
  // Gắn đúng bộ xử lý lỗi mà index.ts thật dùng: thiếu nó thì ApiError rơi ra thành 500 và mọi
  // bài kiểm mã lỗi đều sai lệch mà không nói được vì sao.
  a.onError((err, c) => errorResponse(c, err));
  a.route('/', cong(deps));
  return a;
};

const xinMa = (a: ReturnType<typeof app>, moi: Env, body: unknown) =>
  a.request(
    'https://api/v1/console/auth/otp/request',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    moi,
  );

describe('cổng tự phục vụ', () => {
  it('SELF_SERVE khác "1" → mọi route auth trả 503 self_serve_closed', async () => {
    const res = await xinMa(app(), moiTruong({ SELF_SERVE: '0' }), { email: 'a@b.vn' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'self_serve_closed',
    );
  });
});

describe('POST /v1/console/auth/otp/request', () => {
  it('Turnstile không qua → 403, và KHÔNG gửi thư nào', async () => {
    guiThu.mockClear();
    const res = await xinMa(app({ kiemTurnstile: async () => false }), moiTruong(), {
      email: 'khach@vidu.vn',
      turnstileToken: 'sai',
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('turnstile_failed');
    expect(guiThu).not.toHaveBeenCalled();
  });

  it('email sai định dạng vẫn trả 200 — phản hồi không được lộ email nào có thật', async () => {
    guiThu.mockClear();
    const res = await xinMa(app(), moiTruong(), { email: 'khong-phai-email' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ daGui: true });
    expect(guiThu).not.toHaveBeenCalled();
  });

  it('ngân sách thư cạn → 503 email_budget_exhausted, nói thật chứ không im lặng', async () => {
    const res = await xinMa(app({ daGuiHomNay: async () => 100 }), moiTruong(), {
      email: 'khach@vidu.vn',
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'email_budget_exhausted',
    );
  });

  it('thiếu SESSION_PEPPER → 503 server_misconfigured, không băm yếu', async () => {
    const res = await xinMa(app(), moiTruong({ SESSION_PEPPER: undefined }), {
      email: 'khach@vidu.vn',
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'server_misconfigured',
    );
  });
});

describe('POST /v1/console/auth/otp/verify', () => {
  const xacThuc = (moi: Env, body: unknown) =>
    app().request(
      'https://api/v1/console/auth/otp/verify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      moi,
    );

  it('mã sai định dạng → 400 invalid_code, không chạm DB', async () => {
    const res = await xacThuc(moiTruong(), { email: 'khach@vidu.vn', code: 'abc' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_code');
  });

  it('email sai định dạng cũng → 400, không lộ khác biệt nào', async () => {
    const res = await xacThuc(moiTruong(), { email: 'rac', code: '123456' });
    expect(res.status).toBe(400);
  });
});

describe('đăng nhập Google', () => {
  it('chưa cấu hình → 503 google_not_configured, đường mã một lần vẫn dùng được', async () => {
    const res = await app().request(
      'https://api/v1/console/auth/google/start',
      {},
      moiTruong({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined }),
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'google_not_configured',
    );
  });

  it('có cấu hình → chuyển hướng sang Google kèm PKCE và đặt cookie luồng', async () => {
    const res = await app().request(
      'https://api/v1/console/auth/google/start',
      {},
      moiTruong({ GOOGLE_CLIENT_ID: 'client-1', GOOGLE_CLIENT_SECRET: 'bi-mat' }),
    );
    expect(res.status).toBe(302);
    const dich = new URL(res.headers.get('location') ?? '');
    expect(dich.origin + dich.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(dich.searchParams.get('code_challenge_method')).toBe('S256');

    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('mlv_oauth=');
    expect(cookie).toContain('HttpOnly');
    // Cookie luồng chỉ sống mười phút và chỉ gửi tới nhóm auth, không đi khắp site.
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).toContain('Path=/v1/console/auth');
  });

  it('callback thiếu state hoặc lệch state → 400 invalid_oauth_state', async () => {
    const moi = moiTruong({ GOOGLE_CLIENT_ID: 'client-1', GOOGLE_CLIENT_SECRET: 'bi-mat' });
    const khongCookie = await app().request(
      'https://api/v1/console/auth/google/callback?state=abc&code=xyz',
      {},
      moi,
    );
    expect(khongCookie.status).toBe(400);

    const lechState = await app().request(
      'https://api/v1/console/auth/google/callback?state=abc&code=xyz',
      { headers: { Cookie: 'mlv_oauth=khac.verifier' } },
      moi,
    );
    expect(lechState.status).toBe(400);
  });
});

describe('đăng xuất', () => {
  it('chưa đăng nhập → 401 not_signed_in dạng JSON, không chuyển hướng', async () => {
    const res = await app().request(
      'https://api/v1/console/auth/logout',
      { method: 'POST' },
      moiTruong(),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_signed_in');
  });
});
