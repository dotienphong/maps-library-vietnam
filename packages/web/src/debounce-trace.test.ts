// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineAutocomplete, MapsLibVNAutocomplete } from './autocomplete-element';

const DIR = 'docs/evidence/autocomplete-debounce';
const LEVELS = [200, 300, 500, 800];

const autocomplete = vi.fn();
vi.mock('@mapslibvn/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mapslibvn/core')>()),
  createClient: () => ({ autocomplete }),
}));

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
const inputsOf = (trace: Trace) => trace.events.filter((event) => event.type === 'input');

defineAutocomplete();

async function replay(trace: Trace, debounceMs: number): Promise<Row> {
  autocomplete.mockReset();
  autocomplete.mockResolvedValue({ items: [] });
  const element = new MapsLibVNAutocomplete();
  element.setAttribute('api-key', 'mlv_test');
  element.setAttribute('api-base', 'https://api.test');
  element.setAttribute('debounce', String(debounceMs));
  document.body.append(element);
  const input = element.shadowRoot?.querySelector('input');
  if (!input) throw new Error('không dựng được input');

  let previous = 0;
  for (const event of inputsOf(trace)) {
    await vi.advanceTimersByTimeAsync(event.t - previous);
    previous = event.t;
    input.value = event.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await vi.advanceTimersByTimeAsync(debounceMs + 1);
  element.remove();

  const calls = autocomplete.mock.calls.map((args) => String(args[0]));
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

describe('@mapslibvn/web — số lượt Places cho một phiên gõ thật', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  afterAll(() => {
    if (!process.env.MEASURE_WRITE) return;
    mkdirSync(DIR, { recursive: true });
    writeFileSync(
      `${DIR}/2026-09-15-counts-web.json`,
      `${JSON.stringify({ package: '@mapslibvn/web', rows }, null, 2)}\n`,
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
      for (let i = 1; i < measured.length; i++) {
        const before = measured[i - 1];
        const after = measured[i];
        if (!before || !after) throw new Error('thiếu mức đo');
        expect(after.total, `${trace.id} ${after.debounceMs}ms`).toBeLessThanOrEqual(before.total);
      }
    });
  }

  it('ở 200 ms, web ra đúng cùng số lượt với react và react-native', () => {
    const reactRows = JSON.parse(readFileSync(`${DIR}/2026-09-15-counts-react.json`, 'utf8')) as {
      rows: Row[];
    };
    const nativeRows = JSON.parse(
      readFileSync(`${DIR}/2026-09-15-counts-react-native.json`, 'utf8'),
    ) as { rows: Row[] };
    const at = (source: Row[], id: string) =>
      source.find((r) => r.trace === id && r.debounceMs === 200)?.total;

    for (const trace of file.traces) {
      const web = at(rows, trace.id);
      expect(web, `${trace.id} web`).toBeDefined();
      expect(at(reactRows.rows, trace.id), `${trace.id} react`).toBe(web);
      expect(at(nativeRows.rows, trace.id), `${trace.id} react-native`).toBe(web);
    }
  });
});
