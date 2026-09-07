#!/usr/bin/env node
// Điền name_key / name_alt_norm / name_tsv (poi, street, admin_area, admin_area_old) và alias_key
// (admin_alias) cho dữ liệu ĐÃ publish — dùng một lần sau migration 0009, không phải chờ cron thứ Hai.
// Idempotent: mặc định chỉ điền dòng còn NULL (--all để tính lại toàn bộ). Chạy trong container
// pipeline (role pipeline, có quyền UPDATE). Đọc DATABASE_URL qua helper repo.
//
//   node scripts/backfill-search-keys.mjs [--all] [--table poi]
import 'dotenv/config';
import { pathToFileURL } from 'node:url';

export const BACKFILL_PLAN = [
  { table: 'poi', joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: 'name_alt' },
  { table: 'street', joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: 'name_alt' },
  {
    table: 'admin_area',
    joinColumns: ['id'],
    nameNormColumn: 'name_norm',
    altColumn: null,
    altNormColumn: null,
    tsvColumn: null,
  },
  {
    table: 'admin_area_old',
    joinColumns: ['id'],
    nameNormColumn: 'name_norm',
    altColumn: null,
    altNormColumn: null,
    tsvColumn: null,
  },
  {
    table: 'admin_alias',
    joinColumns: ['alias_norm'],
    nameNormColumn: 'alias_norm',
    altColumn: null,
    keyColumn: 'alias_key',
    altNormColumn: null,
    tsvColumn: null,
  },
];

/**
 * Cổng: cột đích chỉ tồn tại từ 0009, chạy sớm hơn là UPDATE nổ giữa chừng trên production.
 * So sánh chuỗi được vì tên migration có tiền tố số cố định 4 chữ số.
 * @param {string | null | undefined} latest tên migration cuối trong schema_migrations
 */
export function requireMigration(latest) {
  if (!latest || latest < '0009_search_keys.sql') {
    throw new Error(
      `Cần migration 0009_search_keys.sql trước khi backfill (hiện: ${latest ?? 'không có'})`,
    );
  }
}

async function main() {
  const { default: postgres } = await import('postgres');
  const { databaseUrlFromEnv } = await import('./lib/migrations.mjs');
  const { fillSearchKeys } = await import('../pipelines/poi/src/lib/search-keys.mjs');
  const all = process.argv.includes('--all');
  const onlyIndex = process.argv.indexOf('--table');
  const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
  if (only && !BACKFILL_PLAN.some((p) => p.table === only)) {
    throw new Error(`--table ${only} không có trong kế hoạch`);
  }
  const sql = postgres(databaseUrlFromEnv(process.env), {
    max: 2,
    onnotice: () => {},
    idle_timeout: 600,
  });
  try {
    const [m] = await sql`SELECT max(name) AS latest FROM schema_migrations`;
    requireMigration(/** @type {any} */ (m)?.latest);
    for (const step of BACKFILL_PLAN) {
      if (only && step.table !== only) continue;
      const t0 = performance.now();
      const { updated } = await fillSearchKeys(sql, step.table, {
        ...step,
        onlyNull: !all,
        batch: 5000,
      });
      console.log(`✓ ${step.table}: ${updated} dòng (${Math.round(performance.now() - t0)} ms)`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
