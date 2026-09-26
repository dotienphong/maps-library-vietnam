// Chạy: pnpm test:db (cần Postgres dev: pnpm db:up). Chỉ chạy trên DB local.
//
// Vì sao có file này: backup là `pg_dump --no-owner --no-privileges` và restore tạo DATABASE MỚI rồi
// đổi tên, nên mọi owner, GRANT, EXECUTE và `ALTER DATABASE … SET` mà migration đã đặt đều mất; chỉ
// PERMISSIONS_SQL dựng lại. Mỗi lần thêm GRANT vào migration mà quên PERMISSIONS_SQL, production
// vẫn xanh cho tới lần phục hồi kế tiếp — sự cố 26/09/2026: sau khi chuyển máy chủ, trang admin
// khách hàng/đơn hàng/billing chết vì `api` mất quyền trên bảng của 0020/0023, và ngưỡng
// word_similarity của 0007 rơi về mặc định 0.6. Bài này so từng owner/ACL giữa DB vừa migrate và DB
// phục hồi từ dump của chính nó, theo đúng các bước của scripts/db-restore.mjs.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'dotenv/config';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../scripts/lib/migrations.mjs';

const url = new URL(databaseUrlFromEnv(process.env));
if (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname)) {
  throw new Error(`dbtest chỉ chạy trên DB local, không phải ${url.hostname}`);
}

/** @param {string} name */
const dbUrl = (name) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.href;
};
// Tên suy từ DB test cô lập: hai lượt chạy song song (máy dev + agent, hai DB test khác nhau) không
// DROP DATABASE của nhau.
const BASE = url.pathname.slice(1);
const GOC = `${BASE}_acl_goc`;
const PHUC_HOI = `${BASE}_acl_phuc_hoi`;
const admin = postgres(dbUrl('postgres'), { max: 1, onnotice: () => {} });
const goc = postgres(dbUrl(GOC), { max: 1, onnotice: () => {} });
const phucHoi = postgres(dbUrl(PHUC_HOI), { max: 1, onnotice: () => {} });
const work = mkdtempSync(join(tmpdir(), 'acl-parity-'));

/** @param {string} name */
async function taoLai(name) {
  await admin.unsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
  );
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
  await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE template0`);
}

/** @param {string} script @param {string} target */
const chayScript = (script, target) =>
  execFileSync(process.execPath, [script], {
    env: { ...process.env, DATABASE_URL: target },
    stdio: 'inherit',
  });

// Owner + ACL (kể cả PUBLIC và quyền theo cột) của mọi đối tượng public không thuộc extension, và
// thiết lập cấp database. acldefault() thay cho ACL NULL để "chưa từng GRANT" so được với "mặc định".
const SNAPSHOT_SQL = `
WITH ext AS (SELECT objid FROM pg_depend WHERE deptype = 'e'),
acl AS (
  SELECT 'schema ' || n.nspname AS obj, pg_get_userbyid(n.nspowner) AS owner,
         coalesce(n.nspacl, acldefault('n', n.nspowner)) AS a
  FROM pg_namespace n WHERE n.nspname = 'public'
  UNION ALL
  SELECT c.relkind::text || ' ' || c.relname, pg_get_userbyid(c.relowner),
         coalesce(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    AND c.oid NOT IN (SELECT objid FROM ext)
  UNION ALL
  SELECT 'col ' || c.relname || '.' || a.attname, NULL, a.attacl
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND a.attnum > 0 AND NOT a.attisdropped
    AND c.oid NOT IN (SELECT objid FROM ext)
  UNION ALL
  SELECT 'fn ' || p.oid::regprocedure::text, pg_get_userbyid(p.proowner),
         coalesce(p.proacl, acldefault('f', p.proowner))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.oid NOT IN (SELECT objid FROM ext)
)
SELECT obj || ' owner=' || coalesce(owner, '-') || ' ' || coalesce((
  SELECT string_agg(g, ',' ORDER BY g) FROM (
    SELECT CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END
           || ':' || x.privilege_type AS g
    FROM aclexplode(acl.a) x) s), '') AS dong
FROM acl
UNION ALL
SELECT 'db settings ' || array_to_string(setconfig, ',')
FROM pg_db_role_setting
WHERE setrole = 0 AND setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
UNION ALL
SELECT 'default acl ' || d.defaclobjtype::text || ' ' || array_to_string(d.defaclacl, ',') FROM pg_default_acl d
ORDER BY 1`;

/** @param {import('postgres').Sql} sql */
const snapshot = async (sql) => (await sql.unsafe(SNAPSHOT_SQL)).map((r) => r.dong);

beforeAll(async () => {
  await taoLai(GOC);
  chayScript('scripts/db-migrate.mjs', dbUrl(GOC));
  // Bảng pipeline tự tạo ngoài migration mà DB production luôn có, thuộc `pipeline` như khi
  // pipeline tạo chúng; poi_work_* là loại sống giữa hai lần chạy (sự cố 26/09, 20ec573).
  for (const ddl of [
    'CREATE TABLE osm_road_raw (id int)',
    'CREATE TABLE osm_admin_raw (id int)',
    'CREATE TABLE osm_admin_old_raw (id int)',
    'CREATE TABLE vn_boundary (id serial PRIMARY KEY)',
    'CREATE TABLE poi_work_record (rid serial PRIMARY KEY)',
    'CREATE TABLE poi_work_pair (a int, b int)',
  ]) {
    await goc.unsafe(ddl);
    await goc.unsafe(`ALTER TABLE ${ddl.split(' ')[2]} OWNER TO pipeline`);
  }

  // Đúng cờ của backup (scripts/lib/backup-plan.mjs) và các bước của scripts/db-restore.mjs.
  const dump = join(work, 'goc.dump');
  execFileSync('pg_dump', ['-Fc', '--no-owner', '--no-privileges', '-f', dump, dbUrl(GOC)]);
  await taoLai(PHUC_HOI);
  execFileSync('pg_restore', ['--no-owner', '--no-privileges', '-d', dbUrl(PHUC_HOI), dump]);
  chayScript('scripts/db-migrate.mjs', dbUrl(PHUC_HOI));
  chayScript('scripts/db-permissions.mjs', dbUrl(PHUC_HOI));
});

afterAll(async () => {
  await phucHoi.end({ timeout: 5 });
  await goc.end({ timeout: 5 });
  for (const name of [GOC, PHUC_HOI]) {
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
  }
  await admin.end({ timeout: 5 });
  rmSync(work, { recursive: true, force: true });
});

describe('restore từ backup + PERMISSIONS_SQL', () => {
  it('dựng lại đúng owner, GRANT (kể cả theo cột), EXECUTE và thiết lập DB như lúc vừa migrate', async () => {
    const truoc = await snapshot(goc);
    const sau = await snapshot(phucHoi);
    // In riêng phần lệch: mảng đầy đủ ~90 dòng thì vitest cắt diff, mất đúng dòng cần đọc.
    expect({
      thieuSauRestore: truoc.filter((d) => !sau.includes(d)),
      thuaSauRestore: sau.filter((d) => !truoc.includes(d)),
    }).toEqual({ thieuSauRestore: [], thuaSauRestore: [] });
  });
});
