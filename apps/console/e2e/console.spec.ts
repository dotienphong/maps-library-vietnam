import { expect, test } from '@playwright/test';
import { dangKyLayKhoa, emailMoi, nhapMa, xinMaVaDoc } from './helpers';

test('người lạ đăng ký, lấy khoá và gọi được API thật bằng chính khoá đó', async ({
  page,
  request,
}) => {
  const email = emailMoi();
  const khoa = await dangKyLayKhoa(page, email, 'Công ty Thử Nghiệm');

  // Lời hứa của cả pha nằm ở đúng dòng này: khoá vừa tự cấp gọi được API ngay, không chờ ai duyệt.
  const goi = await request.get('/v1/autocomplete?q=ca%20phe', { headers: { 'X-Api-Key': khoa } });
  expect(goi.status()).toBe(200);

  await page.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();
  await expect(page.getByText('Bản dùng thử')).toBeVisible();
  // 2.000 lượt Places của bản dùng thử, lấy từ sổ quota thật chứ không phải chữ viết cứng.
  await expect(page.getByText('2.000')).toBeVisible();
});

test('mã sai năm lần thì mã chết, lần thứ sáu gõ đúng vẫn không vào được', async ({ page }) => {
  const email = emailMoi();
  const maDung = await xinMaVaDoc(page, email);
  const maSai = maDung === '000000' ? '111111' : '000000';

  for (let lan = 0; lan < 5; lan += 1) {
    await nhapMa(page, maSai);
    await expect(page.getByRole('alert')).toBeVisible();
    for (let i = 0; i < 6; i += 1) await page.getByLabel(`Chữ số thứ ${i + 1}`).fill('');
  }

  await nhapMa(page, maDung);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/console\/xac-thuc/);
});

test('chưa đăng nhập mà mở màn Khoá thì bị đưa về đăng nhập, giữ lại đường đang xem', async ({
  page,
}) => {
  await page.goto('/console/khoa');
  await expect(page).toHaveURL(/\/console\/dang-nhap\?next=/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toContain('/khoa');
});

test('đăng xuất rồi thì API trả 401 và giao diện đưa về màn đăng nhập', async ({ page }) => {
  const email = emailMoi();
  await dangKyLayKhoa(page, email, 'Công ty Đăng Xuất');
  await page.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();

  await page.goto('/console/cai-dat');
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(/\/console\/dang-nhap/);

  const sau = await page.request.get('/v1/console/me');
  expect(sau.status()).toBe(401);
});

test('tài khoản này không thấy và không thu hồi được khoá của tài khoản khác', async ({
  browser,
}) => {
  // `browser.newContext()` tạo thủ công KHÔNG kế thừa `use.baseURL` của cấu hình, nên đường dẫn
  // tương đối sẽ hỏng; truyền tay cho cả hai ngữ cảnh.
  const goc = { baseURL: 'http://127.0.0.1:8799' };
  const ctxA = await browser.newContext(goc);
  const pageA = await ctxA.newPage();
  await dangKyLayKhoa(pageA, emailMoi(), 'Công ty A');
  // Gọi bằng fetch TRONG trang chứ không qua `page.request`: cookie phiên là HttpOnly kèm Secure,
  // và đường đi trong trang là đúng đường mà ứng dụng thật dùng.
  const docKhoa = (p: typeof pageA) =>
    p.evaluate(async () => {
      const res = await fetch('/v1/console/keys', { credentials: 'same-origin' });
      return { status: res.status, body: (await res.json()) as { keys?: { keyHash: string }[] } };
    });

  const khoaA = await docKhoa(pageA);
  expect(khoaA.status, 'A phải đọc được khoá của chính mình').toBe(200);
  const hashA = khoaA.body.keys?.[0]?.keyHash;
  expect(hashA).toMatch(/^[a-f0-9]{64}$/);

  const ctxB = await browser.newContext(goc);
  const pageB = await ctxB.newPage();
  await dangKyLayKhoa(pageB, emailMoi(), 'Công ty B');

  // B không thấy khoá của A trong danh sách của mình.
  const khoaB = await docKhoa(pageB);
  expect(khoaB.status).toBe(200);
  expect((khoaB.body.keys ?? []).some((k) => k.keyHash === hashA)).toBe(false);

  // Và B gửi thẳng hash của A lên cũng chỉ nhận 404, không chạm được vào nó.
  const thuHoi = await pageB.evaluate(async (hash) => {
    const res = await fetch(`/v1/console/keys/${hash}/revoke`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'thu-cheo-tenant' }),
    });
    return res.status;
  }, hashA as string);
  expect(thuHoi).toBe(404);

  await ctxA.close();
  await ctxB.close();
});

