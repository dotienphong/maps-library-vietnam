/** @param {string} versionString ví dụ "v22.11.0" */
export function checkNodeVersion(versionString, min = 22) {
  const major = Number(versionString.replace(/^v/, '').split('.')[0]);
  return { ok: Number.isFinite(major) && major >= min, major };
}

/** @param {string} output output của `docker --version` */
export function parseDockerVersion(output) {
  const match = /Docker version (\d+)\.(\d+)/.exec(output);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

/** @param {number} totalMs @param {number} intervalMs */
export function waitPlan(totalMs, intervalMs) {
  return { attempts: Math.ceil(totalMs / intervalMs), intervalMs };
}

/**
 * PostGIS entrypoint chạy một Postgres tạm khi init rồi restart. Chỉ server cuối
 * cùng mới có tiến trình chính (PID 1) là `postgres`.
 * @param {string} pidOneCommand nội dung `/proc/1/comm` trong container
 * @param {string} pgIsReadyOutput output của `pg_isready`
 */
export function isPostgresReady(pidOneCommand, pgIsReadyOutput) {
  return pidOneCommand.trim() === 'postgres' && pgIsReadyOutput.includes('accepting connections');
}
