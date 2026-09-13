import { describe, expect, it } from 'vitest';
import { latestMigrationName, migrationGate } from './migration-gate.mjs';

describe('latestMigrationName', () => {
  it('lấy migration mới nhất, bỏ file .down.sql và file lạ', () => {
    expect(
      latestMigrationName([
        '0013_drop_overture.sql',
        '0014_poi_admin.sql',
        '0014_poi_admin.down.sql',
        'README.md',
      ]),
    ).toBe('0014_poi_admin.sql');
  });

  it('sắp theo tiền tố số chứ không theo thứ tự đọc thư mục', () => {
    expect(latestMigrationName(['0009_a.sql', '0002_b.sql', '0010_c.sql'])).toBe('0010_c.sql');
  });

  it('thư mục rỗng → null', () => {
    expect(latestMigrationName(['README.md'])).toBeNull();
  });
});

describe('migrationGate', () => {
  it('DB đã áp đúng migration mới nhất → cho deploy', () => {
    expect(migrationGate('0014_poi_admin.sql', '0014_poi_admin.sql').ok).toBe(true);
  });

  it('DB còn cũ hơn repo → CHẶN, nêu tên cả hai bên', () => {
    const result = migrationGate('0014_poi_admin.sql', '0013_drop_overture.sql');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('0014_poi_admin.sql');
    expect(result.message).toContain('0013_drop_overture.sql');
    expect(result.message).toContain('pnpm server:migrate');
  });

  it('DB mới hơn repo → cho qua (migration đi trước code là hợp lệ)', () => {
    const result = migrationGate('0013_drop_overture.sql', '0014_poi_admin.sql');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('mới hơn');
  });

  it('healthz không trả schema_migration → CHẶN, không đoán', () => {
    const result = migrationGate('0014_poi_admin.sql', null);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('schema_migration');
  });

  it('repo không có migration nào → cho qua', () => {
    expect(migrationGate(null, null).ok).toBe(true);
  });

  it('so sánh chịu được việc healthz trả tên không kèm đuôi .sql', () => {
    expect(migrationGate('0014_poi_admin.sql', '0014_poi_admin').ok).toBe(true);
    expect(migrationGate('0014_poi_admin.sql', '0013_drop_overture').ok).toBe(false);
  });
});
