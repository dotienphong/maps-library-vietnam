// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { MapsLibVNClient } from '@mapslibvn/core';
import { act, renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaces } from './use-places';

const DIR = 'docs/evidence/autocomplete-debounce';
const LEVELS = [200, 300, 500, 800];

interface TraceEvent {
  t: number;
  type: string;
  value: string;
}
interface Trace {
  id: string;
  group: string;
  target: string;
  events: TraceEvent[];
}
interface Row {
  trace: string;
  group: string;
  debounceMs: number;
  total: number;
  final: number;
  partial: number;
}

const file = JSON.parse(readFileSync(`${DIR}/2026-09-15-traces.json`, 'utf8')) as {
  traces: Trace[];
};

/**
 * Chỉ phát lại sự kiện `input`. Mốc composition được ghi để dành cho việc sửa IME sau này;
 * hook hiện chỉ thấy giá trị ô đổi, nên đưa chúng vào sẽ đếm sai.
 */
const inputsOf = (trace: Trace) => trace.events.filter((event) => event.type === 'input');

/**
 * Client giả trả về ngay. Không cần mô phỏng độ trễ mạng: bộ đếm giờ debounce khởi động lại theo
 * phím gõ chứ không chờ response, nên response nhanh hay chậm không đổi số lượt.
 */
async function replay(trace: Trace, debounceMs: number): Promise<Row> {
  const calls: string[] = [];
  const client = {
    autocomplete: async (q: string) => {
      calls.push(q);
      return { items: [] };
    },
  } as unknown as MapsLibVNClient;

  const { rerender, unmount } = renderHook(
    ({ q }: { q: string }) => usePlaces(q, { client, debounceMs }),
    { initialProps: { q: '' } },
  );

  let previous = 0;
  for (const event of inputsOf(trace)) {
    await act(async () => {
      vi.advanceTimersByTime(event.t - previous);
      await Promise.resolve();
    });
    previous = event.t;
    rerender({ q: event.value });
  }
  // Tua thêm một nhịp debounce để lượt cuối cùng kịp bắn.
  await act(async () => {
    vi.advanceTimersByTime(debounceMs + 1);
    await Promise.resolve();
  });
  unmount();

  const last = inputsOf(trace).at(-1);
  const target = last ? last.value.trim() : '';
  const final = calls.filter((q) => q === target).length;
  return {
    trace: trace.id,
    group: trace.group,
    debounceMs,
    total: calls.length,
    final,
    partial: calls.length - final,
  };
}

const rows: Row[] = [];

describe('@mapslibvn/react — số lượt Places cho một phiên gõ thật', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  afterAll(() => {
    if (!process.env.MEASURE_WRITE) return;
    mkdirSync(DIR, { recursive: true });
    writeFileSync(
      `${DIR}/2026-09-15-counts-react.json`,
      `${JSON.stringify({ package: '@mapslibvn/react', rows }, null, 2)}\n`,
    );
  });

  for (const trace of file.traces) {
    it(`${trace.id}: số lượt không tăng khi debounce tăng`, async () => {
      const measured: Row[] = [];
      for (const debounceMs of LEVELS) measured.push(await replay(trace, debounceMs));
      rows.push(...measured);
      console.log(
        `${trace.id.padEnd(22)} ${measured.map((r) => `${r.debounceMs}ms=${r.total}`).join('  ')}`,
      );

      // Bất biến đúng bất kể con số cụ thể: chờ lâu hơn không thể sinh thêm lượt.
      for (let i = 1; i < measured.length; i++) {
        const before = measured[i - 1];
        const after = measured[i];
        if (!before || !after) throw new Error('thiếu mức đo');
        expect(after.total, `${trace.id} ${after.debounceMs}ms`).toBeLessThanOrEqual(before.total);
      }
      // Chuỗi cuối cùng luôn phải được gửi đi ÍT NHẤT một lần, nếu không người dùng không thấy
      // gợi ý. Không phải "đúng một lần": trace fix-ben-thanh cho thấy người gõ có thể vô tình đi
      // qua đúng chuỗi đích, dừng đủ lâu để một lượt tự bắn, rồi tiếp tục sửa và quay lại đúng
      // chuỗi đó lần nữa — hai lượt trùng giá trị là hành vi thật, không phải lỗi đo.
      // Ngưỡng của hook là 2 ký tự sau khi trim, nên chuỗi ngắn hơn thì không lượt nào bắn cả.
      const last = inputsOf(trace).at(-1);
      if (last && last.value.trim().length >= 2) {
        for (const row of measured) {
          expect(row.final, `${row.trace} ${row.debounceMs}ms`).toBeGreaterThanOrEqual(1);
        }
      }
    });
  }

  it('số lượt khớp bảng đã chốt trong docs/evidence', () => {
    const total = (id: string, ms: number) =>
      rows.find((r) => r.trace === id && r.debounceMs === ms)?.total;
    // Số chốt lại 17/09/2026 (15→13, 7→6): hook nay đệm gợi ý trong phiên nên gõ thêm dấu cách và
    // gõ lùi về chuỗi vừa hỏi xong không tốn lượt nữa. Xem `2026-09-15-do-luot-autocomplete.md`.
    expect(total('poi-ben-thanh', 200)).toBe(13);
    expect(total('poi-ben-thanh', 500)).toBe(6);
  });
});
