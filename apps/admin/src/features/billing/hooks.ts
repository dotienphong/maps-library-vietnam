import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Command,
  getCatalog,
  getLegacyUsage,
  getPeriods,
  getUsage,
  sendCommand,
  unlockAcks,
} from './api';

export const billingKeys = {
  usage: (id: string) => ['billing', 'usage', id] as const,
  periods: (id: string) => ['billing', 'periods', id] as const,
  legacy: (id: string) => ['billing', 'legacy', id] as const,
  catalog: () => ['billing', 'catalog'] as const,
};

/**
 * `enabled` là cổng an toàn chứ không phải tối ưu: gọi `usage`/`periods` sẽ TẠO sổ Durable Object
 * cho tenant chưa có, và lần get() đầu tiên là lúc Cloudflare chốt vị trí object (bài học
 * 15/09/2026). Mở màn hình xem thông tin không được phép tạo sổ cho một tenant legacy.
 */
export function useUsage(tenantId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: billingKeys.usage(tenantId ?? ''),
    queryFn: () => getUsage(tenantId as string),
    enabled: tenantId !== null && enabled,
  });
}

export function usePeriods(tenantId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: billingKeys.periods(tenantId ?? ''),
    queryFn: () => getPeriods(tenantId as string),
    enabled: tenantId !== null && enabled,
  });
}

export function useLegacyUsage(tenantId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: billingKeys.legacy(tenantId ?? ''),
    queryFn: () => getLegacyUsage(tenantId as string),
    enabled: tenantId !== null && enabled,
  });
}

/** Bảng giá đổi vài lần một năm; giữ lâu để form mở tức thì. */
export function useCatalog() {
  return useQuery({
    queryKey: billingKeys.catalog(),
    queryFn: getCatalog,
    staleTime: 30 * 60_000,
  });
}

function useLamMoiBilling() {
  const client = useQueryClient();
  return () => {
    // Làm mới CẢ nhóm: mỗi lệnh thành công tăng revision, và gửi lệnh kế bằng revision cũ sẽ nhận
    // revision_conflict. Danh sách tenant cũng đổi (chế độ hạn mức) nên làm mới luôn.
    void client.invalidateQueries({ queryKey: ['billing'] });
    void client.invalidateQueries({ queryKey: ['tenants'] });
  };
}

export function useSendCommand() {
  const lamMoi = useLamMoiBilling();
  return useMutation({
    mutationFn: ({ tenantId, command }: { tenantId: string; command: Command }) =>
      sendCommand(tenantId, command),
    onSettled: lamMoi,
  });
}

export function useUnlockAcks() {
  const lamMoi = useLamMoiBilling();
  return useMutation({
    mutationFn: ({
      tenantId,
      operationId,
      reason,
    }: {
      tenantId: string;
      operationId: string;
      reason: string;
    }) => unlockAcks(tenantId, operationId, reason),
    onSettled: lamMoi,
  });
}