test('thu hồi khoá rồi thì gọi API bằng khoá đó không còn được', async ({ page, request }) => {
  const khoa = await dangKyLayKhoa(page, emailMoi(), 'Công ty Thu Hồi');
  expect(
    (await request.get('/v1/autocomplete?q=ca%20phe', { headers: { 'X-Api-Key': khoa } })).status(),
  ).toBe(200);

  await page.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();
  await page.goto('/console/khoa');
  await page.getByRole('button', { name: 'Thu hồi' }).first().click();
  // Toast đếm ngược 5 giây rồi mới gửi thật.
  await expect(page.getByText(/gửi sau/)).toBeVisible();
  await expect(page.getByText('Đã thu hồi')).toBeVisible({ timeout: 15_000 });

  const sau = await request.get('/v1/autocomplete?q=ca%20phe', { headers: { 'X-Api-Key': khoa } });
  expect(sau.status()).toBe(401);
});

test('huỷ trong 5 giây khi thu hồi thì khoá vẫn dùng được', async ({ page, request }) => {
  const khoa = await dangKyLayKhoa(page, emailMoi(), 'Công ty Huỷ');
  await page.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();
  await page.goto('/console/khoa');

  await page.getByRole('button', { name: 'Thu hồi' }).first().click();
  await page.getByRole('button', { name: 'Huỷ' }).click();
  await page.waitForTimeout(6_000);

  // Không có request nào rời trình duyệt, nên khoá còn nguyên.
  const sau = await request.get('/v1/autocomplete?q=ca%20phe', { headers: { 'X-Api-Key': khoa } });
  expect(sau.status()).toBe(200);
  // `exact` là bắt buộc: chuỗi "Đang dùng" còn nằm trong câu "Đang dùng 1/10 khoá" ở khối cấp khoá.
  await expect(page.getByText('Đang dùng', { exact: true })).toBeVisible();
});

test('cấp thêm khoá và danh sách đếm đúng số khoá đang dùng', async ({ page }) => {
  await dangKyLayKhoa(page, emailMoi(), 'Công ty Nhiều Khoá');
  await page.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();
  await page.goto('/console/khoa');
  await expect(page.getByText('Đang dùng 1/10 khoá')).toBeVisible();

  await page.getByLabel('Tên gợi nhớ').fill('khoá thứ hai');
  await page.getByRole('button', { name: 'Cấp khoá' }).click();
  await expect(page.getByTestId('khoa-mot-lan')).toBeVisible();
  await expect(page.getByText('Đang dùng 2/10 khoá')).toBeVisible();
});

test('thông tin biên nhận sống qua lần tải lại, và lần lưu sau không xoá mất nó', async ({
  page,
}) => {
  const email = emailMoi();
  await dangKyLayKhoa(page, email, 'Công ty Biên Nhận');
  await page.getByRole('button', { name: /Tôi đã lưu khoá/ }).click();

  await page.goto('/console/cai-dat');
  await page.getByLabel('Tên trên biên nhận').fill('Công ty TNHH Biên Nhận');
  await page.getByLabel('Mã số thuế').fill('0312345678');
  await page.getByLabel('Địa chỉ').fill('12 Nguyễn Huệ, Quận 1, TP.HCM');
  await page.getByLabel('Email nhận biên nhận').fill('ketoan@bien-nhan.vn');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('status')).toHaveText('Đã lưu');

  // Tải lại: bản cũ chỉ nạp `name` nên bốn ô này hiện rỗng, trông y như "bấm Lưu mà không lưu".
  await page.reload();
  await expect(page.getByLabel('Tên trên biên nhận')).toHaveValue('Công ty TNHH Biên Nhận');
  await expect(page.getByLabel('Mã số thuế')).toHaveValue('0312345678');
  await expect(page.getByLabel('Địa chỉ')).toHaveValue('12 Nguyễn Huệ, Quận 1, TP.HCM');
  await expect(page.getByLabel('Email nhận biên nhận')).toHaveValue('ketoan@bien-nhan.vn');

  // Phần nguy hiểm hơn: chỉ sửa tên tổ chức rồi lưu. `PATCH` đặt lại cả năm cột, nên nếu biểu mẫu
  // không nạp đủ thì lần lưu này GHI NULL ĐÈ lên bốn trường vừa nhập — mất dữ liệu, im lặng.
  await page.getByLabel('Tên tổ chức').fill('Công ty Biên Nhận Đã Đổi Tên');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('status')).toHaveText('Đã lưu');

  await page.reload();
  await expect(page.getByLabel('Tên tổ chức')).toHaveValue('Công ty Biên Nhận Đã Đổi Tên');
  await expect(page.getByLabel('Mã số thuế')).toHaveValue('0312345678');
  await expect(page.getByLabel('Email nhận biên nhận')).toHaveValue('ketoan@bien-nhan.vn');

  // Máy chủ mới là nguồn sự thật, không phải state của trang.
  const tuMayChu = await page.evaluate(async () => {
    const r = await fetch('/v1/console/tenant', { credentials: 'same-origin' });
    return r.json();
  });
  expect(tuMayChu.tenant.billing_tax_code).toBe('0312345678');
  expect(tuMayChu.tenant.billing_address).toBe('12 Nguyễn Huệ, Quận 1, TP.HCM');
  expect(tuMayChu.tenant.name).toBe('Công ty Biên Nhận Đã Đổi Tên');
});
