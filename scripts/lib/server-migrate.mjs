import { resolve, sep } from 'node:path';

/** @param {string} path */
const toPosixPath = (path) => path.split(sep).join('/');

export const SERVER_MIGRATE_REQUIRED_ENV = ['POSTGRES_SUPER_PASSWORD'];

/**
 * Biến bắt buộc còn thiếu trong infra/server/.env.
 * @param {Record<string, string | undefined>} env
 */
export function missingServerMigrateEnv(env) {
  return SERVER_MIGRATE_REQUIRED_ENV.filter((name) => !env[name]?.trim());
}

/**
 * Lệnh áp migration lên DB máy chủ bằng service `pipeline`, KHÔNG chạm container postgres.
 *
 * Ba điểm phải giữ, mỗi điểm là một sự cố đã gặp hoặc một rủi ro đã đo:
 *
 * 1. `--no-deps`. `pipeline` khai báo `depends_on: postgres: condition: service_healthy`, nên
 *    `compose run` trần sẽ reconcile cả `postgres` và RECREATE nó khi cấu hình đã trôi (đổi
 *    PG_SHARED_BUFFERS trong .env, `git pull` mang compose.yml mới, image postgis có digest mới).
 *    Đúng lúc lệnh này được dùng — áp migration TRƯỚC khi deploy Worker — thì đó là restart DB
 *    production giữa giờ phục vụ: Hyperdrive mất kết nối và API trả 5xx.
 *
 * 2. Mật khẩu KHÔNG nằm trên dòng lệnh. `run()` ném `Error` có nội dung là toàn bộ argv
 *    (scripts/lib/run.mjs), nên `-e POSTGRES_PASSWORD=<secret>` sẽ in mật khẩu superuser ra
 *    terminal đúng vào ca hay gặp nhất của lệnh này là migration lỗi — rồi đi tiếp vào log dán
 *    vào DEVLOG/evidence. Truyền tên biến, giá trị đi qua `env` (mẫu của serverRestoreRun).
 *
 * 3. Tham số được chuyển tiếp. `db-migrate.mjs` có `--down` để revert một migration; trước đây
 *    wrapper nuốt argv nên `pnpm server:migrate -- --down` chạy migrate xuôi rồi vẫn in
 *    `✔ server:migrate xong`, khiến người vận hành tin là đã rollback.
 *
 * @param {Record<string, string | undefined>} env nội dung infra/server/.env đã parse
 * @param {string[]} argv tham số chuyển tiếp cho scripts/db-migrate.mjs
 * @param {{ mountDb?: boolean }} [opts] mountDb=false: dùng migration có sẵn trong image — server:update
 *   đã xác nhận image khớp HEAD (image-khop-repo.mjs), mount cây làm việc chỉ thêm được file chưa commit.
 */
export function serverMigrateRun(env, argv = [], { mountDb = true } = {}) {
  const missing = missingServerMigrateEnv(env);
  if (missing.length > 0) {
    throw new Error(`Thiếu biến bắt buộc trong infra/server/.env: ${missing.join(', ')}`);
  }
  const dir = resolve('infra/server');
  return {
    command: 'docker',
    args: [
      'compose',
      '--env-file',
      toPosixPath(resolve(dir, '.env')),
      '-f',
      toPosixPath(resolve(dir, 'compose.yml')),
      'run',
      '--rm',
      '--no-deps',
      ...(mountDb ? ['-v', `${toPosixPath(resolve('db'))}:/app/db:ro`] : []),
      '-e',
      'POSTGRES_USER',
      '-e',
      'POSTGRES_PASSWORD',
      'pipeline',
      'node',
      'scripts/db-migrate.mjs',
      ...argv,
    ],
    env: {
      ...process.env,
      ...env,
      POSTGRES_USER: 'mapslibvn',
      POSTGRES_PASSWORD: env.POSTGRES_SUPER_PASSWORD ?? '',
    },
  };
}
