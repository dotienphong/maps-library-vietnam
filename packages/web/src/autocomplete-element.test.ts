// @vitest-environment jsdom
import type { AutocompleteItem } from '@mapslibvn/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapsLibVNAutocomplete, defineAutocomplete } from './autocomplete-element';

const autocomplete = vi.fn();
const createClientMock = vi.fn(() => ({ autocomplete }));

vi.mock('@mapslibvn/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mapslibvn/core')>()),
  createClient: (...args: unknown[]) => createClientMock(...(args as [])),
}));

const area: AutocompleteItem = {
  type: 'area',
  name: 'Quận 10',
  secondary: 'Diên Hồng, Hòa Hưng, Vườn Lài, …',
  lat: 10.77,
  lng: 106.67,
  precision: 'district',
  score: 0.6,
  bbox: [106.65, 10.75, 106.68, 10.79],
};

const poi: AutocompleteItem = {
  type: 'poi',
  name: 'Highlands Coffee',
  secondary: 'Quận 1',
  lat: 10.776,
  lng: 106.7,
  score: 0.9,
};

defineAutocomplete();

/** Gắn element, gõ `query` rồi chờ hết debounce 200 ms để danh sách render. */
async function typeQuery(
  items: AutocompleteItem[],
  query = 'quan 10',
  attrs: Record<string, string> = {},
) {
  autocomplete.mockResolvedValue({ items });
  const element = new MapsLibVNAutocomplete();
  element.setAttribute('api-key', 'mlv_test');
  element.setAttribute('api-base', 'https://api.test');
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  document.body.append(element);
  const input = element.shadowRoot?.querySelector('input');
  if (!input) throw new Error('không dựng được input');
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(200);
  const options = Array.from(element.shadowRoot?.querySelectorAll('li') ?? []);
  return { element, input, options };
}

describe('MapsLibVNAutocomplete — vùng hành chính', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom không có scrollIntoView; #setActive gọi nó khi di chuyển bằng bàn phím.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    autocomplete.mockReset();
  });

  it('thuộc tính sources → poiSources của client; lạ → cảnh báo và dùng mặc định', async () => {
    createClientMock.mockClear();
    await typeQuery([poi], 'high');
    expect(createClientMock).toHaveBeenLastCalledWith({
      apiKey: 'mlv_test',
      baseUrl: 'https://api.test',
    });

    createClientMock.mockClear();
    await typeQuery([poi], 'high', { sources: 'fsq,osm' });
    expect(createClientMock).toHaveBeenLastCalledWith({
      apiKey: 'mlv_test',
      baseUrl: 'https://api.test',
      poiSources: ['osm', 'fsq'],
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createClientMock.mockClear();
    await typeQuery([poi], 'high', { sources: 'banana' });
    expect(createClientMock).toHaveBeenLastCalledWith({
      apiKey: 'mlv_test',
      baseUrl: 'https://api.test',
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('click phát select giữ nguyên object area kèm bbox', async () => {
    const { element, options } = await typeQuery([area]);
    const selected = new Promise<AutocompleteItem>((resolve) =>
      element.addEventListener('select', (event) =>
        resolve((event as CustomEvent<AutocompleteItem>).detail),
      ),
    );
    options[0]?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const detail = await selected;
    expect(detail).toEqual(area);
    expect(detail.bbox).toEqual([106.65, 10.75, 106.68, 10.79]);
    expect(detail.precision).toBe('district');
  });

  it('bàn phím Enter cũng phát select giữ nguyên bbox', async () => {
    const { element, input, options } = await typeQuery([area]);
    expect(options).toHaveLength(1);
    const selected = new Promise<AutocompleteItem>((resolve) =>
      element.addEventListener('select', (event) =>
        resolve((event as CustomEvent<AutocompleteItem>).detail),
      ),
    );
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const detail = await selected;
    expect(detail).toEqual(area);
    expect(detail.bbox).toEqual([106.65, 10.75, 106.68, 10.79]);
  });

  it('icon của area khác icon của poi', async () => {
    const { options } = await typeQuery([area, poi]);
    expect(options).toHaveLength(2);
    expect(options[0]?.dataset.type).toBe('area');
    expect(options[1]?.dataset.type).toBe('poi');
    const icon = (option?: Element) => option?.querySelector('.icon')?.textContent;
    expect(icon(options[0])).toBeTruthy();
    expect(icon(options[1])).toBeTruthy();
    expect(icon(options[0])).not.toBe(icon(options[1]));
  });

  it('matched_alt hiện thành "tên cũ: …" ở dòng phụ, vẫn là textContent', async () => {
    const street: AutocompleteItem = {
      ...poi,
      type: 'street',
      name: 'Nam Kỳ Khởi Nghĩa',
      secondary: 'ho chi minh',
      matched_alt: 'Công Lý',
    };
    const { options } = await typeQuery([street]);
    expect(options[0]?.querySelector('.secondary')?.textContent).toBe(
      'ho chi minh · tên cũ: Công Lý',
    );
  });

  it('matched_alt mà secondary rỗng thì không có dấu chấm giữa thừa', async () => {
    const street: AutocompleteItem = {
      ...poi,
      type: 'street',
      name: 'Nam Kỳ Khởi Nghĩa',
      secondary: '',
      matched_alt: 'Công Lý',
    };
    const { options } = await typeQuery([street]);
    expect(options[0]?.querySelector('.secondary')?.textContent).toBe('tên cũ: Công Lý');
  });

  it('không có matched_alt thì dòng phụ y như cũ', async () => {
    const { options } = await typeQuery([area]);
    expect(options[0]?.querySelector('.secondary')?.textContent).toBe(area.secondary);
  });

  it('secondary render bằng textContent nên không dựng thẻ từ dữ liệu', async () => {
    const injected: AutocompleteItem = { ...area, secondary: '<b>Diên Hồng</b>' };
    const { options } = await typeQuery([injected]);
    const secondary = options[0]?.querySelector('.secondary');
    expect(secondary?.textContent).toBe('<b>Diên Hồng</b>');
    expect(secondary?.querySelector('b')).toBeNull();
  });
});
