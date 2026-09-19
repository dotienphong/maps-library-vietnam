import { expect, type Page, test } from '@playwright/test';
import { dungWebhook, FAKE_CHECKSUM, PAYOS_FAKE_PORT } from '../../../scripts/lib/payos-fake.mjs';
import { dangKyLayKhoa, emailMoi, HARNESS_BASE } from './helpers';

const PAYOS_FAKE = `http://127.0.0.1:${PAYOS_FAKE_PORT}`;

/** Đăng ký xong và đóng màn hiện khoá, để các bài dưới bắt đầu từ trạng thái đã đăng nhập. */
async function sanSang(page: Page, ten: string) {
  await dangKyLayKhoa(page, emailMoi(), ten);
  await page.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();
}

/** Mua Starter theo kỳ đã chọn; trả về id và mã đơn đọc từ chính trang chi tiết. */
async function muaStarter(page: Page, ky: '1' | '3') {
  await page.goto('/console/mua');
  await page.getByRole('radio', { name: `${ky} tháng` }).check({ force: true });
  // Starter là gói chọn sẵn nên nhãn nút là "Đã chọn Starter"; khớp cả hai để bài không phụ
  // thuộc gói mặc định.
  await page.getByRole('button', { name: /^(Chọn|Đã chọn) Starter$/ }).click();
  await page.getByRole('button', { name: 'Thanh toán' }).click();
  await expect(page).toHaveURL(/\/console\/don-hang\/[0-9a-f-]{36}/);
  const id = page.url().split('/don-hang/')[1]?.split('?')[0] as string;
  const tieuDe = await page.getByRole('heading', { level: 1 }).innerText();
  return { id, orderCode: Number(tieuDe.replace(/\D/g, '')) };
}

/** Mô phỏng khách chuyển khoản ở PayOS giả; kèm webhookUrl thì nó tự bắn webhook vào API. */
const traTien = (orderCode: number, them: Record<string, unknown> = {}) =>
  fetch(`${PAYOS_FAKE}/__fake/pay/${orderCode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ webhookUrl: `${HARNESS_BASE}/v1/pay/payos/webhook`, ...them }),
  });

test('khách mua Starter 3 tháng: QR hiện, PayOS báo trả, trang tự chuyển "Đã cấp gói"', async ({
  page,
}) => {
  await sanSang(page, 'Công ty Mua Thật');
  const { orderCode } = await muaStarter(page, '3');

  await expect(page.getByText('1.950.000đ').first()).toBeVisible();
  await expect(page.getByText(`MLV${orderCode}`)).toBeVisible();
  await expect(page.getByRole('img', { name: /Mã QR/ })).toBeVisible();
  await expect(page.getByText('Chờ thanh toán')).toBeVisible();

  const tra = await (await traTien(orderCode)).json();
  expect(tra.webhookStatus).toBe(200);

  // Poll 3 giây tự cập nhật — bài này KHÔNG tải lại trang, đó chính là điều cần chứng minh.
  await expect(page.getByText('Đã cấp gói')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Gói đã được cấp/)).toBeVisible();

  await page.getByRole('link', { name: 'Về Tổng quan' }).click();
  await expect(page.getByText('Starter').first()).toBeVisible();
  // Hết hạn ≈ hôm nay + 3 tháng; chỉ kiểm tháng/năm để không phụ thuộc giờ chạy.
  const hetHan = new Date();
  hetHan.setMonth(hetHan.getMonth() + 3);
  const mmyyyy = `${String(hetHan.getMonth() + 1).padStart(2, '0')}/${hetHan.getFullYear()}`;
  await expect(page.getByText(new RegExp(mmyyyy.replace('/', '\\/')))).toBeVisible();
});

test('chuyển thiếu → trang nói rõ số đã nhận và số còn thiếu', async ({ page }) => {
  await sanSang(page, 'Công ty Thiếu');
  const { orderCode } = await muaStarter(page, '1');

  const than = dungWebhook(
    { orderCode, amount: 600_000, reference: `FT-E2E-${orderCode}` },
    FAKE_CHECKSUM,
  );
  await fetch(`${HARNESS_BASE}/v1/pay/payos/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(than),
  });

  await expect(page.getByText('Thiếu tiền')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Đã nhận 600\.000đ, còn thiếu 50\.000đ/)).toBeVisible();
});

test('huỷ đơn đi qua đếm ngược 5 giây; huỷ giữa chừng thì đơn vẫn chờ thanh toán', async ({
  page,
}) => {
  await sanSang(page, 'Công ty Huỷ');
  await muaStarter(page, '1');

  await page.getByRole('button', { name: 'Huỷ đơn' }).click();
  await page.getByRole('button', { name: 'Huỷ', exact: true }).click(); // huỷ chính việc huỷ
  await page.waitForTimeout(6000);
  await expect(page.getByText('Chờ thanh toán')).toBeVisible();

  await page.getByRole('button', { name: 'Huỷ đơn' }).click();
  // 'Đã huỷ' xuất hiện ở cả huy hiệu lẫn câu giải thích bên dưới; lấy cái đầu là đủ.
  await expect(page.getByText('Đã huỷ').first()).toBeVisible({ timeout: 15_000 });
});

test('tài khoản khác mở đơn không phải của mình → không tìm thấy', async ({ browser }) => {
  const goc = { baseURL: HARNESS_BASE };
  const ctxA = await browser.newContext(goc);
  const pageA = await ctxA.newPage();
  await sanSang(pageA, 'Công ty A');
  const { id } = await muaStarter(pageA, '1');

  const ctxB = await browser.newContext(goc);
  const pageB = await ctxB.newPage();
  await sanSang(pageB, 'Công ty B');
  await pageB.goto(`/console/don-hang/${id}`);
  await expect(pageB.getByRole('alert')).toContainText('Không tìm thấy đơn này');

  await ctxA.close();
  await ctxB.close();
});
