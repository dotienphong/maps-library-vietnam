// Bước đăng ký dùng chung cho mọi bộ e2e của cổng khách hàng: tách khỏi console.spec.ts để
// don-hang.spec.ts không phải chép lại chặng đăng nhập.
import { expect, type Page } from '@playwright/test';

export const HARNESS_BASE = 'http://127.0.0.1:8799';

/** Mỗi lượt chạy một email mới: bảng tài khoản sống qua các lần chạy trong cùng một harness. */
export const emailMoi = () => `thu-${Date.now()}-${Math.floor(Math.random() * 1000)}@vidu.vn`;

/** Xin mã rồi đọc lại từ header `X-Debug-Otp` — đường này chỉ sống ngoài production. */
export async function xinMaVaDoc(page: Page, email: string): Promise<string> {
  await page.goto('/console/dang-nhap');
  await page.getByLabel('Email').fill(email);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/otp/request')),
    page.getByRole('button', { name: /Gửi mã/ }).click(),
  ]);
  const ma = res.headers()['x-debug-otp'];
  expect(ma, 'harness phải trả mã qua header để e2e chạy được').toMatch(/^\d{6}$/);
  return ma as string;
}

export async function nhapMa(page: Page, ma: string) {
  for (let i = 0; i < 6; i += 1) {
    await page.getByLabel(`Chữ số thứ ${i + 1}`).fill(ma[i] as string);
  }
}

export async function dangNhap(page: Page, email: string) {
  const ma = await xinMaVaDoc(page, email);
  await nhapMa(page, ma);
}

/** Đăng ký trọn vẹn rồi trả về khoá API vừa cấp. */
export async function dangKyLayKhoa(page: Page, email: string, tenToChuc: string): Promise<string> {
  await dangNhap(page, email);
  await expect(page).toHaveURL(/\/console\/bat-dau/);
  await page.getByLabel('Tên tổ chức').fill(tenToChuc);
  await page.getByRole('button', { name: /Tạo và lấy khoá/ }).click();
  const khoa = await page.getByTestId('khoa-mot-lan').innerText();
  expect(khoa).toMatch(/^mlv_live_[0-9A-Za-z]{24}$/);
  return khoa;
}
