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

  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: 'Duyệt đóng góp POI' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Duyệt' }).click();
  await expect(row).toHaveCount(0);

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

  await page.goto('/admin/');
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Từ chối' }).click();
  await expect(row).toHaveCount(0);

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
