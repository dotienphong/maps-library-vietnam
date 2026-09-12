import { expect, test } from '@playwright/test';

test('playground tải bản đồ từ fixture, tiles 206/200, attribution hiện', async ({ page }) => {
  const tileResponses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/r2/tiles/')) tileResponses.push(r.status());
  });
  await page.goto('/playground.html');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });
  expect(tileResponses.length).toBeGreaterThan(0);
  expect(tileResponses.every((s) => s === 206 || s === 200)).toBe(true);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  await expect(page.locator('.maplibregl-marker')).toHaveCount(1);
});

test('style dark cũng tải', async ({ page }) => {
  await page.goto('/playground.html?api=http://localhost:8787&style=dark');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });
});

test('gõ "highlands" có gợi ý ≤ 1 s, chọn bằng bàn phím thì hiện tên', async ({ page }) => {
  await page.goto('/playground.html?api=http://localhost:8787');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });

  // #ac là ô tìm kiếm chính trong bảng điều khiển — trang còn hai ô #nav-from/#nav-to của thẻ
  // dẫn đường luôn có mặt trong DOM nên không thể định vị bằng tag name chung chung nữa.
  const autocomplete = page.locator('#ac');
  const input = autocomplete.locator('input');
  await expect(input).toHaveAttribute('role', 'combobox');
  await input.fill('highlands');

  // Spec mục 10: 200 ms debounce + API local vẫn phải hiện gợi ý trong 1 giây.
  const firstOption = autocomplete.locator('[role="option"]').first();
  await expect(firstOption).toBeVisible({ timeout: 1_000 });
  await expect(firstOption).toContainText(/highlands/i);
  await expect(input).toHaveAttribute('aria-expanded', 'true');

  await input.press('ArrowDown');
  await expect(firstOption).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');

  await expect(page.locator('#status')).toContainText('Đã chọn:');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
});

// "Quận 10" là quận cũ bị tách sau sắp xếp 2025. Truy vấn thuần tên hành chính nên `withAreaSlot`
// dành cho vùng một suất; trước khi có suất đó, mười POI chứa token "10" đẩy vùng ra khỏi danh sách.
test('chọn vùng hành chính thì khớp khung bằng fitBounds', async ({ page }) => {
  const jsErrors: string[] = [];
  page.on('pageerror', (error) => jsErrors.push(error.message));
  await page.goto('/playground.html?api=http://localhost:8787');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });

  const autocomplete = page.locator('#ac');
  const input = autocomplete.locator('input');
  await input.fill('Quận 10');

  const areaOption = autocomplete.locator('[role="option"][data-type="area"]').first();
  await expect(areaOption).toBeVisible({ timeout: 2_000 });
  // Vùng bị tách: dòng chính giữ tên quận cũ, dòng phụ liệt kê tối đa ba phường đích rồi "…".
  await expect(areaOption).toContainText('Quận 10');
  await expect(areaOption).toContainText('Phường');

  await areaOption.click();

  await expect(page.locator('#status')).toContainText('Đã chọn: Quận 10');
  // Marker chỉ là tâm phụ; khung nhìn do fitBounds đặt theo bbox của vùng. Không khẳng định số
  // marker vì trang còn giữ marker demo lúc tải, ngoài `pins` mà `clearPins()` quản lý.
  await expect(page.locator('.maplibregl-marker').last()).toBeVisible();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(jsErrors, `lỗi JS trên trang: ${jsErrors.join(' | ')}`).toEqual([]);
});

// Hạng mục 3 (spec 6.1): `qui nhon` là cách viết địa phương của Quy Nhơn. Từ điển biến thể áp
// thẳng lên truy vấn ở bậc 1 nên không phải chờ pipeline chạy lại để điền cột dẫn xuất.
test('gõ cách viết địa phương "qui nhon" vẫn ra Quy Nhơn', async ({ page }) => {
  const jsErrors: string[] = [];
  page.on('pageerror', (error) => jsErrors.push(error.message));
  await page.goto('/playground.html?api=http://localhost:8787');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });

  const autocomplete = page.locator('#ac');
  await autocomplete.locator('input').fill('qui nhon');

  await expect(autocomplete.locator('[role="option"]').first()).toBeVisible({ timeout: 5_000 });
  // Phải có địa điểm viết đúng dạng chuẩn CÓ DẤU trong danh sách — đó mới là cái mà cách viết
  // `qui` không tự khớp được. Không khẳng định nó đứng đầu: dữ liệu thật còn có nơi tên là
  // "Qui Nhon Quan" viết y hệt truy vấn, khớp trực tiếp nên hạng nhất là đúng.
  await expect(
    autocomplete.locator('[role="option"]').filter({ hasText: 'Quy Nhơn' }).first(),
  ).toBeVisible({ timeout: 5_000 });
  expect(jsErrors, `lỗi JS trên trang: ${jsErrors.join(' | ')}`).toEqual([]);
});

