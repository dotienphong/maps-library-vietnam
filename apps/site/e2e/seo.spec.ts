import { expect, test } from '@playwright/test';

const TRANG = [
  '/',
  '/tinh-nang/',
  '/bang-gia/',
  '/so-sanh/google-maps-api/',
  '/so-sanh/vietmap/',
  '/bai-viet/',
  '/lien-he/',
];

for (const path of TRANG) {
  test(`SEO cơ bản: ${path}`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);

    // Đúng MỘT h1. Hai h1 làm bot không biết trang nói về cái gì.
    await expect(page.locator('h1')).toHaveCount(1);

    const title = await page.title();
    expect(title.length).toBeGreaterThan(10);
    expect(title.length).toBeLessThanOrEqual(60);

    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc?.length ?? 0).toBeGreaterThanOrEqual(120);
    expect(desc?.length ?? 0).toBeLessThanOrEqual(160);

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBe(`https://mapslibvn.pages.dev${path}`);

    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');

    // Mọi khối JSON-LD phải parse được; một dấu phẩy thừa là Google bỏ cả khối.
    const khoi = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(khoi.length).toBeGreaterThan(0);
    for (const ld of khoi) {
      const doc = JSON.parse(ld) as Record<string, unknown>;
      expect(doc['@context']).toBe('https://schema.org');
      expect(typeof doc['@type']).toBe('string');
    }
  });
}

test('robots.txt và sitemap trỏ đúng nhau', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('Sitemap: https://mapslibvn.pages.dev/sitemap-index.xml');

  const sitemap = await request.get('/sitemap-0.xml');
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain('<loc>https://mapslibvn.pages.dev/bang-gia/</loc>');
  // 404 không được nằm trong sitemap — gửi bot vào trang lỗi là tự hạ chất lượng.
  expect(xml).not.toContain('/404');
});

test('ảnh OG mà thẻ meta trỏ tới phải tồn tại thật', async ({ page, request }) => {
  for (const path of ['/', '/bang-gia/', '/tinh-nang/']) {
    await page.goto(path);
    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(og).toBeTruthy();
    const anh = await request.get(new URL(og as string).pathname);
    expect(anh.status(), `thiếu ảnh OG cho ${path}`).toBe(200);
  }
});

test('trang giá: số tiền khớp catalog, và vẫn đúng khi tắt JavaScript', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('/bang-gia/');
  await expect(page.getByText('650.000đ').first()).toBeVisible();
  await expect(page.getByText('10.400.000đ').first()).toBeVisible();
  await ctx.close();
});

test('công tắc kỳ đổi giá đúng khi có JavaScript', async ({ page }) => {
  await page.goto('/bang-gia/');
  await expect(page.getByText('650.000đ').first()).toBeVisible();

  // Bấm vào NHÃN chứ không vào ô radio: ô radio cố ý ẩn kiểu chỉ-đọc-màn-hình (1px, bị cắt) và
  // người dùng thật luôn bấm nhãn. Gọi .check() thẳng vào ô ẩn sẽ treo cho tới hết thời gian chờ.
  await page.getByText('3 tháng', { exact: true }).click();
  await expect(page.getByRole('radio', { name: '3 tháng' })).toBeChecked();
  await expect(page.getByText('1.950.000đ').first()).toBeVisible();

  // Đổi tiếp sang 12 tháng để chắc script không chỉ chạy đúng một lần.
  await page.getByText('12 tháng', { exact: true }).click();
  await expect(page.getByText('7.800.000đ').first()).toBeVisible();
});

test('bàn phím: Tab tới được ô chọn kỳ và đổi bằng mũi tên', async ({ page }) => {
  await page.goto('/bang-gia/');
  // Ô radio ẩn về mặt thị giác nhưng PHẢI còn trong luồng tiêu điểm, nếu không người dùng bàn
  // phím không đổi kỳ được. Đây là lý do dùng sr-only thay vì display:none.
  await page.getByRole('radio', { name: '1 tháng' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '3 tháng' })).toBeChecked();
  await expect(page.getByText('1.950.000đ').first()).toBeVisible();
});

test('ngân sách JavaScript trang chủ dưới 15 KB gzip', async ({ page }) => {
  // Khoá lại quyết định không dùng React. Một island React kéo theo khoảng 45 KB gzip và sẽ làm
  // bài này đỏ ngay, nên không ai vô tình thêm vào mà không nhận ra cái giá.
  const tepJs: string[] = [];
  page.on('response', (res) => {
    if (res.url().endsWith('.js')) tepJs.push(res.url());
  });
  await page.goto('/', { waitUntil: 'networkidle' });

  const byteNhung = await page.evaluate(() =>
    [...document.querySelectorAll('script:not([src])')]
      .filter((s) => s.getAttribute('type') !== 'application/ld+json')
      .reduce((tong, s) => tong + new Blob([s.textContent ?? '']).size, 0),
  );
  // Byte thô chứ chưa nén; ngưỡng 15 KB vẫn rất rộng so với mức thật khoảng 1,5 KB thô.
  expect(byteNhung).toBeLessThan(15_000);
  expect(tepJs.length, `không được có tệp JS ngoài: ${tepJs.join(', ')}`).toBe(0);
});

test('robots.txt khai Content-Signal cho bot AI', async ({ request }) => {
  const txt = await (await request.get('/robots.txt')).text();
  expect(txt).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes');
});

test('llms.txt có mọi trang chính và giá lấy từ catalog', async ({ request }) => {
  const res = await request.get('/llms.txt');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/plain');
  const txt = await res.text();
  expect(txt.startsWith('# MapsLibVN\n')).toBe(true);
  for (const path of TRANG.filter((p) => p !== '/')) {
    expect(txt, path).toContain(`(https://mapslibvn.pages.dev${path})`);
  }
  expect(txt).toContain('650.000đ');
  expect(txt).not.toMatch(/mlv_live_[0-9A-Za-z]{24}/);
});

test('sitemap: bài viết có lastmod, trang marketing thì không', async ({ request }) => {
  const xml = await (await request.get('/sitemap-0.xml')).text();
  expect(xml).toMatch(/<loc>https:\/\/mapslibvn\.pages\.dev\/bai-viet\/[^<]+\/<\/loc><lastmod>/);
  expect(xml).toContain('<loc>https://mapslibvn.pages.dev/bang-gia/</loc></url>');
});

test('logo vuông mà Organization.logo trỏ tới tồn tại thật', async ({ request }) => {
  const logo = await request.get('/logo-512.png');
  expect(logo.status()).toBe(200);
  expect(logo.headers()['content-type']).toContain('image/png');
});
