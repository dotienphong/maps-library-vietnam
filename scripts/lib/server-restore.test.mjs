import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  docKetQuaPsql,
  KIEM_RESTORE,
  kiemRestoreHong,
  requiredServerRestoreEnv,
  serverRestoreRun,
  verifyRestoredDatabaseSql,
} from './server-restore.mjs';

describe('server restore plan', () => {
  it('fail closed khi thiếu bí mật để đọc và giải mã backup production', () => {
    expect(requiredServerRestoreEnv({})).toEqual([
      'POSTGRES_SUPER_PASSWORD',
      'BACKUP_PASSPHRASE',
      'BACKUP_BUCKET',
      'RCLONE_CONFIG_R2_ACCESS_KEY_ID',
      'RCLONE_CONFIG_R2_SECRET_ACCESS_KEY',
      'RCLONE_CONFIG_R2_ENDPOINT',
    ]);
  });

  it('restore bằng server compose và không đặt secret vào command line', () => {
    const env = {
      POSTGRES_SUPER_PASSWORD: 'super-secret',
      BACKUP_PASSPHRASE: 'x'.repeat(48),
      BACKUP_BUCKET: 'mapslibvn-backups',
      RCLONE_CONFIG_R2_ACCESS_KEY_ID: 'access',
      RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: 'secret',
      RCLONE_CONFIG_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    };
    const plan = serverRestoreRun(env);
    expect(plan.args.join(' ')).toContain('infra/server/compose.yml');
    expect(plan.args).toContain('DATABASE_URL');
    expect(plan.args).toContain('POSTGRES_PASSWORD');
    expect(plan.args.join(' ')).not.toContain('super-secret');
    expect(plan.env.DATABASE_URL).toBe(
      'postgres://mapslibvn:super-secret@postgres:5432/mapslibvn?sslmode=require',
    );
    expect(plan.command).toBe('docker');
  });

  it('nghiệm thu đủ migration, POI và owner/quyền chính', () => {
    const sql = verifyRestoredDatabaseSql();
    expect(sql).toContain('schema_migrations');
    expect(sql).toContain('count(*) FROM poi');
    expect(sql).toContain("tableowner = 'pipeline'");
    expect(sql).toContain("has_table_privilege('api', 'poi', 'SELECT')");
  });

  it('nghiệm thu cả thứ restore từng làm mất (26/09): GRANT 0018–0024, ngưỡng 0007, timeout 0015', () => {
    // Bản cũ chỉ soi bảng poi nên báo xanh trên đúng DB đã làm trang admin khách hàng/đơn hàng chết.
    const sql = verifyRestoredDatabaseSql();
    for (const doiTuong of [
      "'customer_account'",
      "'customer_order'",
      "'payment_event'",
      "'key_hash'",
      "'xoa_tenant_hoan_toan(uuid)'",
      'pg_trgm.word_similarity_threshold=0.5',
      'statement_timeout=29s',
      '^poi_work_',
      'osm_road_raw',
      "'reject_poi_edit(bigint, text)'",
    ]) {
      expect(sql).toContain(doiTuong);
    }
    for (const ten of KIEM_RESTORE) expect(sql).toContain(`'${ten}'`);
  });

  it('kiemRestoreHong: nhóm kiểm vắng mặt trong output cũng là hỏng — psql lỗi không được coi là xanh', () => {
    const tatCa = KIEM_RESTORE.map((kiem) => ({ kiem, dat: true }));
    expect(kiemRestoreHong(tatCa)).toEqual([]);
    expect(kiemRestoreHong([])).toEqual([...KIEM_RESTORE]);
    const hong = tatCa.map((r) => (r.kiem === 'khach_hang' ? { ...r, dat: false } : r));
    expect(kiemRestoreHong(hong)).toEqual(['khach_hang']);
  });

  it('docKetQuaPsql đọc output `psql -At -F |`', () => {
    expect(docKetQuaPsql('du_lieu|t\nkhach_hang|f\n\n')).toEqual([
      { kiem: 'du_lieu', dat: true },
      { kiem: 'khach_hang', dat: false },
    ]);
  });
});

describe('Windows local setup guide contract', () => {
  it('guide và package scripts cùng công bố các entrypoint setup được hỗ trợ', () => {
    const root = resolve(import.meta.dirname, '../..');
    const guide = readFileSync(resolve(root, 'Setup_Local_Guide.md'), 'utf8');
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['server:restore']).toBe('node scripts/server-restore.mjs');
    for (const command of [
      'pnpm run setup',
      'pnpm db:fixture',
      'pnpm server:restore',
      'pnpm dev',
    ]) {
      expect(guide).toContain(command);
    }
    expect(guide).toContain('WSL2');
    expect(guide).toContain('BACKUP_PASSPHRASE');
    expect(guide).toContain('Mỗi thay đổi ảnh hưởng đến setup');
  });
});
