import { type APIRequestContext, expect, test } from '@playwright/test';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const API = 'http://127.0.0.1:8799';
const ACCESS_JWT = signAccessJwt({ email: 'phong@e2e.local' });
const ADMIN = { 'Cf-Access-Jwt-Assertion': ACCESS_JWT, 'Sec-Fetch-Site': 'same-origin' };

/** Một khách mới có tổ chức, đăng nhập bằng mã một lần qua API thuần. */
async function taoKhach(request: APIRequestContext) {
  const email = `khach-e2e-${Date.now()}@vidu.vn`;
  const xin = await request.post(`${API}/v1/console/auth/otp/request`, {
    headers: { 'Sec-Fetch-Site': 'same-origin' },
    data: { email, turnstileToken: '' },
  });
  const ma = xin.headers()['x-debug-otp'];
  const xac = await request.post(`${API}/v1/console/auth/otp/verify`, {
    headers: { 'Sec-Fetch-Site': 'same-origin' },
    data: { email, code: ma },
  });
  const cookie = (xac.headers()['set-cookie'] ?? '').split(';')[0] as string;
  const h = { cookie, 'Sec-Fetch-Site': 'same-origin' };
  const { tenant } = await (
    await request.post(`${API}/v1/console/tenant`, {
      headers: h,
      data: { name: 'Công ty Khách E2E' },
    })
  ).json();
  const ds = await (
    await request.get(`${API}/v1/admin/customers?q=${encodeURIComponent(email)}`, {
      headers: ADMIN,
    })
  ).json();
  return { email, cookie: h, tenantId: tenant.id as string, accountId: ds.items[0].id as string };
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': ACCESS_JWT });
});

test('tìm khách theo email → chi tiết có phiên và tổ chức → vô hiệu hoá qua đếm ngược → khách mất phiên → huy hiệu đỏ', async ({
  page,
  request,
}) => {
  const k = await taoKhach(request);

  await page.goto('/admin/customers');
  await page.getByLabel('Tìm theo email hoặc tên').fill(k.email);
  await page.getByRole('button', { name: k.email }).click();
  const ngan = page.getByRole('dialog');
  await expect(ngan.getByText('Đang hoạt động')).toBeVisible();
  await expect(ngan.getByText(/Phiên đang mở \(1\)/)).toBeVisible();
  await expect(ngan.getByRole('link', { name: 'Công ty Khách E2E' })).toBeVisible();

  await ngan.getByRole('button', { name: 'Vô hiệu hoá' }).click();
  await ngan.getByLabel('Lý do').fill('E2E: kiểm thử vô hiệu hoá');
  await ngan.getByRole('button', { name: 'Vô hiệu hoá tài khoản' }).click();
  // Ngăn đóng ngay, toast đếm ngược 5 giây rồi mới gửi — đúng cơ chế delayed-action.
  await expect(page.getByRole('status')).toContainText(/Vô hiệu hoá/);
  await page.waitForTimeout(6500);

  // Khách mất phiên trong một request (tiêu chí 20.11).
  const me = await request.get(`${API}/v1/console/me`, { headers: k.cookie });
  expect(me.status()).toBe(401);

  await page.goto(`/admin/customers?id=${k.accountId}`);
  await expect(page.getByRole('dialog').getByText('Đã vô hiệu hoá')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Kích hoạt lại' }),
  ).toBeVisible();
});

test('chi tiết tenant hiện chủ tổ chức và link sang màn Khách hàng', async ({ page, request }) => {
  const k = await taoKhach(request);
  await page.goto(`/admin/tenants?id=${k.tenantId}`);
  const ngan = page.getByRole('dialog');
  await expect(ngan.getByRole('link', { name: k.email })).toHaveAttribute(
    'href',
    `/admin/customers?id=${k.accountId}`,
  );
  await ngan.getByRole('link', { name: k.email }).click();
  await expect(page.getByRole('dialog').getByText(k.email)).toBeVisible();
});
