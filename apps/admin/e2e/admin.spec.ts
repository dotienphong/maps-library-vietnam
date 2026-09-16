import { expect, test } from '@playwright/test';
// tsconfig của app bật allowJs nên .mjs này được kiểm kiểu qua JSDoc, không cần .d.ts.
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const FREE_KEY = 'mlv_live_edit00000000000000000000';

// Access giả lập: chèn JWT như Cloudflare Access làm ở production (cùng khoá với JWKS
// mà harness --serve đang phục vụ, vì cả hai đọc .cache/access-fake.json).
const ACCESS_JWT = signAccessJwt({ email: 'phong@e2e.local' });

// page.setExtraHTTPHeaders là bắt buộc: fetch() do trang phát ra KHÔNG nhận header từ
// test.use({ extraHTTPHeaders }) — chỉ APIRequestContext (fixture `request`) nhận.
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'Cf-Access-Jwt-Assertion': ACCESS_JWT });
});

test('luồng duyệt: tạo POI pending → thấy trên trang → Duyệt → biến khỏi pending', async ({
  page,
  request,
}) => {
  const name = `Quán E2E ${Date.now()}`;
  const created = await (
    await request.post('/v1/edits', {
      headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
      data: {
        kind: 'create',
        changes: { name, lat: 10.772, lng: 106.702, category: 'cafe' },
        end_user_token: 'e2e-user',
      },
    })
  ).json();
  expect(created.status).toBe('pending');

  await page.goto('/admin/edits');
  await expect(page).toHaveTitle(/Admin Page/);
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Duyệt' }).click();
  // Hoãn gửi 5 giây: bản ghi biến khỏi danh sách ngay, nhưng request chỉ đi sau đó.
  await expect(row).toHaveCount(0);
  await page.waitForTimeout(6000);

  // POI đã active qua API công khai
  const place = await request.get(`/v1/places/${created.poi_id}`, {
    headers: { 'X-Api-Key': FREE_KEY },
  });
  expect(place.ok()).toBeTruthy();
  expect((await place.json()).status).toBe('active');
});

test('nút Từ chối: edit biến khỏi pending và POI không active', async ({ page, request }) => {
  const name = `Quán E2E Từ Chối ${Date.now()}`;
  const created = await (
    await request.post('/v1/edits', {
      headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
      data: {
        kind: 'create',
        changes: { name, lat: 10.771, lng: 106.703, category: 'cafe' },
        end_user_token: 'e2e-user-2',
      },
    })
  ).json();

  await page.goto('/admin/edits');
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Từ chối', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.waitForTimeout(6000);

  const place = await request.get(`/v1/places/${created.poi_id}`, {
    headers: { 'X-Api-Key': FREE_KEY },
  });
  expect(place.status()).toBe(404);
});

test('không JWT → API admin chặn 401', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8799' });
  const response = await context.request.get('/v1/admin/edits');
  expect(response.status()).toBe(401);
  await context.close();
});

test('huỷ trong 5 giây: đóng góp vẫn ở hàng chờ, POI chưa active', async ({ page, request }) => {
  const name = `Quán E2E Huỷ ${Date.now()}`;
  const created = await (
    await request.post('/v1/edits', {
      headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
      data: {
        kind: 'create',
        changes: { name, lat: 10.7705, lng: 106.7045, category: 'cafe' },
        end_user_token: 'e2e-huy',
      },
    })
  ).json();

  await page.goto('/admin/edits');
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Duyệt' }).click();
  await page.getByRole('button', { name: 'Huỷ' }).click();
  await page.waitForTimeout(6000);

  // Bản ghi vẫn nằm trong hàng chờ vì request duyệt chưa bao giờ được gửi.
  // Không kiểm qua /v1/places: POI ở trạng thái pending vẫn trả 200 cho chính tenant đã gửi
  // đóng góp, nên endpoint đó không phân biệt được "đã duyệt" với "chưa duyệt".
  const pending = (await (
    await request.get('/v1/admin/edits?status=pending&limit=100', {
      headers: { 'Cf-Access-Jwt-Assertion': ACCESS_JWT },
    })
  ).json()) as { items: { id: number }[] };
  expect(pending.items.some((item) => item.id === created.edit_id)).toBe(true);
});

test('màn hình hẹp: điều hướng bằng nút hamburger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/edits');
  await page.getByRole('button', { name: 'Mở menu điều hướng' }).click();
  await expect(page.getByRole('link', { name: /Duyệt đóng góp/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: /Duyệt đóng góp/ })).toBeHidden();
});

