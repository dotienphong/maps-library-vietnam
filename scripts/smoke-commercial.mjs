#!/usr/bin/env node
// Nghiệm thu quota thương mại trên một tenant thử (plan quota Task 7).
//
//   BILLING_ACCESS_JWT=... MAPSLIBVN_API_KEY=... [MAPSLIBVN_API_KEY_B=...] \
//     node scripts/smoke-commercial.mjs --tenant <uuid> --base https://api.ai-solutions.io.vn
//
// Vì sao cần script thay vì gõ curl: **một phản hồi 2xx KHÔNG tự trừ lượt.** Lượt chỉ được tính
// sau khi client ACK receipt. Gõ tay rất dễ quên bước đó rồi kết luận nhầm là quota hỏng — tệ hơn,
// mỗi receipt bỏ quên sẽ thành `missed_ack`, và ba cái trong 24 giờ khoá tenant bằng `ack_required`.
// Script này ACK đúng từng receipt nó tạo ra.
//
// Script KHÔNG bật/tắt cổng admission và KHÔNG deploy. Chạy được nghĩa là tenant đã commercial và
// `COMMERCIAL_ADMISSION=1`.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';

/** @typedef {{name: string, ok: boolean, detail: string}} Check */

/** @param {string[]} argv */
export function parseSmokeArgs(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  for (const token of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(token);
    if (match?.[1]) flags[match[1]] = match[2] ?? '';
  }
  return flags;
}

/**
 * So sánh một kỳ vọng và ghi lại kết quả. Không ném: mục đích là chạy hết mọi bước rồi báo bảng,
 * chứ không dừng ở lỗi đầu tiên — biết "3/9 hỏng, hỏng ở đâu" hữu ích hơn "hỏng".
 * @param {Check[]} checks @param {string} name @param {unknown} actual @param {unknown} expected
 */
export function expectEqual(checks, name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({
    name,
    ok,
    detail: ok
      ? `${JSON.stringify(actual)}`
      : `nhận ${JSON.stringify(actual)}, chờ ${JSON.stringify(expected)}`,
  });
  return ok;
}

/**
 * Chuỗi nghiệm thu. `data` gọi API dữ liệu bằng API key, `admin` gọi route quản trị bằng Access JWT.
 * Cả hai đều tiêm được nên test chạy không cần mạng.
 * @param {{
 *   data: (path: string, options?: {key?: string, method?: string, body?: string}) => Promise<{status: number, headers: Headers, json: any}>,
 *   admin: (path: string, init?: {method?: string, body?: string}) => Promise<any>,
 *   keyA: string, keyB?: string, tenantId: string,
 * }} deps
 */
