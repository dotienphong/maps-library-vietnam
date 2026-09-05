import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJsonl = (path) =>
  readFileSync(path, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));

describe('admin alias 2025 evidence fixtures', () => {
  it('pins an immutable OSM snapshot with verifiable metadata', () => {
    const source = JSON.parse(readFileSync('pipelines/poi/fixtures/admin-old-source.json', 'utf8'));
    expect(source.url).toBe('https://download.geofabrik.de/asia/vietnam-250101.osm.pbf');
    expect(source.bytes).toBe(306_547_939);
    expect(source.md5).toMatch(/^[a-f0-9]{32}$/);
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.osmTimestamp).toMatch(/^2025-01-/);
    expect(source.targetValidUntil).toBe('2025-06-30');
    expect(source.license).toBe('ODbL-1.0');
    expect(source.fixture.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.fixture.bbox).toEqual([106.68, 10.76, 106.72, 10.8]);
    expect(Array.isArray(source.issues)).toBe(true);
  });

  it('has independent legal ground truth across the required regions', () => {
    const cases = readJsonl('packages/core/tests/fixtures/admin-alias-2025.jsonl');
    expect(cases.length).toBeGreaterThanOrEqual(60);
    expect(
      new Set(cases.flatMap((c) => c.expectedTargets.map((t) => t.province))).size,
    ).toBeGreaterThanOrEqual(6);
    expect(cases.filter((c) => c.split).length).toBeGreaterThanOrEqual(5);
    expect(new Set(cases.map((c) => c.caseId)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.expectedKeys.length).toBeGreaterThan(0);
      expect(c.expectedTargets.length).toBeGreaterThan(0);
      expect(c.sourceUrl).toMatch(/^https:\/\/xaydungchinhsach\.chinhphu\.vn\//);
      expect(c.sourceClause.trim().length).toBeGreaterThan(0);
      if (c.split) expect(c.expectedTargets.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('pins ten old/new address pairs without embedding credentials', () => {
    const addresses = readJsonl('scripts/fixtures/admin-alias-addresses.jsonl');
    expect(addresses).toHaveLength(10);
    for (const row of addresses) {
      expect(row.oldQuery.length).toBeGreaterThan(5);
      expect(row.newQuery.length).toBeGreaterThan(5);
      expect(row.expectedBbox).toHaveLength(4);
      expect(row.sourceUrl).toMatch(/^https:\/\//);
      expect(JSON.stringify(row)).not.toMatch(/api[_-]?key/i);
    }
  });
});
