#!/usr/bin/env node
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
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
 * @param {{ poi?: string | null, poiProfiles?: { osm?: string | null } }} target
 * @param {Set<string>} listed
 * @param {(checksumName: string) => string} readChecksum
 */
export function verifyRollbackArchives(target, listed, readChecksum) {
  const releases = [target.poi, target.poiProfiles?.osm].filter(
    (release) => typeof release === 'string' && release.length > 0,
  );
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

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
export function rollbackCommand(env) {
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
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.MAPSLIBVN_IN_CONTAINER !== '1') {
    const { cmd, args } = rollbackCommand(process.env);
    run(cmd, args);
  } else {
    const bucket = process.env.R2_BUCKET;
    if (!bucket) throw new Error('Thiếu R2_BUCKET để xác minh rollback');
    const manifest = JSON.parse(
      execFileSync('node', ['pipelines/tiles/src/manifest.mjs', 'get'], { encoding: 'utf8' }),
    );
    const target = rollbackTarget(manifest);
    const remoteDir = `r2:${bucket}/tiles`;
    const listed = new Set(
      execFileSync('rclone', ['lsf', remoteDir, '--files-only'], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean),
    );
    const verified = verifyRollbackArchives(target, listed, (checksumName) =>
      execFileSync('rclone', ['cat', `${remoteDir}/${checksumName}`], { encoding: 'utf8' }),
    );
    console.log(`✓ rollback target đã xác minh: ${JSON.stringify(verified)}`);
    run('node', ['pipelines/tiles/src/manifest.mjs', 'rollback']);
  }
}
