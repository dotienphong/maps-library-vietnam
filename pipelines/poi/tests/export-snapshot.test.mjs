import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSnapshotMeta,
  readSnapshotRows,
  sha256File,
  snapshotRowIncluded,
} from '../src/export-snapshot.mjs';

describe('snapshotRowIncluded', () => {
  it('all giữ ba nguồn và POI user', () => {
    for (const source of ['osm', 'overture', 'fsq']) {
      expect(snapshotRowIncluded({ primary_source: source, created_by: 'pipeline' }, 'all')).toBe(
        true,
      );
    }
    expect(snapshotRowIncluded({ primary_source: null, created_by: 'user' }, 'all')).toBe(true);
  });

  it('osm chỉ giữ nguồn OSM nhưng luôn giữ POI user', () => {
    expect(snapshotRowIncluded({ primary_source: 'osm', created_by: 'pipeline' }, 'osm')).toBe(
      true,
    );
    expect(snapshotRowIncluded({ primary_source: 'fsq', created_by: 'pipeline' }, 'osm')).toBe(
      false,
    );
    expect(snapshotRowIncluded({ primary_source: null, created_by: 'user' }, 'osm')).toBe(true);
  });
});

describe('assertSnapshotMeta', () => {
  it('chỉ nhận snapshot hoàn chỉnh đúng build id', () => {
    expect(() =>
      assertSnapshotMeta({ type: 'mapslibvn-poi-snapshot', schema: 1, buildId: 'run-1' }, 'run-1'),
    ).not.toThrow();
    expect(() =>
      assertSnapshotMeta({ type: 'mapslibvn-poi-snapshot', schema: 1, buildId: 'run-1' }, 'run-2'),
    ).toThrow(/build id/i);
    expect(() => assertSnapshotMeta({ type: 'row' }, 'run-1')).toThrow(/metadata/i);
  });
});

describe('readSnapshotRows', () => {
  it('đọc dữ liệu đã chụp dù nguồn sống thay đổi sau đó', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'mapslibvn-poi-snapshot-'));
    try {
      const file = resolve(dir, 'snapshot-run-1.jsonl');
      const liveRow = { id: 'before', primary_source: 'osm', created_by: 'pipeline' };
      writeFileSync(
        file,
        `${JSON.stringify({ type: 'mapslibvn-poi-snapshot', schema: 1, buildId: 'run-1' })}\n${JSON.stringify(liveRow)}\n`,
      );
      writeFileSync(`${file}.sha256`, `${await sha256File(file)}\n`);
      liveRow.id = 'after'; // mô phỏng DB đổi sau thời điểm snapshot

      const rows = [];
      for await (const row of readSnapshotRows(file, 'run-1')) rows.push(row);
      expect(rows).toEqual([{ id: 'before', primary_source: 'osm', created_by: 'pipeline' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('không nhận file partial/thiếu checksum hoặc bytes bị sửa', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'mapslibvn-poi-snapshot-'));
    try {
      const file = resolve(dir, 'snapshot-run-1.jsonl');
      writeFileSync(file, '{}\n');
      await expect(async () => {
        for await (const _row of readSnapshotRows(file, 'run-1')) void _row;
      }).rejects.toThrow(/chưa hoàn chỉnh/);
      writeFileSync(`${file}.sha256`, `${'0'.repeat(64)}\n`);
      await expect(async () => {
        for await (const _row of readSnapshotRows(file, 'run-1')) void _row;
      }).rejects.toThrow(/checksum/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
