import { expect, test } from '@playwright/test';

// Spec B mục 7.4: provider fixture (không Valhalla) + playbackSource nhanh gấp 20, voice tắt.
test('demo dẫn đường giả lập: tìm tuyến từ fixture, chạy hết, có câu "Trong … nữa", đến nơi', async ({
  page,
}) => {
  await page.goto('/dan-duong-demo/?api=http://localhost:8787&fixture=1&simulate=1&rate=20');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

  await page.getByRole('button', { name: 'Tìm tuyến' }).click();
  await expect(page.locator('#steps li')).toHaveCount(6);
  await expect(page.locator('#start')).toBeEnabled();

  await page.getByRole('button', { name: 'Bắt đầu' }).click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', 'navigating', {
    timeout: 10_000,
  });
  await expect(page.locator('#status')).toHaveAttribute('data-status', 'arrived', {
    timeout: 30_000,
  });

  const said = await page.locator('#announcements li').allTextContents();
  expect(said.length).toBeGreaterThanOrEqual(10);
  expect(said.some((t) => t.startsWith('Trong '))).toBe(true);
  expect(said.at(-1)).toBe('Điểm đến ở bên trái.');

  const distanceText = await page.locator('#distance').textContent();
  expect(distanceText).toMatch(/\d+ m|\d+,\d km/);

  const hasLayer = await page.evaluate(() => {
    const demo = (globalThis as { __mapslibvnDemo?: { hasRouteLayer(): boolean } }).__mapslibvnDemo;
    return demo?.hasRouteLayer() ?? false;
  });
  expect(hasLayer).toBe(true);
});