export async function runSmoke({ data, admin, keyA, keyB, tenantId }) {
  /** @type {Check[]} */
  const checks = [];
  const usedNow = async () => (await admin(`/v1/admin/billing/${tenantId}/usage`)).places.used;

  const before = await admin(`/v1/admin/billing/${tenantId}/usage`);
  expectEqual(checks, 'thuê bao đang hoạt động', before.status, 'active');
  expectEqual(checks, 'sổ không ở chế độ bảo trì', before.maintenance === true, false);
  let used = before.places.used;

  // 1. Phản hồi 2xx phải mang đủ receipt và không được cache chung.
  const first = await data('/v1/autocomplete?q=ha%20noi&limit=1', { key: keyA });
  expectEqual(checks, 'gọi Places thành công', first.status, 200);
  const receiptId = first.headers.get('x-mapslibvn-receipt-id');
  const receiptToken = first.headers.get('x-mapslibvn-receipt-token');
  expectEqual(checks, 'có receipt id + token', Boolean(receiptId && receiptToken), true);
  expectEqual(
    checks,
    'có hạn receipt',
    Boolean(first.headers.get('x-mapslibvn-receipt-expires-at')),
    true,
  );
  expectEqual(
    checks,
    'response riêng tư, không cache',
    first.headers.get('cache-control'),
    'private, no-store',
  );

  // 2. Chưa ACK thì chưa bị tính lượt.
  expectEqual(checks, 'chưa ACK thì chưa trừ lượt', await usedNow(), used);

  // 3. ACK đúng token thì tính đúng MỘT lượt, ACK lại không tính thêm.
  const ackPath = `/v1/quota/receipts/${receiptId}/ack`;
  const ack = await data(ackPath, {
    key: keyA,
    method: 'POST',
    body: JSON.stringify({ token: receiptToken }),
  });
  expectEqual(checks, 'ACK được chấp nhận', ack.status, 200);
  used += 1;
  expectEqual(checks, 'ACK trừ đúng một lượt', await usedNow(), used);
  const replay = await data(ackPath, {
    key: keyA,
    method: 'POST',
    body: JSON.stringify({ token: receiptToken }),
  });
  expectEqual(checks, 'ACK lặp lại vẫn 200', replay.status, 200);
  expectEqual(checks, 'ACK lặp lại không trừ thêm', await usedNow(), used);

  // 4. Lỗi của người gọi không được tính tiền.
  const bad = await data('/v1/autocomplete?q=a', { key: keyA });
  expectEqual(checks, 'truy vấn sai trả 400', bad.status, 400);
  expectEqual(checks, 'lỗi 4xx không trừ lượt', await usedNow(), used);

  // 5. HEAD phải bị chặn sớm, không chạy handler và không trừ lượt.
  const head = await data('/v1/autocomplete?q=ha%20noi', { key: keyA, method: 'HEAD' });
  expectEqual(checks, 'HEAD trả 405', head.status, 405);
  expectEqual(checks, 'HEAD kèm Allow: GET', head.headers.get('allow'), 'GET');
  expectEqual(checks, 'HEAD không trừ lượt', await usedNow(), used);

  // 6. Mọi khoá của cùng tenant tiêu chung một sổ.
  if (keyB) {
    const second = await data('/v1/autocomplete?q=da%20nang&limit=1', { key: keyB });
    expectEqual(checks, 'khoá thứ hai gọi được', second.status, 200);
    const id2 = second.headers.get('x-mapslibvn-receipt-id');
    const token2 = second.headers.get('x-mapslibvn-receipt-token');
    await data(`/v1/quota/receipts/${id2}/ack`, {
      key: keyB,
      method: 'POST',
      body: JSON.stringify({ token: token2 }),
    });
    used += 1;
    expectEqual(checks, 'hai khoá cộng chung một sổ', await usedNow(), used);
  } else {
    checks.push({
      name: 'hai khoá cộng chung một sổ',
      ok: true,
      detail: 'BỎ QUA — không có MAPSLIBVN_API_KEY_B',
    });
  }

  // 7. Bảo trì đóng sổ: khách nhận 503 quota_unavailable, KHÔNG phải "hết lượt".
  await admin(`/v1/admin/billing/${tenantId}/backup/maintenance`, {
    method: 'POST',
    body: JSON.stringify({ operationId: crypto.randomUUID(), reason: 'smoke', enabled: true }),
  });
  const closed = await data('/v1/autocomplete?q=hue&limit=1', { key: keyA });
  expectEqual(checks, 'bảo trì trả 503', closed.status, 503);
  expectEqual(
    checks,
    'bảo trì dùng mã quota_unavailable',
    closed.json?.error?.code,
    'quota_unavailable',
  );
  await admin(`/v1/admin/billing/${tenantId}/backup/maintenance`, {
    method: 'POST',
    body: JSON.stringify({ operationId: crypto.randomUUID(), reason: 'smoke', enabled: false }),
  });
  expectEqual(checks, 'bảo trì không trừ lượt', await usedNow(), used);

  // 8. Đình chỉ là hết QUYỀN (403), khác hẳn hết lượt (429).
  const revision = (await admin(`/v1/admin/billing/${tenantId}/usage`)).revision;
  await admin(`/v1/admin/billing/${tenantId}/commands`, {
    method: 'POST',
    body: JSON.stringify({
      kind: 'suspend',
      operationId: crypto.randomUUID(),
      reason: 'smoke',
      expectedRevision: revision,
    }),
  });
  const suspended = await data('/v1/autocomplete?q=can%20tho&limit=1', { key: keyA });
  expectEqual(checks, 'đình chỉ trả 403', suspended.status, 403);
  expectEqual(
    checks,
    'đình chỉ dùng mã subscription_expired',
    suspended.json?.error?.code,
    'subscription_expired',
  );
  await admin(`/v1/admin/billing/${tenantId}/commands`, {
    method: 'POST',
    body: JSON.stringify({
      kind: 'resume',
      operationId: crypto.randomUUID(),
      reason: 'smoke',
      expectedRevision: revision + 1,
    }),
  });
  const resumed = await admin(`/v1/admin/billing/${tenantId}/usage`);
  expectEqual(checks, 'mở lại thì hoạt động tiếp', resumed.status, 'active');
  expectEqual(checks, 'đình chỉ/mở lại không đổi số đã dùng', resumed.places.used, used);

  return { checks, failed: checks.filter((check) => !check.ok) };
}

/** @param {string} base @param {string} jwt */
function client(base, jwt) {
  const root = base.replace(/\/+$/, '');
  /** @param {string} path @param {{key?: string, method?: string, body?: string}} [options] */
  const data = async (path, options = {}) => {
    const response = await fetch(`${root}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'X-Api-Key': options.key ?? '',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(options.body ? { body: options.body } : {}),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, json };
  };
  /** @param {string} path @param {{method?: string, body?: string}} [init] */
  const admin = async (path, init = {}) => {
    const response = await fetch(`${root}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Cf-Access-Jwt-Assertion': jwt,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${path} → HTTP ${response.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
  return { data, admin };
}

async function main() {
  const flags = parseSmokeArgs(process.argv.slice(2));
  const base = flags.base ?? process.env.MAPSLIBVN_API_BASE ?? '';
  const tenantId = flags.tenant ?? '';
  const jwt = process.env.BILLING_ACCESS_JWT ?? '';
  const keyA = process.env.MAPSLIBVN_API_KEY ?? '';
  const keyB = process.env.MAPSLIBVN_API_KEY_B;
  if (!base || !tenantId) throw new Error('Thiếu --base hoặc --tenant');
  if (!jwt)
    throw new Error('Thiếu BILLING_ACCESS_JWT (cloudflared access token -app=<base>/v1/admin)');
  if (!keyA) throw new Error('Thiếu MAPSLIBVN_API_KEY — không truyền khoá trên dòng lệnh');

  const { data, admin } = client(base, jwt);
  const result = await runSmoke({ data, admin, keyA, ...(keyB ? { keyB } : {}), tenantId });
  console.table(
    result.checks.map(({ name, ok, detail }) => ({ '': ok ? '✓' : '✗', name, detail })),
  );
  if (result.failed.length > 0) {
    console.error(
      `✗ ${result.failed.length}/${result.checks.length} bước không đạt — KHÔNG mở commercial.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${result.checks.length}/${result.checks.length} bước đạt.`);
  console.log(
    'Chưa nghiệm thu phần cạn hạn mức (lượt thứ 21 của tuyến trong ngày): cần ~3 phút traffic có ' +
      'giữ nhịp dưới burst. Logic đó đã có test ở apps/api/test/billing-reservations.test.ts.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
