import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** @typedef {{t:number, type:string, value:string}} TraceEvent */
/** @typedef {{id:string, group:string, target:string, events:TraceEvent[]}} Trace */

const IDS = [
  'poi-ben-thanh',
  'poi-highlands',
  'poi-cho-ray',
  'addr-nguyen-hue',
  'addr-le-loi',
  'cat-ca-phe',
  'cat-cay-xang',
  'route-from-bach-khoa',
  'route-to-tan-son-nhat',
  'fix-ben-thanh',
  'fix-highlands',
  'fix-nguyen-hue',
  'fix-ca-phe',
  'fix-tan-son-nhat',
];

const file = JSON.parse(
  readFileSync('docs/evidence/autocomplete-debounce/2026-09-15-traces.json', 'utf8'),
);

describe('trace gõ phím autocomplete', () => {
  it('ghi rõ ghi ở đâu, bằng bàn phím gì, ai gõ', () => {
    expect(file.device).toBeTruthy();
    expect(file.keyboard).toBeTruthy();
    expect(file.typist).toBeTruthy();
    expect(file.recordedAt).toMatch(/^2026-/);
  });

  it('đủ 14 kịch bản, đúng thứ tự', () => {
    expect(file.traces.map((/** @type {Trace} */ t) => t.id)).toEqual(IDS);
  });

  it('mốc thời gian không lùi, gốc là 0', () => {
    for (const trace of file.traces) {
      const inputs = trace.events.filter((/** @type {TraceEvent} */ e) => e.type === 'input');
      expect(inputs.length, trace.id).toBeGreaterThan(1);
      const first = trace.events[0];
      expect(first, trace.id).toBeDefined();
      expect(first?.t, trace.id).toBe(0);
      for (let i = 1; i < trace.events.length; i++) {
        const prev = trace.events[i - 1];
        const cur = trace.events[i];
        expect(prev, `${trace.id} mốc ${i - 1}`).toBeDefined();
        expect(cur, `${trace.id} mốc ${i}`).toBeDefined();
        expect(cur?.t, `${trace.id} mốc ${i}`).toBeGreaterThanOrEqual(prev?.t ?? 0);
      }
    }
  });

  it('kịch bản sửa lỗi có ít nhất một lần chuỗi ngắn lại', () => {
    for (const trace of file.traces.filter((/** @type {Trace} */ t) => t.group === 'fix')) {
      const inputs = trace.events.filter((/** @type {TraceEvent} */ e) => e.type === 'input');
      const shrank = inputs.some((/** @type {TraceEvent} */ e, /** @type {number} */ i) => {
        if (i === 0) return false;
        const prev = inputs[i - 1];
        return prev !== undefined && e.value.length < prev.value.length;
      });
      expect(shrank, `${trace.id} phải có xoá lùi`).toBe(true);
    }
  });
});