test('bốn tab chuyển được bằng chuột và bàn phím', async ({ page }) => {
  await page.goto('/playground.html');

  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.locator('#tab-ban-do')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-ban-do')).toBeVisible();
  await expect(page.locator('#panel-tim-kiem')).toBeHidden();

  await page.locator('#tab-ma-nhung').click();
  await expect(page.locator('#tab-ma-nhung')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tab-ban-do')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#panel-ma-nhung')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#ma-nhung');

  // Mũi tên trái trong tablist lùi về tab Geocode.
  await page.locator('#tab-ma-nhung').press('ArrowLeft');
  await expect(page.locator('#tab-geocode')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-geocode')).toBeVisible();
});

test('?embed=1 chỉ còn bản đồ và thanh trạng thái', async ({ page }) => {
  await page.goto('/playground.html?embed=1');

  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#panel')).toHaveCount(0);
  await expect(page.locator('mapslibvn-autocomplete')).toHaveCount(0);
});

test('tuỳ chọn trên URL phản ánh vào form', async ({ page }) => {
  await page.goto('/playground.html?style=dark&lang=en&poi=0&sources=osm&compact=1');

  await expect(page.locator('#f-style')).toHaveValue('dark');
  await expect(page.locator('#f-lang')).toHaveValue('en');
  await expect(page.locator('#f-poi')).not.toBeChecked();
  await expect(page.locator('#f-sources')).toHaveValue('osm');
  await expect(page.locator('#f-compact')).toBeChecked();
  await expect(page.locator('#f-key')).toHaveValue('mlv_live_demo00000000000000000000');
});

test('đổi nguồn POI tạo lại map, đồng bộ URL và mã nhúng', async ({ page }) => {
  const styleRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/v1/styles/light.json' && url.searchParams.get('sources') === 'osm';
  });
  await page.goto('/playground.html');
  await page.locator('#f-sources').selectOption('osm');
  await page.locator('#apply').click();
  await styleRequest;

  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });
  expect(new URL(page.url()).searchParams.get('sources')).toBe('osm');
  await page.locator('#tab-ma-nhung').click();
  await expect(page.locator('#snippet-script')).toContainText("poiSources: ['osm']");
});

test('Nguồn POI mới đồng bộ selector, URL, snippet và style request', async ({ page }) => {
  const unexpectedErrors: string[] = [];
  page.on('pageerror', (error) => unexpectedErrors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      message.text() !==
        'Failed to load resource: the server responded with a status of 404 (Not Found)'
    ) {
      unexpectedErrors.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (response.status() === 404 && url.pathname.startsWith('/r2/assets/fonts/')) return;
    unexpectedErrors.push(`${response.status()} ${url.pathname}`);
  });
  await page.goto('/playground.html');
  await expect(page.locator('#f-sources option')).toHaveCount(6);

  for (const [profile, sources, snippet] of [
    ['osm-fsq', 'osm,fsq', "poiSources: ['osm', 'fsq']"],
    ['overture-fsq', 'overture,fsq', "poiSources: ['overture', 'fsq']"],
    ['overture', 'overture', "poiSources: ['overture']"],
    ['fsq', 'fsq', "poiSources: ['fsq']"],
  ]) {
    const styleRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === '/v1/styles/light.json' && url.searchParams.get('sources') === sources
      );
    });
    await page.locator('#f-sources').selectOption(profile);
    await page.locator('#apply').click();
    await styleRequest;
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
      timeout: 30_000,
    });
    expect(new URL(page.url()).searchParams.get('sources')).toBe(sources);
    await page.locator('#tab-ma-nhung').click();
    await expect(page.locator('#snippet-script')).toContainText(snippet);
    await page.locator('#tab-ban-do').click();
  }

  expect(unexpectedErrors, `lỗi bất ngờ trên trang: ${unexpectedErrors.join(' | ')}`).toEqual([]);
});

