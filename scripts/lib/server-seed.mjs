import { resolve, sep } from 'node:path';

/** @param {string} path */
const toPosixPath = (path) => path.split(sep).join('/');

export const SERVER_SEED_REQUIRED_ENV = ['POSTGRES_SUPER_PASSWORD'];

/** @param {Record<string, string | undefined>} env */
export function missingServerSeedEnv(env) {
  return SERVER_SEED_REQUIRED_ENV.filter((name) => !env[name]?.trim());
}

/**
 * Lệnh nạp một file seed lên DB máy chủ bằng service `pipeline`.
 *
 * Giữ nguyên ba ràng buộc của `serverMigrateRun`, vì đây cũng là lệnh chạm DB production:
 *
 * 1. `--no-deps` — `compose run` trần sẽ reconcile và có thể RECREATE container `postgres` đang
 *    phục vụ khi cấu hình đã trôi, tức restart DB production giữa giờ.
 * 2. Mật khẩu siêu người dùng đi qua `env`, KHÔNG nằm trên dòng lệnh: `run()` ném Error chứa toàn
 *    bộ argv, nên seed lỗi sẽ in mật khẩu ra terminal rồi vào log dán vào evidence.
 * 3. Mount `db/` của working tree đè lên image — image có thể cũ hơn repo, và seed vừa viết xong
 *    thì chắc chắn chưa có trong image.
 *
 * @param {Record<string, string | undefined>} env nội dung infra/server/.env đã parse
 * @param {string[]} files đường dẫn seed tương đối gốc repo, ví dụ `db/seed/tenant_x.sql`
 */
export function serverSeedRun(env, files) {
  return serverNodeRun(env, 'scripts/db-seed-tenant.mjs', files, { seedCheck: true });
}

/**
 * Chạy một script Node của repo bên trong container `pipeline`, nối tới DB máy chủ bằng quyền
 * siêu người dùng. Mount cả `db/` lẫn `scripts/` của working tree đè lên image: image có thể cũ
 * hơn repo, và script vừa viết xong thì chắc chắn chưa có trong image.
 * @param {Record<string, string | undefined>} env
 * @param {string} script đường dẫn script trong repo, ví dụ `scripts/db-seed-tenant.mjs`
 * @param {string[]} [argv] tham số chuyển tiếp
 * @param {{seedCheck?: boolean}} [options]
 */
export function serverNodeRun(env, script, argv = [], options = {}) {
  const missing = missingServerSeedEnv(env);
  if (missing.length > 0) {
    throw new Error(`Thiếu biến bắt buộc trong infra/server/.env: ${missing.join(', ')}`);
  }
  if (options.seedCheck) {
    if (argv.length === 0) throw new Error('Phải chỉ rõ ít nhất một file seed');
    // Chỉ nhận seed nằm trong db/: thư mục này là thứ được mount vào container, đường dẫn khác sẽ
    // không tồn tại bên trong và lỗi sẽ khó hiểu.
    const outside = argv.filter((file) => !toPosixPath(file).startsWith('db/'));
    if (outside.length > 0) {
      throw new Error(`Seed phải nằm trong db/: ${outside.join(', ')}`);
    }
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
      '-v',
      `${toPosixPath(resolve('db'))}:/app/db:ro`,
      '-v',
      `${toPosixPath(resolve('scripts'))}:/app/scripts:ro`,
      '-e',
      'POSTGRES_USER',
      '-e',
      'POSTGRES_PASSWORD',
      'pipeline',
      'node',
      script,
      ...argv.map(toPosixPath),
    ],
    env: {
      ...process.env,
      ...env,
      POSTGRES_USER: 'mapslibvn',
      POSTGRES_PASSWORD: env.POSTGRES_SUPER_PASSWORD ?? '',
    },
  };
}
