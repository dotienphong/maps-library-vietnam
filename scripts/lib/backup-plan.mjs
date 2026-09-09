/** @param {Date} d tên theo giờ VN */
export function backupName(d) {
  const vn = new Date(d.getTime() + 7 * 3600 * 1000).toISOString();
  return `mapslibvn-${vn.slice(0, 10).replace(/-/g, '')}-${vn.slice(11, 16).replace(':', '')}.dump.zst`;
}

/**
 * @param {{ daily: string[], weekly: string[] }} existing tên file trong backups/daily và backups/weekly
 * @param {{ keepDaily: number, keepWeekly: number }} keep
 */
export function retentionPlan(existing, keep) {
  const oldest = (/** @type {string[]} */ names, /** @type {number} */ n) => {
    const sorted = [...names].sort();
    return sorted.slice(0, Math.max(0, sorted.length - n));
  };
  return {
    deleteDaily: oldest(existing.daily, keep.keepDaily),
    deleteWeekly: oldest(existing.weekly, keep.keepWeekly),
  };
}

/** Tên object mã hoá trên R2. @param {string} name */
export const encryptedName = (name) => `${name}.enc`;

/** Bỏ hậu tố .enc (nếu có) để lấy tên .dump.zst. @param {string} name */
export const plainName = (name) => name.replace(/\.enc$/, '');

/**
 * Lệnh sh tạo dump đã mã hoá. Audit 09/09/2026: dump plaintext trong bucket có custom domain
 * tải được công khai; từ nay object trên R2 luôn là AES-256 (PBKDF2 600k vòng) — lộ bucket không
 * còn đồng nghĩa lộ `api_key`/`tenant`/`poi_edit`. Passphrase đi qua env, không nằm trong argv.
 * @param {string} outFile đường dẫn file .dump.zst.enc
 */
export function dumpCommand(outFile) {
  return `pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL" | zstd -T0 -3 -q | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -out "${outFile}"`;
}

/** Lệnh sh giải mã file .enc về .dump.zst. @param {string} encFile @param {string} outFile */
export function decryptCommand(encFile, outFile) {
  return `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in "${encFile}" -out "${outFile}"`;
}

/**
 * Thiếu passphrase thì dừng: từ chối backup còn hơn upload dump không mã hoá.
 * @param {Record<string, string | undefined>} env
 */
export function requireBackupPassphrase(env) {
  const value = env.BACKUP_PASSPHRASE ?? '';
  if (!value)
    throw new Error('Thiếu BACKUP_PASSPHRASE (infra/server/.env) — không backup dump không mã hoá');
  if (value.length < 32) throw new Error('BACKUP_PASSPHRASE phải dài ≥ 32 ký tự');
  return value;
}

/**
 * Bucket chứa backup. Phải là bucket RIÊNG không gắn custom domain (mặc định `mapslibvn-backups`);
 * thiếu BACKUP_BUCKET thì tạm dùng bucket tiles và báo `shared` để log cảnh báo.
 * @param {Record<string, string | undefined>} env
 */
export function backupBucket(env) {
  if (env.BACKUP_BUCKET) return { bucket: env.BACKUP_BUCKET, shared: false };
  return { bucket: env.R2_BUCKET ?? 'mapslibvn-tiles', shared: true };
}
