#!/usr/bin/env node
// Sao lưu và đối soát sổ quota thương mại (plan quota Task 6).
//
//   node scripts/quota-audit.mjs export  --tenant <uuid> [--out out/quota-audit] [--no-upload]
//   node scripts/quota-audit.mjs verify  --file <đường dẫn .json hoặc .json.enc>
//   node scripts/quota-audit.mjs restore --tenant <uuid> --file <...> --yes
//
// `export` lấy snapshot + đuôi journal qua API quản trị, KIỂM checksum, ghi bản mã hoá lên bucket
// backup riêng, rồi MỚI chốt checkpoint. Thứ tự đó là điều kiện đúng đắn: chốt trước khi R2 nhận
// xong sẽ cắt mất đúng đoạn journal vừa mất.
//
// Báo cáo in ra màn hình/ghi file chỉ chứa số đếm và checksum — không khoá, không truy vấn,
// không toạ độ. Dữ liệu thô nằm trong file .enc.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  backupBucket,
  decryptCommand,
  encryptCommand,
  requireBackupPassphrase,
} from './lib/backup-plan.mjs';

export const BUNDLE_KIND = 'mapslibvn-quota-audit';
/** Trần một lô phát lại journal, khớp trần trang của Durable Object. */
export const JOURNAL_PAGE = 100;

/** @typedef {{seq:number, kind:string, ref:string, payload:string, createdAt:string}} JournalEntry */
/** @typedef {{index:number, pages:number, sequence:number, records:string, checksum:string, snapshotId:string}} SnapshotPage */
/** @typedef {{snapshotId:string, tenantId:string, schemaVersion:number, sequence:number, pages:number, records:number, checksum:string, takenAt:string}} SnapshotManifest */
/** @typedef {{kind:string, schemaVersion:number, tenantId:string, takenAt:string, manifest:SnapshotManifest, pages:SnapshotPage[], journal:JournalEntry[]}} Bundle */
/** @typedef {(path: string, init?: {method?: string, body?: string, headers?: Record<string,string>}) => Promise<any>} AdminCall */

/** @param {string} value */
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith('--')) continue;
    const name = token.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = true;
    }
  }
  return { command: command ?? '', flags };
}

/**
 * Tên object trên R2. Một tenant một thư mục, tên theo giờ VN như backup DB.
 * @param {string} tenantId @param {Date} [date]
 */
export function backupObjectName(tenantId, date = new Date()) {
  const vn = new Date(date.getTime() + 7 * 3600 * 1000).toISOString();
  const stamp = `${vn.slice(0, 10).replace(/-/g, '')}-${vn.slice(11, 16).replace(':', '')}`;
  return `quota-audit/${tenantId}/quota-${stamp}.json.enc`;
}

/**
 * Kiểm một bản sao lưu ĐỘC LẬP với máy chủ đã tạo ra nó: băm lại từng trang, dựng lại checksum
 * tổng và soi số thứ tự journal. Trả danh sách vấn đề; rỗng nghĩa là dùng để phục hồi được.
 * @param {Bundle} bundle
 */
export async function verifyBundle(bundle) {
  /** @type {string[]} */
  const problems = [];
  if (!bundle || bundle.kind !== BUNDLE_KIND) return ['không phải bản sao lưu quota'];
  const manifest = bundle.manifest;
  if (!manifest) return ['thiếu manifest'];
  if (!Array.isArray(bundle.pages) || bundle.pages.length !== manifest.pages) {
    problems.push(`số trang lệch manifest: ${bundle.pages?.length} ≠ ${manifest.pages}`);
  }

  const checksums = [];
  let records = 0;
  for (const [index, page] of (bundle.pages ?? []).entries()) {
    if (page.index !== index) problems.push(`trang ${index} sai thứ tự (index=${page.index})`);
    const actual = await sha256Hex(page.records ?? '');
    if (actual !== page.checksum) problems.push(`trang ${index} sai checksum`);
    checksums.push(page.checksum);
    try {
      const parsed = JSON.parse(page.records);
      if (!Array.isArray(parsed)) throw new Error('không phải mảng');
      records += parsed.length;
    } catch {
      problems.push(`trang ${index} không đọc được`);
    }
  }
  if (records !== manifest.records) {
    problems.push(`tổng bản ghi lệch manifest: ${records} ≠ ${manifest.records}`);
  }
  // Dựng lại đúng công thức của Durable Object: đổi một byte ở bất kỳ trang nào cũng lộ ở đây.
  const expected = await sha256Hex(
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      tenantId: manifest.tenantId,
      sequence: manifest.sequence,
      records: manifest.records,
      pages: checksums,
    }),
  );
  if (expected !== manifest.checksum) problems.push('checksum tổng không khớp các trang');

  const journal = bundle.journal ?? [];
  for (const [index, entry] of journal.entries()) {
    const expectedSeq = manifest.sequence + index + 1;
    if (entry.seq !== expectedSeq) {
      // Thiếu một số thứ tự nghĩa là thiếu một khoản ĐÃ tính tiền. Không được coi là 0.
      problems.push(`đuôi journal thủng tại ${expectedSeq} (nhận ${entry.seq})`);
      break;
    }
  }
  return problems;
}

