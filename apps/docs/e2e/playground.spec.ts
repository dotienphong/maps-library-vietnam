import { expect, test } from '@playwright/test';

test('playground tải bản đồ từ fixture, tiles 206/200, attribution hiện', async ({ page }) => {
  const tileResponses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/r2/tiles/')) tileResponses.push(r.status());
  });
  await page.goto('/playground.html?api=http://localhost:8787');
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
