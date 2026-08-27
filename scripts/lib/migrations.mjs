const MIGRATION_FILE = /^\d{4}_.+\.sql$/;
const DOWN_FILE = /\.down\.sql$/;

/**
 * @param {string[]} applied tên migration đã áp dụng
 * @param {string[]} files tên file trong db/migrations
 * @returns {string[]} migration cần chạy, theo thứ tự (bỏ qua file .down.sql)
 */
export function pendingMigrations(applied, files) {
  const done = new Set(applied);
  return [...files]
    .filter((file) => MIGRATION_FILE.test(file) && !DOWN_FILE.test(file) && !done.has(file))
    .sort();
}

/** @param {string[]} applied @returns {string | null} */
export function lastApplied(applied) {
  return applied.length ? ([...applied].sort().at(-1) ?? null) : null;
}

/** @param {string} name */
export function downFileFor(name) {
  return name.replace(/\.sql$/, '.down.sql');
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function databaseUrlFromEnv(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const user = env.POSTGRES_USER ?? 'mapslibvn';
  const password = env.POSTGRES_PASSWORD ?? 'mapslibvn';
  const host = env.POSTGRES_HOST ?? 'localhost';
  const port = env.POSTGRES_PORT ?? '5432';
  const database = env.POSTGRES_DB ?? 'mapslibvn';
  // Máy chủ: pg_hba từ chối kết nối không TLS; client `postgres` mặc định không dùng TLS
  const ssl = env.POSTGRES_SSL === 'require' ? '?sslmode=require' : '';
  return `postgres://${user}:${password}@${host}:${port}/${database}${ssl}`;
}
