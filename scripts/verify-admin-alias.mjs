#!/usr/bin/env node
// Cổng nghiệm thu alias hành chính cũ–mới (plan Task 8).
//
//   node scripts/verify-admin-alias.mjs --mode coverage --out out/admin-alias
//   node scripts/verify-admin-alias.mjs --mode geocode  --out out/admin-alias
//
// `coverage` đọc DATABASE_URL qua helper repo; `geocode` gọi API thật bằng
// MAPSLIBVN_API_BASE/MAPSLIBVN_API_KEY. Khoá **không bao giờ** được ghi ra log hay file.
// Thoát 1 khi có bất kỳ failure bắt buộc.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {'rooftop'|'alley'|'interpolated'|'street'|'ward'|'district'|'province'} Precision */

/** Bậc chính xác: càng lớn càng tốt. `district` trên `province` vì vùng cũ hẹp hơn tỉnh. */
export const PRECISION_RANK = /** @type {const} */ ({
  province: 1,
  district: 2,
  ward: 3,
  street: 4,
  interpolated: 5,
  alley: 6,
  rooftop: 7,
});

const HIGH_PRECISION = new Set(['rooftop', 'alley', 'interpolated']);

/** @param {string | undefined} precision */
export const isHighPrecision = (precision) =>
  precision !== undefined && HIGH_PRECISION.has(precision);

/** @param {string | undefined} precision */
const rankOf = (precision) =>
  precision && precision in PRECISION_RANK
    ? PRECISION_RANK[/** @type {Precision} */ (precision)]
    : 0;

/**
 * @typedef {{id:string, level:number, rawCoverage:number, keptCoverage:number,
 *   discardedShare:number, targets:number, normalizedShareSum?:number}} CoverageRow
 * @typedef {{caseId:string, split:boolean, expectedTargets:string[], actualTargets:string[]}} AliasCase
 * @typedef {{id:string, name:string, evidenceUrl?:string}} OffshoreUnit
 * @typedef {{kind:string, [key:string]:unknown}} Finding
 */

const RAW_COVERAGE_MIN = 0.95;
const RAW_COVERAGE_MAX = 1.05;

/**
 * Đánh giá độ phủ. Mọi thứ ở `failures` là chặn phát hành; `warnings` phải có quyết định QA
 * có nguồn trước release nhưng không tự chặn.
 *
 * @param {{
 *   expectedCounts: Record<string, [number, number]>,
 *   countsByLevel: Record<string, number>,
 *   distinctUnits?: Record<string, number>,
 *   missingMainlandL8: {id:string, name?:string}[],
 *   offshore: OffshoreUnit[],
 *   coverage: CoverageRow[],
 *   aliasCases: AliasCase[],
 *   reportOldCount?: number | null,
 *   dbOldCount?: number | null,
 *   fixtureMismatches?: {caseId:string, ward:string, fixtureDistrict:string,
 *     snapshotDistrict:string}[],
 *   fixtureAmbiguous?: {caseId:string, ward:string, candidates:string[]}[],
 * }} input
 */
