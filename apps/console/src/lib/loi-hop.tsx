import { loiVi } from './error-vi';

/**
 * Khối báo lỗi của console. Không dùng `ErrorState` của `@mapslibvn/ui`: component đó đọc lỗi
 * theo hình dạng `{ status, code, message }` của API và in nguyên mã tiếng Anh, hợp cho trang
 * quản trị nhưng không hợp cho khách. Ở đây câu tiếng Việt đứng trước, mã đứng sau và nhỏ — đủ để
 * khách đọc cho người hỗ trợ khi cần.
 */
export function LoiHop({ error }: { error: unknown }) {
  const { ma, cau } = loiVi(error);
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-card)] border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950"
    >
      <p className="font-semibold text-red-800 dark:text-red-100">{cau}</p>
      <p className="mt-1 text-xs text-red-700 dark:text-red-200">Mã lỗi: {ma}</p>
    </div>
  );
}
