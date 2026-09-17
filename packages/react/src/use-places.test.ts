// @vitest-environment jsdom
import { type AutocompleteItem, createClient, type MapsLibVNClient } from '@mapslibvn/core';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaces } from './use-places';

const highlands: AutocompleteItem = {
  type: 'poi',
  name: 'Highlands Coffee',
  secondary: 'Quận 1',
  lat: 10.776,
  lng: 106.7,
  score: 0.9,
};

const makeClient = (items = [highlands]) =>
  ({ autocomplete: vi.fn(async () => ({ items })) }) as unknown as MapsLibVNClient;

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('usePlaces', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('đổi khoảng trắng KHÔNG bắn lại cùng một truy vấn', async () => {
    // Deps của effect từng là `query` THÔ trong khi request gửi đi là `query.trim()`. Gõ thêm một
    // dấu cách — chuyện thường xuyên giữa hai từ — là một lượt places nữa cho đúng truy vấn vừa
    // hỏi. Đo 17/09/2026: `highlands coffee quan 1` mất 3 lượt thừa chỉ vì ba dấu cách.
    const client = makeClient();
    const { rerender } = renderHook(({ v }) => usePlaces(v, { client }), {
      initialProps: { v: 'highlands' },
    });
    await advance(300);
    expect(client.autocomplete).toHaveBeenCalledTimes(1);

    rerender({ v: 'highlands ' });
    await advance(300);
    expect(client.autocomplete).toHaveBeenCalledTimes(1);

    rerender({ v: 'highlands c' });
    await advance(300);
    expect(client.autocomplete).toHaveBeenCalledTimes(2);
  });

  it('không gọi API khi query ngắn hơn 2 ký tự', async () => {
    const client = makeClient();
    const { result } = renderHook(() => usePlaces('h', { client }));
    await advance(500);
    expect(client.autocomplete).not.toHaveBeenCalled();
    expect(result.current).toEqual({ items: [], loading: false, error: null });
  });

  it('debounce 300 ms rồi trả items và near', async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      usePlaces('  highlands  ', { client, near: [10.776, 106.7] }),
    );
    expect(result.current.loading).toBe(true);
    await advance(299);
    expect(client.autocomplete).not.toHaveBeenCalled();
    await advance(1);
    expect(client.autocomplete).toHaveBeenCalledWith(
      'highlands',
      expect.objectContaining({ near: [10.776, 106.7], signal: expect.any(AbortSignal) }),
    );
    expect(result.current.items).toEqual([highlands]);
    expect(result.current.loading).toBe(false);
  });

  it('giữ profile nguồn của client khi gọi autocomplete', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ items: [highlands] })));
    const client = createClient({
      apiKey: 'k',
      baseUrl: 'https://api.test',
      poiSources: ['fsq'],
      fetch,
    });
    const { result } = renderHook(() => usePlaces('highlands', { client }));
    await advance(300);
    expect(result.current.items).toEqual([highlands]);
    expect((fetch.mock.calls[0] as unknown as [URL])[0].searchParams.get('sources')).toBe('fsq');
  });

  it('đổi query trước debounce chỉ gọi query cuối', async () => {
    const client = makeClient();
    const { rerender } = renderHook(({ query }) => usePlaces(query, { client }), {
      initialProps: { query: 'high' },
    });
    await advance(100);
    rerender({ query: 'highlands' });
    await advance(300);
    expect(client.autocomplete).toHaveBeenCalledTimes(1);
    expect(client.autocomplete).toHaveBeenCalledWith(
      'highlands',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('response cũ về muộn không ghi đè items của query mới', async () => {
    let resolveOld: ((value: { items: AutocompleteItem[] }) => void) | undefined;
    let resolveNew: ((value: { items: AutocompleteItem[] }) => void) | undefined;
    const newer = { ...highlands, name: 'Highlands mới' };
    const client = {
      autocomplete: vi.fn(
        (query: string) =>
          new Promise<{ items: AutocompleteItem[] }>((resolve) => {
            if (query === 'high') resolveOld = resolve;
            else resolveNew = resolve;
          }),
      ),
    } as unknown as MapsLibVNClient;
    const { result, rerender } = renderHook(({ query }) => usePlaces(query, { client }), {
      initialProps: { query: 'high' },
    });
    await advance(300);
    rerender({ query: 'highlands' });
    await advance(300);
    await act(async () => resolveNew?.({ items: [newer] }));
    expect(result.current.items).toEqual([newer]);
    await act(async () => resolveOld?.({ items: [highlands] }));
    expect(result.current.items).toEqual([newer]);
  });

  it('giữ lỗi API trong result và kết thúc loading', async () => {
    const failure = new Error('mất kết nối');
    const client = {
      autocomplete: vi.fn(async () => Promise.reject(failure)),
    } as unknown as MapsLibVNClient;
    const { result } = renderHook(() => usePlaces('highlands', { client }));
    await advance(300);
    expect(result.current.error).toBe(failure);
    expect(result.current.loading).toBe(false);
  });
  it('trả nguyên item area, không mất bbox', async () => {
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
    const { result } = renderHook(() => usePlaces('quan 10', { client: makeClient([area]) }));
    await advance(300);
    expect(result.current.items).toEqual([area]);
    expect(result.current.items[0]?.bbox).toEqual([106.65, 10.75, 106.68, 10.79]);
    expect(result.current.items[0]?.precision).toBe('district');
  });

  it('request cũ bị huỷ ở mạng khi query đổi trước khi nó xong', async () => {
    const signals: AbortSignal[] = [];
    const client = {
      autocomplete: vi.fn((_query: string, opts: { signal?: AbortSignal }) => {
        if (opts.signal) signals.push(opts.signal);
        return new Promise<{ items: AutocompleteItem[] }>(() => {});
      }),
    } as unknown as MapsLibVNClient;
    const { rerender } = renderHook(({ query }) => usePlaces(query, { client }), {
      initialProps: { query: 'high' },
    });
    await advance(300);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    rerender({ query: 'highlands' });
    await advance(300);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('unmount huỷ request đang chờ ở mạng', async () => {
    const signals: AbortSignal[] = [];
    const client = {
      autocomplete: vi.fn((_query: string, opts: { signal?: AbortSignal }) => {
        if (opts.signal) signals.push(opts.signal);
        return new Promise<{ items: AutocompleteItem[] }>(() => {});
      }),
    } as unknown as MapsLibVNClient;
    const { unmount } = renderHook(() => usePlaces('highlands', { client }));
    await advance(300);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    unmount();
    expect(signals[0]?.aborted).toBe(true);
  });
});
