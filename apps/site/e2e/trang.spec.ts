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

test('bản đồ trải ngang: không iframe khi mở, nạp sau lần cuộn đầu', async ({ page }) => {
  await page.goto('/');
  // Lời hứa về tốc độ tải: mở trang không kéo một byte nào của playground.
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('#khoi-ban-do img').first()).toBeVisible();

  await page.mouse.wheel(0, 400);
  const khung = page.locator('iframe');
  await expect(khung).toHaveCount(1);
  await expect(khung).toHaveAttribute('title', /Bản đồ MapsLibVN/);
});

test('bản đồ LUÔN sáng, kể cả khi trang đang ở theme tối', async ({ page }) => {
  // Quyết định của PHONG 22/09: bản đồ là ảnh sản phẩm, không phải một mảng giao diện, nên nó
  // giữ nguyên bản sáng ở cả hai theme thay vì đổi theo trang.
  for (const chon of ['dark', 'light']) {
    await page.goto('/');
    await page.evaluate((v) => localStorage.setItem('mapslibvn-site-theme', v), chon);
    await page.reload();
    await expect(page.locator('#khoi-ban-do img')).toHaveCount(1);
    await page.mouse.wheel(0, 400);
    await expect(page.locator('iframe'), `theme ${chon}`).toHaveAttribute(
      'src',
      /\/playground\?embed=1&style=light$/,
    );
  }
});

test('nút "Mở bản đồ tương tác" nạp ngay không cần cuộn', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở bản đồ tương tác' }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
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

test('bento bảy ô đúng thứ tự và mỗi ô có link tài liệu', async ({ page }) => {
  await page.goto('/');
  const khoi = page.locator('section[aria-labelledby="tt-tinh-nang"]');
  await expect(khoi.getByRole('heading', { level: 3 })).toHaveText([
    'Tìm kiếm hiểu tiếng Việt',
    'Rẻ hơn Google',
    '164 loại địa điểm',
    'Geocode nói thật',
    'Dẫn đường',
    'Giao hàng & vận tải',
    'Bốn SDK, một API',
  ]);
  await expect(khoi.getByRole('link', { name: /→$/ })).toHaveCount(7);
  // Con số rẻ hơn Google tính từ catalog, không gõ tay.
  await expect(khoi.getByText(/^\d+–\d+%$/)).toBeVisible();
});

test('khối giá: bốn thẻ, Professional nổi bật là nút nhấn duy nhất trong khối', async ({
  page,
}) => {
  await page.goto('/');
  const khoi = page.locator('section[aria-labelledby="tt-gia"]');
  await expect(khoi.getByRole('heading', { level: 3 })).toHaveText([
    'Dùng thử',
    'Starter',
    'Professional',
    'Business',
  ]);
  await expect(khoi.getByText('Được chọn nhiều nhất')).toBeVisible();
  await expect(khoi).toContainText('2.000 lượt Places trong 30 ngày');
  const nutNhan = khoi.locator('a.bg-accent');
  await expect(nutNhan).toHaveCount(1);
  await expect(nutNhan).toHaveText('Chọn Professional');
});

test('mặc định tối bất kể cài đặt máy; chọn sáng thì nhớ', async ({ browser }) => {
  // Mô phỏng máy đặt SÁNG để chứng minh site không còn đi theo prefers-color-scheme.
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto('/');
  const html = page.locator('html');
  expect(await html.evaluate((el) => el.classList.contains('dark'))).toBe(true);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0a0a0a');

  await page.getByRole('button', { name: 'Đổi giao diện sáng tối' }).click();
  await expect.poll(() => html.evaluate((el) => el.classList.contains('dark'))).toBe(false);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#fafafa');

  await page.reload();
  expect(await html.evaluate((el) => el.classList.contains('dark'))).toBe(false);
  await ctx.close();
});

test('đã chọn tối thì reload vẫn tối', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('mapslibvn-site-theme', 'dark'));
  await page.reload();
  expect(await page.locator('html').evaluate((el) => el.classList.contains('dark'))).toBe(true);
});

test('mọi trang có đường tới giấy phép và ghi nguồn — đây là nghĩa vụ giấy phép', async ({
  page,
}) => {
  // Chân trang KHÔNG còn in chuỗi ghi nguồn (PHONG chốt 22/09/2026). Nghĩa vụ ODbL vẫn được giữ ở
  // đúng chỗ dữ liệu xuất hiện: ảnh bản đồ và iframe playground tự mang ghi nguồn. Thứ phải có ở
  // MỌI trang là đường tới bản đầy đủ — bài này khoá đúng điều đó.
  for (const path of TRANG) {
    await page.goto(path);
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: 'Giấy phép và ghi nguồn' }),
      `thiếu đường tới giấy phép ở ${path}`,
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

test('không còn lớp brand- nào trên bảy trang', async ({ page }) => {
  for (const path of TRANG) {
    await page.goto(path);
    const con = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="brand-"]')].map((el) => el.className),
    );
    expect(con, `còn brand- ở ${path}`).toEqual([]);
  }
});