export function evaluateCoverage(input) {
  /** @type {Finding[]} */
  const failures = [];
  /** @type {Finding[]} */
  const warnings = [];

  for (const [level, [min, max]] of Object.entries(input.expectedCounts)) {
    const actual = input.countsByLevel[level];
    if (actual === undefined || actual < min || actual > max) {
      failures.push({ kind: 'count_out_of_range', level, actual: actual ?? null, min, max });
    }
    // Số relation không đồng nghĩa số đơn vị pháp lý: lệch nghĩa là có relation trùng.
    const distinct = input.distinctUnits?.[level];
    if (distinct !== undefined && actual !== undefined && distinct !== actual) {
      warnings.push({ kind: 'distinct_differs_from_relations', level, actual, distinct });
    }
  }

  for (const unit of input.missingMainlandL8) {
    failures.push({ kind: 'missing_mainland_l8', id: unit.id, name: unit.name ?? null });
  }

  // Không được suy "ngoài đất liền" chỉ vì không khớp — phải có bằng chứng nguồn.
  for (const unit of input.offshore) {
    if (!unit.evidenceUrl) {
      failures.push({ kind: 'offshore_without_evidence', id: unit.id, name: unit.name });
    }
  }

  // `coverage` đến từ report.json của pipeline, còn phần đếm/alias đọc trực tiếp DB. Nếu hai nguồn
  // khác generation thì mọi kết luận về coverage là vô nghĩa — chặn thay vì đánh giá dữ liệu lệch.
  if (input.coverage.length > 0) {
    if (input.reportOldCount === null || input.reportOldCount === undefined) {
      failures.push({ kind: 'report_missing', coverageRows: input.coverage.length });
    } else if (
      input.dbOldCount !== null &&
      input.dbOldCount !== undefined &&
      input.reportOldCount !== input.dbOldCount
    ) {
      failures.push({
        kind: 'report_generation_mismatch',
        reportOldCount: input.reportOldCount,
        dbOldCount: input.dbOldCount,
      });
    }
  }

  for (const row of input.coverage) {
    // Kiểm raw coverage **độc lập** với share đã chuẩn hoá: chuẩn hoá về 1 không xoá được lỗ dữ liệu.
    if (row.rawCoverage < RAW_COVERAGE_MIN) {
      failures.push({
        kind: 'raw_coverage_gap',
        id: row.id,
        level: row.level,
        rawCoverage: row.rawCoverage,
        normalizedShareSum: row.normalizedShareSum ?? null,
      });
    } else if (row.rawCoverage > RAW_COVERAGE_MAX) {
      warnings.push({
        kind: 'raw_coverage_outside_band',
        id: row.id,
        rawCoverage: row.rawCoverage,
      });
    }
    if (row.discardedShare > 0) {
      warnings.push({ kind: 'discarded_sliver', id: row.id, discardedShare: row.discardedShare });
    }
  }

  // Ground truth sai thì mọi con số sau đó vô nghĩa. 07/09/2026: fixture Task 0 gán toàn bộ ca
  // Đà Nẵng vào "Quận Hải Châu" và Cần Thơ vào "Ninh Kiều", trong khi snapshot ODbL nói Hòa Liên
  // thuộc Hòa Vang, Xuân Hà thuộc Thanh Khê, Thọ Quang thuộc Sơn Trà, Bùi Hữu Nghĩa thuộc Bình Thủy.
  for (const item of input.fixtureMismatches ?? []) {
    failures.push({
      kind: 'fixture_district_mismatch',
      caseId: item.caseId,
      ward: item.ward,
      fixtureDistrict: item.fixtureDistrict,
      snapshotDistrict: item.snapshotDistrict,
    });
  }

  // Trùng tên phường trong cùng tỉnh thì không kết luận được huyện nào đúng — nêu ra, không tính lỗi.
  for (const item of input.fixtureAmbiguous ?? []) {
    warnings.push({
      kind: 'fixture_district_ambiguous',
      caseId: item.caseId,
      ward: item.ward,
      candidates: item.candidates,
    });
  }

  for (const item of input.aliasCases) {
    const expected = new Set(item.expectedTargets);
    const actual = new Set(item.actualTargets);
    const missing = item.expectedTargets.filter((target) => !actual.has(target));
    const unexpected = item.actualTargets.filter((target) => !expected.has(target));
    if (missing.length > 0) {
      failures.push({
        kind: item.split ? 'split_target_missing' : 'target_missing',
        caseId: item.caseId,
        missing,
      });
    }
    if (unexpected.length > 0) {
      failures.push({ kind: 'unexpected_target', caseId: item.caseId, unexpected });
    }
  }

  return { ok: failures.length === 0, failures, warnings };
}

/** @typedef {{precision?:string, lat?:number, lng?:number, error?:string}} GeocodeResult */

const HIGH_PRECISION_MIN = 8;

/**
 * Đánh giá 10 cặp địa chỉ cũ/mới. Ca lỗi HTTP **vẫn nằm trong mẫu** và tính là trượt —
 * không được retry đến khi đạt rồi bỏ lần thất bại.
 *
 * @param {{caseId:string, expectedBbox:[number,number,number,number],
 *   old:GeocodeResult, fresh:GeocodeResult}[]} cases
 */