/**
 * Báo cáo đối soát. Chỉ số đếm, trạng thái và checksum — cố tình KHÔNG mang theo bản ghi thô,
 * nên file báo cáo có thể đính kèm evidence mà không lộ băm khoá hay lịch sử truy vấn của khách.
 * @param {Bundle} bundle
 * @param {Record<string, any>|null} [usage]
 */
export function buildReport(bundle, usage = null) {
  /** @type {Record<string, number>} */
  const tables = {};
  for (const page of bundle.pages ?? []) {
    try {
      for (const record of JSON.parse(page.records)) {
        tables[record.table] = (tables[record.table] ?? 0) + 1;
      }
    } catch {
      /* trang hỏng đã được verifyBundle báo riêng */
    }
  }
  /** @type {Record<string, number>} */
  const byKind = {};
  for (const entry of bundle.journal ?? []) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  /** @param {any} value */
  const group = (value) =>
    value
      ? {
          limit: value.limit,
          used: value.used,
          reserved: value.reserved,
          credits: value.credits,
          available: value.available,
        }
      : null;
  return {
    tenantId: bundle.tenantId,
    takenAt: bundle.takenAt,
    schemaVersion: bundle.manifest?.schemaVersion ?? null,
    sequence: bundle.manifest?.sequence ?? null,
    pages: bundle.manifest?.pages ?? 0,
    records: bundle.manifest?.records ?? 0,
    checksum: bundle.manifest?.checksum ?? null,
    tables,
    journal: {
      entries: (bundle.journal ?? []).length,
      byKind,
      from: bundle.journal?.[0]?.seq ?? null,
      to: bundle.journal?.at(-1)?.seq ?? null,
    },
    usage: usage
      ? {
          status: usage.status,
          tier: usage.tier,
          periodId: usage.periodId,
          endsAt: usage.endsAt,
          maintenance: usage.maintenance === true,
          places: group(usage.places),
          directions: group(usage.directions),
        }
      : null,
  };
}

