import { describe, expect, it } from 'vitest';
import { formatKb, formatSizeTable } from './perf-size.mjs';

describe('formatKb', () => {
  it('làm tròn tới 0,1 kB và dùng dấu phẩy thập phân', () => {
    expect(formatKb(1536)).toBe('1,5 kB');
    expect(formatKb(0)).toBe('0,0 kB');
  });
});

describe('formatSizeTable', () => {
  it('dựng bảng Markdown theo thứ tự đưa vào', () => {
    const md = formatSizeTable([
      { name: 'dist/index.js', bytes: 2048, gzipBytes: 1024 },
      { name: 'dist/expo/index.js', bytes: 1024, gzipBytes: 512 },
    ]);
    expect(md.split('\n')[0]).toBe('| File | Thô | Gzip |');
    expect(md).toContain('| dist/index.js | 2,0 kB | 1,0 kB |');
    expect(md).toContain('| dist/expo/index.js | 1,0 kB | 0,5 kB |');
  });

  it('bảng rỗng vẫn có phần đầu', () => {
    expect(formatSizeTable([])).toBe('| File | Thô | Gzip |\n|---|---|---|');
  });
});
