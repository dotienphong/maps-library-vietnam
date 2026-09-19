import { type APIRequestContext, expect, test } from '@playwright/test';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const API = 'http://127.0.0.1:8799';
const ACCESS_JWT = signAccessJwt({ email: 'phong@e2e.local' });

/** Tạo một khách và một đơn Starter 1 tháng bằng API thuần, không đi qua giao diện console. */
async function taoDonKhach(request: APIRequestContext) {
  const email = `admin-e2e-${Date.now()}@vidu.vn`;
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
  await request.post(`${API}/v1/console/tenant`, {
    headers: h,
    data: { name: 'Công ty Admin E2E' },
  });
  const { order } = await (
    await request.post(`${API}/v1/console/orders`, {
      headers: h,
      data: { kind: 'plan', tier: 'starter', months: 1 },
    })
  ).json();
  return order as { id: string; orderCode: number };
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': ACCESS_JWT });
});

test('admin thấy đơn mới, xác nhận tay → Đã cấp gói và sự kiện manual xuất hiện', async ({
  page,
  request,
}) => {
  const don = await taoDonKhach(request);

  await page.goto('/admin/orders?status=pending');
  await expect(page.getByRole('button', { name: String(don.orderCode) })).toBeVisible();
  await page.getByRole('button', { name: String(don.orderCode) }).click();

  await page.getByRole('button', { name: /Xác nhận đã nhận tiền/ }).click();
  await page.getByLabel('Lý do').fill('E2E thấy tiền trong sao kê');
  await page.getByLabel('Mã tham chiếu ngân hàng').fill('FT-E2E');
  await page.getByRole('button', { name: /Gửi xác nhận/ }).click();
  // Ngăn đóng ngay, toast đếm ngược 5 giây rồi mới gửi — đúng cơ chế delayed-action.
  await page.waitForTimeout(6500);

  await page.goto(`/admin/orders?id=${don.id}`);
  // Giới hạn trong ngăn chi tiết: chữ "Đã cấp gói" cũng nằm trong ô lọc trạng thái dưới dạng
  // <option>, và Playwright coi option là phần tử ẩn.
  const ngan = page.getByRole('dialog');
  await expect(ngan.getByText('Đã cấp gói')).toBeVisible();
  await expect(ngan.getByText(/^manual:/)).toBeVisible();
  await expect(ngan.getByText('chữ ký hợp lệ').first()).toBeVisible();
});

test('admin huỷ đơn pending qua đếm ngược → Đã huỷ, ghi chú hiện trong ngăn', async ({
  page,
  request,
}) => {
  const don = await taoDonKhach(request);

  await page.goto(`/admin/orders?id=${don.id}`);
  const ngan = page.getByRole('dialog');
  await ngan.getByRole('button', { name: 'Huỷ đơn' }).click();
  await ngan.getByLabel('Lý do').fill('E2E: khách đổi ý');
  await ngan
    .getByRole('form', { name: /Huỷ đơn/ })
    .getByRole('button', { name: 'Huỷ đơn' })
    .click();
  await page.waitForTimeout(6500);

  await page.goto(`/admin/orders?id=${don.id}`);
  await expect(page.getByRole('dialog').getByText('Đã huỷ')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('E2E: khách đổi ý')).toBeVisible();
  // Lọc theo trạng thái Đã huỷ vẫn thấy đơn — bộ lọc URL hoạt động.
  await page.goto('/admin/orders?status=cancelled');
  await expect(page.getByRole('button', { name: String(don.orderCode) })).toBeVisible();
});