/** @param {{base:string, headers?:Record<string,string>, fetchImpl?:typeof fetch}} options */
export function adminClient({ base, headers = {}, fetchImpl = fetch }) {
  const root = base.replace(/\/+$/, '');
  /** @type {AdminCall} */
  return async (path, init) => {
    const response = await fetchImpl(`${root}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...headers, ...(init?.headers ?? {}) },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${path} → HTTP ${response.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
}

/**
 * Lấy trọn snapshot rồi đuôi journal sinh ra trong lúc đang tải trang.
 * @param {{call: AdminCall, tenantId: string, operationId?: string}} options
 * @returns {Promise<Bundle>}
 */
export async function collectBundle({ call, tenantId, operationId = randomUUID() }) {
  const manifest = await call(`/v1/admin/billing/${tenantId}/backup/snapshot`, {
    method: 'POST',
    body: JSON.stringify({ operationId }),
  });
  /** @type {SnapshotPage[]} */
  const pages = [];
  for (let index = 0; index < manifest.pages; index += 1) {
    pages.push(
      await call(`/v1/admin/billing/${tenantId}/backup/snapshot/${manifest.snapshotId}/${index}`),
    );
  }
  /** @type {JournalEntry[]} */
  const journal = [];
  let after = manifest.sequence;
  for (;;) {
    const page = await call(
      `/v1/admin/billing/${tenantId}/backup/journal?after=${after}&limit=${JOURNAL_PAGE}`,
    );
    if (!page.entries || page.entries.length === 0) break;
    journal.push(...page.entries);
    after = page.nextSequence;
  }
  return {
    kind: BUNDLE_KIND,
    schemaVersion: manifest.schemaVersion,
    tenantId,
    takenAt: manifest.takenAt,
    manifest,
    pages,
    journal,
  };
}

/**
 * Lấy → kiểm → ghi bền vững → chốt checkpoint. `persist` phải chỉ resolve khi byte đã nằm ở nơi
 * sống sót qua sự cố; chốt sớm hơn là cách chắc chắn nhất để mất đúng phần vừa xoá khỏi journal.
 * @param {{call: AdminCall, tenantId: string, persist: (bundle: Bundle) => Promise<string>,
 *   operationId?: string}} options
 */
export async function runExport({ call, tenantId, persist, operationId = randomUUID() }) {
  const bundle = await collectBundle({ call, tenantId, operationId });
  const problems = await verifyBundle(bundle);
  if (problems.length > 0) throw new Error(`Bản sao lưu không hợp lệ: ${problems.join('; ')}`);
  const location = await persist(bundle);
  const receipt = await call(`/v1/admin/billing/${tenantId}/backup/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      operationId: randomUUID(),
      snapshotId: bundle.manifest.snapshotId,
      checksum: bundle.manifest.checksum,
    }),
  });
  const usage = await call(`/v1/admin/billing/${tenantId}/usage`);
  return { bundle, location, receipt, report: buildReport(bundle, usage) };
}

/**
 * Nạp lại sổ: bật bảo trì → từng trang snapshot → phát lại đuôi journal theo lô. Không tự tắt
 * bảo trì ở cuối: người vận hành phải đối chiếu số trước khi mở lại cho khách.
 * @param {{call: AdminCall, tenantId: string, bundle: Bundle, reason?: string}} options
 */
export async function runRestore({ call, tenantId, bundle, reason = 'quota restore drill' }) {
  const problems = await verifyBundle(bundle);
  if (problems.length > 0) throw new Error(`Bản sao lưu không hợp lệ: ${problems.join('; ')}`);
  await call(`/v1/admin/billing/${tenantId}/backup/maintenance`, {
    method: 'POST',
    body: JSON.stringify({ operationId: randomUUID(), reason, enabled: true }),
  });
  for (const page of bundle.pages) {
    await call(`/v1/admin/billing/${tenantId}/backup/restore`, {
      method: 'POST',
      body: JSON.stringify({ operationId: randomUUID(), page }),
    });
  }
  for (let index = 0; index < bundle.journal.length; index += JOURNAL_PAGE) {
    await call(`/v1/admin/billing/${tenantId}/backup/restore`, {
      method: 'POST',
      body: JSON.stringify({
        operationId: randomUUID(),
        entries: bundle.journal.slice(index, index + JOURNAL_PAGE),
      }),
    });
  }
  const usage = await call(`/v1/admin/billing/${tenantId}/usage`);
  return { report: buildReport(bundle, usage), usage };
}

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

/**
 * Ghi bản mã hoá xuống đĩa rồi đẩy lên bucket backup riêng.
 * @param {Bundle} bundle @param {{outDir: string, upload: boolean}} options
 */
function persistToBackup(bundle, { outDir, upload }) {
  requireBackupPassphrase(process.env);
  mkdirSync(outDir, { recursive: true });
  const name = backupObjectName(bundle.tenantId);
  const local = resolve(outDir, name.split('/').at(-1) ?? 'quota.json.enc');
  const plain = `${local}.${process.pid}.tmp`;
  writeFileSync(plain, JSON.stringify(bundle));
  try {
    run('sh', ['-c', encryptCommand(plain, local)]);
  } finally {
    rmSync(plain, { force: true });
  }
  if (!upload) return local;
  const { bucket, shared } = backupBucket(process.env);
  if (shared) {
    console.warn('⚠ BACKUP_BUCKET chưa đặt — đang dùng bucket dùng chung, hãy tách bucket riêng.');
  }
  run('rclone', ['copyto', local, `r2:${bucket}/${name}`]);
  return `r2:${bucket}/${name}`;
}

