/** Mã sống 10 phút — đủ để mở hộp thư trên máy khác, ngắn để một mã lộ không dùng được lâu. */
export const HAN_PHUT = 10;
/** Năm lần thử một mã. Mở rộng hơn là mời người ta dò sáu chữ số. */
export const SO_LAN_THU_TOI_DA = 5;

/**
 * Sáu chữ số lấy từ nguồn ngẫu nhiên mật mã, dùng rejection sampling để mọi mã có xác suất bằng
 * nhau. Lấy `% 1_000_000` thẳng trên một số 32 bit làm các mã nhỏ hơi hay ra hơn — sai lệch nhỏ,
 * nhưng cách đúng chỉ tốn thêm ba dòng nên không có lý do chấp nhận nó.
 */
export function sinhMa(): string {
  const TRAN = 1_000_000;
  const GIOI_HAN = Math.floor(0xff_ff_ff_ff / TRAN) * TRAN;
  const so = new Uint32Array(1);
  do {
    crypto.getRandomValues(so);
  } while ((so[0] as number) >= GIOI_HAN);
  return String((so[0] as number) % TRAN).padStart(6, '0');
}

export const chuanHoaEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Kiểm tối thiểu: đúng một `@`, phần sau có dấu chấm, không khoảng trắng, độ dài hợp lý.
 * Không cố viết biểu thức "đúng chuẩn RFC" — nó dài, vẫn sai, và thứ thật sự chứng minh email có
 * tồn tại vẫn là lá thư gửi tới nơi.
 */
export function laEmailHopLe(email: string): boolean {
  return email.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email);
}

export const hetHanLuc = (now: Date = new Date()): Date =>
  new Date(now.getTime() + HAN_PHUT * 60_000);

export function maConDung(
  ma: { expires_at: Date; consumed_at: Date | null; attempts: number },
  now: Date = new Date(),
): boolean {
  return (
    ma.consumed_at === null &&
    ma.attempts < SO_LAN_THU_TOI_DA &&
    ma.expires_at.getTime() > now.getTime()
  );
}
