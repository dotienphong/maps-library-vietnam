import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

/**
 * Không có `errorElement` thì react-router dựng trang mặc định của NÓ — nguyên văn "Unexpected
 * Application Error! 404 Not Found 💿 Hey developer 👋..." bằng tiếng Anh, kèm lời khuyên dành cho
 * lập trình viên. Trang đó đã chạy thật trên production tại `/admin/health` và `/admin/audit`
 * (đo 17/09/2026): hai mục có trong sidebar nhưng chưa có route.
 */
export function NotFound() {
  const error = useRouteError();
  // Dùng ở hai chỗ: nhánh bắt hết `*` và `errorElement` của route cha. Ở nhánh bắt hết không có
  // lỗi nào được ném và `useRouteError()` trả **null** — không phải `undefined`, kiểm nhầm kiểu là
  // đường dẫn gõ sai lại hiện "Màn hình gặp lỗi", đổ lỗi cho hệ thống vì một chuyện người dùng gõ nhầm.
  const la404 = error == null || (isRouteErrorResponse(error) && error.status === 404);

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-base font-semibold">
        {la404 ? 'Không có màn hình này' : 'Màn hình gặp lỗi'}
      </h2>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        {la404
          ? 'Đường dẫn không khớp màn hình nào. Có thể nó thuộc phần chưa làm, hoặc địa chỉ gõ sai.'
          : 'Có lỗi ngoài dự tính khi dựng màn hình. Tải lại trang, nếu vẫn vậy thì xem log Worker.'}
      </p>
      <Link
        to="/edits"
        className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-btn)] bg-accent px-4 text-[15px] font-semibold text-accent-ink"
      >
        Về Duyệt đóng góp
      </Link>
    </section>
  );
}
