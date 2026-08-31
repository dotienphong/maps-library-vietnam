#!/usr/bin/env node
import 'dotenv/config';
import postgres from 'postgres';
import { PERMISSIONS_SQL } from './lib/db-permissions.mjs';
import { databaseUrlFromEnv } from './lib/migrations.mjs';

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
try {
  await sql.unsafe(PERMISSIONS_SQL);
  console.log('✓ đã reconcile owner/grant cho api và pipeline');
} finally {
  await sql.end({ timeout: 5 });
}
