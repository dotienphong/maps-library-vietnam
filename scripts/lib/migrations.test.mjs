import { describe, expect, it } from 'vitest';
import { databaseUrlFromEnv, downFileFor, lastApplied, pendingMigrations } from './migrations.mjs';

describe('pendingMigrations', () => {
  it('trả về file .sql chưa áp dụng, theo thứ tự tên', () => {
    const files = ['0003_c.sql', '0001_a.sql', 'README.md', '0002_b.sql', 'notes.txt'];
    expect(pendingMigrations(['0001_a.sql'], files)).toEqual(['0002_b.sql', '0003_c.sql']);
  });

  it('trả về mảng rỗng khi mọi migration đã áp dụng', () => {
    expect(pendingMigrations(['0001_a.sql'], ['0001_a.sql'])).toEqual([]);
  });

  it('bỏ qua file không đúng mẫu NNNN_ten.sql', () => {
    expect(pendingMigrations([], ['x.sql', '01_short.sql', '0001_ok.sql'])).toEqual([
      '0001_ok.sql',
    ]);
  });
});

describe('databaseUrlFromEnv', () => {
  it('ưu tiên DATABASE_URL', () => {
    expect(databaseUrlFromEnv({ DATABASE_URL: 'postgres://u:p@h:1/d' })).toBe(
      'postgres://u:p@h:1/d',
    );
  });

  it('ghép từ các biến POSTGRES_* với mặc định', () => {
    expect(databaseUrlFromEnv({ POSTGRES_PASSWORD: 'secret' })).toBe(
      'postgres://mapslibvn:secret@localhost:5432/mapslibvn',
    );
  });
});

describe('pendingMigrations bỏ qua file .down.sql', () => {
  it('không coi 0002_x.down.sql là migration', () => {
    expect(pendingMigrations([], ['0002_x.sql', '0002_x.down.sql'])).toEqual(['0002_x.sql']);
  });
});

describe('lastApplied / downFileFor', () => {
  it('lấy migration cuối theo tên và tên file down tương ứng', () => {
    expect(lastApplied(['0001_a.sql', '0003_c.sql', '0002_b.sql'])).toBe('0003_c.sql');
    expect(lastApplied([])).toBeNull();
    expect(downFileFor('0003_c.sql')).toBe('0003_c.down.sql');
  });
});

describe('databaseUrlFromEnv với POSTGRES_SSL', () => {
  it('POSTGRES_SSL=require → thêm ?sslmode=require; DATABASE_URL giữ nguyên', () => {
    expect(databaseUrlFromEnv({ POSTGRES_SSL: 'require' })).toBe(
      'postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn?sslmode=require',
    );
    expect(databaseUrlFromEnv({})).toBe('postgres://mapslibvn:mapslibvn@localhost:5432/mapslibvn');
    expect(databaseUrlFromEnv({ DATABASE_URL: 'postgres://x', POSTGRES_SSL: 'require' })).toBe(
      'postgres://x',
    );
  });
});
