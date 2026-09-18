import { useQuery } from '@tanstack/react-query';
import { type CuaSo, getHealth, getMetrics } from './api';

export const healthKeys = {
  health: ['health', 'trang-thai'] as const,
  metrics: (window: CuaSo) => ['health', 'so-lieu', window] as const,
};

/**
 * Trạng thái sống KHÔNG cache phía client ở màn Sức khoẻ: mở màn hình là đo lại. Máy chủ định
 * tuyến là máy Mac ở nhà — nó ngủ là routing chết, và một ảnh chụp cũ 5 phút đúng lúc đó là câu
 * trả lời sai.
 *
 * Tổng quan truyền `staleTime: 60_000` vì nó là TRANG ĐÍCH, mở mỗi lần vào, và mỗi lượt đo là một
 * lời gọi Valhalla thật. Hai màn dùng CHUNG một khoá cache: sang màn Sức khoẻ vẫn đo lại (observer
 * ở đó để staleTime 0), còn quay về trang đích trong một phút thì không đo lại nữa.
 */
export function useHealth(options: { staleTime?: number } = {}) {
  return useQuery({
    queryKey: healthKeys.health,
    queryFn: getHealth,
    staleTime: options.staleTime ?? 0,
    retry: false,
  });
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
