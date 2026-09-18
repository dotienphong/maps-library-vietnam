#!/usr/bin/env node
/**
 * Chẩn đoán độ trễ `/v1/autocomplete` bằng EXPLAIN (ANALYZE, BUFFERS) trên **DB máy chủ**.
 *
 * Vì sao cần: đo qua HTTP chỉ cho biết TỔNG (18/09/2026: cache-hit 123 ms, cache-miss p50 2.849 ms
 * — xem `docs/evidence/perf/2026-09-18-autocomplete-cold.md`). Tổng không nói được thời gian nằm ở
 * nhánh nào, nên vá theo tổng là đoán. Script này chạy từng nhánh RIÊNG và bỏ bớt từng thành phần
 * để **quy** thời gian cho chúng, thay vì đọc một con số rồi suy diễn.
 *
 * Cách dùng (cần .env ở gốc repo có DB_TUNNEL_HOSTNAME + PIPELINE_DATABASE_URL + CF_ACCESS_*,
 * và `pnpm build` đã chạy vì script dùng `packages/core/dist` để rút gọn truy vấn đúng như API):
 *   pnpm explain:autocomplete
 *   pnpm explain:autocomplete -- --q "ben thanh" --q cafe --plan
 *
 * Script TỰ mở Cloudflare Tunnel (như `data:update`), không cần mở terminal thứ hai, không cần psql.
 *
 * CHỈ ĐỌC: không ghi, không ALTER, không tạo chỉ số. An toàn chạy trên production — nhưng nó DÙNG
 * CPU của Postgres đang phục vụ thật, nên đừng chạy song song với pipeline dữ liệu.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { applyToponymAlias, nameCore, normalizeVi, viKey } from '../packages/core/dist/index.js';
import { openDatabaseTunnel } from './lib/tunnel.mjs';

/** Truy vấn mặc định: 2 ký tự (nghi chậm nhất), cụm ngắn, và cụm dài — ba chế độ chi phí khác nhau. */
const DEFAULT_QUERIES = ['qu', 'cafe', 'ben thanh', 'truong tieu hoc'];
/** `SIMILARITY_MAX_QUERY_LENGTH` của apps/api/src/autocomplete-sql.ts — giữ hai nơi bằng nhau. */
const SIMILARITY_MAX_QUERY_LENGTH = 12;
/** Bộ nguồn mặc định của API (profile `all`). */
const SOURCES = "ARRAY['osm','fsq']::text[]";
const SOURCE_FILTER = `(p.primary_source = ANY(${SOURCES}) OR p.created_by = 'user')`;
/** `near` mặc định của các phép đo perf, để số đo so được với `perf-autocomplete`. */
const NEAR = 'ST_SetSRID(ST_MakePoint(106.700, 10.776), 4326)';

/** @param {string} raw */
const lit = (raw) => `'${raw.replace(/'/g, "''")}'`;

/** Bản sao của `tsQueryFor` trong apps/api/src/stages.ts (TS, không import được từ .mjs). */
function tsQueryFor(/** @type {string} */ queryNorm) {
  const tokens = queryNorm
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => t.length >= 2 || /^\d+$/.test(t));
  return tokens.length < 2 ? null : tokens.map((t) => `${t}:*`).join(' & ');
}

/**
 * Dựng ĐÚNG câu bậc 1 của `poiCandidates()` cho một truy vấn đã rút gọn, với một thành phần bị bỏ.
 *
 * Chỉ nhận truy vấn mà `queryNorm === queryCore === queryAlias`: khi đó mọi nhánh điều kiện của
 * builder (aliasBranch, aliasSim, aliasPrefix, coreBranches) rỗng và câu dưới đây là bản sao chính
 * xác, không phải bản "gần giống". Truy vấn nào không rút gọn được thì `buildCases()` từ chối —
 * thà không đo còn hơn đo một câu khác với câu production đang chạy.
 *
 * @param {string} q đã chuẩn hoá
 * @param {'full'|'no_matched_alt'|'no_distance'|'no_like'|'no_percent'|'chi_wordsim'} bien_the
 */
