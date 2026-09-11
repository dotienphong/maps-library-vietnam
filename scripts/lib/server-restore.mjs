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

export function verifyRestoredDatabaseSql() {
  return `SELECT
    ((SELECT count(*) FROM schema_migrations) > 0 AND (SELECT count(*) FROM poi) > 0) AS data_ok,
    (SELECT tableowner = 'pipeline' FROM pg_tables WHERE schemaname = 'public' AND tablename = 'poi') AS poi_owner_ok,
    has_table_privilege('api', 'poi', 'SELECT') AS api_select_ok,
    NOT has_table_privilege('api', 'poi', 'INSERT, UPDATE, DELETE') AS api_write_blocked;`;
}
