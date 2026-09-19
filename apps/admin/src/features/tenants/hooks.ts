import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTenant,
  issueKey,
  listTenants,
  type NewKeyInput,
  type QuotaMode,
  setKeyRevoked,
  setQuotaMode,
  xoaTenant,
} from './api';

export const tenantKeys = {
  list: (q: string) => ['tenants', 'list', q] as const,
  detail: (id: string) => ['tenants', 'detail', id] as const,
};

export function useTenantList(q: string) {
  return useInfiniteQuery({
    queryKey: tenantKeys.list(q),
    queryFn: ({ pageParam }) =>
      listTenants({ ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTenantDetail(id: string | null) {
  return useQuery({
    queryKey: tenantKeys.detail(id ?? ''),
    queryFn: () => getTenant(id as string),
    enabled: id !== null,
  });
}

/** Làm mới danh sách và chi tiết sau mỗi thao tác đã gửi thật. */
function useInvalidateTenants() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['tenants'] });
  };
}

export function useIssueKey() {
  const invalidate = useInvalidateTenants();
  return useMutation({
    mutationFn: ({ tenantId, input }: { tenantId: string; input: NewKeyInput }) =>
      issueKey(tenantId, input),
    onSettled: invalidate,
  });
}

export function useSetKeyRevoked() {
  const invalidate = useInvalidateTenants();
  return useMutation({
    mutationFn: ({
      tenantId,
      keyHash,
      revoked,
      reason,
      operationId,
    }: {
      tenantId: string;
      keyHash: string;
      revoked: boolean;
      reason: string;
      operationId: string;
    }) => setKeyRevoked(tenantId, keyHash, revoked, reason, operationId),
    onSettled: invalidate,
  });
}

export function useSetQuotaMode() {
  const invalidate = useInvalidateTenants();
  return useMutation({
    mutationFn: ({ tenantId, mode }: { tenantId: string; mode: QuotaMode }) =>
      setQuotaMode(tenantId, mode),
    onSettled: invalidate,
  });
}

/**
 * Xoá tenant. Không `onSettled: invalidate` như các mutation khác mà làm mới CẢ cây `tenants`
 * sau khi thành công — chi tiết của tenant vừa xoá không còn gì để đọc, giữ nó trong cache là mời
 * giao diện gọi lại một id đã chết.
 */
export function useXoaTenant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, confirmName }: { tenantId: string; confirmName: string }) =>
      xoaTenant(tenantId, confirmName),
    onSuccess: (_, { tenantId }) => {
      client.removeQueries({ queryKey: tenantKeys.detail(tenantId) });
      void client.invalidateQueries({ queryKey: ['tenants'] });
    },
  });
}