function poiStage1(q, bien_the) {
  const fuzzy = q.length <= SIMILARITY_MAX_QUERY_LENGTH;
  const qs = lit(q);
  const prefix = lit(`${q.replace(/[\\%_]/g, '\\$&')}%`);
  const matchedAlt =
    bien_the === 'no_matched_alt'
      ? 'NULL'
      : `(SELECT a.orig FROM unnest(name_alt, string_to_array(name_alt_norm, ' | ')) AS a(orig, norm)
         WHERE ${qs} <% a.norm ORDER BY word_similarity(${qs}, a.norm) DESC LIMIT 1)`;
  const distance = bien_the === 'no_distance' ? 'NULL::float8' : `ST_DistanceSphere(geom, ${NEAR})`;

  const where = [`${qs} <% name_norm`];
  if (bien_the !== 'chi_wordsim') {
    if (fuzzy && bien_the !== 'no_percent') where.push(`name_norm % ${qs}`);
    where.push(`${qs} <% name_alt_norm`);
    if (bien_the !== 'no_like') where.push(`name_norm LIKE ${prefix}`);
  }

  return `
    SELECT 'poi' AS type, id, name,
      concat_ws(', ', street, coalesce(admin_ward, ward), coalesce(admin_province, province)) AS secondary,
      ST_Y(geom) AS lat, ST_X(geom) AS lng, NULL AS precision,
      greatest(
        word_similarity(${qs}, name_norm),
        word_similarity(${qs}, name_norm),
        similarity(name_norm, ${qs}),
        word_similarity(${qs}, coalesce(name_alt_norm, ''))
      ) AS sim,
      starts_with(name_norm, ${qs}) AS prefix,
      coalesce(popularity, 0) AS pop,
      ${distance} AS d,
      ${matchedAlt} AS matched_alt
    FROM poi p
    WHERE status = 'active'
      AND ${SOURCE_FILTER}
      AND (${where.join('\n        OR ')})
    ORDER BY sim DESC, pop DESC
    LIMIT 20`;
}

/** Bậc 2 (tsvector) và bậc 3 (khoá ngữ âm) chạy SONG SONG với bậc 1 trên cùng một Postgres. */
function poiStage2(/** @type {string} */ tsQuery, /** @type {string} */ q) {
  return `
    SELECT 'poi' AS type, id, name, word_similarity(${lit(q)}, name_norm) AS sim,
      coalesce(popularity, 0) AS pop, ST_DistanceSphere(geom, ${NEAR}) AS d
    FROM poi p
    WHERE status = 'active' AND ${SOURCE_FILTER}
      AND name_tsv @@ to_tsquery('simple', ${lit(tsQuery)})
    ORDER BY sim DESC, pop DESC LIMIT 20`;
}

function poiStage3(/** @type {string} */ queryKey) {
  return `
    SELECT 'poi' AS type, id, name, word_similarity(${lit(queryKey)}, name_key) AS sim,
      coalesce(popularity, 0) AS pop, ST_DistanceSphere(geom, ${NEAR}) AS d
    FROM poi p
    WHERE status = 'active' AND ${SOURCE_FILTER}
      AND ${lit(queryKey)} <% name_key
    ORDER BY sim DESC, pop DESC LIMIT 20`;
}

/**
 * Rút gọn truy vấn người dùng về dạng builder dùng, và TỪ CHỐI truy vấn không rút gọn được.
 * @param {string[]} raw
 */
