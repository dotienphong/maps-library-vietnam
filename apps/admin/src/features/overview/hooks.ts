import { useQuery } from '@tanstack/react-query';
import { listAudit } from '@/features/audit/api';
import { getQuotaSummary } from './api';

export const overviewKeys = {
  quota: ['overview', 'quota-summary'] as const,
  viec: ['overview', 'viec-gan-nhat'] as const,
};

/**
 * `retry: false` để một lần 403 (email không nằm trong BILLING_ADMIN_EMAILS) không bị thử lại ba
 * lần; màn hình chỉ cần biết ngay là không được xem phần này.
 */
export function useQuotaSummary() {
  return useQuery({
    queryKey: overviewKeys.quota,
    queryFn: getQuotaSummary,
    staleTime: 60_000,
    retry: false,
  });
}

/** Năm việc gần nhất, dùng lại đúng lời gọi của Nhật ký kiểm toán chứ không viết hàm thứ hai. */
export function useVietGanNhat() {
  return useQuery({
    queryKey: overviewKeys.viec,
    queryFn: () => listAudit({}, 5),
    staleTime: 60_000,
    retry: false,
  });
}
