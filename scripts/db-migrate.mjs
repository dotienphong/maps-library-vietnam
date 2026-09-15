#!/usr/bin/env node
// Dùng: node scripts/db-migrate.mjs        — áp dụng migration mới (db/migrations/NNNN_ten.sql)
//       node scripts/db-migrate.mjs --down — revert đúng MỘT migration cuối bằng NNNN_ten.down.sql
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import {
  databaseUrlFromEnv,
  downFileFor,
  lastApplied,
  pendingMigrations,
} from './lib/migrations.mjs';

const directory = resolve('db/migrations');
const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });

try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  // `api` phải đọc được bảng này để /healthz/db công bố `schema_migration`. Thiếu quyền thì
  // healthz trả null y như khi thiếu bảng, tức mất khả năng phát hiện Worker deploy trước
  // migration — đúng sự cố 07/09/2026. `pipeline` cũng phải đọc được: các script chạy trong
  // container (vd `backfill-search-keys.mjs`) tự chặn mình khi migration chưa tới bản cần, và
  // không đọc được bảng thì cổng đó ném `permission denied` thay vì chạy. Bỏ qua nếu role chưa
  // tồn tại (DB dev/dbtest).
  for (const role of ['api', 'pipeline']) {
    await sql`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sql.unsafe(`'${role}'`)}) THEN
        GRANT SELECT ON schema_migrations TO ${sql.unsafe(role)};
      END IF;
    END $$`;
  }
  const applied = (await sql`SELECT name FROM schema_migrations`).map((row) => String(row.name));

  if (process.argv.includes('--down')) {
    const last = lastApplied(applied);
    if (!last) {
      console.log('[db:migrate] Không có migration nào để revert.');
    } else {
      const down = downFileFor(last);
      // Ném lỗi nếu thiếu file down — cố ý: không revert mù
      const body = readFileSync(resolve(directory, down), 'utf8');
      console.log(`[db:migrate] Revert ${last} bằng ${down} …`);
      await sql.begin(async (transaction) => {
        await transaction.unsafe(body);
        await transaction`DELETE FROM schema_migrations WHERE name = ${last}`;
      });
      console.log('[db:migrate] Xong — revert 1 migration.');
    }
  } else {
    const pending = pendingMigrations(applied, readdirSync(directory));
    if (pending.length === 0) console.log('[db:migrate] Không có migration mới.');
    for (const name of pending) {
      const body = readFileSync(resolve(directory, name), 'utf8');
      console.log(`[db:migrate] Áp dụng ${name} …`);
      await sql.begin(async (transaction) => {
        await transaction.unsafe(body);
        await transaction`INSERT INTO schema_migrations (name) VALUES (${name})`;
      });
    }
    console.log(`[db:migrate] Xong — áp dụng ${pending.length} migration.`);
  }
} finally {
  await sql.end();
}
