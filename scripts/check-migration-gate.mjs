#!/usr/bin/env node
// Cổng chặn deploy: so migration mới nhất trong repo với `schema_migration` mà /healthz/db của
// production báo. Chạy TRƯỚC `wrangler deploy` (xem .github/workflows/deploy-api.yml).
//
// Dùng: node scripts/check-migration-gate.mjs [--base https://api.ai-solutions.io.vn]
//
// Fail closed: không gọi được /healthz/db, hoặc nó không trả schema_migration, thì CHẶN. Sự cố
// 06–07/09/2026 tốn nhiều giờ downtime vì deploy đi trước migration mà mọi cổng đều xanh; kẹt
// deploy vài phút vì API tạm không trả lời là cái giá rẻ hơn nhiều.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { latestMigrationName, migrationGate } from './lib/migration-gate.mjs';

const DEFAULT_BASE = 'https://api.ai-solutions.io.vn';
const TIMEOUT_MS = 15_000;

/** @param {string} name */
function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const base = (arg('base') ?? process.env.API_BASE ?? DEFAULT_BASE).replace(/\/+$/, '');
const url = `${base}/healthz/db`;

/** @returns {Promise<string | null>} */
async function readSchemaMigration() {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${url} trả ${response.status} — DB production không trả lời được.`);
  }
  const body = /** @type {{ schema_migration?: string | null }} */ (await response.json());
  return body.schema_migration ?? null;
}

try {
  const local = latestMigrationName(readdirSync(resolve('db/migrations')));
  const remote = await readSchemaMigration();
  const { ok, message } = migrationGate(local, remote);
  console.log(`[migration-gate] ${message}`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.error(`[migration-gate] CHẶN: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
