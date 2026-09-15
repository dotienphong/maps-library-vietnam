#!/usr/bin/env node
// Liệt kê tenant, plan, quota_mode và số khoá đang hoạt động.
//
// Cổng phát hành đòi "inventory tenant/mode" trước khi mở commercial: phải biết chắc tenant nào
// đang ở chế độ nào, vì tenant commercial thiếu quyền sử dụng sẽ fail closed, còn tenant internal
// mà để commercial là lỗi cấu hình bị chặn thẳng (spec 14.2).
import 'dotenv/config';
import postgres from 'postgres';
import { databaseUrlFromEnv } from './lib/migrations.mjs';

const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
try {
  const rows = await sql`
    SELECT t.id, t.name, t.plan,
      coalesce(to_jsonb(t) ->> 'quota_mode', 'legacy') AS quota_mode,
      count(k.key_hash) FILTER (WHERE k.active) AS active_keys
    FROM tenant t LEFT JOIN api_key k ON k.tenant_id = t.id
    GROUP BY t.id, t.name, t.plan, to_jsonb(t) ->> 'quota_mode'
    ORDER BY quota_mode DESC, t.name`;
  console.table(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      plan: r.plan,
      quota_mode: r.quota_mode,
      active_keys: Number(r.active_keys),
    })),
  );
  const bad = rows.filter((r) => r.quota_mode === 'commercial' && r.plan === 'internal');
  if (bad.length > 0) {
    console.error(`✗ ${bad.length} tenant vừa internal vừa commercial — cấu hình lỗi, API sẽ 503.`);
    process.exitCode = 1;
  }
  const commercial = rows.filter((r) => r.quota_mode === 'commercial').length;
  console.log(`${rows.length} tenant, ${commercial} ở chế độ commercial.`);
} finally {
  await sql.end({ timeout: 5 });
}
