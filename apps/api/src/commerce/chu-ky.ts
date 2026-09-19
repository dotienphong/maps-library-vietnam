/**
 * Chữ ký PayOS, chép đúng thuật toán của SDK chính thức `@payos/node@2.0.5`
 * (`lib/utils/sort-obj-by-key.js`, `lib/utils/convert-obj-to-query-str.js`,
 * `lib/crypto/subtle-crypto.js`). Không cài SDK vào Worker: toàn bộ giá trị của nó với ta là ~40
 * dòng dưới đây, và ít mã lạ chạy cạnh khoá thanh toán hơn. Mọi thay đổi ở đây phải qua vector
 * cố định trong test/commerce-chu-ky.test.ts.
 */

const encoder = new TextEncoder();

async function hmacHex(chuoi: string, khoa: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(khoa),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(chuoi));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface TaoLinkKy {
  amount: number;
  cancelUrl: string;
  description: string;
  orderCode: number;
  returnUrl: string;
}

/** Chữ ký gửi kèm `POST /v2/payment-requests`: đúng năm trường, đúng thứ tự này. */
export function kyTaoLink(input: TaoLinkKy, checksumKey: string): Promise<string> {
  const chuoi =
    `amount=${input.amount}&cancelUrl=${input.cancelUrl}&description=${input.description}` +
    `&orderCode=${input.orderCode}&returnUrl=${input.returnUrl}`;
  return hmacHex(chuoi, checksumKey);
}

type DuLieu = Record<string, unknown>;

/** `sortObjDataByKey` của SDK: sắp khoá; với giá trị không phải object thì Object.keys rỗng → {}. */
function sapXepKhoa(gia: unknown): Record<string, unknown> {
  const doiTuong = (gia ?? {}) as Record<string, unknown>;
  return Object.keys(doiTuong)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = doiTuong[k];
      return acc;
    }, {});
}

/**
 * `convertObjToQueryStr(sortObjDataByKey(data))` của SDK, giữ nguyên cả điểm kỳ quặc: phần tử
 * mảng đi qua `sortObjDataByKey` bất kể kiểu. Webhook thật hiện không có mảng, nhưng nếu một ngày
 * có thì chữ ký phải khớp với thứ PayOS tính, không phải với thứ ta thấy hợp lý.
 */
export function chuoiKyDuLieu(data: DuLieu): string {
  return Object.keys(data)
    .sort()
    .filter((k) => data[k] !== undefined)
    .map((k) => {
      let v: unknown = data[k];
      if (Array.isArray(v)) v = JSON.stringify(v.map((phanTu) => sapXepKhoa(phanTu)));
      if (v === null || v === undefined || v === 'undefined' || v === 'null') v = '';
      return `${k}=${String(v)}`;
    })
    .join('&');
}

/** Chữ ký của `data` trong webhook và trong mọi phản hồi của PayOS. */
export function kyDuLieu(data: DuLieu, checksumKey: string): Promise<string> {
  return hmacHex(chuoiKyDuLieu(data), checksumKey);
}

/**
 * So sánh không phụ thuộc vị trí sai khác. `!==` thoát ở byte sai đầu tiên, và thời gian đó đo
 * được từ ngoài; với chữ ký hex 64 ký tự thì XOR toàn bộ rồi mới kết luận.
 */
export function soSanhHangSo(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let khac = 0;
  for (let i = 0; i < a.length; i += 1) khac |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return khac === 0;
}

export async function khopChuKy(
  data: DuLieu,
  chuKy: string,
  checksumKey: string,
): Promise<boolean> {
  if (typeof chuKy !== 'string' || !/^[0-9a-f]{64}$/.test(chuKy)) return false;
  return soSanhHangSo(await kyDuLieu(data, checksumKey), chuKy);
}
