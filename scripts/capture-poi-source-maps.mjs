#!/usr/bin/env node
import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../apps/docs/node_modules/@playwright/test/index.mjs';

const key = process.env.KEY_EXAMPLE_EMBED;
if (!key) throw new Error('Thiếu KEY_EXAMPLE_EMBED trong .env');

const cities = [
  ['hcm', 106.7, 10.77],
  ['ha-noi', 105.85, 21.03],
  ['da-nang', 108.2, 16.05],
  ['can-tho', 106.35, 9.99],
  ['nha-trang', 109.19, 12.24],
];
const out = resolve('docs/evidence/poi-sources/browser');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  for (const [city, lng, lat] of cities) {
    for (const profile of ['all', 'osm']) {
      for (const zoom of [12, 14, 16]) {
        let observedProfile = '';
        page.on('response', function capture(response) {
          if (response.url().includes('/v1/styles/light.json')) {
            observedProfile = response.headers()['x-poi-profile'] ?? '';
            page.off('response', capture);
          }
        });
        const query = new URLSearchParams({
          key,
          center: `${lng},${lat}`,
          zoom: String(zoom),
          ...(profile === 'osm' ? { sources: 'osm' } : {}),
        });
        await page.goto(`http://127.0.0.1:5500/?${query}`, { waitUntil: 'networkidle' });
        await page.getByText(`bản đồ đã tải · profile ${profile} · z${zoom}`).waitFor();
        if (observedProfile !== profile) {
          throw new Error(
            `${city}/${profile}/z${zoom}: x-poi-profile=${observedProfile || '(thiếu)'}`,
          );
        }
        await page.screenshot({
          path: resolve(out, `${city}-${profile}-z${zoom}.jpg`),
          type: 'jpeg',
          quality: 75,
        });
        console.log(`✓ ${city} ${profile} z${zoom} (${observedProfile})`);
      }
    }
  }

  if (consoleErrors.length > 0) {
    throw new Error(`Console có ${consoleErrors.length} lỗi:\n${consoleErrors.join('\n')}`);
  }
} finally {
  await browser.close();
}