test('trang Tính năng: mục lục dính và bảy hàng, mỗi hàng có bằng chứng nhìn được', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tinh-nang/');
  const mucLuc = page.getByRole('navigation', { name: 'Mục lục tính năng' });
  await expect(mucLuc.getByRole('link')).toHaveCount(7);
  // Mỗi hàng phải có thứ NHÌN được, không chỉ chữ — đó là điều tách trang này khỏi bản cũ.
  await expect(page.locator('[data-bang-chung]')).toHaveCount(7);
  // Bản đồ LUÔN sáng như ở trang chủ: đúng MỘT ảnh, không phải một cặp đổi theo theme.
  await expect(page.locator('[data-bang-chung] img')).toHaveCount(1);
});

test('bảng giá: thanh ước tính chỉ đúng gói theo số nhập', async ({ page }) => {
  await page.goto('/bang-gia/');
  const places = page.getByLabel('Lượt Places mỗi tháng');
  const tuyen = page.getByLabel('Lượt tính tuyến mỗi tháng');
  const ketQua = page.getByTestId('goi-goi-y');

  await places.fill('120000');
  await tuyen.fill('5000');
  await expect(ketQua).toContainText('Business');

  await places.fill('20000');
  await tuyen.fill('2000');
  await expect(ketQua).toContainText('Starter');

  // Hai nhóm hạn mức ĐỘC LẬP: vượt tuyến là phải lên gói dù Places còn thừa rất nhiều. Đây là
  // luật của máy chủ, không phải chi tiết giao diện, nên khoá lại.
  await tuyen.fill('5000');
  await expect(ketQua).toContainText('Professional');

  await places.fill('500000');
  await expect(ketQua).toContainText('liên hệ');
});

test('bảng giá: bảng đối chiếu hạn mức có cột tiêu chí và bốn cột gói', async ({ page }) => {
  await page.goto('/bang-gia/');
  const bang = page.getByRole('table', { name: /hạn mức/i });
  await expect(bang.getByRole('columnheader')).toHaveCount(5);
});

test('so sánh Google: bảng đối đầu tô đúng bên thắng, không giấu chỗ thua', async ({ page }) => {
  await page.goto('/so-sanh/google-maps-api/');
  const bang = page.getByRole('table', { name: /đối đầu/i });
  const hang = bang.getByRole('row').filter({ hasText: 'Street View' });
  // Hai ô dữ liệu: [0] MapsLibVN, [1] đối thủ. Ô tiêu chí là rowheader nên không nằm trong đây.
  await expect(hang.getByRole('cell').nth(1)).toContainText('✓');
  await expect(hang.getByRole('cell').nth(0)).not.toContainText('✓');
});

test('so sánh VIETMAP: bảng đối đầu có cả hàng đối thủ thắng', async ({ page }) => {
  await page.goto('/so-sanh/vietmap/');
  const bang = page.getByRole('table', { name: /đối đầu/i });
  await expect(bang.getByRole('row').filter({ hasText: '✓' })).not.toHaveCount(0);
  const khaoSat = bang.getByRole('row').filter({ hasText: 'Nguồn dữ liệu' });
  await expect(khaoSat.getByRole('cell').nth(1)).toContainText('✓');
});

test('bài viết: một bài dẫn lớn, các bài còn lại là hàng gọn', async ({ page }) => {
  await page.goto('/bai-viet/');
  await expect(page.getByTestId('bai-dan')).toHaveCount(1);
  await expect(page.getByTestId('bai-hang').first()).toBeVisible();
});

test('trang bài dài có mục lục riêng ở màn rộng', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/bai-viet/chi-phi-google-maps-api-cho-doanh-nghiep-viet-nam-2026/');
  const mucLuc = page.getByRole('navigation', { name: 'Mục lục bài' });
  await expect(mucLuc).toBeVisible();
  await expect(mucLuc.getByRole('link').first()).toHaveAttribute('href', /^#/);
});

test('liên hệ: thẻ gọi điện được làm nổi bật hơn thẻ thư', async ({ page }) => {
  await page.goto('/lien-he/');
  const goi = page.getByTestId('the-goi');
  await expect(goi).toHaveClass(/border-accent-text/);
  await expect(page.getByTestId('the-thu')).not.toHaveClass(/border-accent-text/);
});

test('hero có ba nút đúng thứ tự và chỉ một nút mang màu nhấn', async ({ page }) => {
  await page.goto('/');
  const hero = page.locator('section').first();
  await expect(hero.getByRole('link')).toHaveText([
    'Bắt đầu miễn phí',
    'Hướng dẫn setup',
    'Xem bảng giá',
  ]);
  await expect(hero.locator('a.bg-accent')).toHaveCount(1);
  await expect(hero.getByRole('link', { name: 'Hướng dẫn setup' })).toHaveAttribute(
    'href',
    /\/cai-dat\/$/,
  );
});
