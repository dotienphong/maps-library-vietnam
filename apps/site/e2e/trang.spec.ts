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

test('mọi link nội bộ đều sống', async ({ page, request }) => {
  const daKiem = new Set<string>();
  const hong: string[] = [];

  for (const path of TRANG) {
    await page.goto(path);
    const links = await page.$$eval('a[href^="/"]', (as) =>
      as.map((a) => a.getAttribute('href') ?? ''),
    );
    for (const href of links) {
      // Bỏ neo trong trang và tệp tĩnh đã có bài kiểm riêng.
      const sach = href.split('#')[0] ?? '';
      if (!sach || daKiem.has(sach)) continue;
      daKiem.add(sach);
      const res = await request.get(sach);
      if (res.status() !== 200) hong.push(`${sach} → ${res.status()} (từ ${path})`);
    }
  }

  expect(daKiem.size).toBeGreaterThan(5);
  expect(hong, `link chết:\n${hong.join('\n')}`).toEqual([]);
});

test('đường dẫn lạ trả 404 và trang 404 vẫn dùng được', async ({ page }) => {
  const res = await page.goto('/khong-co-that/');
  expect(res?.status()).toBe(404);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Trang chủ' }).first()).toBeVisible();
});

test('bản đồ hero chỉ nạp iframe sau khi bấm', async ({ page }) => {
  await page.goto('/');
  // Trước khi bấm: KHÔNG có iframe nào. Đây là lời hứa về tốc độ tải, nên phải có bài khoá lại.
  await expect(page.locator('iframe')).toHaveCount(0);

  await page.getByRole('button', { name: /Bấm để mở bản đồ/ }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveAttribute('title', /Bản đồ MapsLibVN/);
});

test('điện thoại: ngăn kéo mở, đi được tới trang, và mọi mục đều bấm tới nơi', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const nut = page.getByRole('button', { name: 'Mở menu điều hướng' });
  await expect(nut).toBeVisible();
  await expect(nut).toHaveAttribute('aria-expanded', 'false');

  await nut.click();
  const nganKeo = page.getByRole('dialog', { name: 'Điều hướng chính' });
  await expect(nganKeo).toBeVisible();
  await expect(nut).toHaveAttribute('aria-expanded', 'true');

  // Cả năm mục PHẢI nhìn thấy được mà không cần cuộn ngang — đây chính là lý do bỏ thanh cuộn:
  // ở 390px thanh cũ giấu mất "Bài viết" và "Liên hệ".
  for (const nhan of ['Tính năng', 'Bảng giá', 'So với Google', 'Bài viết', 'Liên hệ']) {
    await expect(nganKeo.getByRole('link', { name: nhan }), `thiếu mục ${nhan}`).toBeInViewport();
  }

  await nganKeo.getByRole('link', { name: 'Bảng giá' }).click();
  await expect(page).toHaveURL(/\/bang-gia\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bảng giá');
});

test('điện thoại: Esc đóng ngăn kéo và trả tiêu điểm về nút mở', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const nut = page.getByRole('button', { name: 'Mở menu điều hướng' });
  await nut.click();
  await expect(page.getByRole('dialog', { name: 'Điều hướng chính' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Điều hướng chính' })).toBeHidden();
  await expect(nut).toHaveAttribute('aria-expanded', 'false');
  // Trả tiêu điểm về đúng nút đã mở: thiếu bước này, người dùng bàn phím rơi về đầu trang.
  await expect(nut).toBeFocused();
  // Cuộn trang nền phải được mở lại, nếu không cả trang cứng đờ sau khi đóng menu.
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('điện thoại: nút đóng và chạm nền tối đều đóng được ngăn kéo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const nut = page.getByRole('button', { name: 'Mở menu điều hướng' });
  const nganKeo = page.getByRole('dialog', { name: 'Điều hướng chính' });

  await nut.click();
  await page.getByRole('button', { name: 'Đóng menu điều hướng' }).click();
  await expect(nganKeo).toBeHidden();

  await nut.click();
  // Chạm mép trái màn hình = chạm vùng nền tối, vì ngăn kéo nằm sát mép phải.
  await page.mouse.click(10, 400);
  await expect(nganKeo).toBeHidden();
});

test('máy tính: không có nút hamburger, năm mục nằm thẳng trên thanh', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mở menu điều hướng' })).toBeHidden();
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  await expect(nav.getByRole('link')).toHaveCount(5);
});

test('bốn tab mã nhúng đổi được bằng chuột và bàn phím', async ({ page }) => {
  await page.goto('/');
  // Đủ bốn cách như trang Cài đặt của tài liệu: thẻ script, npm, React, React Native.
  await expect(page.getByRole('tab')).toHaveCount(4);

  const tabNpm = page.getByRole('tab', { name: 'npm' });
  await tabNpm.click();
  await expect(tabNpm).toHaveAttribute('aria-selected', 'true');
  // Bản ESM phải nhắc cài peer maplibre-gl và truyền vào, nếu không createMap ném lỗi.
  await expect(page.getByRole('tabpanel')).toContainText('@mapslibvn/web maplibre-gl');
  await expect(page.getByRole('tabpanel')).toContainText('{ maplibre: maplibregl }');

  // Mũi tên phải là điều người dùng bàn phím mong đợi ở một tablist.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'React', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel')).toContainText('@mapslibvn/react maplibre-gl');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'React Native' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('trang chủ in đủ bốn thẻ giá, có gói dùng thử 0đ', async ({ page }) => {
  await page.goto('/');
  const khoi = page.locator('section[aria-labelledby="tt-gia"]');
  await expect(khoi.getByRole('heading', { level: 3 })).toHaveText([
    'Dùng thử',
    'Starter',
    'Professional',
    'Business',
  ]);
  await expect(khoi).toContainText('0đ');
  await expect(khoi).toContainText('2.000 lượt Places trong 30 ngày');
});

test('công tắc sáng tối đổi giao diện và nhớ lựa chọn', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  const toiLucDau = await html.evaluate((el) => el.classList.contains('dark'));

  await page.getByRole('button', { name: 'Đổi giao diện sáng tối' }).click();
  await expect.poll(() => html.evaluate((el) => el.classList.contains('dark'))).toBe(!toiLucDau);

  await page.reload();
  await expect.poll(() => html.evaluate((el) => el.classList.contains('dark'))).toBe(!toiLucDau);
});

test('ghi nguồn dữ liệu mở có mặt ở mọi trang — đây là nghĩa vụ giấy phép', async ({ page }) => {
  for (const path of TRANG) {
    await page.goto(path);
    await expect(
      page.getByRole('contentinfo').getByText('OpenStreetMap contributors'),
      `thiếu ghi nguồn ở ${path}`,
    ).toBeVisible();
  }
});

test('số điện thoại bấm gọi được, có ở mọi trang và trong đánh dấu Organization', async ({
  page,
}) => {
  for (const path of TRANG) {
    await page.goto(path);
    const goi = page.getByRole('contentinfo').getByRole('link', { name: '+84 983 450 456' });
    await expect(goi, `thiếu số điện thoại ở ${path}`).toBeVisible();
    // href phải là E.164 KHÔNG khoảng trắng, nếu không máy gọi sai số.
    await expect(goi).toHaveAttribute('href', 'tel:+84983450456');
  }

  await page.goto('/');
  const khoi = await page.locator('script[type="application/ld+json"]').allTextContents();
  const org = khoi.map((ld) => JSON.parse(ld)).find((ld) => ld['@type'] === 'Organization');
  expect(org?.contactPoint?.telephone).toBe('+84983450456');
});

test('trang liên hệ có khối gọi điện riêng', async ({ page }) => {
  await page.goto('/lien-he/');
  await expect(page.getByRole('heading', { name: 'Điện thoại' })).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('link', { name: '+84 983 450 456' }),
  ).toHaveAttribute('href', 'tel:+84983450456');
});
