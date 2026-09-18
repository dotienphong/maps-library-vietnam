import { LoadingSkeleton } from '@mapslibvn/ui';
import type { ReactNode } from 'react';
import { useCauHinh } from '@/features/auth/hooks';
import { SapMo } from '@/features/sap-mo/page';

/**
 * Cổng chặn toàn ứng dụng khi việc tự phục vụ còn đóng.
 *
 * `/v1/console/config` cố ý đứng NGOÀI cổng đó ở phía máy chủ, nên SPA đọc được cờ và hiện màn
 * "Sắp mở" ngay, thay vì mời khách gõ email rồi mới báo lỗi. Máy chủ vẫn là nơi chặn thật —
 * component này chỉ để không hứa hẹn thứ mình không làm được.
 */
export function CongDong({ children }: { children: ReactNode }) {
  const { data: cauHinh, isPending, isError } = useCauHinh();

  if (isPending) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <LoadingSkeleton rows={2} />
      </div>
    );
  }

  // Không đọc được cấu hình thì cho đi tiếp: máy chủ vẫn chặn đúng, và khoá cả ứng dụng vì một
  // lần gọi mạng hỏng là phạt nhầm người dùng.
  if (!isError && cauHinh && !cauHinh.selfServe) return <SapMo />;

  return <>{children}</>;
}
