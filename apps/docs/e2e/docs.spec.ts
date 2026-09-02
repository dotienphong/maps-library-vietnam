import { expect, test } from '@playwright/test';

// 5 trang spec 7.4 + 2 trang pháp lý sinh lúc prebuild (M5 Task 2).
// Chỉ kiểm link nội bộ để CI không phụ thuộc Internet.
const PAGES = [
  '/',
  '/bat-dau/',
  '/tu-host/',
  '/giay-phep/',
  '/do-chinh-xac/',
  '/dong-gop/',
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