test('tab Mã nhúng sinh mã theo tuỳ chọn hiện tại', async ({ page }) => {
  await page.goto('/playground.html');

  await page.locator('#tab-ma-nhung').click();
  const script = page.locator('#snippet-script');
  await expect(script).toContainText('MapsLibVN.createMap');
  await expect(script).toContainText("container: 'map'");
  await expect(script).not.toContainText("style: 'dark'");
  await expect(page.locator('#snippet-esm')).toContainText("from '@mapslibvn/web'");

  await page.locator('#tab-ban-do').click();
  await page.locator('#f-style').selectOption('dark');
  await page.locator('#tab-ma-nhung').click();
  await expect(script).toContainText("style: 'dark'");
  await expect(page.locator('#snippet-esm')).toContainText("style: 'dark'");
});

test.describe('vị trí của tôi', () => {
  test.use({
    geolocation: { latitude: 10.7798, longitude: 106.699 },
    permissions: ['geolocation'],
  });

  test('có quyền: bay về vị trí, cắm chấm, nút ◎ bật', async ({ page }) => {
    await page.goto('/playground.html?api=http://localhost:8787');
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
      timeout: 30_000,
    });
    await expect(page.locator('.pg-my-location')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('#locate')).toHaveAttribute('aria-pressed', 'true');
    // flyTo là animation — chờ tới khi ổn định thay vì đọc getCenter() ngay lúc còn đang bay.
    const getCenter = () =>
      page.evaluate(() => {
        const c = (
          window as unknown as { __map: { gl: { getCenter(): { lng: number; lat: number } } } }
        ).__map.gl.getCenter();
        return [c.lng, c.lat];
      });
    await expect
      .poll(async () => (await getCenter())[0], { timeout: 10_000 })
      .toBeCloseTo(106.699, 3);
    const center = await getCenter();
    expect(center[1]).toBeCloseTo(10.7798, 3);
  });
});

test('không cấp quyền vị trí: không lỗi JS, giữ tâm mặc định', async ({ page, context }) => {
  await context.clearPermissions();
  const jsErrors: string[] = [];
  page.on('pageerror', (error) => jsErrors.push(error.message));
  await page.goto('/playground.html?api=http://localhost:8787');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
  await expect(page.locator('.pg-my-location')).toHaveCount(0);
  await expect(page.locator('#locate')).toHaveAttribute('aria-pressed', 'false');
  expect(jsErrors).toEqual([]);
});

test('bấm Dẫn đường: bảng thu về ⋯ Công cụ, thẻ trái hiện, chip Xe máy đang chọn', async ({
  page,
}) => {
  await page.goto('/playground.html?api=http://localhost:8787');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });
  await page.locator('#enter-nav').click();

  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#tools')).toBeVisible();
  await expect(page.locator('#nav-card')).toBeVisible();
  await expect(page.locator('#nav-from input')).toBeVisible();
  await expect(page.locator('#nav-to input')).toBeVisible();
  await expect(page.locator('.nav-mode[data-mode="motorbike"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(new URL(page.url()).searchParams.get('tab')).toBe('dan-duong');

  await page.locator('#tools').click();
  await expect(page.locator('#panel')).toBeVisible();
  await page.locator('#tools').click();
  await expect(page.locator('#panel')).toBeHidden();

  await page.locator('#nav-exit').click();
  await expect(page.locator('#nav-card')).toBeHidden();
  await expect(page.locator('#panel')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('tab')).toBeNull();
});

test('bấm bản đồ chọn "Đến đây" → ô Điểm đến có nhãn toạ độ, URL có to; đổi chiều hoán vị', async ({
  page,
}) => {
  await page.goto(
    '/playground.html?api=http://localhost:8787&tab=dan-duong&from=10.7798,106.699,Nhà thờ Đức Bà',
  );
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });
  await expect(page.locator('#nav-from input')).toHaveValue('Nhà thờ Đức Bà');

  const canvas = page.locator('canvas.maplibregl-canvas');
  await canvas.click({ position: { x: 700, y: 300 } });
  await page.getByRole('button', { name: 'Đến đây' }).click();
  await expect(page.locator('#nav-to input')).toHaveValue(/^\d+\.\d{4}, \d+\.\d{4}$/);
  expect(new URL(page.url()).searchParams.get('to')).toMatch(/^\d+\.\d+,\d+\.\d+,/);

  await page.locator('#nav-swap').click();
  await expect(page.locator('#nav-to input')).toHaveValue('Nhà thờ Đức Bà');
  await expect(page.locator('#nav-from input')).toHaveValue(/^\d+\.\d{4}, \d+\.\d{4}$/);
});

