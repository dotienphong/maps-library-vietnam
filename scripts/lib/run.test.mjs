import { describe, expect, it } from 'vitest';
import { run, runFailure } from './run.mjs';

describe('runFailure', () => {
  it('hiển thị signal khi subprocess không có exit status', () => {
    expect(runFailure('osmium', ['tags-filter'], { status: null, signal: 'SIGKILL' })).toBe(
      'osmium tags-filter bị kết thúc bởi SIGKILL',
    );
  });

  it('hiển thị exit status thông thường', () => {
    expect(runFailure('node', ['script.mjs'], { status: 2, signal: null })).toBe(
      'node script.mjs thoát mã 2',
    );
  });
});

describe('run với timeout (backup: rclone không tự cắt được, sự cố 25/09/2026)', () => {
  it('giết tiến trình quá hạn và ném lỗi thay vì chờ mãi', () => {
    const t0 = Date.now();
    expect(() => run('sleep', ['5'], { timeout: 200, killSignal: 'SIGKILL' })).toThrow();
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
