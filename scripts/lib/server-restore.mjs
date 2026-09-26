import { resolve, sep } from 'node:path';

/** @param {string} path */
const toPosixPath = (path) => path.split(sep).join('/');

export const SERVER_RESTORE_REQUIRED_ENV = [
  'POSTGRES_SUPER_PASSWORD',
  'BACKUP_PASSPHRASE',
  'BACKUP_BUCKET',
  'RCLONE_CONFIG_R2_ACCESS_KEY_ID',
  'RCLONE_CONFIG_R2_SECRET_ACCESS_KEY',
  'RCLONE_CONFIG_R2_ENDPOINT',
];

/** @param {Record<string, string | undefined>} env */
export function requiredServerRestoreEnv(env) {
  return SERVER_RESTORE_REQUIRED_ENV.filter((name) => !env[name]?.trim());
}

/** @param {Record<string, string | undefined>} env */
export function serverRestoreRun(env) {
  const password = env.POSTGRES_SUPER_PASSWORD ?? '';
  return {
    command: 'docker',
    args: [
      'compose',
      '--env-file',
      'infra/server/.env',
      '-f',
      toPosixPath(resolve('infra/server/compose.yml')),
      'run',
      '--rm',
      '-e',
      'POSTGRES_USER',
      '-e',
      'POSTGRES_PASSWORD',
      '-e',
      'DATABASE_URL',
      'pipeline',
      'node',
      'scripts/db-restore.mjs',
      '--latest',
      '--yes',
    ],
    env: {
      ...process.env,
      ...env,
      POSTGRES_USER: 'mapslibvn',
      POSTGRES_PASSWORD: password,
      DATABASE_URL: `postgres://mapslibvn:${encodeURIComponent(password)}@postgres:5432/mapslibvn?sslmode=require`,
    },
  };
}

/**
 * Nhóm kiểm sau restore, theo thứ tự in. Mỗi nhóm là một thứ restore từng làm mất hoặc có thể làm mất:
 * pg_dump --no-owner --no-privileges bỏ owner/GRANT, DB mới đổi tên bỏ ALTER DATABASE … SET, và
 * cluster mới không có ALTER ROLE … SET. Bản cũ chỉ soi bảng `poi` nên báo xanh trên DB đã làm trang
 * admin khách hàng/đơn hàng, đăng nhập console và webhook PayOS chết (26/09/2026).
 */
export const KIEM_RESTORE = /** @type {const} */ ([
  'du_lieu',
  'poi_thuoc_pipeline',
  'bang_tam_thuoc_pipeline',
  'api_doc_poi',
  'api_khong_ghi_poi',
  'khach_hang',
  'don_hang_payos',
  'cap_khoa',
  'xoa_tenant_chi_api',
  'ham_m4_thuoc_pipeline',
  'nguong_tim_mo',
  'api_statement_timeout',
]);

/** Mỗi dòng `kiem | dat`; chạy bằng superuser trên DB vừa phục hồi. */
export function verifyRestoredDatabaseSql() {
  return `SELECT kiem, dat FROM (VALUES
    ('du_lieu', (SELECT count(*) FROM schema_migrations) > 0 AND (SELECT count(*) FROM poi) > 0),
    ('poi_thuoc_pipeline', (SELECT tableowner = 'pipeline' FROM pg_tables WHERE schemaname = 'public' AND tablename = 'poi')),
    ('bang_tam_thuoc_pipeline', NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public'
      AND tableowner <> 'pipeline' AND (tablename ~ '^poi_work_|_new$|_keys_stage$'
        OR tablename IN ('osm_road_raw', 'osm_admin_raw', 'osm_admin_old_raw', 'admin_overlap_work',
          'address_anchor_raw', 'address_anchor_edge', 'address_anchor_merge')))),
    ('api_doc_poi', has_table_privilege('api', 'poi', 'SELECT')),
    ('api_khong_ghi_poi', NOT has_table_privilege('api', 'poi', 'INSERT, UPDATE, DELETE')),
    ('khach_hang', has_table_privilege('api', 'customer_account', 'SELECT')
      AND has_column_privilege('api', 'customer_account', 'last_login_at', 'UPDATE')
      AND has_table_privilege('api', 'customer_session', 'INSERT')
      AND has_table_privilege('api', 'customer_login_code', 'DELETE')
      AND has_table_privilege('api', 'tenant_member', 'SELECT')
      AND has_column_privilege('api', 'tenant', 'billing_name', 'UPDATE')),
    ('don_hang_payos', has_table_privilege('api', 'customer_order', 'INSERT')
      AND has_column_privilege('api', 'customer_order', 'status', 'UPDATE')
      AND has_table_privilege('api', 'payment_event', 'INSERT')
      AND has_sequence_privilege('api', 'customer_order_code_seq', 'USAGE')),
    ('cap_khoa', has_column_privilege('api', 'api_key', 'key_hash', 'INSERT')
      AND has_column_privilege('api', 'api_key', 'revoked_at', 'UPDATE')),
    ('xoa_tenant_chi_api', has_function_privilege('api', 'xoa_tenant_hoan_toan(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('pipeline', 'xoa_tenant_hoan_toan(uuid)', 'EXECUTE')),
    ('ham_m4_thuoc_pipeline', (SELECT count(*) = 3 FROM pg_proc WHERE pg_get_userbyid(proowner) = 'pipeline'
      AND oid IN ('stage_poi_create(bigint)'::regprocedure, 'apply_poi_edit(bigint, text, text)'::regprocedure,
        'reject_poi_edit(bigint, text)'::regprocedure))),
    ('nguong_tim_mo', EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole = 0
      AND setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND 'pg_trgm.word_similarity_threshold=0.5' = ANY (setconfig))),
    ('api_statement_timeout', EXISTS (SELECT 1 FROM pg_db_role_setting
      WHERE setrole = 'api'::regrole AND setdatabase = 0 AND 'statement_timeout=29s' = ANY (setconfig)))
  ) AS t(kiem, dat)`;
}

/**
 * Đọc output `psql -At -F '|'` của verifyRestoredDatabaseSql.
 * @param {string} text
 * @returns {{ kiem: string, dat: boolean }[]}
 */
export function docKetQuaPsql(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [kiem = '', dat = ''] = line.split('|');
      return { kiem, dat: dat === 't' };
    });
}

/**
 * Nhóm kiểm hỏng, theo thứ tự KIEM_RESTORE. Nhóm vắng mặt trong kết quả cũng là hỏng: psql lỗi hay
 * câu SQL đổi mà quên nhóm nào thì không được coi là xanh.
 * @param {{ kiem: string, dat: boolean }[]} rows
 * @returns {string[]}
 */
export function kiemRestoreHong(rows) {
  const dat = new Set(rows.filter((r) => r.dat).map((r) => r.kiem));
  return KIEM_RESTORE.filter((kiem) => !dat.has(kiem));
}
