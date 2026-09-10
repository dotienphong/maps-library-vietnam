import { describe, expect, it } from 'vitest';
import { GRAPH_FILES, graphMeta, preparePlan, rollbackPlan } from './routing-graph.mjs';

describe('preparePlan', () => {
  const md5 = 'a'.repeat(32);

  it('không có PBF nguồn → error', () => {
    expect(
      preparePlan({
        hasSource: false,
        sourceMd5: null,
        currentMd5: null,
        hasTar: false,
        force: false,
      }),
    ).toEqual({ action: 'error', reason: expect.stringContaining('download.mjs') });
  });

  it('md5 trùng và đã có tar → skip (idempotent); --force vẫn rebuild', () => {
    const state = {
      hasSource: true,
      sourceMd5: md5,
      currentMd5: md5,
      hasTar: true,
      force: false,
    };
    expect(preparePlan(state)).toEqual({
      action: 'skip',
      reason: expect.stringContaining(md5),
    });
    expect(preparePlan({ ...state, force: true })).toEqual({ action: 'rebuild', keepPrev: true });
  });

  it('md5 khác hoặc chưa có tar → rebuild; keepPrev theo tar hiện có', () => {
    expect(
      preparePlan({
        hasSource: true,
        sourceMd5: md5,
        currentMd5: 'b'.repeat(32),
        hasTar: true,
        force: false,
      }),
    ).toEqual({ action: 'rebuild', keepPrev: true });
    expect(
      preparePlan({
        hasSource: true,
        sourceMd5: md5,
        currentMd5: null,
        hasTar: false,
        force: false,
      }),
    ).toEqual({ action: 'rebuild', keepPrev: false });
  });
});

describe('rollbackPlan / graphMeta / GRAPH_FILES', () => {
  it('rollback cần prev tar', () => {
    expect(rollbackPlan({ hasPrevTar: true })).toEqual({ action: 'swap' });
    expect(rollbackPlan({ hasPrevTar: false })).toEqual({
      action: 'error',
      reason: expect.stringContaining('prev/valhalla_tiles.tar'),
    });
  });

  it('graphMeta ghi md5, ngày PBF, thời điểm và bản trước', () => {
    const prev = {
      pbfMd5: 'x',
      pbfDate: '2026-09-01T00:00:00.000Z',
      requestedAt: '2026-09-01T02:00:00.000Z',
    };
    expect(
      graphMeta('y', new Date('2026-09-14T00:00:00Z'), new Date('2026-09-15T02:00:00Z'), prev),
    ).toEqual({
      pbfMd5: 'y',
      pbfDate: '2026-09-14T00:00:00.000Z',
      requestedAt: '2026-09-15T02:00:00.000Z',
      previous: {
        pbfMd5: 'x',
        pbfDate: '2026-09-01T00:00:00.000Z',
        requestedAt: '2026-09-01T02:00:00.000Z',
      },
    });
    expect(graphMeta('y', new Date(0), new Date(0), null).previous).toBeNull();
  });

  it('tên file khớp image valhalla-scripted (tileset_name=valhalla_tiles)', () => {
    expect(GRAPH_FILES).toEqual({
      pbf: 'vietnam.osm.pbf',
      tar: 'valhalla_tiles.tar',
      tileDir: 'valhalla_tiles',
      prevDir: 'prev',
      flag: 'reload.request',
      meta: 'graph.json',
    });
  });
});
