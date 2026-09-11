import { expect, it } from 'vitest';
import { translateDirections } from '../src/routing/translate';
import type { ValhallaRouteResponse } from '../src/routing/valhalla';
import q1 from './fixtures/valhalla/q1-motorbike.json';

/**
 * Fixture DirectionsResponse dùng chung cho test core, web và demo docs (spec B mục 7.0).
 * Lệch với translate() hiện tại → đỏ. Cập nhật: từ apps/api chạy
 *   pnpm exec vitest run test/routing-fixture-sync.test.ts -u
 * rồi commit cả file JSON. `toMatchFileSnapshot` chạy được trong workers pool (kiểm 12/09/2026).
 */
it('packages/core/tests/fixtures/directions-q1.json khớp translateDirections(q1-motorbike, vi)', async () => {
  const out = translateDirections(
    q1 as unknown as ValhallaRouteResponse,
    'motorbike',
    '2026-09-11',
    'vi',
  );
  await expect(`${JSON.stringify(out, null, 2)}\n`).toMatchFileSnapshot(
    '../../../packages/core/tests/fixtures/directions-q1.json',
  );
});
