import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  countPending,
  type EditListFilter,
  getEdit,
  listEdits,
  reviewBulk,
  reviewEdit,
} from './api';

export const editKeys = {
  list: (filter: EditListFilter) => ['edits', 'list', filter] as const,
  detail: (id: number) => ['edits', 'detail', id] as const,
  count: () => ['edits', 'count'] as const,
};

export function useEditList(filter: EditListFilter) {
  return useQuery({ queryKey: editKeys.list(filter), queryFn: () => listEdits(filter) });
}

export function useEditDetail(id: number | null) {
  return useQuery({
    queryKey: editKeys.detail(id ?? 0),
    queryFn: () => getEdit(id as number),
    enabled: id !== null,
  });
}

export function usePendingCount() {
  return useQuery({
    queryKey: editKeys.count(),
    queryFn: countPending,
    refetchInterval: 60_000,
  });
}

/** Làm mới danh sách và huy hiệu sau khi một thao tác duyệt đã gửi thật. */
function useInvalidateEdits() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['edits'] });
  };
}

export function useReviewEdit() {
  const invalidate = useInvalidateEdits();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'reject' }) =>
      reviewEdit(id, action),
    onSettled: invalidate,
  });
}

export function useReviewBulk() {
  const invalidate = useInvalidateEdits();
  return useMutation({
    mutationFn: ({ ids, action }: { ids: number[]; action: 'approve' | 'reject' }) =>
      reviewBulk(ids, action),
    onSettled: invalidate,
  });
}
