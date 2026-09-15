import { describe, expect, it } from 'vitest';
import {
  formatEvidence,
  gestureCommands,
  hasErrorEvent,
  navCommitsPerFix,
  PERF_PREFIX,
  parseGfxinfo,
  parsePerfLines,
  summarize,
} from './perf-rn.mjs';

describe('parsePerfLines', () => {
  it('lấy JSON sau tiền tố, kể cả khi logcat thêm phần đầu dòng', () => {
    const text = [
      '09-14 08:00:00.000  1234  1234 I ReactNativeJS: MLVPERF {"kind":"map_ready","ms":812}',
      '09-14 08:00:00.100  1234  1234 I ReactNativeJS: MLVPERF {"kind":"commit","n":1}',
      'dòng không liên quan',
    ].join('\n');
    expect(parsePerfLines(text)).toEqual([
      { kind: 'map_ready', ms: 812 },
      { kind: 'commit', n: 1 },
    ]);
  });

  it('bỏ qua dòng JSON hỏng thay vì ném lỗi', () => {
    expect(parsePerfLines(`${PERF_PREFIX}{không phải json}`)).toEqual([]);
  });

  it('văn bản rỗng trả mảng rỗng', () => {
    expect(parsePerfLines('')).toEqual([]);
  });

  it('bỏ qua JSON hợp lệ nhưng không phải object (null, số, chuỗi, mảng)', () => {
    const text = [
      `${PERF_PREFIX}null`,
      `${PERF_PREFIX}42`,
      `${PERF_PREFIX}"chuỗi"`,
      `${PERF_PREFIX}[1,2,3]`,
      `${PERF_PREFIX}{"kind":"map_ready","ms":1}`,
    ].join('\n');
    expect(parsePerfLines(text)).toEqual([{ kind: 'map_ready', ms: 1 }]);
  });
});

describe('summarize', () => {
  it('tính p50 và p95 theo thứ tự đã sắp', () => {
    expect(summarize([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toEqual({
      n: 10,
      p50: 50,
      p95: 100,
    });
  });

  it('một mẫu thì p50 = p95 = chính nó', () => {
    expect(summarize([42])).toEqual({ n: 1, p50: 42, p95: 42 });
  });

  it('không có mẫu nào trả n = 0 và null', () => {
    expect(summarize([])).toEqual({ n: 0, p50: null, p95: null });
  });
});

describe('parseGfxinfo', () => {
  it('đọc tổng số frame và số frame giật', () => {
    const text = [
      'Graphics info for pid 1234 [vn.mapslibvn.demo]',
      '',
      'Total frames rendered: 480',
      'Janky frames: 24 (5.00%)',
      '50th percentile: 8ms',
    ].join('\n');
    expect(parseGfxinfo(text)).toEqual({ total: 480, janky: 24, jankyPct: 5 });
  });

  it('trả null khi không có khối số liệu', () => {
    expect(parseGfxinfo('Graphics info for pid 1234')).toBeNull();
  });
});

describe('gestureCommands', () => {
  it('kịch bản kéo và zoom bám theo kích thước màn hình', () => {
    const cmds = gestureCommands(1080, 2400);
    expect(cmds.length).toBeGreaterThanOrEqual(4);
    for (const c of cmds) expect(c[0]).toBe('shell');
    // Mọi toạ độ nằm trong màn hình.
    for (const c of cmds) {
      for (const n of c.slice(3).map(Number).filter(Number.isFinite)) {
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('navCommitsPerFix', () => {
  it('chia số commit cho số fix của pha dẫn đường', () => {
    expect(
      navCommitsPerFix([
        { kind: 'commit', n: 1 },
        { kind: 'nav_start' },
        { kind: 'nav_done', fixes: 40, commits: 80 },
      ]),
    ).toBe(2);
  });

  it('làm tròn tới hai chữ số thập phân', () => {
    expect(navCommitsPerFix([{ kind: 'nav_done', fixes: 3, commits: 5 }])).toBe(1.67);
  });

  it('không có nav_done thì trả null', () => {
    expect(navCommitsPerFix([{ kind: 'map_ready', ms: 800 }])).toBeNull();
  });

  it('không chia cho 0 fix', () => {
    expect(navCommitsPerFix([{ kind: 'nav_done', fixes: 0, commits: 9 }])).toBeNull();
  });

  it('nav_done có profiler === false thì trả null (Profiler không chạy ở bản Release)', () => {
    expect(
      navCommitsPerFix([{ kind: 'nav_done', fixes: 40, commits: 80, profiler: false }]),
    ).toBeNull();
  });

  it('nav_done có profiler === true (hoặc thiếu trường, log cũ) vẫn tính bình thường', () => {
    expect(navCommitsPerFix([{ kind: 'nav_done', fixes: 40, commits: 80, profiler: true }])).toBe(
      2,
    );
    expect(navCommitsPerFix([{ kind: 'nav_done', fixes: 40, commits: 80 }])).toBe(2);
  });
});

describe('hasErrorEvent', () => {
  it('nhận ra sự kiện error thật (ví dụ khoá API hết hạn)', () => {
    expect(
      hasErrorEvent([
        { kind: 'map_ready', ms: 800 },
        { kind: 'error', message: 'HTTP 401' },
      ]),
    ).toBe(true);
  });

  it('không có error thì trả false, kể cả khi không có nav_done', () => {
    expect(hasErrorEvent([{ kind: 'map_ready', ms: 800 }])).toBe(false);
    expect(hasErrorEvent([])).toBe(false);
  });
});

describe('formatEvidence', () => {
  it('ghi rõ nơi đo và đánh dấu phần chờ máy thật', () => {
    const md = formatEvidence({
      device: 'emulator-5554 · Pixel 7 · Android 14',
      build: 'Release',
      mapReady: { n: 10, p50: 812, p95: 940 },
      gfx: { total: 480, janky: 24, jankyPct: 5 },
      commitsPerFix: 2,
    });
    expect(md).toContain('emulator-5554 · Pixel 7 · Android 14');
    expect(md).toContain('Release');
    expect(md).toContain('812');
    expect(md).toContain('5');
    expect(md).toContain('CHỜ PHONG');
  });

  it('thiếu số liệu gfx thì ghi dấu gạch, không ghi 0', () => {
    const md = formatEvidence({
      device: 'emulator-5554',
      build: 'Debug',
      mapReady: { n: 0, p50: null, p95: null },
      gfx: null,
      commitsPerFix: null,
    });
    expect(md).toContain('—');
    expect(md).not.toContain('null');
  });
});