test('chi tiết đóng góp đổi toạ độ hiện khoảng cách lệch', async ({ page, request }) => {
  const name = `Quán E2E Dời ${Date.now()}`;
  const created = await (
    await request.post('/v1/edits', {
      headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
      data: {
        kind: 'create',
        changes: { name, lat: 10.769, lng: 106.706, category: 'cafe' },
        end_user_token: 'e2e-doi-seed',
      },
    })
  ).json();
  await request.post(`/v1/admin/edits/${created.edit_id}/approve`, {
    headers: { 'Cf-Access-Jwt-Assertion': ACCESS_JWT },
  });
  await request.post('/v1/edits', {
    headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
    data: {
      kind: 'update',
      poi_id: created.poi_id,
      changes: { lat: 10.772, lng: 106.709 },
      end_user_token: 'e2e-doi-move',
    },
  });

  // Khung hẹp để dùng chế độ thẻ — nhãn đầy đủ "Đổi vị trí · X m" chỉ có ở đó; chế độ bảng
  // rút gọn thành một huy hiệu "X m" trong cột Vị trí.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/edits');
  await expect(page.getByText(/Đổi vị trí · \d+ m/).first()).toBeVisible();
  await page
    .getByRole('button', { name: new RegExp(name) })
    .first()
    .click();
  await expect(page.getByText(/Lệch \d+ m/)).toBeVisible();
});

test('bản đồ thật: maplibre dựng được và giao thức pmtiles phân giải', async ({
  page,
  request,
}) => {
  const name = `Quán E2E Bản Đồ ${Date.now()}`;
  const created = await (
    await request.post('/v1/edits', {
      headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
      data: {
        kind: 'create',
        changes: { name, lat: 10.762, lng: 106.682, category: 'cafe' },
        end_user_token: 'e2e-map-seed',
      },
    })
  ).json();
  await request.post(`/v1/admin/edits/${created.edit_id}/approve`, {
    headers: { 'Cf-Access-Jwt-Assertion': ACCESS_JWT },
  });
  await request.post('/v1/edits', {
    headers: { 'X-Api-Key': FREE_KEY, 'content-type': 'application/json' },
    data: {
      kind: 'update',
      poi_id: created.poi_id,
      changes: { lat: 10.765, lng: 106.685 },
      end_user_token: 'e2e-map-move',
    },
  });

  // Nguồn dữ liệu chỉ được yêu cầu khi `pmtiles://` đã có protocol handler. Thiếu bước đăng ký
  // đó thì maplibre bỏ qua nguồn và KHÔNG request gì — chính là lỗi bản đồ trống ngày 16/09.
  const pmtilesRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('.pmtiles')) pmtilesRequests.push(r.url());
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/edits');
  await page
    .getByRole('button', { name: new RegExp(name) })
    .first()
    .click();

  await expect(page.locator('canvas.maplibregl-canvas').first()).toBeVisible({ timeout: 25_000 });
  await expect.poll(() => pmtilesRequests.length, { timeout: 25_000 }).toBeGreaterThan(0);

  // Style tải xong thật — harness phục vụ tiles từ R2 local nên khẳng định này chạy được ở máy.
  await expect(page.locator('[data-map-loaded]')).toHaveCount(1, { timeout: 25_000 });

  // Hai chốt chỉ xuất hiện khi sự kiện `load` đã bắn, tức style, sprite VÀ nguồn pmtiles đều
  // phân giải được. Harness phục vụ tiles từ R2 local nên khẳng định này chạy được ở máy.
  await expect(page.locator('.maplibregl-marker')).toHaveCount(2, { timeout: 25_000 });

  // Bản đồ tải được thì không có thông báo lỗi nào.
  await expect(page.getByText('Không tải được bản đồ')).toHaveCount(0);
});

test('mọi thứ bấm được đều hiện con trỏ hình bàn tay', async ({ page }) => {
  await page.goto('/admin/edits');

  const cursorOf = (locator: import('@playwright/test').Locator) =>
    locator.evaluate((el) => getComputedStyle(el).cursor);

  // Nút lọc trạng thái, ô chọn loại, và mục điều hướng trong sidebar.
  await expect.poll(() => cursorOf(page.getByRole('button', { name: 'Đã duyệt' }))).toBe('pointer');
  await expect.poll(() => cursorOf(page.getByLabel('Lọc theo loại'))).toBe('pointer');
  await expect
    .poll(() => cursorOf(page.getByRole('link', { name: /Duyệt đóng góp/ }).first()))
    .toBe('pointer');

  // Ô nhập vẫn phải là con trỏ chữ, không phải bàn tay.
  await expect.poll(() => cursorOf(page.getByLabel('Tìm theo tên POI'))).not.toBe('pointer');
});

test('file tĩnh không tồn tại phải trả 404, KHÔNG trả index.html', async ({ request }) => {
  // Fallback SPA từng nuốt cả yêu cầu file .js: trình duyệt giữ index.html cũ, xin một chunk có
  // hash cũ, Worker trả HTML, module bị từ chối vì sai MIME và maplibre không bao giờ nạp được —
  // bản đồ trắng mà không có lỗi nào để hiện. Sự cố 16/09/2026.
  const missing = await request.get('/admin/assets/khong-ton-tai-abc123.js');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type'] ?? '').not.toContain('text/html');

  // Đường dẫn điều hướng thì vẫn phải trả index.html để router phía trình duyệt làm việc.
  const route = await request.get('/admin/edits');
  expect(route.status()).toBe(200);
  expect(route.headers()['content-type'] ?? '').toContain('text/html');
});

