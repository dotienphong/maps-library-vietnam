import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  confirmManual,
  fulfilOrder,
  getOrder,
  getSummary,
  getUnmatched,
  listOrders,
  type TrangThaiDon,
  type XacNhanTay,
} from './api';

export const orderKeys = {
  list: (status: TrangThaiDon | '') => ['orders', 'list', status] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
  summary: () => ['orders', 'summary'] as const,
  unmatched: () => ['orders', 'unmatched'] as const,
};

export function useOrderList(status: TrangThaiDon | '') {
  return useInfiniteQuery({
    queryKey: orderKeys.list(status),
    queryFn: ({ pageParam }) =>
      listOrders({ ...(status ? { status } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor,
  });
}

export const useOrderDetail = (id: string | null) =>
  useQuery({
    queryKey: orderKeys.detail(id ?? ''),
    queryFn: () => getOrder(id as string),
    enabled: id !== null,
  });

/** Cùng khoá cache mà hai ô của Tổng quan sẽ dùng ở pha 4 — khoá đã sẵn, không phải đổi sau. */
export const useOrderSummary = () =>
  useQuery({ queryKey: orderKeys.summary(), queryFn: getSummary, staleTime: 30_000 });

export const useUnmatched = () =>
  useQuery({ queryKey: orderKeys.unmatched(), queryFn: getUnmatched, staleTime: 30_000 });

function useInvalidateOrders() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: ['orders'] });
}

export function useFulfil() {
  const invalidate = useInvalidateOrders();
  return useMutation({ mutationFn: (id: string) => fulfilOrder(id), onSettled: invalidate });
}

export function useConfirmManual() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: XacNhanTay }) => confirmManual(id, body),
    onSettled: invalidate,
  });
}
