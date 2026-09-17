import { useInfiniteQuery } from '@tanstack/react-query';
import { type AuditFilter, listAudit } from './api';

export const auditKeys = {
  list: (filter: AuditFilter) => ['audit', 'list', filter] as const,
};

export function useAuditList(filter: AuditFilter) {
  return useInfiniteQuery({
    queryKey: auditKeys.list(filter),
    queryFn: ({ pageParam }) =>
      listAudit({ ...filter, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor,
  });
}
