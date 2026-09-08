#!/usr/bin/env node
// Dùng: node upload.mjs <release> — đẩy PMTiles và assets bất biến lên R2.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/run.mjs';
import { assertPoiArchiveSize, immutableUploadAction } from './lib/archive-guard.mjs';
import { OUT, requireEnv } from './lib/env.mjs';

const release = process.argv[2];
if (!release) throw new Error('Dùng: node upload.mjs <release>');

const bucket = requireEnv('R2_BUCKET');
requireEnv('RCLONE_CONFIG_R2_ACCESS_KEY_ID');
requireEnv('RCLONE_CONFIG_R2_SECRET_ACCESS_KEY');
requireEnv('RCLONE_CONFIG_R2_ENDPOINT');
requireEnv('RCLONE_CONFIG_R2_NO_CHECK_BUCKET');

const file = resolve(OUT, `${release}.pmtiles`);
if (!existsSync(file)) throw new Error(`Không thấy ${file}`);

assertPoiArchiveSize(release, statSync(file).size);

const remoteDir = `r2:${bucket}/tiles`;
const archiveName = `${release}.pmtiles`;
const checksumName = `${archiveName}.sha256`;
let action = /** @type {'upload' | 'reuse'} */ ('upload');
/** @type {string | undefined} */
let sha256;
if (release.startsWith('poi-')) {
  sha256 = await new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolveHash(hash.digest('hex')));
  });
  const listed = execFileSync('rclone', ['lsf', remoteDir, '--files-only'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
    .split(/\r?\n/)
    .filter(Boolean);
  const archiveExists = listed.includes(archiveName);
  const checksumExists = listed.includes(checksumName);
  const remoteSha256 = checksumExists
    ? execFileSync('rclone', ['cat', `${remoteDir}/${checksumName}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      }).trim()
    : undefined;
  action = immutableUploadAction({
    archiveExists,
    checksumExists,
    localSha256: /** @type {string} */ (sha256),
    ...(remoteSha256 === undefined ? {} : { remoteSha256 }),
  });
}

if (action === 'upload') {
  run('rclone', [
    'copyto',
    file,
    `${remoteDir}/${archiveName}`,
    '--s3-chunk-size',
    '64M',
    '--s3-upload-concurrency',
    '8',
    '--progress',
  ]);
  if (sha256) {
    execFileSync('rclone', ['rcat', `${remoteDir}/${checksumName}`], {
      input: `${sha256}\n`,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
  }
} else {
  console.log(`= giữ nguyên ${archiveName}: checksum trùng`);
}

const assets = resolve('packages/style/assets');
if (!existsSync(resolve(assets, 'fonts/Noto Sans Regular/0-255.pbf'))) {
  run('node', ['packages/style/scripts/vendor.mjs', 'fonts']);
}
run('rclone', [
  'copy',
  assets,
  `r2:${bucket}/assets`,
  '--checksum',
  '--header-upload',
  'Cache-Control: public, max-age=31536000, immutable',
]);

console.log(`✓ upload ${release} + assets`);
