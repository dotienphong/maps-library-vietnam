import { describe, expect, it } from 'vitest';
import { immutableUploadAction } from '../../pipelines/tiles/src/lib/archive-guard.mjs';
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
    const next = nextState(state, same, {
      poi: 'poi-20260910',
      poiOsm: 'poi-osm-20260910',
      poiProfiles: {
        osm: 'poi-osm-20260910',
        'overture-fsq': 'poi-overture-fsq-20260910',
        overture: 'poi-overture-20260910',
        fsq: 'poi-fsq-20260910',
      },
    });
    expect(next.releases).toEqual({
      vn: 'vn-20260819',
      poi: 'poi-20260910',
      poiOsm: 'poi-osm-20260910',
      poiProfiles: {
        osm: 'poi-osm-20260910',
        'overture-fsq': 'poi-overture-fsq-20260910',
        overture: 'poi-overture-20260910',
        fsq: 'poi-fsq-20260910',
      },
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

  it('nâng state cũ poiOsm vào poiProfiles mà vẫn giữ khoá tương thích', () => {
    const legacy = { ...state, releases: { ...state.releases, poiOsm: 'poi-osm-cu' } };
    expect(nextState(legacy, same, { poi: 'poi-moi' }).releases).toEqual({
      vn: 'vn-20260819',
      poi: 'poi-moi',
      poiOsm: 'poi-osm-cu',
      poiProfiles: { osm: 'poi-osm-cu' },
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

describe('POI release transaction', () => {
  const releaseInput = {
    releases: {
      all: 'poi-20260908-120000-abcd',
      osm: 'poi-osm-20260908-120000-abcd',
      'overture-fsq': 'poi-overture-fsq-20260908-120000-abcd',
      overture: 'poi-overture-20260908-120000-abcd',
      fsq: 'poi-fsq-20260908-120000-abcd',
    },
    buildId: '20260908-120000-abcd',
    snapshot: '/app/work/poi/snapshot-20260908-120000-abcd.jsonl',
    out: '/app/out',
  };

  const makeExternalState = () => ({
    current: {
      vn: 'vn-old',
      poi: 'poi-old',
      poiProfiles: /** @type {Record<string, string>} */ ({ osm: 'poi-osm-old' }),
    },
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
      if (step.id.startsWith('upload-')) {
        if (!uploadedRelease) throw new Error(`thiếu release cho ${step.id}`);
        external.checksums.set(uploadedRelease, `sha-${step.id.slice('upload-'.length)}-new`);
      }
      if (step.id === 'manifest') {
        external.current = {
          ...external.current,
          poi: releaseInput.releases.all,
          poiProfiles: Object.fromEntries(
            Object.entries(releaseInput.releases).filter(([profile]) => profile !== 'all'),
          ),
        };
      }
    };
    return { external, oldChecksums, execute };
  };

  it('dựng đủ năm profile từ cùng snapshot và chỉ commit manifest ở bước cuối', () => {
    const steps = poiReleaseSteps(releaseInput);
    expect(steps.filter((step) => step.id.startsWith('export-'))).toHaveLength(5);
    expect(steps.filter((step) => step.id.startsWith('qa-'))).toHaveLength(5);
    expect(steps.filter((step) => step.id.startsWith('upload-'))).toHaveLength(5);
    expect(steps.filter((step) => step.id.startsWith('smoke-'))).toHaveLength(5);
    expect(steps.at(-1)?.id).toBe('manifest');
    expect(
      steps.filter((step) => step.id.startsWith('export-')).map((step) => step.args.slice(-4)),
    ).toEqual(
      Array(5).fill(['--snapshot', releaseInput.snapshot, '--build-id', releaseInput.buildId]),
    );
  });

  for (const faultAt of ['export-fsq', 'upload-overture-fsq', 'smoke-all', 'smoke-overture']) {
    it(`lỗi ${faultAt} giữ manifest hiện hành và checksum archive cũ`, () => {
      const { external, oldChecksums, execute } = executeWithFault(faultAt);
      const current = structuredClone(external.current);

      expect(() => runPoiReleaseSteps(poiReleaseSteps(releaseInput), execute)).toThrow(
        `fault:${faultAt}`,
      );
      expect(external.current).toEqual(current);
      for (const [release, checksum] of oldChecksums) {
        expect(external.checksums.get(release)).toBe(checksum);
      }
    });
  }

  it('chỉ commit manifest sau khi năm upload và năm smoke đều thành công', () => {
    const { external, execute } = executeWithFault(undefined);
    runPoiReleaseSteps(poiReleaseSteps(releaseInput), execute);
    expect(external.current).toEqual({
      vn: 'vn-old',
      poi: releaseInput.releases.all,
      poiProfiles: Object.fromEntries(
        Object.entries(releaseInput.releases).filter(([profile]) => profile !== 'all'),
      ),
    });
  });

  for (const postManifestFault of ['report', 'state']) {
    it(`lỗi ${postManifestFault} sau manifest: retry reuse cùng checksum, chặn bytes khác`, () => {
      const { external, execute } = executeWithFault(undefined);
      runPoiReleaseSteps(poiReleaseSteps(releaseInput), execute);
      expect(() => {
        throw new Error(`fault:${postManifestFault}`);
      }).toThrow(`fault:${postManifestFault}`);
      const publishedSha256 = external.checksums.get(releaseInput.releases.all);
      if (!publishedSha256) throw new Error('fixture thiếu checksum release đã publish');

      expect(
        immutableUploadAction({
          archiveExists: true,
          checksumExists: true,
          localSha256: 'sha-all-new',
          remoteSha256: publishedSha256,
        }),
      ).toBe('reuse');
      expect(() =>
        immutableUploadAction({
          archiveExists: true,
          checksumExists: true,
          localSha256: 'bytes-khac',
          remoteSha256: publishedSha256,
        }),
      ).toThrow(/bất biến/);
    });
  }
});
