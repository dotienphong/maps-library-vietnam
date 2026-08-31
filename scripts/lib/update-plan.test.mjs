import { describe, expect, it } from 'vitest';
import { decideWork, missingLiveEnv, nextState } from './update-plan.mjs';

const state = {
  osm: { lastModified: 'Mon, 18 Aug 2026 20:00:00 GMT', md5: 'aaa' },
  overture: { release: '2026-07-23.1' },
  fsq: { release: '2026-07-08' },
  releases: { vn: 'vn-20260819', poi: 'poi-20260819' },
};
const same = { osm: state.osm, overture: state.overture, fsq: state.fsq };
const osmNew = {
  ...same,
  osm: { lastModified: 'Mon, 25 Aug 2026 20:00:00 GMT', md5: 'bbb' },
};
const overtureNew = { ...same, overture: { release: '2026-08-20.0' } };

describe('decideWork (spec 5.9)', () => {
  it('không có gì mới → không làm gì', () => {
    expect(decideWork(state, same, {})).toEqual({ tiles: false, poi: false, reasons: [] });
  });

  it('OSM mới → tiles và poi', () => {
    expect(decideWork(state, osmNew, {})).toEqual({
      tiles: true,
      poi: true,
      reasons: ['OSM đổi (md5 aaa → bbb)'],
    });
  });

  it('Overture/FSQ mới → chỉ poi', () => {
    expect(decideWork(state, overtureNew, {})).toEqual({
      tiles: false,
      poi: true,
      reasons: ['Overture đổi (2026-07-23.1 → 2026-08-20.0)'],
    });
    expect(decideWork(state, { ...same, fsq: { release: '2026-08-05' } }, {}).tiles).toBe(false);
  });

  it('--force làm tất cả; --tiles/--poi giới hạn', () => {
    expect(decideWork(state, same, { force: true })).toEqual({
      tiles: true,
      poi: true,
      reasons: ['--force'],
    });
    expect(decideWork(state, osmNew, { onlyTiles: true }).poi).toBe(false);
    expect(decideWork(state, osmNew, { onlyPoi: true }).tiles).toBe(false);
  });

  it('state rỗng (lần đầu) → làm tất cả với 3 lý do', () => {
    expect(decideWork({}, same, {}).reasons).toHaveLength(3);
  });
});

describe('nextState', () => {
  it('ghi cả 3 nguồn và release mới, giữ release cũ nếu không build', () => {
    expect(nextState(state, overtureNew, { poi: 'poi-20260826' })).toEqual({
      osm: state.osm,
      overture: { release: '2026-08-20.0' },
      fsq: state.fsq,
      releases: { vn: 'vn-20260819', poi: 'poi-20260826' },
    });
  });

  it('--poi khi OSM đổi giữ pending tiles cho lần chạy sau', () => {
    const afterPoi = nextState(state, osmNew, { poi: 'poi-20260826' });
    expect(afterPoi.pending).toEqual({ tiles: true, poi: false });
    expect(decideWork(afterPoi, osmNew, {})).toMatchObject({ tiles: true, poi: false });
  });

  it('--tiles không nuốt pending POI do OSM/Overture đổi', () => {
    const versions = { ...osmNew, overture: overtureNew.overture };
    const afterTiles = nextState(state, versions, { vn: 'vn-20260826' });
    expect(afterTiles.pending).toEqual({ tiles: false, poi: true });
    expect(decideWork(afterTiles, versions, {})).toMatchObject({ tiles: false, poi: true });
  });
});

describe('missingLiveEnv', () => {
  it('dry-run không đòi credentials upload', () => {
    expect(missingLiveEnv({}, { dryRun: true })).toEqual([]);
  });

  it('live tiles liệt kê đúng credentials còn thiếu, gồm HF_TOKEN', () => {
    expect(
      missingLiveEnv(
        {
          R2_BUCKET: 'mapslibvn-tiles',
          CLOUDFLARE_ACCOUNT_ID: 'account',
          KV_NAMESPACE_ID_META: 'namespace',
          RCLONE_CONFIG_R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
        },
        { onlyTiles: true },
      ),
    ).toEqual([
      'TILES_BASE',
      'CLOUDFLARE_API_TOKEN',
      'RCLONE_CONFIG_R2_ACCESS_KEY_ID',
      'RCLONE_CONFIG_R2_SECRET_ACCESS_KEY',
      'RCLONE_CONFIG_R2_NO_CHECK_BUCKET',
      'HF_TOKEN',
    ]);
  });
});