export function evaluateGeocode(cases) {
  /** @type {Finding[]} */
  const failures = [];
  let highPrecision = 0;

  for (const item of cases) {
    if (item.old.error) {
      failures.push({ kind: 'request_failed', caseId: item.caseId, error: item.old.error });
      continue;
    }
    if (item.fresh.error) {
      failures.push({ kind: 'request_failed', caseId: item.caseId, error: item.fresh.error });
      continue;
    }
    if (isHighPrecision(item.old.precision)) highPrecision++;

    if (rankOf(item.old.precision) < rankOf(item.fresh.precision)) {
      failures.push({
        kind: 'worse_than_new',
        caseId: item.caseId,
        old: item.old.precision ?? null,
        fresh: item.fresh.precision ?? null,
      });
    }

    const [minLng, minLat, maxLng, maxLat] = item.expectedBbox;
    const { lat, lng } = item.old;
    const inside =
      lat !== undefined &&
      lng !== undefined &&
      lng >= minLng &&
      lng <= maxLng &&
      lat >= minLat &&
      lat <= maxLat;
    if (!inside) {
      failures.push({
        kind: 'outside_expected_bbox',
        caseId: item.caseId,
        lat: lat ?? null,
        lng: lng ?? null,
      });
    }
  }

  if (highPrecision < HIGH_PRECISION_MIN) {
    failures.push({
      kind: 'high_precision_below_threshold',
      highPrecision,
      total: cases.length,
      min: HIGH_PRECISION_MIN,
    });
  }

  return { ok: failures.length === 0, failures, highPrecision, total: cases.length };
}

/* ---------- Phần I/O: chỉ chạy khi gọi trực tiếp ---------- */

/**
 * Bỏ dấu + lowercase, khớp `normalizeVi` cho mục đích so tên hành chính. Không import
 * `@mapslibvn/core` để script không phụ thuộc thứ tự build (cùng lý do với perf-autocomplete).
 * @param {string} value
 */
const fold = (value) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** @param {string} value */
const stripUnitPrefix = (value) =>
  value.replace(/^(Phường|Xã|Thị trấn|Đặc khu|Quận|Huyện|Thành phố|Thị xã|Tỉnh)\s+/i, '');

/** Tách "Xã Hòa Liên, Quận Hải Châu, Đà Nẵng" thành ba khóa đã chuẩn hoá. @param {string} value */
const oldUnitOf = (value) => {
  const [ward = '', district = '', province = ''] = value.split(',').map((part) => part.trim());
  return {
    ward: fold(stripUnitPrefix(ward)),
    district: fold(stripUnitPrefix(district)),
    province: fold(stripUnitPrefix(province)),
  };
};

/** @param {string} path */
const readJsonl = (path) =>
  readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

/**
 * Bỏ mọi thứ trông giống khoá API khỏi văn bản trước khi lưu/ghi log.
 * @param {unknown} text
 */
export const stripCredentials = (text) =>
  String(text)
    .replace(/mlv_(live|test)_[A-Za-z0-9]+/g, 'mlv_***')
    .replace(/(X-Api-Key|api[-_]?key)\s*[:=]\s*\S+/gi, '$1: ***');

const gitCommit = () => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

