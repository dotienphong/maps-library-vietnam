const MIGRATION_FILE = /^\d{4}_.+\.sql$/;

/**
 * @param {string[]} applied tên migration đã áp dụng
 * @param {string[]} files tên file trong db/migrations
 * @returns {string[]} migration cần chạy, theo thứ tự
 */
export function pendingMigrations(applied, files) {
  const done = new Set(applied);
  return [...files].filter((file) => MIGRATION_FILE.test(file) && !done.has(file)).sort();
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
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
}