/** @param {string} file @returns {Bundle} */
function loadBundle(file) {
  const path = resolve(file);
  if (!path.endsWith('.enc')) return JSON.parse(readFileSync(path, 'utf8'));
  requireBackupPassphrase(process.env);
  const plain = `${path}.${process.pid}.plain`;
  try {
    run('sh', ['-c', decryptCommand(path, plain)]);
    return JSON.parse(readFileSync(plain, 'utf8'));
  } finally {
    rmSync(plain, { force: true });
  }
}

/**
 * Header xác thực cho route quản trị.
 *
 * Phải là JWT NGƯỜI DÙNG, không phải service token: `verifyAccessJwt` bắt buộc có claim `email`
 * để ghi `actor` vào audit, mà JWT của service token chỉ mang `common_name`. Dùng service token
 * sẽ qua được biên Access rồi chết ở Worker với `invalid_access_jwt`.
 */
export function accessHeaders(env = process.env) {
  const jwt = env.BILLING_ACCESS_JWT;
  if (!jwt) {
    throw new Error(
      [
        'Thiếu BILLING_ACCESS_JWT. Lấy bằng cloudflared:',
        '  cloudflared access login <base>/v1/admin',
        '  export BILLING_ACCESS_JWT=$(cloudflared access token -app=<base>/v1/admin)',
        'Service token (CF-Access-Client-Id/Secret) KHÔNG thay thế được: JWT của nó mang',
        'common_name chứ không mang email, nên Worker từ chối với invalid_access_jwt.',
      ].join('\n'),
    );
  }
  /** @type {Record<string, string>} */
  const headers = { 'Cf-Access-Jwt-Assertion': jwt };
  // Một số cấu hình Access chặn ngay ở biên nếu thiếu service token; gửi kèm khi có sẵn.
  if (env.BILLING_ACCESS_CLIENT_ID && env.BILLING_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.BILLING_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.BILLING_ACCESS_CLIENT_SECRET;
  }
  return headers;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const outDir = resolve(String(flags.out ?? 'out/quota-audit'));
  const tenantId = String(flags.tenant ?? '');

  if (command === 'verify') {
    const bundle = loadBundle(String(flags.file));
    const problems = await verifyBundle(bundle);
    console.log(JSON.stringify(buildReport(bundle), null, 2));
    if (problems.length > 0) {
      console.error(`✗ ${problems.length} vấn đề:\n  - ${problems.join('\n  - ')}`);
      process.exitCode = 1;
      return;
    }
    console.log('✓ Bản sao lưu toàn vẹn');
    return;
  }

  const base = String(flags.base ?? process.env.MAPSLIBVN_API_BASE ?? '');
  if (!base) throw new Error('Thiếu --base hoặc MAPSLIBVN_API_BASE');
  if (!tenantId) throw new Error('Thiếu --tenant');
  const call = adminClient({ base, headers: accessHeaders() });

  if (command === 'export') {
    const result = await runExport({
      call,
      tenantId,
      persist: async (bundle) =>
        persistToBackup(bundle, { outDir, upload: flags['no-upload'] !== true }),
    });
    mkdirSync(outDir, { recursive: true });
    const reportPath = join(outDir, `report-${tenantId}-${result.bundle.manifest.sequence}.json`);
    writeFileSync(reportPath, JSON.stringify(result.report, null, 2));
    console.log(JSON.stringify(result.report, null, 2));
    console.log(`✓ Đã lưu ${result.location}; checkpoint ở sequence ${result.receipt.sequence}`);
    console.log(`✓ Báo cáo: ${reportPath}`);
    return;
  }

  if (command === 'restore') {
    if (flags.yes !== true) {
      throw new Error('Phục hồi ghi đè sổ tiêu thụ — thêm --yes để xác nhận');
    }
    const bundle = loadBundle(String(flags.file));
    const result = await runRestore({ call, tenantId, bundle });
    console.log(JSON.stringify(result.report, null, 2));
    console.log('✓ Đã nạp xong. Sổ VẪN đang bảo trì: đối chiếu số rồi mới tắt bảo trì.');
    return;
  }

  throw new Error(`Lệnh không hợp lệ: ${command || '(trống)'} — dùng export | verify | restore`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`✗ ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
