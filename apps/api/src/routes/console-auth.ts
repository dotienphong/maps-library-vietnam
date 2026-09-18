import { type Context, Hono } from 'hono';
import { audit } from '../audit';
import {
  ganGoogleSub,
  ghiNhanDangNhap,
  taoHoacLayTaiKhoan,
  taoPhien,
  timTaiKhoanTheoEmail,
  voiSql,
  xoaPhien,
  xoaPhienKhac,
} from '../console/db';
import { selfServeOpen } from '../console/flags';
import {
  doiCodeLayToken,
  dungUrlDangNhap,
  type GoogleJwks,
  sinhPkce,
  taiJwks,
  xacThucIdToken,
} from '../console/google';
import { chuanHoaEmail, HAN_PHUT, hetHanLuc, laEmailHopLe, sinhMa } from '../console/otp';
import { requireCustomer } from '../console/require-customer';
import {
  bamToken,
  dungCookiePhien,
  dungCookieXoa,
  hanPhienMoi,
  sinhTokenPhien,
} from '../console/session';
import { kiemTurnstile } from '../console/turnstile';
import { mauMaDangNhap } from '../email/mau';
import { conCho, daGuiHomNay } from '../email/ngan-sach';
import { chonEmailPort, type EmailPort } from '../email/port';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const MAX_BODY = 4 * 1024;
const COOKIE_OAUTH = 'mlv_oauth';

/** Cổng ngoài tiêm được, để test chạy không cần Postgres, mạng hay khoá thật. */
export interface ConsoleAuthDeps {
  emailPort?: (env: Env) => EmailPort;
  kiemTurnstile?: (env: Env, token: string) => Promise<boolean>;
  daGuiHomNay?: (env: Env) => Promise<number>;
  jwks?: (env: Env) => Promise<GoogleJwks>;
  doiCode?: (input: {
    code: string;
    verifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }) => Promise<string>;
}

async function docJsonNho(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Băm IP kèm pepper — không bao giờ lưu địa chỉ thô (checklist pháp lý A7). */
async function bamIp(c: { req: { header(name: string): string | undefined } }, pepper: string) {
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? '';
  if (!ip) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + pepper));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function pepperCua(env: Env): string {
  const pepper = env.SESSION_PEPPER;
  if (!pepper) throw new ApiError(503, 'server_misconfigured', 'Thiếu SESSION_PEPPER');
  return pepper;
}

