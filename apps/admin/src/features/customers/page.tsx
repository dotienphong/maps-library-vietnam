// Bản tạm cho Task 6 — chỉ để route và test biên dịch được. Task 8 thay toàn bộ bằng màn hình
// thật (tìm kiếm, danh sách, chi tiết tài khoản khách).
export function CustomersPage() {
  return (
    <input
      aria-label="Tìm theo email hoặc tên"
      placeholder="Tìm theo email hoặc tên"
      className="min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
    />
  );
}
