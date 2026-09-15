import { describe, expect, it } from 'vitest';
import { missingServerSeedEnv, serverNodeRun, serverSeedRun } from './server-seed.mjs';

const env = { POSTGRES_SUPER_PASSWORD: 'sieu-bi-mat' };

describe('serverSeedRun', () => {
  it('không đưa mật khẩu siêu người dùng lên dòng lệnh', () => {
    const { args, env: childEnv } = serverSeedRun(env, ['db/seed/tenant_quota_probe.sql']);
    // run() ném Error chứa toàn bộ argv, nên mật khẩu trên dòng lệnh sẽ lọt vào log lúc seed lỗi.
    expect(args.join(' ')).not.toContain('sieu-bi-mat');
    expect(args).toContain('POSTGRES_PASSWORD');
    expect(childEnv.POSTGRES_PASSWORD).toBe('sieu-bi-mat');
  });

  it('dùng --no-deps để không recreate container postgres đang phục vụ', () => {
    expect(serverSeedRun(env, ['db/seed/x.sql']).args).toContain('--no-deps');
  });

  it('mount db/ của working tree đè lên image, vì image có thể cũ hơn repo', () => {
    const { args } = serverSeedRun(env, ['db/seed/x.sql']);
    expect(args.some((a) => a.endsWith('/db:/app/db:ro'))).toBe(true);
  });

  it('từ chối seed nằm ngoài db/ vì container không thấy đường dẫn đó', () => {
    expect(() => serverSeedRun(env, ['/tmp/x.sql'])).toThrow('phải nằm trong db/');
    expect(() => serverSeedRun(env, [])).toThrow('ít nhất một file seed');
  });

  it('báo rõ biến còn thiếu thay vì chạy rồi hỏng giữa chừng', () => {
    expect(missingServerSeedEnv({})).toEqual(['POSTGRES_SUPER_PASSWORD']);
    expect(() => serverSeedRun({}, ['db/seed/x.sql'])).toThrow('POSTGRES_SUPER_PASSWORD');
  });
});

describe('serverNodeRun', () => {
  it('mount cả scripts/ lẫn db/, vì script vừa viết chưa có trong image', () => {
    const { args } = serverNodeRun(env, 'scripts/db-tenant-inventory.mjs');
    expect(args.some((a) => a.endsWith('/scripts:/app/scripts:ro'))).toBe(true);
    expect(args.some((a) => a.endsWith('/db:/app/db:ro'))).toBe(true);
    expect(args.at(-1)).toBe('scripts/db-tenant-inventory.mjs');
  });

  it('không bắt buộc tham số khi không phải lệnh seed', () => {
    expect(() => serverNodeRun(env, 'scripts/db-tenant-inventory.mjs')).not.toThrow();
  });
});
