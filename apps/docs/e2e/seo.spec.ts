import { expect, test } from '@playwright/test';

const DOCS = 'https://mapslibvn-docs.pages.dev';

test('mọi trang trong sitemap đạt chuẩn SEO', async ({ page, request }) => {
  const xml = await (await request.get('/sitemap-0.xml')).text();
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1] ?? '').pathname);
  expect(paths.length).toBeGreaterThanOrEqual(19);

  const daThay = new Map<string, string>();
  for (const path of paths) {
    // Astro preview không đổi /playground thành playground.html như Cloudflare Pages.
    const res = await page.goto(path === '/playground' ? '/playground.html' : path);
    expect(res?.status(), path).toBe(200);
    await expect(page.locator('h1'), path).toHaveCount(1);

    const title = await page.title();
    expect(title.length, `${path}: "${title}"`).toBeGreaterThanOrEqual(20);
    expect(title.length, `${path}: "${title}"`).toBeLessThanOrEqual(60);
    expect(title, path).not.toContain('| MapsLibVN');
    expect(daThay.get(title), `${path} trùng title với ${daThay.get(title)}`).toBeUndefined();
    daThay.set(title, path);

    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc?.length ?? 0, `${path}: "${desc}"`).toBeGreaterThanOrEqual(120);
    expect(desc?.length ?? 0, `${path}: "${desc}"`).toBeLessThanOrEqual(160);

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical, path).toBe(`${DOCS}${path}`);

    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(og, path).toBeTruthy();
    const anh = await request.get(new URL(og ?? '').pathname);
    expect(anh.status(), `${path}: og:image`).toBe(200);

    const khoi = await page.locator('script[type="application/ld+json"]').allTextContents();
    if (path !== '/playground') expect(khoi.length, path).toBeGreaterThan(0);
    for (const ld of khoi) {
      expect((JSON.parse(ld) as Record<string, unknown>)['@context'], path).toBe(
        'https://schema.org',
      );
    }
  }
});

test('robots, llms và các trang noindex', async ({ page, request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain(`Sitemap: ${DOCS}/sitemap-index.xml`);
  // Chỉ thị lạ (như Content-Signal) làm Lighthouse chấm robots.txt không hợp lệ, SEO tụt xuống 92.
  for (const dong of robots.split('\n').filter(Boolean)) {
    expect(dong).toMatch(/^(User-agent|Allow|Disallow|Sitemap): /);
  }

  for (const tep of [
    '/llms.txt',
    '/llms-full.txt',
    '/llms-small.txt',
    '/_llms-txt/getting-started.txt',
  ]) {
    const res = await request.get(tep);
    expect(res.status(), tep).toBe(200);
    const noiDung = await res.text();
    expect(noiDung, tep).not.toMatch(/mlv_live_[0-9A-Za-z]{24}/);
    expect(noiDung, tep).not.toMatch(/tự host|self-host/i);
  }
  const muc = await (await request.get('/llms.txt')).text();
  expect(muc.startsWith('# MapsLibVN')).toBe(true);
  expect(muc).toContain(`${DOCS}/llms-full.txt`);

  for (const path of ['/thong-bao-ben-thu-ba/', '/react-demo/']) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute('content', 'noindex');
  }
});

test('footer mọi trang có link về website', async ({ page }) => {
  for (const path of ['/', '/api/']) {
    await page.goto(path);
    await expect(
      page.locator('.lien-ket-site a[href="https://mapslibvn.pages.dev/bang-gia/"]'),
      path,
    ).toHaveCount(1);
  }
});