const NAV_URL =
  '/playground.html?api=http://localhost:8787&fixture=1&tab=dan-duong' +
  '&from=10.7798,106.699,Nhà thờ Đức Bà&to=10.7725,106.698,Chợ Bến Thành';

test('có đủ hai điểm: tự tính tuyến, vẽ tuyến, danh sách tuyến và 6 bước', async ({ page }) => {
  await page.goto(NAV_URL);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });
  await expect(page.locator('#nav-routes li').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#nav-routes li').first()).toContainText('km');
  await expect(page.locator('#nav-routes button').first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#nav-steps-box summary').click();
  await expect(page.locator('#nav-steps li')).toHaveCount(6);
  await expect(page.locator('#nav-start')).toBeEnabled();
  const hasLayer = await page.evaluate(() =>
    Boolean(
      (window as unknown as { __map: { gl: { getLayer(id: string): unknown } } }).__map.gl.getLayer(
        'mapslibvn-route-line',
      ),
    ),
  );
  expect(hasLayer).toBe(true);
});

test('đổi phương tiện → gọi lại directions và URL có tmode=car', async ({ page }) => {
  let calls = 0;
  await page.route('**/fixtures/directions-q1.json', (route) => {
    calls += 1;
    void route.continue();
  });
  await page.goto(NAV_URL);
  await expect(page.locator('#nav-routes li').first()).toBeVisible({ timeout: 30_000 });
  const before = calls;
  await page.locator('.nav-mode[data-mode="car"]').click();
  await expect(page.locator('.nav-mode[data-mode="car"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => calls).toBe(before + 1);
  expect(new URL(page.url()).searchParams.get('tmode')).toBe('car');
});

test('Giả lập: banner rẽ, phụ đề "Trong … nữa", đến nơi rồi trở về thẻ; ✕ xoá tuyến', async ({
  page,
}) => {
  await page.goto(`${NAV_URL}&rate=20`);
  await expect(page.locator('#nav-simulate')).toBeEnabled({ timeout: 30_000 });
  const subtitles: string[] = [];
  await page.exposeFunction('__recordSubtitle', (t: string) => subtitles.push(t));
  await page.evaluate(() => {
    const node = document.getElementById('nav-subtitle');
    if (!node) return;
    new MutationObserver(() => {
      const text = node.textContent ?? '';
      if (text) (window as unknown as { __recordSubtitle(t: string): void }).__recordSubtitle(text);
    }).observe(node, { childList: true, characterData: true, subtree: true });
  });

  await page.locator('#nav-simulate').click();
  await expect(page.locator('#nav-card')).toBeHidden();
  await expect(page.locator('#nav-banner')).toHaveAttribute('data-status', 'navigating', {
    timeout: 10_000,
  });
  await expect(page.locator('#nav-bar')).toContainText('phút');
  await expect(page.locator('#nav-banner')).toHaveAttribute('data-status', 'arrived', {
    timeout: 30_000,
  });
  await expect(page.locator('#nav-card')).toBeVisible({ timeout: 6_000 });

  expect(subtitles.length).toBeGreaterThanOrEqual(10);
  expect(subtitles.some((t) => t.startsWith('Trong '))).toBe(true);
  expect(subtitles.at(-1)).toBe('Điểm đến ở bên trái.');
  const stillDrawn = await page.evaluate(() =>
    Boolean(
      (window as unknown as { __map: { gl: { getLayer(id: string): unknown } } }).__map.gl.getLayer(
        'mapslibvn-route-line',
      ),
    ),
  );
  expect(stillDrawn).toBe(true);

  await page.locator('#nav-exit').click();
  await expect(page.locator('#panel')).toBeVisible();
  const routeFeatures = await page.evaluate(
    () =>
      (
        window as unknown as { __map: { gl: { querySourceFeatures(id: string): unknown[] } } }
      ).__map.gl.querySourceFeatures('mapslibvn-route').length,
  );
  expect(routeFeatures).toBe(0);
});

test('Dừng giữa chừng → về thẻ, trạng thái idle, Bắt đầu bật lại', async ({ page }) => {
  await page.goto(`${NAV_URL}&rate=5`);
  await expect(page.locator('#nav-simulate')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#nav-simulate').click();
  await expect(page.locator('#nav-banner')).toHaveAttribute('data-status', 'navigating', {
    timeout: 10_000,
  });
  await page.locator('#nav-stop').click();
  await expect(page.locator('#nav-banner')).toBeHidden();
  await expect(page.locator('#nav-card')).toBeVisible();
  await expect(page.locator('#nav-start')).toBeEnabled();
});
