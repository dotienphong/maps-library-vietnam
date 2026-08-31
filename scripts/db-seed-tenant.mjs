#!/usr/bin/env node
// Nạp file seed SQL vào DATABASE_URL (mặc định tenant nội bộ):
//   pnpm db:seed-tenant                       — dev DB local
//   pnpm db:seed-tenant db/seed/tenant_free_test.sql
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { databaseUrlFromEnv } from './lib/migrations.mjs';

const files = process.argv.slice(2);
if (files.length === 0) files.push('db/seed/tenant_internal.sql');

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
try {
  for (const file of files) {
    await sql.unsafe(await readFile(file, 'utf8'));
    console.log(`đã nạp ${file}`);
  }
  const [row] = await sql`SELECT count(*)::int AS n FROM api_key WHERE active`;
  console.log(`api_key active: ${row?.n ?? 0}`);
} finally {
  await sql.end({ timeout: 5 });
}
