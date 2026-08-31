import { describe, expect, it } from 'vitest';
import { runFailure } from './run.mjs';

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
