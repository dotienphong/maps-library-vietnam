import { describe, expect, it } from 'vitest';
import { missingServerMigrateEnv, serverMigrateRun } from './server-migrate.mjs';

const SECRET = 'S3cretSuperPassw0rdAbCdEfGhIjKlMn';
const env = { POSTGRES_SUPER_PASSWORD: SECRET };

describe('missingServerMigrateEnv', () => {
  it('báo thiếu khi không có POSTGRES_SUPER_PASSWORD', () => {
    expect(missingServerMigrateEnv({})).toEqual(['POSTGRES_SUPER_PASSWORD']);
    expect(missingServerMigrateEnv({ POSTGRES_SUPER_PASSWORD: '   ' })).toEqual([
      'POSTGRES_SUPER_PASSWORD',
    ]);
  });

  it('không báo gì khi đủ biến', () => {
    expect(missingServerMigrateEnv(env)).toEqual([]);
  });
});

describe('serverMigrateRun', () => {
  it('có --no-deps để compose không đụng container postgres đang phục vụ', () => {
    const { args } = serverMigrateRun(env, []);
    expect(args).toContain('--no-deps');
    // Phải đứng trong cụm `run`, trước tên service.
    expect(args.indexOf('--no-deps')).toBeGreaterThan(args.indexOf('run'));
    expect(args.indexOf('--no-deps')).toBeLessThan(args.indexOf('pipeline'));
  });

  it('KHÔNG đưa mật khẩu lên dòng lệnh, chỉ truyền tên biến', () => {
    const { args, env: runEnv } = serverMigrateRun(env, []);
    for (const arg of args) expect(arg).not.toContain(SECRET);
    expect(args).toContain('POSTGRES_PASSWORD');
    expect(args).not.toContain(`POSTGRES_PASSWORD=${SECRET}`);
    expect(runEnv.POSTGRES_PASSWORD).toBe(SECRET);
    expect(runEnv.POSTGRES_USER).toBe('mapslibvn');
  });

  it('mount db/ của working tree ở chế độ chỉ đọc', () => {
    const { args } = serverMigrateRun(env, []);
    expect(args.some((a) => a.endsWith('/db:/app/db:ro'))).toBe(true);
  });

  it('mountDb: false (server:update) chạy migration có sẵn trong image, không mount cây làm việc', () => {
    // server:update đã xác nhận image khớp HEAD; mount cây làm việc chỉ thêm được migration chưa commit.
    const { args } = serverMigrateRun({ POSTGRES_SUPER_PASSWORD: 'x' }, [], { mountDb: false });
    expect(args).not.toContain('-v');
    expect(args.join(' ')).not.toContain(':/app/db');
    expect(args).toContain('--no-deps');
  });

  it('chuyển tiếp tham số cho db-migrate (ví dụ --down)', () => {
    const { args } = serverMigrateRun(env, ['--down']);
    expect(args.slice(-2)).toEqual(['scripts/db-migrate.mjs', '--down']);
    expect(serverMigrateRun(env, []).args.slice(-1)).toEqual(['scripts/db-migrate.mjs']);
  });

  it('thiếu mật khẩu thì ném, không sinh lệnh mang chữ "undefined"', () => {
    expect(() => serverMigrateRun({}, [])).toThrowError(/POSTGRES_SUPER_PASSWORD/);
  });
});
