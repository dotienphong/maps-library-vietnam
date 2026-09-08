import { describe, expect, it } from 'vitest';
import {
  decideWork,
  missingLiveEnv,
  nextState,
  poiReleaseSteps,
  runPoiReleaseSteps,
} from './update-plan.mjs';

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

  it('ghi releases.poiOsm khi build profile osm, không bịa khoá khi không build', () => {
    const next = nextState(state, same, { poi: 'poi-20260910', poiOsm: 'poi-osm-20260910' });
    expect(next.releases).toEqual({
      vn: 'vn-20260819',
      poi: 'poi-20260910',
      poiOsm: 'poi-osm-20260910',
    });
    expect(nextState(state, same, { poi: 'poi-20260910' }).releases).toEqual({
      vn: 'vn-20260819',
      poi: 'poi-20260910',
    });
    expect(
      nextState({ ...state, releases: { ...state.releases, poiOsm: 'poi-osm-cu' } }, same, {
        poi: 'poi-20260910',
      }).releases?.poiOsm,
    ).toBe('poi-osm-cu');
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

describe('POI release transaction', () => {
  const releases = {
    release: 'poi-20260908-120000-abcd',
    osmRelease: 'poi-osm-20260908-120000-abcd',
    buildId: '20260908-120000-abcd',
    snapshot: '/app/work/poi/snapshot-20260908-120000-abcd.jsonl',
    out: '/app/out',
  };

  const makeExternalState = () => ({
    current: { vn: 'vn-old', poi: 'poi-old', poiProfiles: { osm: 'poi-osm-old' } },
    checksums: new Map([
      ['poi-old', 'sha-all-old'],
      ['poi-osm-old', 'sha-osm-old'],
    ]),
  });

  const executeWithFault = (/** @type {string | undefined} */ faultAt) => {
    const external = makeExternalState();
    const oldChecksums = new Map(external.checksums);
    const execute = (/** @type {import('./update-plan.mjs').PoiReleaseStep} */ step) => {
      if (step.id === faultAt) throw new Error(`fault:${faultAt}`);
      const uploadedRelease = step.args.at(-1);
      if (step.id === 'upload-all' || step.id === 'upload-osm') {
        if (!uploadedRelease) throw new Error(`thiếu release cho ${step.id}`);
        external.checksums.set(
          uploadedRelease,
          step.id === 'upload-all' ? 'sha-all-new' : 'sha-osm-new',
        );
      }
      if (step.id === 'manifest') {
        external.current = {
          ...external.current,
          poi: releases.release,
          poiProfiles: { osm: releases.osmRelease },
        };
      }
    };
    return { external, oldChecksums, execute };
  };

  for (const faultAt of ['export-osm', 'upload-osm', 'smoke-all', 'smoke-osm']) {
    it(`lỗi ${faultAt} giữ manifest hiện hành và checksum archive cũ`, () => {
      const { external, oldChecksums, execute } = executeWithFault(faultAt);
      const current = structuredClone(external.current);

      expect(() => runPoiReleaseSteps(poiReleaseSteps(releases), execute)).toThrow(
        `fault:${faultAt}`,
      );
      expect(external.current).toEqual(current);
      for (const [release, checksum] of oldChecksums) {
        expect(external.checksums.get(release)).toBe(checksum);
      }
    });
  }

  it('chỉ commit manifest sau khi hai upload và hai smoke đều thành công', () => {
    const { external, execute } = executeWithFault(undefined);
    runPoiReleaseSteps(poiReleaseSteps(releases), execute);
    expect(external.current).toEqual({
      vn: 'vn-old',
      poi: releases.release,
      poiProfiles: { osm: releases.osmRelease },
    });
  });
});
