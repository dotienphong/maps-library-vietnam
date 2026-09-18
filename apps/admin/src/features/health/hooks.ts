import { useQuery } from '@tanstack/react-query';
import { type CuaSo, getHealth, getMetrics } from './api';

export const healthKeys = {
  health: ['health', 'trang-thai'] as const,
  metrics: (window: CuaSo) => ['health', 'so-lieu', window] as const,
};

/**
 * Trạng thái sống KHÔNG cache phía client: mở màn hình là đo lại. Máy chủ định tuyến là máy Mac ở
 * nhà — nó ngủ là routing chết, và một ảnh chụp cũ 5 phút đúng lúc đó là câu trả lời sai.
 */
export function useHealth() {
  return useQuery({ queryKey: healthKeys.health, queryFn: getHealth, staleTime: 0, retry: false });
}

/** Số liệu thì cache đúng bằng cache phía máy chủ — hỏi lại sớm hơn chỉ nhận lại cùng câu trả lời. */
export function useMetrics(window: CuaSo) {
  return useQuery({
    queryKey: healthKeys.metrics(window),
    queryFn: () => getMetrics(window),
    staleTime: 300_000,
    retry: false,
  });
}
