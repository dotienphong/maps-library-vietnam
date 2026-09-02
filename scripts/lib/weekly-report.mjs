// Báo cáo tuần từ Workers Analytics Engine (spec 6.4, 11.3). Hàm thuần — phần I/O ở
// scripts/weekly-report.mjs. Dataset `mapslibvn_api` (apps/api/src/analytics.ts):
// blob1=tenant_id, blob2=api_key, blob3=path, double1=status, double2=ms.
const VN_OFFSET_MS = 7 * 3600 * 1000;

/**
 * Một dòng kết quả từ SQL API. Chú ý: SUM/sumIf trả **chuỗi** (UInt64),
 * quantileWeighted trả số (Float64) — đã xác nhận trên API thật 02/09/2026.
 * @typedef {{
 *   tenant_id: string, api_key: string, path: string,
 *   requests: number | string, errors_5xx: number | string,
 *   quota_429: number | string, p95_ms: number | string,
 * }} Row
 */
/** @typedef {{ tenants: Record<string, string>, keys: Record<string, string> }} Labels */

/** @param {Date} d */
const ddmmyyyy = (d) => {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()}`;
};

/**
 * Mặc định: tuần trước trọn vẹn theo giờ VN — [thứ Hai 00:00 VN tuần trước, thứ Hai 00:00 VN tuần này).
 * `current: true`: tuần đang chạy — [thứ Hai 00:00 VN tuần này, bây giờ), dùng cho `--this-week`
 * khi cần xem ngay mà không đợi hết tuần.
 * @param {Date} now
 * @param {{ current?: boolean }} [options]
 */
export function weekRange(now, options = {}) {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const monday = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
  const back = (monday.getUTCDay() + 6) % 7; // thứ Hai → 0, Chủ nhật → 6
  monday.setUTCDate(monday.getUTCDate() - back);
  const thisMonday = new Date(monday.getTime() - VN_OFFSET_MS);
  if (options.current) {
    return {
      from: thisMonday,
      to: now,
      label: `${ddmmyyyy(thisMonday)} → ${ddmmyyyy(now)} (tuần đang chạy)`,
    };
  }
  const from = new Date(thisMonday.getTime() - 7 * 86400_000);
  const last = new Date(thisMonday.getTime() - 1);
  return { from, to: thisMonday, label: `${ddmmyyyy(from)} → ${ddmmyyyy(last)}` };
}

/** @param {Date} d */
const sqlTs = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

/**
 * Câu SQL cho Analytics Engine SQL API. `quantileWeighted` là hàm phân vị **duy nhất** dùng được:
 * `quantile(...)` trả "unknown function call: QUANTILE" (thử thật 02/09/2026).
 * @param {{ from: Date, to: Date, dataset: string }} o
 */
export function analyticsSql({ from, to, dataset }) {
  return `
SELECT
  blob1 AS tenant_id,
  blob2 AS api_key,
  blob3 AS path,
  SUM(_sample_interval) AS requests,
  sumIf(_sample_interval, double1 >= 500) AS errors_5xx,
  sumIf(_sample_interval, double1 = 429) AS quota_429,
  quantileWeighted(0.95)(double2, _sample_interval) AS p95_ms
