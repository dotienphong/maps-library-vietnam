import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { priorityOrderSql } from './display-priority.mjs';
import { arg, POI_WORK } from './lib/env.mjs';
import { sourcesForProfile, tileVisibleSql } from './lib/poi-filter.mjs';
import { connect, readJsonl } from './pg.mjs';

/** @param {{primary_source?: unknown, created_by?: unknown}} row @param {string} profile */
export function snapshotRowIncluded(row, profile) {
  const sources = sourcesForProfile(profile);
  return row.created_by === 'user' || sources.includes(/** @type {any} */ (row.primary_source));
}

/** @param {unknown} value @param {string} expectedBuildId */
export function assertSnapshotMeta(value, expectedBuildId) {
  const meta = /** @type {any} */ (value);
  if (meta?.type !== 'mapslibvn-poi-snapshot' || meta.schema !== 1) {
    throw new Error('Snapshot thiếu metadata hoàn chỉnh');
  }
  if (meta.buildId !== expectedBuildId) {
    throw new Error(`Snapshot build id ${String(meta.buildId)} không khớp ${expectedBuildId}`);
  }
}

/** @param {string} file */
export async function sha256File(file) {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolveHash(hash.digest('hex')));
  });
}

/** @param {string} file @param {string} buildId */
export async function* readSnapshotRows(file, buildId) {
  const checksumFile = `${file}.sha256`;
  if (!existsSync(file) || !existsSync(checksumFile)) {
    throw new Error(`Snapshot chưa hoàn chỉnh: ${file}`);
  }
  const expected = readFileSync(checksumFile, 'utf8').trim();
  const actual = await sha256File(file);
  if (actual !== expected) throw new Error(`Snapshot checksum không khớp: ${file}`);
  let first = true;
  for await (const value of readJsonl(file)) {
    if (first) {
      assertSnapshotMeta(value, buildId);
      first = false;
      continue;
    }
    yield value;
  }
  if (first) throw new Error(`Snapshot rỗng: ${file}`);
}

if (process.argv[1]?.endsWith('export-snapshot.mjs')) {
  const buildId = arg('--build-id', undefined);
  if (!buildId || !/^[a-z0-9-]+$/i.test(buildId)) {
    throw new Error('Dùng: export-snapshot.mjs --build-id <id>');
  }
  mkdirSync(POI_WORK, { recursive: true });
  const file = resolve(POI_WORK, `snapshot-${buildId}.jsonl`);
  const temp = `${file}.partial`;
  const checksumTemp = `${file}.sha256.partial`;
  if (existsSync(file) || existsSync(`${file}.sha256`)) {
    throw new Error(`Snapshot build id đã tồn tại: ${buildId}`);
  }
  const sql = connect();
  let rowsWritten = 0;
  try {
    async function* lines() {
      yield `${JSON.stringify({ type: 'mapslibvn-poi-snapshot', schema: 1, buildId })}\n`;
      const query = `SELECT p.id, p.name, p.category AS cat, c.group_code AS grp,
          c.rank, p.popularity, p.quality_score,
          p.primary_source, p.created_by,
          ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat
        FROM poi p
        JOIN category c ON c.code = p.category
        WHERE p.status = 'active' AND ${tileVisibleSql()}
        ORDER BY ${priorityOrderSql}`;
      for await (const rows of sql.unsafe(query).cursor(5000)) {
        for (const row of rows) {
          rowsWritten++;
          yield `${JSON.stringify(row)}\n`;
        }
      }
    }
    await pipeline(Readable.from(lines()), createWriteStream(temp, { flags: 'wx' }));
  } finally {
    await sql.end();
  }
  const sha256 = await sha256File(temp);
  renameSync(temp, file);
  writeFileSync(checksumTemp, `${sha256}\n`, { flag: 'wx' });
  renameSync(checksumTemp, `${file}.sha256`);
  console.log(JSON.stringify({ snapshot: basename(file), buildId, sha256, rows: rowsWritten }));
}
