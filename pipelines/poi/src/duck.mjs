import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { POI_WORK } from './lib/env.mjs';

/** Mở DuckDB in-memory có spatial + httpfs, giới hạn RAM (mặc định 3GB), tạm trong work/poi/duck-tmp. */
export async function openDuck({
  memory = process.env.DUCKDB_MEMORY ?? '3GB',
  threads = process.env.DUCKDB_THREADS ?? '4',
} = {}) {
  const tmp = resolve(POI_WORK, 'duck-tmp');
  mkdirSync(tmp, { recursive: true });
  const instance = await DuckDBInstance.create(':memory:', {
    memory_limit: memory,
    threads: String(threads),
    temp_directory: tmp,
  });
  const conn = await instance.connect();
  await conn.run('INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;');
  return {
    /** @param {string} sql */
    run: (sql) => conn.run(sql),
    /** Kết quả nhỏ (đếm, DESCRIBE). BigInt → Number. @param {string} sql */
    all: async (sql) => {
      const reader = await conn.runAndReadAll(sql);
      return reader
        .getRowObjects()
        .map((r) =>
          Object.fromEntries(
            Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]),
          ),
        );
    },
    /** Dataset gated trên Hugging Face (FSQ). Cần HF_TOKEN; bỏ qua khi --fixture (đọc file local). */
    huggingface: () => {
      const token = process.env.HF_TOKEN;
      if (!token) {
        if (process.argv.includes('--fixture')) return Promise.resolve();
        throw new Error(
          'Thiếu HF_TOKEN (token Read của Hugging Face, đã chấp nhận điều khoản foursquare/fsq-os-places)',
        );
      }
      return conn.run(
        `CREATE OR REPLACE SECRET hf (TYPE huggingface, TOKEN '${token.replace(/'/g, "''")}')`,
      );
    },
    close: () => {
      conn.closeSync();
      instance.closeSync();
    },
  };
}
