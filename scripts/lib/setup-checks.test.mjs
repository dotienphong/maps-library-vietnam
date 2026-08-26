import { describe, expect, it } from 'vitest';
import {
  checkNodeVersion,
  isPostgresReady,
  parseDockerVersion,
  waitPlan,
} from './setup-checks.mjs';

describe('checkNodeVersion', () => {
  it('chấp nhận v22 trở lên', () => {
    expect(checkNodeVersion('v22.11.0')).toEqual({ ok: true, major: 22 });
    expect(checkNodeVersion('v24.1.0').ok).toBe(true);
  });

  it('từ chối v20', () => {
    expect(checkNodeVersion('v20.18.0')).toEqual({ ok: false, major: 20 });
  });
});

describe('parseDockerVersion', () => {
  it('đọc "Docker version 27.3.1, build ce12230"', () => {
    expect(parseDockerVersion('Docker version 27.3.1, build ce12230')).toEqual({
      major: 27,
      minor: 3,
    });
  });

  it('trả null khi không phải output docker', () => {
    expect(parseDockerVersion('command not found')).toBeNull();
  });
});

describe('waitPlan', () => {
  it('tạo lịch thử lại mỗi 2s trong tối đa 60s', () => {
    const plan = waitPlan(60_000, 2_000);
    expect(plan.attempts).toBe(30);
    expect(plan.intervalMs).toBe(2_000);
  });
});

describe('isPostgresReady', () => {
  it('chỉ sẵn sàng khi tiến trình chính là postgres và pg_isready chấp nhận kết nối', () => {
    expect(isPostgresReady('postgres', '/var/run/postgresql:5432 - accepting connections')).toBe(
      true,
    );
  });

  it('từ chối Postgres tạm trong lúc entrypoint còn là tiến trình chính', () => {
    expect(
      isPostgresReady('docker-entrypoint.sh', '/var/run/postgresql:5432 - accepting connections'),
    ).toBe(false);
  });
});