export function buildCases(raw) {
  /** @type {{ q: string, sql: Record<string, string> }[]} */
  const cases = [];
  for (const input of raw) {
    const q = normalizeVi(input);
    const core = nameCore(input);
    const alias = applyToponymAlias(q);
    if (q !== core || q !== alias) {
      throw new Error(
        `"${input}" không rút gọn được (norm="${q}" core="${core}" alias="${alias}") — ` +
          'câu dựng ở đây sẽ KHÁC câu production, nên không đo. Chọn truy vấn khác.',
      );
    }
    const tsQuery = tsQueryFor(q);
    const key = viKey(alias);
    cases.push({
      q,
      sql: {
        full: poiStage1(q, 'full'),
        no_matched_alt: poiStage1(q, 'no_matched_alt'),
        no_distance: poiStage1(q, 'no_distance'),
        no_like: poiStage1(q, 'no_like'),
        no_percent: poiStage1(q, 'no_percent'),
        chi_wordsim: poiStage1(q, 'chi_wordsim'),
        // Bậc 2/3 chạy SONG SONG với bậc 1 trên cùng một Postgres: khi máy rảnh chúng không cộng
        // vào thời gian tường, nhưng khi máy bận chúng cộng vào TẢI CPU — phải biết giá của chúng.
        ...(tsQuery ? { bac2_tsvector: poiStage2(tsQuery, q) } : {}),
        ...(key ? { bac3_name_key: poiStage3(key) } : {}),
      },
    });
  }
  return cases;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {string[]} */
  const queries = [];
  let plan = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan') plan = true;
    else if (argv[i] === '--q') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--q thiếu giá trị');
      queries.push(value);
      i++;
    }
  }
  return { queries: queries.length > 0 ? queries : DEFAULT_QUERIES, plan };
}

/** Lấy `Execution Time` và `Planning Time` (ms) từ EXPLAIN dạng JSON. */
export function timesOf(/** @type {any} */ plan) {
  const root = Array.isArray(plan) ? plan[0] : plan;
  return {
    exec: Number(root?.['Execution Time'] ?? 0),
    plan: Number(root?.['Planning Time'] ?? 0),
    rows: Number(root?.Plan?.['Actual Rows'] ?? 0),
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { queries, plan: inPlan } = parseArgs(process.argv.slice(2));
  const closeTunnel = await openDatabaseTunnel();
  const url = process.env.PIPELINE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Thiếu PIPELINE_DATABASE_URL (hoặc DATABASE_URL)');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [tong] = await sql`SELECT count(*)::int AS count FROM poi WHERE status = 'active'`;
    const count = Number(tong?.count ?? 0);
    const [guc] =
      await sql`SELECT current_setting('pg_trgm.word_similarity_threshold', true) AS wst,
      current_setting('jit', true) AS jit, version() AS version`;
    console.log(
      `poi active=${count.toLocaleString('vi-VN')} · word_similarity_threshold=${guc?.wst}`,
    );
    console.log(`jit=${guc?.jit} · ${String(guc?.version).split(' ').slice(0, 2).join(' ')}\n`);

    for (const { q, sql: variants } of buildCases(queries)) {
      console.log(`━━━ q=${JSON.stringify(q)} (${q.length} ký tự) ━━━`);
      /** @type {Record<string, number>} */
      const exec = {};
      for (const [label, text] of Object.entries(variants)) {
        // Chạy hai lần: lần 1 gồm cả chi phí đọc đĩa lạnh, lần 2 là chi phí khi buffer đã nóng.
        // In cả hai — lấy một số rồi gọi là "chi phí câu này" là cách tự lừa mình.
        /** @type {number[]} */
        const runs = [];
        for (let i = 0; i < 2; i++) {
          const [row] = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`);
          runs.push(timesOf(row?.['QUERY PLAN']).exec);
        }
        exec[label] = runs[1] ?? 0;
        console.log(
          `  ${label.padEnd(15)} lạnh=${Math.round(runs[0] ?? 0)
            .toString()
            .padStart(6)} ms   nóng=${Math.round(runs[1] ?? 0)
            .toString()
            .padStart(6)} ms`,
        );
      }
      const base = exec.full ?? 0;
      console.log('  — quy chi phí (nóng, so với full):');
      for (const label of [
        'no_matched_alt',
        'no_distance',
        'no_like',
        'no_percent',
        'chi_wordsim',
      ]) {
        if (exec[label] === undefined) continue;
        const saved = base - exec[label];
        const pctSaved = base > 0 ? Math.round((saved / base) * 100) : 0;
        console.log(
          `      bỏ ${label.padEnd(15)} tiết kiệm ${Math.round(saved)} ms (${pctSaved} %)`,
        );
      }
      if (inPlan) {
        const rows = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) ${variants.full}`);
        console.log('\n  — kế hoạch đầy đủ (full):');
        for (const row of rows) console.log(`    ${row['QUERY PLAN']}`);
      }
      console.log();
    }
  } finally {
    await sql.end({ timeout: 5 });
    closeTunnel();
  }
}