export function consoleAuthWith(deps: ConsoleAuthDeps = {}) {
  const routes = new Hono<AppEnv>();

  // Cổng tự phục vụ đóng thì cả nhóm này im lặng. `/v1/console/config` KHÔNG nằm trong nhóm này,
  // nên SPA vẫn đọc được cấu hình để hiện màn "Sắp mở" thay vì một form đăng nhập vô dụng.
  routes.use('/v1/console/auth/*', async (c, next) => {
    if (!selfServeOpen(c.env)) {
      throw new ApiError(503, 'self_serve_closed', 'Cổng tự phục vụ chưa mở');
    }
    await next();
  });

  routes.post('/v1/console/auth/otp/request', async (c) => {
    const body = await docJsonNho(c.req.raw);
    const email = chuanHoaEmail(String(body?.email ?? ''));
    const turnstileToken = String(body?.turnstileToken ?? '');
    const pepper = pepperCua(c.env);

    const quaTurnstile = deps.kiemTurnstile
      ? await deps.kiemTurnstile(c.env, turnstileToken)
      : await kiemTurnstile(c.env, turnstileToken);
    if (!quaTurnstile) throw new ApiError(403, 'turnstile_failed', 'Không qua được bước chống bot');

    // Giới hạn tần suất TRƯỚC khi chạm DB: một đợt gửi rác không được phép biến thành một đợt
    // truy vấn vào Postgres ở nhà.
    const ipHash = await bamIp(c, pepper);
    for (const [limiter, key] of [
      [c.env.OTP_EMAIL_RATE_LIMITER, email],
      [c.env.OTP_IP_RATE_LIMITER, ipHash ?? 'khong-ro-ip'],
    ] as const) {
      if (!limiter || !key) continue;
      const { success } = await limiter.limit({ key });
      if (!success) {
        throw new ApiError(429, 'too_many_requests', 'Mỗi phút chỉ xin được một mã', 60);
      }
    }

    // Email sai định dạng vẫn trả 200: phản hồi của route này không bao giờ được phép cho biết
    // một địa chỉ có tồn tại trong hệ thống hay không.
    if (!laEmailHopLe(email)) return c.json({ daGui: true }, 200, NO_STORE);

    const daGui = deps.daGuiHomNay
      ? await deps.daGuiHomNay(c.env)
      : await daGuiHomNay(c.env, c.executionCtx);
    if (!conCho(daGui)) {
      // Hai lỗi hạ tầng thì nói thật, vì khách cần biết là phải chờ chứ không phải gõ sai email.
      throw new ApiError(503, 'email_budget_exhausted', 'Hệ thống tạm hết lượt gửi thư hôm nay');
    }

    const ma = sinhMa();
    const maHash = await bamToken(ma, pepper);
    const hetHan = hetHanLuc();

    await voiSql(c.env, c.executionCtx, async (sql) => {
      // Xoá mã cũ của cùng email: để lại nghĩa là một mã xin từ mười phút trước vẫn dùng được,
      // và số lần thử bị chia ra nhiều dòng.
      await sql`DELETE FROM customer_login_code WHERE email = ${email}`;
      await sql`INSERT INTO customer_login_code (email, code_hash, expires_at)
        VALUES (${email}, ${maHash}, ${hetHan})`;
    });

    const port = deps.emailPort ? deps.emailPort(c.env) : chonEmailPort(c.env);
    const thu = mauMaDangNhap(ma, HAN_PHUT);
    // Gửi trong waitUntil: khách không phải chờ Resend trả lời mới thấy màn nhập mã.
    c.executionCtx.waitUntil(
      port
        .send({ to: email, subject: thu.subject, html: thu.html, text: thu.text })
        .then(() => {
          audit(c, 'email.sent', 'ma-dang-nhap');
        })
        .catch((error: unknown) => {
          console.error('[console] gửi mã đăng nhập lỗi', error);
        }),
    );

    // Chỉ NGOÀI production: e2e cần đọc mã mà không có hộp thư. Điều kiện kép để một lần đặt nhầm
    // biến production thành nơi phát mã công khai.
    const headers: Record<string, string> = { ...NO_STORE };
    if (c.env.ENVIRONMENT !== 'production' && c.env.OTP_DELIVERY === 'debug') {
      headers['X-Debug-Otp'] = ma;
    }
    return c.json({ daGui: true }, 200, headers);
  });

  routes.post('/v1/console/auth/otp/verify', async (c) => {
    const body = await docJsonNho(c.req.raw);
    const email = chuanHoaEmail(String(body?.email ?? ''));
    const ma = String(body?.code ?? '');
    const pepper = pepperCua(c.env);
    if (!laEmailHopLe(email) || !/^\d{6}$/.test(ma)) {
      throw new ApiError(400, 'invalid_code', 'Mã không đúng định dạng');
    }

    const maHash = await bamToken(ma, pepper);
    const ketQua = await voiSql(c.env, c.executionCtx, async (sql) => {
      const rows = await sql<
        {
          id: string;
          code_hash: string;
          expires_at: Date;
          consumed_at: Date | null;
          attempts: number;
        }[]
      >`SELECT id, code_hash, expires_at, consumed_at, attempts
        FROM customer_login_code WHERE email = ${email}
        ORDER BY created_at DESC LIMIT 1`;
      const dong = rows[0];
      if (!dong) return { loi: 'invalid_code' as const };
      if (dong.consumed_at) return { loi: 'invalid_code' as const };
      if (dong.expires_at.getTime() <= Date.now()) return { loi: 'code_expired' as const };
      if (dong.attempts >= 5) return { loi: 'invalid_code' as const };

      if (dong.code_hash !== maHash) {
        await sql`UPDATE customer_login_code SET attempts = attempts + 1 WHERE id = ${dong.id}`;
        return { loi: 'invalid_code' as const, conLai: 5 - (dong.attempts + 1) };
      }

      await sql`UPDATE customer_login_code SET consumed_at = now() WHERE id = ${dong.id}`;
      const taiKhoan = await taoHoacLayTaiKhoan(sql, email);
      if (taiKhoan.disabled_at) return { loi: 'account_disabled' as const };
      await ghiNhanDangNhap(sql, taiKhoan.id);
      return { taiKhoan };
    });

    if ('loi' in ketQua) {
      const status = ketQua.loi === 'account_disabled' ? 403 : 401;
      const chiTiet =
        ketQua.loi === 'invalid_code' && typeof ketQua.conLai === 'number'
          ? { details: { conLai: Math.max(0, ketQua.conLai) } }
          : {};
      throw new ApiError(
        status,
        ketQua.loi,
        ketQua.loi === 'code_expired' ? 'Mã đã hết hạn' : 'Mã không đúng',
        undefined,
        chiTiet.details,
      );
    }

    return await capPhien(c, ketQua.taiKhoan.id, ketQua.taiKhoan.trial_tenant_id !== null);
  });

  routes.get('/v1/console/auth/google/start', async (c) => {
    const clientId = c.env.GOOGLE_CLIENT_ID;
    if (!clientId || !c.env.GOOGLE_CLIENT_SECRET) {
      throw new ApiError(503, 'google_not_configured', 'Chưa cấu hình đăng nhập Google');
    }
    const { verifier, challenge } = await sinhPkce();
    const state = sinhTokenPhien();
    const redirectUri = new URL('/v1/console/auth/google/callback', c.req.url).toString();

    // `state` và `verifier` nằm trong cookie ngắn hạn thay vì KV: không tốn lượt ghi KV, và một
    // luồng đăng nhập dở dang tự biến mất sau mười phút.
    c.header(
      'Set-Cookie',
      `${COOKIE_OAUTH}=${state}.${verifier}; HttpOnly; Secure; SameSite=Lax; Path=/v1/console/auth; Max-Age=600`,
    );
    return c.redirect(dungUrlDangNhap({ clientId, redirectUri, state, challenge }));
  });

  routes.get('/v1/console/auth/google/callback', async (c) => {
    const clientId = c.env.GOOGLE_CLIENT_ID;
    const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new ApiError(503, 'google_not_configured', 'Chưa cấu hình đăng nhập Google');
    }
    const luu = docCookieOauth(c.req.header('Cookie') ?? null);
    const state = c.req.query('state') ?? '';
    const code = c.req.query('code') ?? '';
    if (!luu || !state || !code || luu.state !== state) {
      throw new ApiError(400, 'invalid_oauth_state', 'Luồng đăng nhập không hợp lệ');
    }

    const redirectUri = new URL('/v1/console/auth/google/callback', c.req.url).toString();
    const idToken = deps.doiCode
      ? await deps.doiCode({ code, verifier: luu.verifier, clientId, clientSecret, redirectUri })
      : await doiCodeLayToken({
          code,
          verifier: luu.verifier,
          clientId,
          clientSecret,
          redirectUri,
        });

    const jwks = deps.jwks ? await deps.jwks(c.env) : await taiJwks(c.env, fetch, c.executionCtx);
    const nguoi = await xacThucIdToken(idToken, { clientId, jwks });

    const ketQua = await voiSql(c.env, c.executionCtx, async (sql) => {
      const co = await timTaiKhoanTheoEmail(sql, nguoi.email);
      if (co?.disabled_at) return { loi: 'account_disabled' as const };
      const taiKhoan = co ?? (await taoHoacLayTaiKhoan(sql, nguoi.email));
      if (!taiKhoan.google_sub) await ganGoogleSub(sql, taiKhoan.id, nguoi.sub);
      await ghiNhanDangNhap(sql, taiKhoan.id);
      return { taiKhoan };
    });
    if ('loi' in ketQua) throw new ApiError(403, 'account_disabled', 'Tài khoản đã bị vô hiệu hoá');

    const daCoTenant = ketQua.taiKhoan.trial_tenant_id !== null;
    await capPhien(c, ketQua.taiKhoan.id, daCoTenant);
    // Xoá cookie luồng OAuth ngay: nó đã dùng xong và không được phép dùng lại.
    c.header(
      'Set-Cookie',
      `${COOKIE_OAUTH}=; HttpOnly; Secure; SameSite=Lax; Path=/v1/console/auth; Max-Age=0`,
      { append: true },
    );
    return c.redirect(daCoTenant ? '/console/' : '/console/bat-dau');
  });

  routes.post('/v1/console/auth/logout', requireCustomer(), async (c) => {
    const khach = c.get('customer');
    if (khach) {
      await voiSql(c.env, c.executionCtx, (sql) => xoaPhien(sql, khach.tokenHash));
    }
    c.header('Set-Cookie', dungCookieXoa());
    return c.json({ daDangXuat: true }, 200, NO_STORE);
  });

  routes.post('/v1/console/auth/logout-all', requireCustomer(), async (c) => {
    const khach = c.get('customer');
    if (!khach) throw new ApiError(401, 'not_signed_in', 'Chưa đăng nhập');
    // Giữ LẠI phiên hiện tại: đá luôn cả thiết bị đang thao tác là hành vi gây bất ngờ, và khách
    // vừa bấm nút xong đã phải đăng nhập lại.
    const soPhien = await voiSql(c.env, c.executionCtx, (sql) =>
      xoaPhienKhac(sql, khach.accountId, khach.tokenHash),
    );
    audit(c, 'customer.logout_all', khach.accountId, { so_phien: soPhien });
    return c.json({ daXoa: soPhien }, 200, NO_STORE);
  });

  /** Tạo phiên mới và đặt cookie. Dùng chung cho cả hai đường đăng nhập. */
  async function capPhien(c: Context<AppEnv>, accountId: string, onboarded: boolean) {
    const pepper = pepperCua(c.env);
    const token = sinhTokenPhien();
    const tokenHash = await bamToken(token, pepper);
    const ipHash = await bamIp(c, pepper);
    await voiSql(c.env, c.executionCtx, (sql) =>
      taoPhien(sql, {
        tokenHash,
        accountId,
        expiresAt: hanPhienMoi(),
        userAgent: (c.req.header('User-Agent') ?? '').slice(0, 250) || null,
        ipHash,
      }),
    );
    c.header('Set-Cookie', dungCookiePhien(token));
    return c.json({ onboarded }, 200, NO_STORE);
  }

  return routes;
}

function docCookieOauth(header: string | null): { state: string; verifier: string } | null {
  if (!header) return null;
  for (const phan of header.split(';')) {
    const cat = phan.trim();
    const dau = cat.indexOf('=');
    if (dau < 0 || cat.slice(0, dau) !== COOKIE_OAUTH) continue;
    const [state, verifier] = cat.slice(dau + 1).split('.');
    if (!state || !verifier) return null;
    return { state, verifier };
  }
  return null;
}

export const consoleAuth = consoleAuthWith();
