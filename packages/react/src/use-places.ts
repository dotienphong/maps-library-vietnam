import type { AutocompleteItem, MapsLibVNClient } from '@mapslibvn/core';
import { useContext, useEffect, useState } from 'react';
import { MapContext } from './context';

export interface UsePlacesOptions {
  near?: [number, number];
  limit?: number;
  debounceMs?: number;
  /** Client tường minh — bắt buộc khi hook nằm ngoài <MapsLibVNMap>. */
  client?: MapsLibVNClient;
}

export interface UsePlacesResult {
  items: AutocompleteItem[];
  loading: boolean;
  error: Error | null;
}

/** Autocomplete kiểu SWR: giữ items cũ khi tải và bỏ qua response của query đã huỷ. */
export function usePlaces(query: string, options: UsePlacesOptions = {}): UsePlacesResult {
  const mapClient = useContext(MapContext)?.places ?? null;
  const client = options.client ?? mapClient;
  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const nearKey = options.near?.join(',') ?? '';

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!client || normalizedQuery.length < 2) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const requestOptions: {
          near?: [number, number];
          limit?: number;
          signal: AbortSignal;
        } = { signal: controller.signal };
        if (nearKey) requestOptions.near = nearKey.split(',').map(Number) as [number, number];
        if (options.limit !== undefined) requestOptions.limit = options.limit;
        const response = await client.autocomplete(normalizedQuery, requestOptions);
        if (!cancelled) setItems(response.items);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error('Không thể tải gợi ý'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, options.debounceMs ?? 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, query, nearKey, options.limit, options.debounceMs]);

  return { items, loading, error };
}