const sourceHashes = () => {
  const manifestPath = resolve('pipelines/poi/fixtures/admin-old-source.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return { url: manifest.url, md5: manifest.md5, sha256: manifest.sha256, bytes: manifest.bytes };
};

/**
 * Gọi API với timeout và số lần thử **hữu hạn**; lần cuối thất bại được giữ nguyên trong kết quả.
 * @param {string} url @param {string} apiKey @param {{timeoutMs?:number, attempts?:number}} opts
 */
async function getJson(url, apiKey, { timeoutMs = 10_000, attempts = 3 } = {}) {
  /** @type {string | undefined} */
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { 'X-Api-Key': apiKey },
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        lastError = stripCredentials(`HTTP ${response.status}: ${body.slice(0, 300)}`);
      } else {
        return { json: JSON.parse(body) };
      }
    } catch (error) {
      lastError = stripCredentials(`${error instanceof Error ? error.message : error}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: lastError ?? 'không rõ lỗi' };
}

async function runCoverage() {
  const { default: postgres } = await import('postgres');
  const { databaseUrlFromEnv } = await import('./lib/migrations.mjs');
  const sql = postgres(databaseUrlFromEnv(process.env), { max: 2, onnotice: () => {} });
  try {
    const levels = await sql`SELECT level,count(*)::int AS n FROM admin_area_old GROUP BY 1`;
    /** @type {Record<string, number>} */
    const countsByLevel = {};
    for (const row of levels) countsByLevel[`L${row.level}`] = row.n;

    const distinct =
      await sql`SELECT level,count(DISTINCT (name_norm,province_norm))::int AS n FROM admin_area_old GROUP BY 1`;
    /** @type {Record<string, number>} */
    const distinctUnits = {};
    for (const row of distinct) distinctUnits[`L${row.level}`] = row.n;

    const missing = await sql`SELECT o.id::text AS id,o.name FROM admin_area_old o
      WHERE o.level=8 AND NOT EXISTS (SELECT 1 FROM admin_alias a WHERE a.old_area_id=o.id)
      ORDER BY o.id`;

    const reportPath = resolve(process.env.MAPSLIBVN_OUT ?? 'out', 'admin-alias/report.json');
    const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
    const oldCountRows = await sql`SELECT count(*)::int AS n FROM admin_area_old`;
    const dbOldCount = Number(oldCountRows[0]?.n ?? 0);

    const fixtures = readJsonl(resolve('packages/core/tests/fixtures/admin-alias-2025.jsonl'));
    /** @type {AliasCase[]} */
    const aliasCases = [];
    /** @type {{caseId:string, ward:string, fixtureDistrict:string, snapshotDistrict:string}[]} */
    const fixtureMismatches = [];
    /** @type {{caseId:string, ward:string, candidates:string[]}[]} */
    const fixtureAmbiguous = [];
    for (const item of fixtures) {
      const unit = oldUnitOf(item.old);
      // Tra theo **đơn vị cũ**, không theo `expectedKeys` viết tay: khóa trong fixture Task 0 đã
      // lệch khỏi dạng canonical của core (`thanh pho ho chi minh` so với `ho chi minh`), nên so
      // theo khóa sẽ báo rỗng dù dữ liệu đúng.
      const rows = await sql`SELECT o.parent_norm,
          coalesce(string_agg(DISTINCT current.name, '|' ORDER BY current.name),'') AS names
        FROM admin_area_old o
        LEFT JOIN admin_alias a ON a.old_area_id=o.id
        LEFT JOIN admin_area current ON current.id=a.admin_area_id
        WHERE o.level=8 AND o.name_norm=${unit.ward} AND o.province_norm=${unit.province}
        GROUP BY o.id,o.parent_norm`;
      // Ưu tiên dòng trùng huyện của fixture: cùng tỉnh có thể có nhiều phường trùng tên
      // (Đồng Tháp có hai `Xã Tân Phước`), lấy dòng đầu tuỳ ý sẽ báo lệch sai.
      const matched = rows.find((candidate) => String(candidate.parent_norm) === unit.district);
      const row = matched ?? rows[0];
      if (!matched && unit.district && rows.length > 1) {
        fixtureAmbiguous.push({
          caseId: item.caseId,
          ward: unit.ward,
          candidates: rows.map((candidate) => String(candidate.parent_norm)),
        });
      } else if (!matched && unit.district && row?.parent_norm) {
        fixtureMismatches.push({
          caseId: item.caseId,
          ward: unit.ward,
          fixtureDistrict: unit.district,
          snapshotDistrict: String(row.parent_norm),
        });
      }
      aliasCases.push({
        caseId: item.caseId,
        split: Boolean(item.split),
        expectedTargets: item.expectedTargets.map((/** @type {{ward:string}} */ t) => t.ward),
        actualTargets: String(row?.names ?? '')
          .split('|')
          .filter(Boolean)
          .map(stripUnitPrefix),
      });
    }

    return {
      countsByLevel,
      distinctUnits,
      missingMainlandL8: missing.map((row) => ({ id: row.id, name: row.name })),
      offshore: [],
      coverage: report?.coverage ?? [],
      aliasCases,
      fixtureMismatches,
      fixtureAmbiguous,
      reportOldCount: report ? (report.oldCount ?? null) : null,
      dbOldCount,
    };
  } finally {
    await sql.end();
  }
}

/** @param {string} base @param {string} apiKey */
async function runGeocode(base, apiKey) {
  const pairs = readJsonl(resolve('scripts/fixtures/admin-alias-addresses.jsonl'));
  /** @type {{caseId:string, expectedBbox:[number,number,number,number], old:GeocodeResult, fresh:GeocodeResult, ms:number}[]} */
  const cases = [];
  for (const pair of pairs) {
    const started = performance.now();
    /** @type {GeocodeResult[]} */
    const both = [];
    for (const query of [pair.oldQuery, pair.newQuery]) {
      const url = `${base.replace(/\/$/, '')}/v1/geocode?q=${encodeURIComponent(query)}&limit=1`;
      const result = await getJson(url, apiKey);
      if (result.error) {
        both.push({ error: result.error });
        continue;
      }
      const [item] = result.json.items ?? [];
      both.push(
        item
          ? { precision: item.precision, lat: item.lat, lng: item.lng }
          : { error: 'không có kết quả' },
      );
    }
    cases.push({
      caseId: pair.caseId,
      expectedBbox: pair.expectedBbox,
      old: both[0] ?? { error: 'thiếu phản hồi' },
      fresh: both[1] ?? { error: 'thiếu phản hồi' },
      ms: Math.round(performance.now() - started),
    });
  }
  return cases;
}

async function main() {
  const argv = process.argv.slice(2);
  const flagValue = (/** @type {string} */ flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const mode = flagValue('--mode');
  const outDir = flagValue('--out') ?? 'out/admin-alias';
  if (mode !== 'coverage' && mode !== 'geocode') {
    throw new Error('Dùng: --mode coverage|geocode [--out out/admin-alias]');
  }

  const startedAt = Date.now();
  /** @type {ReturnType<typeof evaluateCoverage> | ReturnType<typeof evaluateGeocode>} */
  let evaluation;
  /** @type {unknown} */
  let detail;

  if (mode === 'coverage') {
    const input = await runCoverage();
    // Cổng đếm ban đầu theo spec 8.3; sửa khoảng phải có lý do ghi vào plan, không padding dữ liệu.
    evaluation = evaluateCoverage({
      ...input,
      expectedCounts: { L4: [63, 63], L6: [690, 710], L8: [10_000, 10_700] },
    });
    detail = input;
  } else {
    const base = process.env.MAPSLIBVN_API_BASE;
    const apiKey = process.env.MAPSLIBVN_API_KEY;
    if (!base || !apiKey) throw new Error('Thiếu MAPSLIBVN_API_BASE hoặc MAPSLIBVN_API_KEY');
    const cases = await runGeocode(base, apiKey);
    evaluation = evaluateGeocode(cases);
    detail = { cases, apiBase: base };
  }

  const payload = {
    mode,
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    source: sourceHashes(),
    timings: { totalMs: Date.now() - startedAt },
    ...evaluation,
    detail,
  };
  mkdirSync(resolve(outDir), { recursive: true });
  const file = resolve(outDir, `verify-${mode}.json`);
  // stripCredentials chạy trên toàn bộ payload đã tuần tự hoá: không để khoá lọt vào artifact.
  writeFileSync(file, `${stripCredentials(JSON.stringify(payload, null, 2))}\n`);
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
  console.log(
    `${evaluation.ok ? '✓' : '✗'} ${mode}: ${evaluation.failures.length} failure, ` +
      `${'warnings' in evaluation ? evaluation.warnings.length : 0} warning → ${file} (sha256:${hash})`,
  );
  for (const failure of evaluation.failures.slice(0, 20)) {
    console.log(`  - ${JSON.stringify(failure)}`);
  }
  if (!evaluation.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
