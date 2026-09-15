export function initializeLedger(storage: DurableObjectStorage): void {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS entitlement (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL,
      tier TEXT,
      revision INTEGER NOT NULL,
      trial_started_at INTEGER,
      trial_ends_at INTEGER,
      trial_used_once INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS period (
      period_id TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      places_limit INTEGER NOT NULL CHECK (places_limit >= 0),
      directions_limit INTEGER NOT NULL CHECK (directions_limit >= 0),
      payment_reference TEXT,
      line_item_id TEXT
    );
    CREATE INDEX IF NOT EXISTS period_window ON period(starts_at, ends_at);
    CREATE TABLE IF NOT EXISTS counter (
      source_id TEXT NOT NULL,
      group_name TEXT NOT NULL,
      day_key TEXT NOT NULL DEFAULT '',
      used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
      PRIMARY KEY(source_id, group_name, day_key)
    );
    CREATE TABLE IF NOT EXISTS credit_grant (
      grant_id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL,
      group_name TEXT NOT NULL,
      units INTEGER NOT NULL CHECK (units > 0),
      used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
      expires_at INTEGER NOT NULL,
      payment_reference TEXT NOT NULL,
      line_item_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS credit_available ON credit_grant(period_id, group_name, expires_at);
    CREATE TABLE IF NOT EXISTS reservation (
      request_id TEXT PRIMARY KEY,
      group_name TEXT NOT NULL,
      key_hash TEXT,
      state TEXT NOT NULL CHECK (state IN ('reserved','awaiting_ack','committed','released','expired','compensated')),
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      day_key TEXT NOT NULL DEFAULT '',
      token_hash TEXT,
      deadline INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      close_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS reservation_deadline ON reservation(state, deadline);
    CREATE INDEX IF NOT EXISTS reservation_closed ON reservation(state, updated_at);
    CREATE TABLE IF NOT EXISTS missed_ack (
      request_id TEXT PRIMARY KEY,
      expired_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS missed_ack_window ON missed_ack(expired_at);
    CREATE TABLE IF NOT EXISTS entitlement_event (
      operation_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL,
      revision INTEGER NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS business_identity (
      payment_reference TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      PRIMARY KEY(payment_reference, line_item_id)
    );
    CREATE TABLE IF NOT EXISTS operational_command (
      operation_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revoked_key (
      key_hash TEXT PRIMARY KEY,
      revoked_at INTEGER NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_sequence INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 1,
      maintenance INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS journal (
      seq INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS export_checkpoint (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      sequence INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      exported_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshot_manifest (
      snapshot_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      pages INTEGER NOT NULL,
      records INTEGER NOT NULL,
      checksum TEXT,
      actor TEXT NOT NULL,
      taken_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshot_page (
      snapshot_id TEXT NOT NULL,
      page_index INTEGER NOT NULL,
      records TEXT NOT NULL,
      checksum TEXT,
      PRIMARY KEY(snapshot_id, page_index)
    );
  `);
}

/**
 * Bảng của sổ cái được ĐƯA VÀO BẢN SAO LƯU, theo thứ tự nạp lại.
 *
 * `reservation` phải nằm sau `counter`/`credit_grant` vì nạp lại một receipt còn treo cần nguồn
 * lượt đã tồn tại. `journal` và `snapshot_*` KHÔNG có ở đây: journal là đuôi ghi riêng sau
 * snapshot, còn snapshot_* là vùng dựng tạm của chính lần xuất đang chạy.
 */
export const SNAPSHOT_TABLES = [
  'entitlement',
  'period',
  'counter',
  'credit_grant',
  'reservation',
  'missed_ack',
  'entitlement_event',
  'business_identity',
  'operational_command',
  'revoked_key',
  'export_checkpoint',
] as const;

export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];
