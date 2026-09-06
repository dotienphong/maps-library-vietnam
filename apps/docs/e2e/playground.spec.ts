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

  const autocomplete = page.locator('mapslibvn-autocomplete');
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

  const autocomplete = page.locator('mapslibvn-autocomplete');
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
  await page.goto('/playground.html?style=dark&lang=en&poi=0&compact=1');

  await expect(page.locator('#f-style')).toHaveValue('dark');
  await expect(page.locator('#f-lang')).toHaveValue('en');
  await expect(page.locator('#f-poi')).not.toBeChecked();
  await expect(page.locator('#f-compact')).toBeChecked();
  await expect(page.locator('#f-key')).toHaveValue('mlv_live_demo00000000000000000000');
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
