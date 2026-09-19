import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * Chuỗi `qrCode` của PayOS là payload EMVCo/VietQR; mọi ứng dụng ngân hàng quét được. Vẽ ở client
 * bằng một thư viện KHÔNG phụ thuộc và xuất data URL — không gọi máy chủ ảnh bên ngoài, nên nội
 * dung chuyển khoản của khách không rời khỏi trình duyệt.
 */
export function MaQr({ noiDung }: { noiDung: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(noiDung);
    qr.make();
    return qr.createDataURL(4, 8);
  }, [noiDung]);
  return (
    <img
      src={src}
      alt="Mã QR chuyển khoản VietQR"
      width={232}
      height={232}
      className="rounded-[var(--radius-btn)] border border-[var(--border)] bg-white"
    />
  );
}
