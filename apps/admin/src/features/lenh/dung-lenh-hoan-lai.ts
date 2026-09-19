interface ThamSoLichHoanLai {
  /** `schedule` của `useDelayedAction()` — hàm này không tự gọi hook, tránh ép nơi gọi nó thành component. */
  schedule: (input: { label: string; run: () => Promise<void> }) => void;
  onClose: () => void;
  label: string;
}

/**
 * Gói bất biến "operationId sinh MỘT lần lúc bấm, không sinh lại lúc gửi": bốn nơi (ba trong
 * `orders/chi-tiet.tsx`, một trong `customers/chi-tiet.tsx`) từng tự lặp lại đúng ba bước
 * `crypto.randomUUID()` → `schedule({ label, run })` → `onClose()`, và bất biến đó sống rải rác,
 * mỗi bản tự giữ lấy một mình.
 *
 * `run` nhận `operationId` làm tham số — nơi gọi KHÔNG được tự đọc biến ngoài closure để lấy
 * operationId, vì như vậy dễ vô tình sinh lại nó ở chỗ khác. Đóng ngăn ngay sau khi xếp lịch —
 * bắt buộc: ngăn là Radix Dialog modal nên toast đếm ngược nằm ngoài nó bị aria-hidden, ngăn còn
 * mở thì nút Huỷ trên toast không bấm được.
 */
export function dungLenhHoanLai({ schedule, onClose, label }: ThamSoLichHoanLai) {
  return (run: (operationId: string) => Promise<unknown>) => {
    const operationId = crypto.randomUUID().replace(/-/g, '');
    schedule({
      label,
      run: async () => {
        await run(operationId);
      },
    });
    onClose();
  };
}