FROM ${dataset}
WHERE timestamp >= toDateTime('${sqlTs(from)}') AND timestamp < toDateTime('${sqlTs(to)}')
GROUP BY tenant_id, api_key, path
ORDER BY requests DESC
LIMIT 1000
FORMAT JSON`;
}

/** @param {string} key */
export function maskKey(key) {
  if (!key) return '(không key)';
  if (!key.startsWith('mlv_live_')) return key;
  const body = key.slice('mlv_live_'.length);
  return `mlv_live_${body.slice(0, 4)}…${body.slice(-4)}`;
}

/**
 * Gộp các route có id trong đường dẫn để bảng top path không vỡ thành từng dòng một id:
 * `/v1/places/<id>` và `/v1/admin/edits/<id>/{approve,reject}`.
 * @param {string} path
 */
const normalizePath = (path) =>
  path
    .replace(/^\/v1\/places\/[^/]+$/, '/v1/places/:id')
    .replace(/^\/v1\/admin\/edits\/[^/]+\/(approve|reject)$/, '/v1/admin/edits/:id/$1');

/**
 * @param {Row[]} rows
 * @param {Labels} labels
 */
export function summarize(rows, labels) {
  const total = { requests: 0, errors_5xx: 0, quota_429: 0 };
  /** @type {Map<string, { name: string, requests: number, errors_5xx: number, quota_429: number, p95_ms: number }>} */
  const tenants = new Map();
  /** @type {Map<string, { key: string, label: string, tenant: string, requests: number }>} */
  const keys = new Map();
  /** @type {Map<string, { path: string, requests: number, errors_5xx: number, p95_ms: number }>} */
  const paths = new Map();

  for (const r of rows) {
    const requests = Number(r.requests) || 0;
    const errors = Number(r.errors_5xx) || 0;
    const quota = Number(r.quota_429) || 0;
    const p95 = Number(r.p95_ms) || 0;
    total.requests += requests;
    total.errors_5xx += errors;
    total.quota_429 += quota;

    const tenantName = r.tenant_id ? (labels.tenants[r.tenant_id] ?? r.tenant_id) : '(không key)';
    const t = tenants.get(tenantName) ?? {
      name: tenantName,
      requests: 0,
      errors_5xx: 0,
      quota_429: 0,
      p95_ms: 0,
    };
    t.requests += requests;
    t.errors_5xx += errors;
    t.quota_429 += quota;
    t.p95_ms = Math.max(t.p95_ms, p95);
    tenants.set(tenantName, t);

    const masked = maskKey(r.api_key);
    const k = keys.get(masked) ?? {
      key: masked,
      label: labels.keys[r.api_key] ?? '',
      tenant: tenantName,
      requests: 0,
    };
    k.requests += requests;
    keys.set(masked, k);

    const path = normalizePath(r.path);
    const p = paths.get(path) ?? { path, requests: 0, errors_5xx: 0, p95_ms: 0 };
    p.requests += requests;
    p.errors_5xx += errors;
    p.p95_ms = Math.max(p.p95_ms, p95);
    paths.set(path, p);
  }

  const byRequests = (
    /** @type {{ requests: number }} */ a,
    /** @type {{ requests: number }} */ b,
  ) => b.requests - a.requests;
  return {
    total,
    tenants: [...tenants.values()].sort(byRequests),
    keys: [...keys.values()].sort(byRequests),
    paths: [...paths.values()].sort(byRequests).slice(0, 15),
  };
}

/** @typedef {ReturnType<typeof summarize>} Summary */

/**
 * @param {Summary} s
 * @param {{ label: string }} range
 */
export function renderText(s, range) {
  const lines = [`MapsLibVN — báo cáo tuần ${range.label}`, ''];
  if (s.total.requests === 0) {
    lines.push('Không có request nào trong tuần.');
    return lines.join('\n');
  }
  lines.push(
    `Tổng request: ${s.total.requests} · 5xx: ${s.total.errors_5xx} · 429: ${s.total.quota_429}`,
    '',
    'Theo tenant:',
  );
  for (const t of s.tenants) {
    lines.push(
      `  ${t.name}: ${t.requests} request · 5xx ${t.errors_5xx} · 429 ${t.quota_429} · p95 ${Math.round(t.p95_ms)} ms`,
    );
  }
  lines.push('', 'Theo key:');
  for (const k of s.keys) {
    lines.push(`  ${k.key}${k.label ? ` (${k.label})` : ''} — ${k.tenant}: ${k.requests}`);
  }
  lines.push('', 'Endpoint nhiều nhất:');
  for (const p of s.paths) {
    lines.push(`  ${p.path}: ${p.requests} · 5xx ${p.errors_5xx} · p95 ${Math.round(p.p95_ms)} ms`);
  }
  return lines.join('\n');
}

/** @param {string | number} v */
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param {string[]} head
 * @param {(string | number)[][]} body
 */
function table(head, body) {
  const th = head.map((h) => `<th align="left">${esc(h)}</th>`).join('');
  const rows = body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table cellpadding="4" style="border-collapse:collapse;font-family:monospace"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * @param {Summary} s
 * @param {{ label: string }} range
 */
export function renderHtml(s, range) {
  const title = `<h2>MapsLibVN &mdash; báo cáo tuần ${esc(range.label).replace('→', '&rarr;')}</h2>`;
  if (s.total.requests === 0) return `${title}<p>Không có request nào trong tuần.</p>`;
  return [
    title,
    `<p>Tổng request: <b>${s.total.requests}</b> · 5xx: ${s.total.errors_5xx} · 429: ${s.total.quota_429}</p>`,
    '<h3>Theo tenant</h3>',
    table(
      ['Tenant', 'Request', '5xx', '429', 'p95 ms'],
      s.tenants.map((t) => [t.name, t.requests, t.errors_5xx, t.quota_429, Math.round(t.p95_ms)]),
    ),
    '<h3>Theo key</h3>',
    table(
      ['Key', 'Nhãn', 'Tenant', 'Request'],
      s.keys.map((k) => [k.key, k.label, k.tenant, k.requests]),
    ),
    '<h3>Endpoint nhiều nhất</h3>',
    table(
      ['Endpoint', 'Request', '5xx', 'p95 ms'],
      s.paths.map((p) => [p.path, p.requests, p.errors_5xx, Math.round(p.p95_ms)]),
    ),
  ].join('\n');
}
