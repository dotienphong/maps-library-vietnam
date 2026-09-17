import type { AutocompleteItem, MapsLibVNClient } from '@mapslibvn/core';
import { useContext, useEffect, useRef, useState } from 'react';
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

/** Trần bộ đệm gợi ý trong phiên. 20 đủ phủ một lần gõ dò cả câu; giữ nhiều hơn chỉ tốn RAM. */
const CACHE_TOI_DA = 20;

/** Autocomplete kiểu SWR: giữ items cũ khi tải và bỏ qua response của query đã huỷ. */
export function usePlaces(query: string, options: UsePlacesOptions = {}): UsePlacesResult {
  const mapClient = useContext(MapContext)?.places ?? null;
  const client = options.client ?? mapClient;
  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const nearKey = options.near?.join(',') ?? '';
  /**
   * Gợi ý đã lấy được trong phiên này, theo khoá `truy vấn + near + limit`.
   *
   * Bộ đếm debounce vẫn khởi động lại theo TỪNG phím — đó là nhịp đúng; đổi nó đi thì hẹn giờ nổ
   * sớm rồi phải bắn lại, tốn thêm chứ không bớt. Chặn ở ngay trước lúc gọi nên chỉ cắt đúng cú
   * gọi lặp: gõ thêm dấu cách (`query` thô khác nhau, `query.trim()` y hệt), và gõ lùi/sửa chữ rồi
   * quay lại chuỗi vừa hỏi xong.
   */
  const cache = useRef(new Map<string, AutocompleteItem[]>());

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
    const khoa = `${normalizedQuery}\u0000${nearKey}\u0000${options.limit ?? ''}`;
    const timer = setTimeout(async () => {
      // Gõ thêm dấu cách không đổi chuỗi gửi đi: `query` thô khác nhau nhưng `query.trim()` thì y
      // hệt. Không chặn thì mỗi dấu cách là một lượt places nữa cho đúng câu vừa hỏi xong — đo
      // 17/09/2026 trên trace thật, `addr-le-loi` mất 4 lượt thừa trong 14.
      const daCo = cache.current.get(khoa);
      if (daCo) {
        setItems(daCo);
        setLoading(false);
        return;
      }
      try {
        const requestOptions: {
          near?: [number, number];
          limit?: number;
          signal: AbortSignal;
        } = { signal: controller.signal };
        if (nearKey) requestOptions.near = nearKey.split(',').map(Number) as [number, number];
        if (options.limit !== undefined) requestOptions.limit = options.limit;
        const response = await client.autocomplete(normalizedQuery, requestOptions);
        // Ghi đệm KỂ CẢ khi request đã bị bỏ vì người dùng gõ tiếp: chuỗi đó vẫn đã được máy chủ
        // phục vụ và đã tính lượt, nên kết quả vẫn đúng và vẫn đáng giữ. Gõ lùi về nó là có ngay,
        // không tốn lượt thứ hai.
        cache.current.set(khoa, response.items);
        if (cache.current.size > CACHE_TOI_DA) {
          const cuNhat = cache.current.keys().next().value;
          if (cuNhat !== undefined) cache.current.delete(cuNhat);
        }
        if (!cancelled) setItems(response.items);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error('Không thể tải gợi ý'));
      } finally {
        if (!cancelled) setLoading(false);
      }
      // 300 ms chứ không phải 200: đo trên 14 trace gõ thật (docs/evidence/autocomplete-debounce)
      // thì 200 ms tốn 204 lượt Places, 300 ms còn 126 — bớt 38% mà người dùng chỉ chờ thêm
      // 100 ms sau khi ngừng gõ. PHONG chốt 17/09/2026.
    }, options.debounceMs ?? 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, query, nearKey, options.limit, options.debounceMs]);

  return { items, loading, error };
}
