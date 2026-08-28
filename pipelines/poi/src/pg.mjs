import 'dotenv/config';
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import postgres from 'postgres';
import { databaseUrlFromEnv } from '../../../scripts/lib/migrations.mjs';
import { copyRow } from './lib/copy-format.mjs';
import { VN_BOUNDARY } from './lib/env.mjs';

/** @typedef {import('postgres').Sql} Sql */
/** @typedef {import('postgres').TransactionSql} Tx */

export function connect() {
  // work_mem cao cho session pipeline: sort/hash của poi_work_pair (hàng chục triệu dòng) không tràn đĩa với 32MB mặc định
  return postgres(databaseUrlFromEnv(process.env), {
    max: 4,
    onnotice: () => {},
    idle_timeout: 60,
    connect_timeout: 30,
    connection: { work_mem: '512MB' },
  });
}

/**
 * Tạo bảng <name>_new giống <name> (INCLUDING ALL: cột, default, CHECK, index; KHÔNG copy FK — bảng thật giữ FK).
 * @param {Sql} sql @param {string} name
 */
export async function createNewTable(sql, name) {
  await sql.unsafe(`DROP TABLE IF EXISTS ${name}_new`);
  await sql.unsafe(`CREATE TABLE ${name}_new (LIKE ${name} INCLUDING ALL)`);
}

/**
 * COPY … FROM STDIN từ một (async) iterable các mảng giá trị. Trả số dòng.
 * @param {Sql} sql @param {string} table @param {string[]} columns
 * @param {AsyncIterable<unknown[]> | Iterable<unknown[]>} rows
 */
export async function copyInto(sql, table, columns, rows) {
  let n = 0;
  const writable = await sql`COPY ${sql(table)} (${sql(columns)}) FROM STDIN`.writable();
  async function* chunks() {
    for await (const r of rows) {
      n++;
      yield copyRow(r);
    }
  }
  await pipeline(Readable.from(chunks()), writable);
  return n;
}

/** Đọc JSONL (hoặc .jsonl.gz) từng dòng. Bỏ ký tự RS (mã 30, GeoJSON Text Sequence) nếu đứng đầu dòng. @param {string} file */
export async function* readJsonl(file) {
  const raw = createReadStream(file);
  const rl = createInterface({
    input: file.endsWith('.gz') ? raw.pipe(createGunzip()) : raw,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const raw of rl) {
    const line = (raw.charCodeAt(0) === 30 ? raw.slice(1) : raw).trim();
    if (line) yield JSON.parse(line);
  }
}

/**
 * Phát hành: trong MỘT transaction TRUNCATE các bảng (một câu — thoả FK), INSERT … SELECT từ <name>_new,
 * chỉnh sequence, DROP <name>_new. Bảng thật giữ nguyên identity (FK, index, grant); dữ liệu cũ vẫn phục vụ cho đến COMMIT.
 * @param {Sql} sql @param {string[]} names theo thứ tự: bảng cha trước
 */
export async function publishNew(sql, names) {
  await sql.begin(async (/** @type {Tx} */ tx) => {
    await tx.unsafe(`TRUNCATE ${names.join(', ')}`);
    for (const name of names) {
      await tx.unsafe(`INSERT INTO ${name} SELECT * FROM ${name}_new`);
      // pg_get_serial_sequence NÉM LỖI (không trả NULL) khi bảng không có cột id — src_*, admin_alias. Kiểm cột trước.
      const [col] = await tx.unsafe(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${name}' AND column_name = 'id'`,
      );
      if (col) {
        const [seq] = await tx.unsafe(`SELECT pg_get_serial_sequence('${name}', 'id') AS s`);
        if (seq?.s) {
          await tx.unsafe(
            `SELECT setval('${seq.s}', COALESCE((SELECT max(id) FROM ${name}), 0) + 1, false)`,
          );
        }
      }
      await tx.unsafe(`DROP TABLE ${name}_new`);
    }
  });
}

/** Bảng phụ vn_boundary (đa giác VN đệm 2 km, chia nhỏ) — tạo một lần từ data/vn-boundary.geojson. @param {Sql} sql */
export async function ensureVnBoundary(sql) {
  await sql.unsafe(
    'CREATE TABLE IF NOT EXISTS vn_boundary (id serial PRIMARY KEY, geom geometry(Polygon, 4326) NOT NULL)',
  );
  await sql.unsafe(
    'CREATE INDEX IF NOT EXISTS vn_boundary_geom_idx ON vn_boundary USING gist (geom)',
  );
  const [row] = await sql`SELECT count(*)::int AS n FROM vn_boundary`;
  if (Number(row?.n ?? 0) > 0) return;
  const geometry = JSON.stringify(JSON.parse(readFileSync(VN_BOUNDARY, 'utf8')).geometry);
  await sql`INSERT INTO vn_boundary (geom)
    SELECT ST_Subdivide(ST_Buffer(ST_GeomFromGeoJSON(${geometry})::geography, 2000)::geometry, 256)`;
}

/** Xoá bản ghi ngoài VN (đệm 2 km). Trả số dòng xoá. @param {Sql} sql @param {string} table */
export async function deleteOutsideVn(sql, table) {
  const r = await sql.unsafe(
    `DELETE FROM ${table} t WHERE NOT EXISTS (SELECT 1 FROM vn_boundary b WHERE ST_Intersects(b.geom, t.geom))`,
  );
  return r.count;
}

/** @param {Sql} sql @param {string} table */
export async function countRows(sql, table) {
  const [row] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`);
  return Number(row?.n ?? 0);
}
