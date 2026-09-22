// ACK receipt hạn mức cho các script gọi REST production trực tiếp (không qua SDK).
//
// Vì sao bắt buộc: tenant thương mại phát một receipt cho MỖI phản hồi 2xx. Không xác nhận đủ 3 lần
// trong cửa sổ 24 giờ thì sổ quota khoá CẢ tenant với `ack_required`, và mọi khách — kể cả playground
// trên trang tài liệu — nhận 429 cho tới khi quản trị viên mở khoá tay. Đã xảy ra thật 22/09/2026 khi
// `smoke:matrix` gọi curl trần. SDK `@mapslibvn/core` tự làm việc này; script gọi `fetch` thì phải tự.

/** @typedef {{ id: string, token: string } | null} Receipt */

/**
 * Đọc receipt từ header phản hồi. Tenant legacy không phát receipt → null.
 * @param {Response} response
 * @returns {Receipt}
 */
export function receiptFrom(response) {
  const id = response.headers.get('x-mapslibvn-receipt-id');
  const token = response.headers.get('x-mapslibvn-receipt-token');
  return id && token ? { id, token } : null;
}

/**
 * Xác nhận một receipt. KHÔNG ném: lỗi ACK không được làm hỏng phép đo đang chạy, nhưng phải đếm
 * được — người gọi in số ACK trượt để biết có đang tích receipt treo hay không.
 * @param {string} root gốc API đã cắt dấu "/" cuối
 * @param {string} key
 * @param {Receipt} receipt
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<boolean>} true khi đã xác nhận xong
 */
export async function ackReceipt(root, key, receipt, options = {}) {
  if (!receipt) return true;
  const fetchImpl = options.fetchImpl ?? fetch;
  // Thử LẠI một lần: máy chủ chậm nhất thời hay một lỗi mạng lẻ không được biến thành receipt treo —
  // ba cái treo là khoá cả tenant 24 giờ. Đo 22/09/2026 gặp 2/80 lượt trượt ở lần thử đầu.
  for (let lan = 0; lan < 2; lan += 1) {
    if (lan > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetchImpl(
        `${root}/v1/quota/receipts/${encodeURIComponent(receipt.id)}/ack`,
        {
          method: 'POST',
          headers: { 'X-Api-Key': key, 'content-type': 'application/json' },
          body: JSON.stringify({ token: receipt.token }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        },
      );
      // 404 = tenant legacy (không có sổ receipt): không có gì để xác nhận, coi như xong.
      if (response.ok || response.status === 404) return true;
      // 429 do burst: chờ rồi thử lại. 4xx khác là receipt hỏng thật, thử lại cũng vô ích.
      if (response.status !== 429 && response.status < 500) return false;
    } catch {
      // lỗi mạng: rơi xuống vòng sau
    }
  }
  return false;
}

/**
 * Gọi GET rồi ACK ngay receipt kèm theo. Trả cả thời gian (đo TRƯỚC khi ACK để không tính vòng ACK
 * vào p95 của endpoint đang đo).
 * @param {string} url @param {string} root @param {string} key
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ ms: number, status: number, body: unknown, code: string | null, ackFailed: boolean }>}
 */
export async function getAndAck(url, root, key, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const t0 = performance.now();
  const signal = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  /** @type {Response} */
  let response;
  try {
    response = await fetchImpl(url, { headers: { 'X-Api-Key': key }, redirect: 'error', signal });
  } catch (error) {
    return {
      ms: performance.now() - t0,
      status: 0,
      body: null,
      code: signal.aborted ? 'timeout' : String(error),
      ackFailed: false,
    };
  }
  const ms = performance.now() - t0;
  const receipt = receiptFrom(response);
  /** @type {unknown} */
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const ackFailed = !(await ackReceipt(root, key, receipt, options));
  const error =
    body && typeof body === 'object' && 'error' in body
      ? /** @type {{ error?: { code?: string } }} */ (body).error
      : undefined;
  return { ms, status: response.status, body, code: error?.code ?? null, ackFailed };
}
