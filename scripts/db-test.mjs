#!/usr/bin/env node
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { DBTEST_DATABASE, isolatedDbUrl } from './lib/db-test.mjs';
import { databaseUrlFromEnv } from './lib/migrations.mjs';
import { run } from './lib/run.mjs';

if (process.env.MAPSLIBVN_IN_CONTAINER !== '1') {
  run('docker', [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'infra/dev/compose.yml',
    '--profile',
    'pipeline',
    'run',
    '--rm',
    'pipeline',
    'pnpm',
    'test:db',
  ]);
  process.exit(0);
}

const target = isolatedDbUrl(databaseUrlFromEnv(process.env));
const admin = new URL(target);
admin.pathname = '/postgres';
const sql = postgres(admin.href, { max: 1, onnotice: () => {} });
try {
  await sql.unsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DBTEST_DATABASE}' AND pid <> pg_backend_pid()`,
  );
  await sql.unsafe(`DROP DATABASE IF EXISTS ${DBTEST_DATABASE}`);
  await sql.unsafe(`CREATE DATABASE ${DBTEST_DATABASE} TEMPLATE template0`);
} finally {
  await sql.end({ timeout: 5 });
}

console.log(`DB test cô lập: ${target.hostname}/${DBTEST_DATABASE}`);
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--config', 'vitest.db.config.ts', '--passWithNoTests'],
  {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: target.href },
  },
);
if (result.error) throw result.error;
if (result.signal) throw new Error(`vitest db bị dừng bởi signal ${result.signal}`);
process.exit(result.status ?? 1);
