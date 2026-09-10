import { expect, test } from '@playwright/test';

// MapLibre 6 chạy worker ESM riêng và tự suy URL của nó lúc chạy bằng
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Trên `/react-demo/`, Vite gộp maplibre
// vào một chunk trong `_astro/`, nên worker được tìm ở `/_astro/maplibre-gl-worker.mjs`. Nếu build
// không phát ra file đó, worker 404 → maplibre không parse được vector tile → bản đồ trống trong
// khi style/sprite/pmtiles vẫn 200. `docs.spec.ts` không bắt được vì nó chỉ kiểm link `<a href>`.
const RUNTIME_ASSETS = [
  '/_astro/maplibre-gl-worker.mjs',
  // Chính worker `import` file này, nên thiếu nó thì worker cũng chết.
  '/_astro/maplibre-gl-shared.mjs',
];

for (const path of RUNTIME_ASSETS) {
  test(`build phát ra ${path} cho bản đồ React demo`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status(), `thiếu ${path} → worker maplibre chết, bản đồ trống`).toBe(200);
  });
}

test('/react-demo/ tải worker maplibre không lỗi', async ({ page }) => {
  // Phải đăng ký chờ TRƯỚC `goto`: maplibre xin worker ngay trong constructor của `Map`, nên
  // `canvas` có thể hiện xong trước khi response worker về — bắt bằng `page.on` là đua tiến trình.
  const workerResponse = page.waitForResponse((res) => res.url().includes('maplibre-gl-worker'));

  await page.goto('/react-demo/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

  const res = await workerResponse;
  expect(res.status(), `worker maplibre tải lỗi: ${res.url()}`).toBe(200);
});
