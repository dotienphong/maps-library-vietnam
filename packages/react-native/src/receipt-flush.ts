import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

interface CoReceipt {
  flushReceipts: () => Promise<boolean>;
}

/**
 * ACK những receipt còn chờ khi app rời màn hình trước.
 *
 * Với tenant chạy chế độ thương mại, một phản hồi 2xx chưa trừ lượt — lượt chỉ được tính khi client
 * ACK. SDK ACK ở nền ngay sau mỗi phản hồi, nhưng receipt CUỐI CÙNG của một phiên thường chưa kịp
 * đi thì người dùng đã thoát app. Web giải quyết bằng `pagehide`/`visibilitychange`; React Native
 * không có hai sự kiện đó nên dùng `AppState`.
 *
 * Bỏ qua bước này thì mỗi phiên dùng app để lại một receipt bỏ lỡ, và chỉ ba cái trong 24 giờ là
 * máy chủ khoá tenant bằng `ack_required`.
 */
export function useFlushReceiptsOnBackground(client: CoReceipt): void {
  useEffect(() => {
    const onChange = (trangThai: AppStateStatus) => {
      // `inactive` (iOS: kéo thanh thông báo, chuyển app) cũng tính: từ đó người dùng có thể không
      // bao giờ quay lại, và ACK thì rẻ — gửi thừa một lần vô hại vì máy chủ idempotent theo id.
      if (trangThai === 'background' || trangThai === 'inactive') {
        void client.flushReceipts();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [client]);
}
