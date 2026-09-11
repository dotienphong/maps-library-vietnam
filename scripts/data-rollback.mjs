#!/usr/bin/env node
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { run } from './lib/run.mjs';

/** @param {unknown} value */
export function rollbackTarget(value) {
  const manifest = /** @type {any} */ (value);
  const target = Array.isArray(manifest?.history) ? manifest.history[0] : undefined;
  if (!target || typeof target !== 'object') throw new Error('Không có bản trước để rollback');
  return target;
}

/**
 * @param {{ vn?: string | null, poi?: string | null, poiProfiles?: Record<string, string | null> }} target
 * @param {Set<string>} listed
 * @param {(checksumName: string) => string} readChecksum
 */
export function verifyRollbackArchives(target, listed, readChecksum) {
  const releases = [
    ...new Set([target.vn, target.poi, ...Object.values(target.poiProfiles ?? {})]),
  ].filter((release) => typeof release === 'string' && release.length > 0);
  return releases.map((release) => {
    const archiveName = `${release}.pmtiles`;
    const checksumName = `${archiveName}.sha256`;
    if (!listed.has(archiveName) || !listed.has(checksumName)) {
      throw new Error(`Rollback target ${release} thiếu archive hoặc checksum trên R2`);
    }
    const sha256 = readChecksum(checksumName).trim();
    if (!/^[a-f0-9]{64}$/i.test(sha256)) {
      throw new Error(`Rollback target ${release} có checksum SHA-256 không hợp lệ`);
    }
    return { release, sha256: sha256.toLowerCase() };
  });
}

/**
 * @param {unknown} status
 * @param {string} currentVn
 * @param {string} targetVn
 */
export function verifyRoutingRollbackTarget(status, currentVn, targetVn) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    throw new Error('graph release identity không khả dụng');
  }
  const graph = /** @type {Record<string, any>} */ (status);
  if (graph.activeGraph?.vnRelease !== currentVn || graph.previousGraph?.vnRelease !== targetVn) {
    throw new Error(
      `graph vnRelease không khớp rollback ${currentVn} → ${targetVn}; từ chối toggle graph`,
    );
  }
}

/** @param {string[]} argv */
export function parseRollbackArgs(argv) {
  if (argv.length === 0) return { skipRouting: false };
  if (argv.length === 1 && argv[0] === '--skip-routing') return { skipRouting: true };
  throw new Error('Dùng: data-rollback.mjs [--skip-routing]');
}

/**
 * Xác minh toàn bộ target/R2 trước mọi mutation; sau đó graph rollback luôn đi trước manifest rollback.
 * @param {{ manifest: unknown, listed: Set<string>, readChecksum: (name: string) => string,
 *   graphDirExists: boolean, skipRouting: boolean, readGraphStatus?: () => unknown,
 *   runCommand: (cmd: string, args: string[]) => void }} input
 */
export function executeRollback(input) {
  const manifest = /** @type {any} */ (input.manifest);
  const target = rollbackTarget(input.manifest);
  const verified = verifyRollbackArchives(target, input.listed, input.readChecksum);
  const currentVn = manifest.current?.vn;
  const targetVn = target.vn;
  const vnChanged = currentVn !== targetVn;
  if (!input.skipRouting && vnChanged) {
    if (!input.graphDirExists || typeof input.readGraphStatus !== 'function') {
      throw new Error(
        `graph release identity không khả dụng cho rollback ${String(currentVn)} → ${String(targetVn)}; dùng --skip-routing nếu chủ ý bỏ qua`,
      );
    }
    if (typeof currentVn !== 'string' || typeof targetVn !== 'string') {
      throw new Error('manifest thiếu VN release identity để rollback graph an toàn');
    }
    verifyRoutingRollbackTarget(input.readGraphStatus(), currentVn, targetVn);
    input.runCommand('node', [
      'scripts/routing-graph.mjs',
      'rollback',
      '--expected-current',
      currentVn,
      '--expected-target',
      targetVn,
    ]);
  }
  input.runCommand('node', ['pipelines/tiles/src/manifest.mjs', 'rollback']);
  return verified;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string[]} [argv]
 */
export function rollbackCommand(env, argv = []) {
  parseRollbackArgs(argv);
  if (env.MAPSLIBVN_IN_CONTAINER === '1') {
    return {
      cmd: 'node',
      args: ['pipelines/tiles/src/manifest.mjs', 'rollback'],
    };
  }

  return {
    cmd: 'docker',
    args: [
      'compose',
      '--env-file',
      '.env',
      '-f',
      'infra/dev/compose.yml',
      '--profile',
      'pipeline',
      'run',
      '--rm',
      'pipeline',
      'node',
      'scripts/data-rollback.mjs',
      ...argv,
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseRollbackArgs(process.argv.slice(2));
  if (process.env.MAPSLIBVN_IN_CONTAINER !== '1') {
    const { cmd, args } = rollbackCommand(process.env, process.argv.slice(2));
    run(cmd, args);
  } else {
    // Preflight R2/history/archive hoàn tất trước mutation; retry --skip-routing chỉ commit manifest.
    const graphDir = process.env.MAPSLIBVN_VALHALLA ?? '/app/valhalla';
    const bucket = process.env.R2_BUCKET;
    if (!bucket) throw new Error('Thiếu R2_BUCKET để xác minh rollback');
    const manifest = JSON.parse(
      execFileSync('node', ['pipelines/tiles/src/manifest.mjs', 'get'], { encoding: 'utf8' }),
    );
    const remoteDir = `r2:${bucket}/tiles`;
    const listed = new Set(
      execFileSync('rclone', ['lsf', remoteDir, '--files-only'], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean),
    );
    const verified = executeRollback({
      manifest,
      listed,
      readChecksum: (checksumName) =>
        execFileSync('rclone', ['cat', `${remoteDir}/${checksumName}`], { encoding: 'utf8' }),
      graphDirExists: existsSync(graphDir),
      skipRouting: options.skipRouting,
      readGraphStatus: () => {
        // Lần đầu cho phép status recovery journal và in chẩn đoán; lần hai lấy JSON sạch.
        execFileSync('node', ['scripts/routing-graph.mjs', 'status'], { stdio: 'inherit' });
        return JSON.parse(
          execFileSync('node', ['scripts/routing-graph.mjs', 'status'], { encoding: 'utf8' }),
        );
      },
      runCommand: run,
    });
    console.log(`✓ rollback target đã xác minh: ${JSON.stringify(verified)}`);
  }
}
