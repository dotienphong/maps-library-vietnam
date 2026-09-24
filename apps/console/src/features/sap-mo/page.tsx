import { useCauHinh } from '@/features/auth/hooks';

/**
 * Hiện khi cổng tự phục vụ còn đóng. Chặn ngay từ đây thay vì để khách gõ xong email rồi mới báo
 * lỗi: một form nhận đầu vào mà chắc chắn sẽ từ chối là một lời hứa sai.
 */
export function SapMo() {
  const { data: cauHinh } = useCauHinh();
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Cổng khách hàng sắp mở</h1>
      <p className="mt-3 text-[var(--text-muted)]">
        Việc tự đăng ký đang được hoàn thiện. Trong lúc chờ, hãy liên hệ để được cấp khoá API và bản
        dùng thử ngay trong ngày làm việc.
      </p>
      {cauHinh?.supportEmail && (
        <p className="mt-6">
          <a
            className="inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-accent px-5 font-semibold text-accent-ink"
            href={`mailto:${cauHinh.supportEmail}`}
          >
            Gửi thư cho chúng tôi
          </a>
        </p>
      )}
      <p className="mt-6 text-sm text-[var(--text-muted)]">
        <a className="underline" href="https://mapslibvn.pages.dev/">
          Xem bảng giá và tài liệu
        </a>
      </p>
    </div>
  );
}
