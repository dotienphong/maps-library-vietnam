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
  | 'orders.write'
  | 'customers.read';

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
 *
 * `Array.isArray` chứ không `me?.permissions.includes`: một /v1/admin/me trả thân lạ (proxy chèn
 * trang HTML, hay stub test trả nhầm) không được làm trắng cả trang vì `.includes` của undefined.
 * Không có quyền thì ẩn, đó là hành vi đúng cho dữ liệu hỏng.
 */
export function can(me: Me | undefined, permission: Permission): boolean {
  return Array.isArray(me?.permissions) && me.permissions.includes(permission);
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<Me>('/v1/admin/me'),
    staleTime: 5 * 60_000,
  });
}
