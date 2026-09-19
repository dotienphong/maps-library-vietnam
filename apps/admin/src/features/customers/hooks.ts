import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disableCustomer,
  enableCustomer,
  getCustomer,
  type LenhTaiKhoan,
  listCustomers,
} from './api';

export const customerKeys = {
  list: (q: string) => ['customers', 'list', q] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
};

export function useCustomerList(q: string) {
  return useInfiniteQuery({
    queryKey: customerKeys.list(q),
    queryFn: ({ pageParam }) =>
      listCustomers({ ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor,
  });
}

export const useCustomerDetail = (id: string | null) =>
  useQuery({
    queryKey: customerKeys.detail(id ?? ''),
    queryFn: () => getCustomer(id as string),
    enabled: id !== null,
  });

function useInvalidateCustomers() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: ['customers'] });
}

export function useDisableCustomer() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LenhTaiKhoan }) => disableCustomer(id, body),
    onSettled: invalidate,
  });
}

export function useEnableCustomer() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LenhTaiKhoan }) => enableCustomer(id, body),
    onSettled: invalidate,
  });
}
