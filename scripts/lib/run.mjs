import { execFileSync } from 'node:child_process';
import crossSpawn from 'cross-spawn';

/**
 * @param {string} cmd @param {string[]} args
 * @param {{ status: number | null, signal: NodeJS.Signals | null }} result
 */
export function runFailure(cmd, args, result) {
  const command = `${cmd} ${args.join(' ')}`;
  return result.signal
    ? `${command} bị kết thúc bởi ${result.signal}`
    : `${command} thoát mã ${result.status}`;
}

/**
 * Chạy lệnh, in output ra màn hình, ném lỗi nếu exit != 0.
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [opts]
 */
export function run(cmd, args, opts = {}) {
  const result = crossSpawn.sync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(runFailure(cmd, args, result));
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
