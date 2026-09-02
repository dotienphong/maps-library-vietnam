#!/usr/bin/env node
// Báo cáo sử dụng tuần: Analytics Engine SQL API → tổng hợp → email qua Cloudflare Email Sending.
//   pnpm report:weekly [--dry-run] [--no-db] [--this-week]
// --this-week: lấy tuần đang chạy thay vì tuần trước (xem ngay, không đợi hết tuần).
// Biến môi trường (infra/server/.env trên máy chủ, .env trên máy dev):
//   CLOUDFLARE_ACCOUNT_ID
//   CF_REPORT_API_TOKEN  — token riêng: Account Analytics: Read + Email Sending: Edit
//                          (thiếu thì tạm dùng CLOUDFLARE_API_TOKEN, chỉ đủ cho --dry-run)
//   REPORT_EMAIL_TO      — nhiều địa chỉ cách nhau bằng phẩy
//   REPORT_EMAIL_FROM    — domain đã bật Email Sending
//   DB (tuỳ chọn, để đổi id → nhãn): DATABASE_URL hoặc POSTGRES_*; bỏ qua bằng --no-db
import 'dotenv/config';
import postgres from 'postgres';
import { databaseUrlFromEnv } from './lib/migrations.mjs';
import {
  analyticsSql,
  renderHtml,
  renderText,
  summarize,
  weekRange,
} from './lib/weekly-report.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const noDb = argv.includes('--no-db');
const DATASET = 'mapslibvn_api';

/** @param {string} name @param {string} [fallbackName] */
function need(name, fallbackName) {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : undefined);
  if (!value) throw new Error(`Thiếu biến môi trường ${name}`);
  if (!process.env[name] && fallbackName) {
    console.warn(`[report] ${name} chưa có, tạm dùng ${fallbackName}`);
  }
  return value;
}

const account = need('CLOUDFLARE_ACCOUNT_ID');
const token = need('CF_REPORT_API_TOKEN', 'CLOUDFLARE_API_TOKEN');
const range = weekRange(new Date(), { current: argv.includes('--this-week') });

// 1. Analytics Engine SQL API
const aeRes = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: analyticsSql({ from: range.from, to: range.to, dataset: DATASET }),
  },
);
if (!aeRes.ok) throw new Error(`Analytics SQL API ${aeRes.status}: ${await aeRes.text()}`);
/** @type {{ data: import('./lib/weekly-report.mjs').Row[], rows: number }} */
const ae = await aeRes.json();
console.log(`[report] ${range.label}: ${ae.rows} nhóm từ Analytics Engine`);

// 2. Nhãn tenant/key từ DB (role `pipeline` và `api` đều có SELECT trên tenant, api_key)
/** @type {{ tenants: Record<string, string>, keys: Record<string, string> }} */
const labels = { tenants: {}, keys: {} };
if (!noDb) {
  const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });
  try {
    for (const t of await sql`SELECT id::text AS id, name FROM tenant`) {
      labels.tenants[t.id] = t.name;
    }
    for (const k of await sql`SELECT key, coalesce(label, '') AS label FROM api_key`) {
      labels.keys[k.key] = k.label;
    }
  } catch (e) {
    console.warn(
      '[report] không đọc được nhãn từ DB, dùng id thô:',
      e instanceof Error ? e.message : e,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// 3. Kết xuất
const summary = summarize(ae.data, labels);
const text = renderText(summary, range);
const html = renderHtml(summary, range);
if (dryRun) {
  console.log(text);
  process.exit(0);
}

// 4. Email — Cloudflare Email Sending REST API. Lưu ý: `from` dùng khoá `address` (không phải
// `email` như binding của Worker) và `reply_to` viết snake_case.
const to = need('REPORT_EMAIL_TO')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const from = need('REPORT_EMAIL_FROM');
const mailRes = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      from: { address: from, name: 'MapsLibVN' },
      subject: `MapsLibVN — báo cáo tuần ${range.label}`,
      text,
      html,
    }),
  },
);
const body = await mailRes.text();
if (!mailRes.ok) throw new Error(`Email Sending API ${mailRes.status}: ${body}`);
console.log(`[report] đã gửi tới ${to.join(', ')}: ${body.slice(0, 200)}`);