test('worker của maplibre phải có mặt trong bản build', async ({ request }) => {
  // maplibre giải mã ô trong Web Worker và dựng URL worker cạnh chunk của chính nó. Vite không
  // tự xuất tệp này, nên thiếu nó thì ô không bao giờ được giải mã: nền bản đồ trắng, chốt vị
  // trí vẫn hiện, và KHÔNG có lỗi nào để hiển thị. Sự cố 16/09/2026.
  const worker = await request.get('/admin/assets/maplibre-gl-worker.mjs');
  expect(worker.status()).toBe(200);
  expect(worker.headers()['content-type'] ?? '').toContain('javascript');
});

test('trang khai icon riêng nên không xin /favicon.ico ở gốc tên miền', async ({
  page,
  request,
}) => {
  const icon = await request.get('/admin/favicon.svg');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type'] ?? '').toContain('svg');

  await page.goto('/admin/edits');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/admin/favicon.svg');
});

const TENANT_FREE = '00000000-0000-4000-8000-0000000000cc';
const POI_ID = '01M3TEST0000000000000CAF01';

test('cấp khoá từ trang Admin rồi gọi API thật bằng chính khoá đó', async ({ page, request }) => {
  await page.goto('/admin/tenants');
  await expect(page).toHaveTitle(/Admin Page/);

  // Mở tenant free đã seed sẵn trong setup.sql.
  // Lọc theo uuid chứ không theo tên: "M4 itest free" còn khớp cả "M4 itest free 2", và tenant
  // đó đứng trước trong danh sách nên `.first()` mở nhầm hàng.
  await page.getByLabel('Tìm theo tên tenant').fill('M4 itest free');
  await page.getByRole('button').filter({ hasText: TENANT_FREE }).first().click();
  await expect(page.getByRole('button', { name: 'Cấp khoá mới' })).toBeVisible();

  await page.getByRole('button', { name: 'Cấp khoá mới' }).click();
  await page.getByLabel('Nhãn').fill(`e2e ${Date.now()}`);
  await page.getByRole('button', { name: 'Cấp khoá' }).click();

  // Khoá rõ hiện đúng một lần, ngay trên màn hình.
  // Khớp đúng chuỗi 24 ký tự: danh sách khoá phía sau cũng dùng font mono nhưng chỉ có tiền tố.
  const khoa = await page
    .getByText(/^mlv_live_[0-9A-Za-z]{24}$/)
    .first()
    .innerText();
  expect(khoa).toMatch(/^mlv_live_[0-9A-Za-z]{24}$/);

  // Bằng chứng mạnh nhất của cả pha: khoá vừa cấp gọi được API công khai ngay lập tức.
  const place = await request.get(`/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': khoa } });
  expect(place.status()).toBe(200);

  // Đóng hộp thoại rồi tải lại: chỉ còn tiền tố, khoá rõ không quay lại được.
  await page.getByRole('button', { name: 'Tôi đã lưu' }).click();
  await page.reload();
  await page.getByLabel('Tìm theo tên tenant').fill('M4 itest free');
  await page.getByRole('button').filter({ hasText: TENANT_FREE }).first().click();
  await expect(page.getByText(khoa)).toHaveCount(0);
  await expect(page.getByText(khoa.slice(0, 17)).first()).toBeVisible();
});

test('thu hồi khoá trên trang Admin làm khoá chết thật sau 5 giây', async ({ page, request }) => {
  // Cấp khoá qua API để test này không phụ thuộc test trước.
  const ACCESS = { 'Cf-Access-Jwt-Assertion': ACCESS_JWT, 'Sec-Fetch-Site': 'same-origin' };
  const cap = await (
    await request.post(`/v1/admin/tenants/${TENANT_FREE}/keys`, {
      headers: { ...ACCESS, 'content-type': 'application/json' },
      data: { label: `e2e thu hồi ${Date.now()}`, kind: 'server' },
    })
  ).json();
  expect(
    (await request.get(`/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': cap.key } })).status(),
  ).toBe(200);

  await page.goto('/admin/tenants');
  await page.getByLabel('Tìm theo tên tenant').fill('M4 itest free');
  await page.getByRole('button').filter({ hasText: TENANT_FREE }).first().click();

  const dong = page.locator('li').filter({ hasText: cap.key_prefix });
  await expect(dong).toBeVisible();
  await dong.getByRole('button', { name: 'Thu hồi' }).click();

  // Hoãn 5 giây: trong lúc đếm, khoá vẫn phải sống.
  expect(
    (await request.get(`/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': cap.key } })).status(),
  ).toBe(200);

  await expect
    .poll(
      async () =>
        (await request.get(`/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': cap.key } })).status(),
      { timeout: 20_000 },
    )
    .toBe(401);
});
