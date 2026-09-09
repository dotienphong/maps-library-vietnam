#!/usr/bin/env node
// Cấp API key ngẫu nhiên cho một tenant đã seed. In key đúng một lần — lưu vào password manager.
//   pnpm key:issue --tenant 00000000-0000-4000-8000-000000000002 --label "trang nhúng thử" \
//     --kind web --origins http://localhost:5500 [--scopes places:read]
// DB: DATABASE_URL hoặc POSTGRES_* (dev). Production: DATABASE_URL trỏ qua Tunnel
// (xem infra/server/README.md mục Kiểm tra).
import 'dotenv/config';
import postgres from 'postgres';
import { generateKey, hashKey, keyPrefix, parseIssueArgs } from './lib/api-key.mjs';
import { databaseUrlFromEnv } from './lib/migrations.mjs';

const { tenant, label, kind, origins, scopes } = parseIssueArgs(process.argv.slice(2));
const key = generateKey();
const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
try {
  const [row] = await sql`SELECT name, plan FROM tenant WHERE id = ${tenant}`;
  if (!row) {
    throw new Error(
      `Không có tenant ${tenant} — chạy pnpm db:seed-tenant db/seed/tenant_nhung_thu.sql trước`,
    );
  }
  // DB chỉ lưu sha256(khoá) + tiền tố (audit 09/09/2026); khoá gốc in đúng một lần bên dưới.
  await sql`
    INSERT INTO api_key (key_hash, key_prefix, tenant_id, label, kind, allowed_origins, scopes)
    VALUES (${hashKey(key)}, ${keyPrefix(key)}, ${tenant}, ${label}, ${kind}, ${origins}, ${scopes})`;
  console.log(`tenant : ${row.name} (${row.plan})`);
  console.log(
    `kind   : ${kind}  scopes: ${scopes.join(',')}  origins: ${origins.join(',') || '(không kiểm)'}`,
  );
  console.log(`KEY    : ${key}`);
  console.log(`prefix : ${keyPrefix(key)}  (DB không giữ khoá gốc — chỉ sha256 + tiền tố này)`);
  console.log(
    `Lưu key ngay — script không in lại. Thu hồi: UPDATE api_key SET active=false, revoked_at=now() WHERE key_prefix='${keyPrefix(key)}'`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
