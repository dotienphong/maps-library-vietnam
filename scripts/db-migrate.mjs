#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseUrlFromEnv, pendingMigrations } from './lib/migrations.mjs';

const directory = resolve('db/migrations');
const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });

try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const applied = (await sql`SELECT name FROM schema_migrations`).map((row) => String(row.name));
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
} finally {
  await sql.end();
}
