import { expect, test } from '@playwright/test';

// Mọi trang trong sidebar (spec docs-site 04/09/2026 mục 4) + 2 trang pháp lý sinh lúc prebuild
// (M5 Task 2) + trang Astro `/react-demo/` (không phải trang Starlight, nhưng có `h1` trong header).
// Chỉ kiểm link nội bộ để CI không phụ thuộc Internet.
const PAGES = [
  '/',
  '/tinh-nang/',
  '/cai-dat/',
  '/khoa-api/',
  '/bat-dau/',
  '/react-native/',
  '/ban-do-web/',
  '/tim-kiem/',
  '/dan-duong/',
  '/dan-duong-react-native/',
  '/react/',
  '/do-chinh-xac/',
  '/dong-gop/',
  '/tu-host/',
  '/api/',
  '/sdk/',
  '/nhung-thu/',
  '/react-demo/',
  '/giay-phep/',
  '/dieu-khoan/',
  '/thong-bao-ben-thu-ba/',
];

for (const path of PAGES) {
  test(`trang ${path} tải được và link nội bộ không vỡ`, async ({ page, request }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();

    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((links) =>
        links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''),
      );
    const unique = [...new Set(hrefs.map((h) => h.split('#')[0]).filter(Boolean))];
    expect(unique.length).toBeGreaterThan(0);
    for (const href of unique) {
      const r = await request.get(href);
      expect(r.status(), `link vỡ: ${href} trên ${path}`).toBeLessThan(400);
    }
  });
}
