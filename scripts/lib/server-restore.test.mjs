import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
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
    expect(sql).toMatch(/schema_migrations\) > 0 AND .*poi\) > 0\) AS data_ok/);
    expect(sql).toContain("tableowner = 'pipeline'");
    expect(sql).toContain("has_table_privilege('api', 'poi', 'SELECT')");
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
