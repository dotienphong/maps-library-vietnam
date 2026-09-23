import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

test('năm tab chuyển được bằng chuột và bàn phím', async ({ page }) => {
  await page.goto('/playground.html');

  await expect(page.getByRole('tab')).toHaveCount(5);
  await expect(page.locator('#tab-ban-do')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-ban-do')).toBeVisible();
  await expect(page.locator('#panel-tim-kiem')).toBeHidden();

  await page.locator('#tab-ma-nhung').click();
  await expect(page.locator('#tab-ma-nhung')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tab-ban-do')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#panel-ma-nhung')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#ma-nhung');

  // Mũi tên trái trong tablist lùi về tab Đội xe.
  await page.locator('#tab-ma-nhung').press('ArrowLeft');
  await expect(page.locator('#tab-doi-xe')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-doi-xe')).toBeVisible();
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
  await expect(page.locator('#f-sources option')).toHaveCount(3);

  // `all` là mặc định (trùng SDK) nên round-trip không in `sources` trên URL (null) và snippet
  // không có dòng `poiSources`; SDK vẫn gửi `sources=osm,fsq` khi xin style.
  const sourceCases: [string, string, string | null, string | null][] = [
    ['osm', 'osm', 'osm', "poiSources: ['osm']"],
    ['fsq', 'fsq', 'fsq', "poiSources: ['fsq']"],
    ['all', 'osm,fsq', null, null],
  ];
  for (const [profile, sources, urlSources, snippet] of sourceCases) {
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
    expect(new URL(page.url()).searchParams.get('sources')).toBe(urlSources);
    await page.locator('#tab-ma-nhung').click();
    if (snippet) await expect(page.locator('#snippet-script')).toContainText(snippet);
    else await expect(page.locator('#snippet-script')).not.toContainText('poiSources');
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
  // Chưa tìm kiếm gì trước đó nên không có gì để tự điền điểm đến.
  await expect(page.locator('#nav-to input')).toHaveValue('');
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

test('đã tìm địa điểm rồi mới bấm Dẫn đường: điểm đến tự điền, không cần nhập lại', async ({
  page,
}) => {
  await page.goto('/playground.html?api=http://localhost:8787');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
    timeout: 30_000,
  });

  const autocomplete = page.locator('#ac');
  await autocomplete.locator('input').fill('highlands');
  const firstOption = autocomplete.locator('[role="option"]').first();
  await expect(firstOption).toBeVisible({ timeout: 5_000 });
  await firstOption.click();
  await expect(page.locator('#status')).toContainText('Đã chọn:');
  const placeName = ((await page.locator('#status').textContent()) ?? '').replace('Đã chọn: ', '');

  await page.locator('#enter-nav').click();
  await expect(page.locator('#nav-card')).toBeVisible();
  await expect(page.locator('#nav-to input')).toHaveValue(placeName);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('to') ?? '')).toContain(placeName);
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

test('tab Mã nhúng có đoạn dẫn đường theo điểm/phương tiện đang chọn', async ({ page }) => {
  await page.goto(`${NAV_URL}&tmode=walk`);
  await expect(page.locator('#nav-routes li').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('#tools').click();
  await page.locator('#tab-ma-nhung').click();
  const pre = page.locator('#snippet-nav');
  await expect(pre).toContainText('map.places.directions');
  await expect(pre).toContainText("mode: 'walk'");
  await expect(pre).toContainText('to: [10.7725, 106.698], // Chợ Bến Thành');
  await expect(pre).toContainText('map.navigation.start');
});

// Tab Đội xe: API được giả bằng phản hồi thật chụp từ Valhalla dev Quận 1 (23/09/2026), để e2e
// không phụ thuộc engine định tuyến và không tốn lượt `directions`.
test.describe('tab Đội xe', () => {
  const fixture = (name: string) =>
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

  test.beforeEach(async ({ page }) => {
    await page.route('**/v1/optimized-route?*', (route) =>
      route.fulfill({ contentType: 'application/json', body: fixture('optimized-q1.json') }),
    );
    await page.route('**/v1/matrix?*', (route) =>
      route.fulfill({ contentType: 'application/json', body: fixture('matrix-q1.json') }),
    );
    await page.route('**/v1/fleet-plan', (route) =>
      route.fulfill({ contentType: 'application/json', body: fixture('fleet-plan-q1.json') }),
    );
    await page.goto('/playground.html?api=http://localhost:8787#doi-xe');
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'loaded', {
      timeout: 30_000,
    });
  });

  test('nạp mẫu → tối ưu: vẽ tuyến, liệt kê thứ tự ghé, xếp lại danh sách', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (error) => jsErrors.push(error.message));
    await page.locator('#fl-sample').click();
    await expect(page.locator('#fl-points li')).toHaveCount(6);
    await expect(page.locator('.fl-marker')).toHaveCount(6);

    const request = page.waitForRequest('**/v1/optimized-route?*');
    await page.locator('#fl-opt').click();
    const url = new URL((await request).url());
    expect(url.searchParams.get('from')).toBe('10.7725,106.698');
    expect(url.searchParams.get('stops')?.split(';')).toHaveLength(5);
    expect(url.searchParams.has('to')).toBe(false);

    await expect(page.locator('#fl-opt-msg')).toContainText('Tổng 8,8 km');
    // order [3,1,4,0,2] của fixture → điểm 5, 3, 6, 2, 4 rồi về 1.
    const legs = page.locator('#fl-legs li');
    await expect(legs.nth(1)).toContainText('→ 5 · Bitexco');
    await expect(legs.nth(6)).toContainText('→ 1 · Chợ Bến Thành (về lại)');
    const drawn = await page.evaluate(() =>
      Boolean(
        (
          window as unknown as { __map: { gl: { getSource(id: string): unknown } } }
        ).__map.gl.getSource('mapslibvn-route'),
      ),
    );
    expect(drawn).toBe(true);

    await page.locator('#fl-apply-order').click();
    await expect(page.locator('#fl-points li .fl-name')).toHaveText([
      'Chợ Bến Thành',
      'Bitexco',
      'Bến Nhà Rồng',
      'Nhà thờ Đức Bà',
      'Hồ Con Rùa',
      'Dinh Độc Lập',
    ]);
    expect(jsErrors).toEqual([]);
  });

  test('ma trận 6×6: bảng có đường chéo và đổi được sang km; 8 điểm thì chặn trước khi gọi', async ({
    page,
  }) => {
    let calls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/v1/matrix?')) calls += 1;
    });
    await page.locator('#fl-sample').click();
    await page.locator('#fl-mx').click();
    await expect(page.locator('#fl-mx-msg')).toContainText('6 × 6 = 36 cặp');
    await expect(page.locator('#fl-table tr')).toHaveCount(7);
    await expect(page.locator('#fl-table .fl-diag')).toHaveCount(6);
    // durations_s[0][1] = 340 giây → 6 phút.
    await expect(page.locator('#fl-table tr').nth(1).locator('td').nth(1)).toHaveText('6');
    await page.locator('#fl-metric').selectOption('distance');
    await expect(page.locator('#fl-table th').first()).toHaveText('km');
    expect(calls).toBe(1);

    await page.locator('#fl-pick').click();
    const box = await page.locator('#map').boundingBox();
    if (!box) throw new Error('không thấy #map');
    await page.mouse.click(box.x + box.width - 120, box.y + 120);
    await page.mouse.click(box.x + box.width - 160, box.y + 200);
    await expect(page.locator('#fl-points li')).toHaveCount(8);
    await page.locator('#fl-mx').click();
    await expect(page.locator('#fl-mx-msg')).toContainText('8 × 8 = 64');
    await expect(page.locator('#fl-mx-msg')).toHaveAttribute('data-state', 'error');
    expect(calls).toBe(1);
  });

  test('chia đơn cho 2 xe: body 2 xe 5 đơn, hai khối xe hai màu, layer đội xe trên bản đồ, marker đơn đổi màu', async ({
    page,
  }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (error) => jsErrors.push(error.message));
    await page.locator('#fl-sample').click();
    await page.locator('#fl-veh').selectOption('2');
    const request = page.waitForRequest(
      (r) => r.url().includes('/v1/fleet-plan') && r.method() === 'POST',
    );
    await page.locator('#fl-plan').click();
    const body = (await request).postDataJSON() as {
      vehicles: unknown[];
      jobs: { service_s?: number }[];
      mode: string;
    };
    expect(body.vehicles).toHaveLength(2);
    expect(body.jobs).toHaveLength(5);
    expect(body.jobs[0]?.service_s).toBe(300);
    expect(body.mode).toBe('motorbike');
    await expect(page.locator('#fl-plan-msg')).toContainText('2/2 xe dùng');
    const khoi = page.locator('#fl-plan-list .fl-veh');
    await expect(khoi).toHaveCount(2);
    const mau = await khoi
      .locator('.fl-swatch')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).style.background));
    expect(new Set(mau).size).toBe(2);
    await expect(page.locator('#fl-plan-list li')).toHaveCount(5);
    await expect(page.locator('#fl-unassigned')).toBeHidden();
    const drawn = await page.evaluate(() =>
      Boolean(
        (
          window as unknown as { __map: { gl: { getSource(id: string): unknown } } }
        ).__map.gl.getSource('mapslibvn-fleet'),
      ),
    );
    expect(drawn).toBe(true);
    await expect(page.locator('#fl-plan-req')).toContainText(
      'POST http://localhost:8787/v1/fleet-plan',
    );
    // Marker đơn (không phải kho) đã đổi màu theo xe được giao.
    const mauMarker = await page
      .locator('.fl-marker:not(.fl-marker-depot)')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).style.background));
    expect(mauMarker).toHaveLength(5);
    expect(mauMarker.every((m) => m !== '')).toBe(true);
    expect(jsErrors).toEqual([]);
  });

  test('khung giờ mà chưa có giờ xuất phát → chặn trước khi gọi API', async ({ page }) => {
    let calls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/v1/fleet-plan')) calls += 1;
    });
    await page.locator('#fl-sample').click();
    const tw = page.locator('#fl-points li').nth(1).locator('.fl-tw');
    await tw.fill('09:00-10:00');
    await tw.press('Tab');
    await page.locator('#fl-plan').click();
    await expect(page.locator('#fl-plan-msg')).toContainText('giờ xuất phát');
    await expect(page.locator('#fl-plan-msg')).toHaveAttribute('data-state', 'error');
    expect(calls).toBe(0);
  });
});
