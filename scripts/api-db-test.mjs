#!/usr/bin/env node
// DB cô lập → migrate → seed → Wrangler/Hyperdrive local → integration tests.
import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { DBTEST_DATABASE, isolatedDbUrl } from './lib/db-test.mjs';
import { databaseUrlFromEnv } from './lib/migrations.mjs';

const PORT = 8799;
const target = isolatedDbUrl(databaseUrlFromEnv(process.env));

/**
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, string>} [extraEnv]
 */
function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: target.href, ...extraEnv },
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} bị dừng bởi signal ${result.signal}`);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} thất bại (exit ${result.status})`);
  }
}

async function recreateDatabase() {
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
}

async function seedDatabase() {
  run('node', ['scripts/db-migrate.mjs']);
  const sql = postgres(target.href, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(await readFile('apps/api/test-db/setup.sql', 'utf8'));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await recreateDatabase();
console.log(`API itest DB: ${target.hostname}/${DBTEST_DATABASE}`);
await seedDatabase();

const detached = process.platform !== 'win32';
const wrangler = spawn(
  'pnpm',
  ['--filter', '@mapslibvn/api', 'exec', 'wrangler', 'dev', '--port', String(PORT)],
  {
    stdio: 'inherit',
    detached,
    env: {
      ...process.env,
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB: target.href,
    },
  },
);

let stopped = false;
function stopWrangler() {
  if (stopped) return;
  stopped = true;
  try {
    if (detached && wrangler.pid) process.kill(-wrangler.pid, 'SIGTERM');
    else wrangler.kill('SIGTERM');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error;
  }
}
process.once('exit', stopWrangler);
process.once('SIGINT', () => {
  stopWrangler();
  process.exit(130);
});
process.once('SIGTERM', () => {
  stopWrangler();
  process.exit(143);
});

try {
  const deadline = Date.now() + 90_000;
  let up = false;
  while (Date.now() < deadline && !up) {
    if (wrangler.exitCode !== null) {
      throw new Error(`wrangler dev thoát sớm (exit ${wrangler.exitCode})`);
    }
    try {
      up = (await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!up) throw new Error('wrangler dev không lên trong 90 giây');

  run('pnpm', ['exec', 'vitest', 'run', '--config', 'apps/api/vitest.itest.config.ts'], {
    PLACES_API_BASE: `http://127.0.0.1:${PORT}`,
  });
} finally {
  stopWrangler();
}
