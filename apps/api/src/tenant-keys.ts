import { apiKeyPrefix, generateApiKey } from './api-key';
import { quotaObject } from './billing/object';
import type { getSql } from './db';
import { sha256Hex } from './edits/hash';
import type { Env } from './env';
import { textArray } from './geocode';

/**
 * Cấp và thu hồi khoá API, dùng chung cho trang Admin lẫn cổng khách hàng.
 *
 * Tách ra chứ không viết bản thứ hai: hai việc này đang chạy production với thứ tự fail-closed đã
 * cân nhắc kỹ, và hai bản song song sẽ lệch nhau đúng lúc không ai để ý. Phần kiểm tham số, ghi
 * nhật ký và dựng phản hồi vẫn thuộc về từng route — đó là chuyện riêng của mỗi đường.
 */

type Sql = ReturnType<typeof getSql>;

export type LoaiKhoa = 'web' | 'mobile' | 'server';

export interface CapKhoaInput {
  tenantId: string;
  label: string | null;
  kind: LoaiKhoa;
  allowedOrigins: string[];
  allowedBundleIds: string[];
  scopes: string[];
  quotaDirectionsPerDay: number | null;
}

export interface KhoaVuaCap {
  /** Khoá dạng rõ. Chỉ tồn tại trong giá trị trả về này — không log, không lưu, không trả lại. */
  key: string;
  keyPrefix: string;
  keyHash: string;
}

export async function issueKeyForTenant(
  sql: Sql,
  env: Env,
  input: CapKhoaInput,
): Promise<KhoaVuaCap> {
  // Sinh và băm TRƯỚC khi chạm DB: khoá rõ không bao giờ đi xa hơn giá trị trả về.
  const key = generateApiKey();
  const keyHash = await sha256Hex(key);
  const keyPrefix = apiKeyPrefix(key);

  // Ba cột mảng đi qua `textArray`: bind mảng JS rồi cast ::text[] thì bản postgres/cf trong
  // Workers nối thành "a,b" và Postgres ném `malformed array literal` — chỉ vỡ trên production
  // và ở test:api-db, unit test không DB luôn xanh.
  await sql`
    INSERT INTO api_key
      (key_hash, key_prefix, tenant_id, label, kind,
       allowed_origins, allowed_bundle_ids, scopes, quota_directions_per_day)
    VALUES (${keyHash}, ${keyPrefix}, ${input.tenantId}::uuid, ${input.label}, ${input.kind},
            ${textArray(sql, input.allowedOrigins)}, ${textArray(sql, input.allowedBundleIds)},
            ${textArray(sql, input.scopes)}, ${input.quotaDirectionsPerDay})`;

  // Cache âm của auth sống 60 giây. Ai đó vừa thử đúng chuỗi này (hoặc một lần thử trước đó trong
  // cùng phút) là khoá mới chết oan tới một phút; xoá luôn cho chắc.
  await env.META.delete(`apikey:${keyHash}`);

  return { key, keyPrefix, keyHash };
}

export interface ThuHoiInput {
  tenantId: string;
  keyHash: string;
  revoked: boolean;
  operationId: string;
  actor: string;
  reason: string;
}

/**
 * Thu hồi hoặc khôi phục một khoá.
 *
 * Thứ tự fail-closed là phần quan trọng nhất và KHÔNG được đổi: thu hồi chạm Durable Object trước
 * rồi mới tới Postgres, khôi phục thì ngược lại. Đảo lại sẽ tạo ra một cửa sổ mà khoá đã thu hồi
 * vẫn gọi API được, hoặc khoá vừa khôi phục vẫn bị chặn.
 *
 * Trả `null` khi không có khoá đó trong tenant — chỗ gọi tự quyết định 404 hay im lặng.
 */
export async function setKeyRevokedForTenant(
  sql: Sql,
  env: Env,
  input: ThuHoiInput,
): Promise<unknown | null> {
  const existing = await sql<{ key_hash: string }[]>`SELECT key_hash FROM api_key
    WHERE tenant_id = ${input.tenantId}::uuid AND key_hash = ${input.keyHash}`;
  if (existing.length === 0) return null;

  const object = quotaObject(env, input.tenantId);
  const apDungVaoSo = () =>
    object.setKeyRevoked(
      input.keyHash,
      input.revoked,
      input.operationId,
      input.actor,
      input.reason,
    );
  const capNhatDb = async () => {
    const rows = await sql<{ key_hash: string }[]>`UPDATE api_key
      SET active = ${!input.revoked}, revoked_at = ${input.revoked ? new Date() : null}
      WHERE tenant_id = ${input.tenantId}::uuid AND key_hash = ${input.keyHash}
      RETURNING key_hash`;
    return rows.length > 0;
  };

  let receipt: Awaited<ReturnType<typeof apDungVaoSo>>;
  try {
    if (input.revoked) {
      receipt = await apDungVaoSo();
      if (!(await capNhatDb())) throw new Error('key_disappeared_during_revocation');
    } else {
      if (!(await capNhatDb())) throw new Error('key_disappeared_during_restoration');
      receipt = await apDungVaoSo();
    }
  } finally {
    // Xoá cache auth ở CẢ hai nhánh: thất bại giữa chừng mà để lại bản cache cũ nghĩa là khoá vừa
    // thu hồi còn sống thêm tới năm phút.
    await env.META.delete(`apikey:${input.keyHash}`);
  }
  return receipt;
}
