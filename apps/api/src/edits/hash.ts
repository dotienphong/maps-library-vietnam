// Băm định danh cho đóng góp (spec 6.4/6.5): không lưu token/IP thô.
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** end_user_hash = sha256(tenant_id + token) — token do app nhúng cấp, ổn định theo người dùng. */
export const endUserHash = (tenantId: string, token: string) => sha256Hex(`${tenantId}:${token}`);

/** ip_hash = sha256(ip + ngày VN) — salt xoay theo ngày, không liên kết được giữa các ngày. */
export const ipHash = (ip: string, day: string) => sha256Hex(`${ip}:${day}`);
