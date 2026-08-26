import { execFileSync, spawnSync } from 'node:child_process';

/**
 * Chạy lệnh, in output ra màn hình, ném lỗi nếu exit != 0.
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [opts]
 */
export function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} thoát mã ${result.status}`);
}

/**
 * Chạy lệnh và trả stdout (chuỗi rỗng nếu lỗi).
 * @param {string} cmd
 * @param {string[]} args
 */
export function capture(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
