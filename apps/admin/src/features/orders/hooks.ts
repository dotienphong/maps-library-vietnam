import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelOrder,
  confirmManual,
  fulfilOrder,
  getOrder,
  getSummary,
  getUnmatched,
  type LenhCoLyDo,
  listOrders,
  refundOrder,
  type TrangThaiDon,
  type XacNhanTay,
} from './api';

export interface BoLocDanhSach {
  status: TrangThaiDon | '';
  tenant: string;
  from: string;
  to: string;
}

export const orderKeys = {
  list: (b: BoLocDanhSach) => ['orders', 'list', b.status, b.tenant, b.from, b.to] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
  summary: () => ['orders', 'summary'] as const,
  unmatched: () => ['orders', 'unmatched'] as const,
  ganNhat: (tenantId: string) => ['orders', 'gan-nhat', tenantId] as const,
};

export function useOrderList(b: BoLocDanhSach) {
  return useInfiniteQuery({
    queryKey: orderKeys.list(b),
    queryFn: ({ pageParam }) =>
      listOrders({
        ...(b.status ? { status: b.status } : {}),
        ...(b.tenant ? { tenant: b.tenant } : {}),
        ...(b.from ? { from: b.from } : {}),
        ...(b.to ? { to: b.to } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
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

/**
 * Cùng khoá cache với hai ô của Tổng quan (pha 4). `retry: false`: tài khoản ngoài
 * BILLING_ADMIN_EMAILS nhận 403 một lần là đủ, không thử ba lần. `enabled` để màn không có quyền
 * `orders.read` không gọi.
 */
export const useOrderSummary = (tuyChon: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: orderKeys.summary(),
    queryFn: getSummary,
    staleTime: 30_000,
    retry: false,
    enabled: tuyChon.enabled ?? true,
  });

export const useUnmatched = () =>
  useQuery({ queryKey: orderKeys.unmatched(), queryFn: getUnmatched, staleTime: 30_000 });

/** Năm đơn gần nhất của một tenant — chi tiết tenant và chi tiết khách hàng dùng chung. */
export const useDonGanNhat = (tenantId: string | null, tuyChon: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: orderKeys.ganNhat(tenantId ?? ''),
    queryFn: () => listOrders({ tenant: tenantId as string, limit: 5 }),
    enabled: tenantId !== null && (tuyChon.enabled ?? true),
    retry: false,
    staleTime: 30_000,
  });

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

export interface TuyChonLenh {
  /**
   * Lệnh chạy sau 5 giây (`useDelayedAction`), lúc đó panel gọi nó thường đã đóng. `onError` ở
   * ĐÂY (tuỳ chọn của `useMutation`, không phải tham số thứ hai của `mutate`/`mutateAsync`) là bắt
   * buộc: react-query chỉ gọi callback lỗi truyền qua `mutate(vars, { onError })` khi observer còn
   * `hasListeners()` — tức component gọi nó còn mounted. Callback ở cấp hook luôn chạy, kể cả khi
   * component đã unmount.
   */
  onError?: (error: unknown) => void;
}

export function useCancelOrder(tuyChon: TuyChonLenh = {}) {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LenhCoLyDo }) => cancelOrder(id, body),
    ...(tuyChon.onError ? { onError: tuyChon.onError } : {}),
    onSettled: invalidate,
  });
}

export function useRefundOrder(tuyChon: TuyChonLenh = {}) {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LenhCoLyDo }) => refundOrder(id, body),
    ...(tuyChon.onError ? { onError: tuyChon.onError } : {}),
    onSettled: invalidate,
  });
}
