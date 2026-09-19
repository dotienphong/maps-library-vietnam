const NGAY_MS = 86_400_000;
/** Phiên sống 30 ngày, gia hạn trượt khi còn dưới 15 ngày. */
export const SONG_NGAY = 30;
const GIA_HAN_KHI_CON_NGAY = 15;

export const COOKIE_PHIEN = 'mlv_console_session';

/** 32 byte ngẫu nhiên, base64url — không có ký tự nào phải mã hoá khi đặt vào cookie. */
export function sinhTokenPhien(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * DB chỉ giữ băm kèm pepper, y như `api_key` sau audit 09/09/2026: đọc trộm bảng phiên không
 * mạo danh được ai, và một bản dump lọt ra ngoài không kéo theo quyền đăng nhập.
 */
export async function bamToken(token: string, pepper: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token + pepper));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hanPhienMoi(now: Date = new Date()): Date {
  return new Date(now.getTime() + SONG_NGAY * NGAY_MS);
}

/**
 * Chỉ ghi lại hạn khi đã trôi quá nửa đời phiên, để mỗi request không kéo theo một lượt ghi DB.
 * Phiên đã hết hạn cũng trả `true`; nơi từ chối nó là câu truy vấn đọc phiên, không phải hàm này.
 */
export function nenGiaHan(hetHan: Date, now: Date = new Date()): boolean {
  return hetHan.getTime() - now.getTime() < GIA_HAN_KHI_CON_NGAY * NGAY_MS;
}

/**
 * `SameSite=Lax` cộng cổng chống CSRF sẵn có (`requireSameSiteGhi`) là đủ cho mọi thao tác ghi,
 * nên không cần token CSRF riêng. `Path=/` vì cookie phải đi tới cả SPA ở `/console/*` lẫn API ở
 * `/v1/console/*`.
 */
export function dungCookiePhien(token: string, songNgay = SONG_NGAY): string {
  return [
    `${COOKIE_PHIEN}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${songNgay * 86_400}`,
  ].join('; ');
}

export function dungCookieXoa(): string {
  return `${COOKIE_PHIEN}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function docCookiePhien(header: string | null): string | null {
  if (!header) return null;
  for (const phan of header.split(';')) {
    const cat = phan.trim();
    const dau = cat.indexOf('=');
    if (dau < 0) continue;
    // So khớp TÊN đầy đủ, không dùng startsWith: một cookie tên `x_mlv_console_session` của
    // ứng dụng khác trên cùng tên miền sẽ bị nhận nhầm.
    if (cat.slice(0, dau) !== COOKIE_PHIEN) continue;
    return cat.slice(dau + 1) || null;
  }
  return null;
}
