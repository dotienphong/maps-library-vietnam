import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetcher';

export type Permission =
  | 'edits.read'
  | 'edits.write'
  | 'tenants.read'
  | 'tenants.write'
  | 'billing.read'
  | 'billing.write'
  | 'health.read'
  | 'audit.read'
  | 'orders.read'
  | 'orders.write';

export interface Me {
  email: string;
  permissions: string[];
}

/**
 * Giai đoạn này máy chủ trả đủ quyền cho mọi người qua được Access, nên hàm này luôn đúng. Các
 * màn hình vẫn gọi nó ngay từ đầu: ngày thêm phân quyền chỉ phải đổi phía máy chủ, không phải đi
 * sửa rải rác từng màn hình để tìm chỗ cần chặn.
 *
 * Giao diện chỉ ẩn cho gọn mắt — API mới là nơi chặn thật.
 */
export function can(me: Me | undefined, permission: Permission): boolean {
  return me?.permissions.includes(permission) ?? false;
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<Me>('/v1/admin/me'),
    staleTime: 5 * 60_000,
  });
}
