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
