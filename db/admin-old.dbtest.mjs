import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../scripts/lib/migrations.mjs';

const url = databaseUrlFromEnv(process.env);
if (new URL(url).pathname !== '/mapslibvn_task8_test') {
  throw new Error('admin-old.dbtest chỉ chạy trên database mapslibvn_task8_test');
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
let currentIds = [];
let oldId;

beforeAll(async () => {
  const current = await sql`INSERT INTO admin_area(level,name,name_norm,osm_relation_id,geom) VALUES
    (8,'Phường Mới A','moi a',-8001,ST_Multi(ST_Buffer(ST_Point(106.7,10.7),0.01))),
    (8,'Phường Mới B','moi b',-8002,ST_Multi(ST_Buffer(ST_Point(106.72,10.7),0.01))) RETURNING id`;
  currentIds = current.map((row) => row.id);
  [oldId] = (
    await sql`INSERT INTO admin_area_old(level,name,name_norm,parent_norm,province_norm,
    osm_relation_id,snapshot,geom) VALUES (8,'Phường Cũ','cu','quan cu','tinh cu',-8101,
    '2025-01-02',ST_Multi(ST_Buffer(ST_Point(106.71,10.7),0.02))) RETURNING id`
  ).map((r) => r.id);
});

afterAll(async () => {
  await sql`DELETE FROM admin_area_old WHERE osm_relation_id=-8101`;
  await sql`DELETE FROM admin_area WHERE osm_relation_id IN (-8001,-8002)`;
  await sql.end();
});

describe('migration 0008 admin old', () => {
  it('cho một alias trỏ nhiều vùng mới nhưng cấm trùng cạnh', async () => {
    await sql`INSERT INTO admin_alias(alias_norm,level,admin_area_id,valid_until,share,source,old_area_id)
      VALUES ('phuong cu quan cu',8,${currentIds[0]},'2025-06-30',0.6,'overlay',${oldId}),
             ('phuong cu quan cu',8,${currentIds[1]},'2025-06-30',0.4,'overlay',${oldId})`;
    await expect(sql`INSERT INTO admin_alias(alias_norm,level,admin_area_id,share,source,old_area_id)
      VALUES ('phuong cu quan cu',8,${currentIds[0]},0.6,'overlay',${oldId})`).rejects.toThrow(
      /admin_alias_pkey/,
    );
  });

  it('chặn share ngoài (0,1] và foreign key treo', async () => {
    await expect(sql`INSERT INTO admin_alias(alias_norm,level,admin_area_id,share,source)
      VALUES ('bad share',8,${currentIds[0]},0,'overlay')`).rejects.toThrow(
      /admin_alias_share_check/,
    );
    await expect(sql`INSERT INTO admin_alias(alias_norm,level,admin_area_id,share,source,old_area_id)
      VALUES ('bad fk',8,${currentIds[0]},1,'overlay',-999999)`).rejects.toThrow(
      /admin_alias_old_area_id_fkey/,
    );
  });

  it('api đọc được nhưng không ghi bảng old', async () => {
    const [rights] = await sql`SELECT
      has_table_privilege('api','admin_area_old','SELECT') AS can_read,
      has_table_privilege('api','admin_area_old','INSERT') AS can_write`;
    expect(rights).toEqual({ can_read: true, can_write: false });
  });

  // Sự cố 07/09/2026: /healthz/db trả schema_migration=null vì role `api` không đọc được bảng
  // này, nên không phân biệt được "thiếu bảng" với "thiếu quyền" — mất luôn khả năng phát hiện
  // Worker deploy trước migration. Chỉ tầng DB test mới kiểm được quyền theo đúng role production.
  it('api đọc được schema_migrations để healthz công bố phiên bản schema', async () => {
    const [rights] = await sql`SELECT
      has_table_privilege('api','schema_migrations','SELECT') AS can_read,
      has_table_privilege('api','schema_migrations','INSERT') AS can_write`;
    expect(rights).toEqual({ can_read: true, can_write: false });
  });

  it('down từ chối mất dữ liệu một-nhiều và rollback nguyên vẹn', async () => {
    const down = () =>
      spawnSync(process.execPath, ['scripts/db-migrate.mjs', '--down'], {
        env: process.env,
        encoding: 'utf8',
      });
    // `--down` chỉ revert ĐÚNG MỘT migration cuối. Hạ mọi migration mới hơn 0008 trước để test
    // vẫn chạm đúng 0008 khi schema có thêm migration trong tương lai.
    const newer = await sql`SELECT name FROM schema_migrations
      WHERE name > '0008_admin_old.sql' ORDER BY name DESC`;
    for (const migration of newer) {
      const step = down();
      expect(
        step.status,
        `hạ ${migration.name} phải thành công: ${step.stdout}${step.stderr}`,
      ).toBe(0);
    }
    try {
      const result = down();
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('quan hệ một-nhiều');
      const [state] = await sql`SELECT
        to_regclass('public.admin_area_old') IS NOT NULL AS old_exists,
        count(*)::int AS edges FROM admin_alias WHERE alias_norm='phuong cu quan cu'`;
      expect(state).toEqual({ old_exists: true, edges: 2 });
    } finally {
      // Trả DB về đủ migration, nếu không các file dbtest chạy sau sẽ thiếu cột của 0009.
      const up = spawnSync(process.execPath, ['scripts/db-migrate.mjs'], {
        env: process.env,
        encoding: 'utf8',
      });
      expect(up.status, `migrate lại phải thành công: ${up.stdout}${up.stderr}`).toBe(0);
    }
  });
});
