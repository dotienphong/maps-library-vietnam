import { describe, expect, it } from 'vitest';
import { immutableUploadAction } from '../../pipelines/tiles/src/lib/archive-guard.mjs';
import {
  decideWork,
  missingLiveEnv,
  nextState,
  parseRoutingGraphStatus,
  poiReleaseSteps,
  recoverAndReadRoutingGraphStatus,
  routingStep,
  runPoiReleaseSteps,
  runTileReleaseSteps,
  serverRoutingSetupSteps,
  tileReleaseSteps,
} from './update-plan.mjs';

const state = {
  osm: { lastModified: 'Mon, 18 Aug 2026 20:00:00 GMT', md5: 'aaa' },
  fsq: { release: '2026-07-08' },
  releases: { vn: 'vn-20260819', poi: 'poi-20260819' },
};
const same = { osm: state.osm, fsq: state.fsq };
const osmNew = {
  ...same,
  osm: { lastModified: 'Mon, 25 Aug 2026 20:00:00 GMT', md5: 'bbb' },
};
const fsqNew = { ...same, fsq: { release: '2026-08-05' } };

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

  it('FSQ mới → chỉ poi', () => {
    expect(decideWork(state, fsqNew, {})).toEqual({
      tiles: false,
      poi: true,
      reasons: ['FSQ đổi (2026-07-08 → 2026-08-05)'],
    });
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

  it('state rỗng (lần đầu) → làm tất cả với 2 lý do (OSM, FSQ)', () => {
    expect(decideWork({}, same, {}).reasons).toHaveLength(2);
  });
});

describe('nextState', () => {
  it('ghi cả 2 nguồn và release mới, giữ release cũ nếu không build', () => {
    expect(nextState(state, fsqNew, { poi: 'poi-20260826' })).toEqual({
      osm: state.osm,
      fsq: { release: '2026-08-05' },
      releases: { vn: 'vn-20260819', poi: 'poi-20260826' },
    });
  });

  it('ghi releases.poiOsm khi build profile osm, không bịa khoá khi không build', () => {
    const next = nextState(state, same, {
      poi: 'poi-20260910',
      poiOsm: 'poi-osm-20260910',
      poiProfiles: { osm: 'poi-osm-20260910', fsq: 'poi-fsq-20260910' },
    });
    expect(next.releases).toEqual({
      vn: 'vn-20260819',
      poi: 'poi-20260910',
      poiOsm: 'poi-osm-20260910',
      poiProfiles: { osm: 'poi-osm-20260910', fsq: 'poi-fsq-20260910' },
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

  it('lọc khoá poiProfiles ngoài registry (overture*, osm-fsq) khi gộp state cũ', () => {
    const stale = {
      ...state,
      releases: {
        ...state.releases,
        poiProfiles: {
          osm: 'poi-osm-1',
          overture: 'poi-overture-x',
          'overture-fsq': 'poi-overture-fsq-x',
          'osm-fsq': 'poi-osm-fsq-x',
          fsq: 'poi-fsq-1',
        },
      },
    };
    expect(nextState(stale, same, { poi: 'poi-moi' }).releases?.poiProfiles).toEqual({
      osm: 'poi-osm-1',
      fsq: 'poi-fsq-1',
    });
    // Khoá lạ từ `built` cũng không được lọt vào state.
    expect(
      nextState(state, same, { poi: 'poi-moi', poiProfiles: { fsq: 'poi-fsq-2', overture: 'x' } })
        .releases?.poiProfiles,
    ).toEqual({ fsq: 'poi-fsq-2' });
  });

  it('--poi khi OSM đổi giữ pending tiles cho lần chạy sau', () => {
    const afterPoi = nextState(state, osmNew, { poi: 'poi-20260826' });
    expect(afterPoi.pending).toEqual({ tiles: true, poi: false });
    expect(decideWork(afterPoi, osmNew, {})).toMatchObject({ tiles: true, poi: false });
  });

  it('--tiles không nuốt pending POI do OSM/FSQ đổi', () => {
    const versions = { ...osmNew, fsq: fsqNew.fsq };
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

describe('routingStep', () => {
  it('chỉ chạy khi có tiles mới, volume valhalla gắn và không --skip-routing', () => {
    expect(routingStep({ tiles: true, graphDirExists: true, skipRouting: false })).toEqual({
      run: true,
      reason: 'OSM đổi → build lại graph Valhalla',
    });
    expect(routingStep({ tiles: false, graphDirExists: true, skipRouting: false })).toEqual({
      run: false,
      reason: 'tiles không đổi',
    });
    expect(routingStep({ tiles: true, graphDirExists: false, skipRouting: false })).toEqual({
      run: false,
      reason: 'không có volume valhalla-data (máy dev)',
    });
    expect(routingStep({ tiles: true, graphDirExists: true, skipRouting: true })).toEqual({
      run: false,
      reason: '--skip-routing',
    });
  });
});

describe('tile release transaction', () => {
  it('prepare graph trước manifest; lỗi graph không commit và retry chạy lại tuần tự', () => {
    const steps = tileReleaseSteps({
      release: 'vn-20260911',
      routing: { run: true },
    });
    /** @type {string[]} */
    const calls = [];
    let manifest = 'vn-old';
    const execute = (/** @type {{ id: string, command: string, args: string[] }} */ step) => {
      calls.push(step.id);
      if (step.id === 'routing-prepare') throw new Error('graph chưa sẵn sàng');
      if (step.id === 'manifest') manifest = 'vn-20260911';
    };

    expect(() => runTileReleaseSteps(steps, execute)).toThrow(/graph chưa sẵn sàng/);
    expect(calls).toEqual(['build', 'qa', 'upload', 'smoke', 'routing-prepare']);
    expect(manifest).toBe('vn-old');

    calls.length = 0;
    runTileReleaseSteps(
      steps,
      (/** @type {{ id: string, command: string, args: string[] }} */ step) => {
        calls.push(step.id);
        if (step.id === 'manifest') manifest = 'vn-20260911';
      },
    );
    expect(calls).toEqual(['build', 'qa', 'upload', 'smoke', 'routing-prepare', 'manifest']);
    expect(manifest).toBe('vn-20260911');
    expect(steps.find((step) => step.id === 'routing-prepare')?.args).toEqual([
      'scripts/routing-graph.mjs',
      'prepare',
      '--vn-release',
      'vn-20260911',
    ]);
  });
});

describe('server routing setup transaction', () => {
  it('phục hồi/status trước khi quyết định tar và chỉ start sau prepare', () => {
    expect(serverRoutingSetupSteps({ hasTar: true, hasPbf: true })).toEqual([
      { id: 'status' },
      { id: 'start' },
    ]);
    expect(serverRoutingSetupSteps({ hasTar: false, hasPbf: false })).toEqual([
      { id: 'status' },
      { id: 'download' },
      { id: 'prepare' },
      { id: 'start' },
    ]);
  });

  it('recovered/pending graph không tar thì start wrapper, không prepare lại', () => {
    const pending = parseRoutingGraphStatus({
      tarBytes: null,
      copiedPbf: { bytes: 123, md5: 'a'.repeat(32), matchesActiveGraph: false },
      pendingReload: true,
      buildInProgress: false,
      buildFailed: false,
    });
    expect(pending).toEqual({
      hasTar: false,
      hasPbf: true,
      pendingReload: true,
      buildInProgress: false,
      buildFailed: false,
    });
    expect(serverRoutingSetupSteps(pending)).toEqual([{ id: 'status' }, { id: 'start' }]);

    for (const recoveryState of [
      { pendingReload: false, buildInProgress: true, buildFailed: false },
      { pendingReload: false, buildInProgress: false, buildFailed: true },
    ]) {
      expect(serverRoutingSetupSteps({ hasTar: false, hasPbf: true, ...recoveryState })).toEqual([
        { id: 'status' },
        { id: 'start' },
      ]);
    }
  });

  it('upgrade cũ để lại failed trên volume trống thì reset rồi bootstrap an toàn', () => {
    expect(
      serverRoutingSetupSteps({
        hasTar: false,
        hasPbf: false,
        pendingReload: false,
        buildInProgress: true,
        buildFailed: true,
      }),
    ).toEqual([
      { id: 'status' },
      { id: 'reset-empty' },
      { id: 'download' },
      { id: 'prepare' },
      { id: 'start' },
    ]);
  });

  it('chạy status recovery có log trước, rồi đọc JSON sạch để start không prepare', () => {
    const recoveryOutput = [
      'Khôi phục reload dở dang: chuyển reload.request sang reload.in-progress.',
      '{"activeGraph":"vn-old","tarBytes":null,"copiedPbf":{"bytes":123,"md5":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","matchesActiveGraph":false},"pendingReload":true,"buildInProgress":false,"buildFailed":false}',
    ].join('\n');
    /** @type {string[]} */
    const calls = [];
    const status = recoverAndReadRoutingGraphStatus({
      runStatus: () => {
        calls.push(`inherited:${recoveryOutput}`);
      },
      captureStatus: () => {
        calls.push('captured');
        return JSON.stringify({
          activeGraph: 'vn-old',
          tarBytes: null,
          copiedPbf: {
            bytes: 123,
            md5: 'a'.repeat(32),
            matchesActiveGraph: false,
          },
          pendingReload: true,
          buildInProgress: false,
          buildFailed: false,
        });
      },
    });

    expect(calls).toEqual([`inherited:${recoveryOutput}`, 'captured']);
    expect(serverRoutingSetupSteps(status)).toEqual([{ id: 'status' }, { id: 'start' }]);
  });
});

describe('POI release transaction', () => {
  const releaseInput = {
    releases: {
      all: 'poi-20260908-120000-abcd',
      osm: 'poi-osm-20260908-120000-abcd',
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

  it('dựng đủ ba profile registry (all, osm, fsq) từ cùng snapshot và chỉ commit manifest ở bước cuối', () => {
    const steps = poiReleaseSteps(releaseInput);
    expect(steps.filter((step) => step.id.startsWith('export-'))).toHaveLength(3);
    expect(steps.filter((step) => step.id.startsWith('qa-'))).toHaveLength(3);
    expect(steps.filter((step) => step.id.startsWith('upload-'))).toHaveLength(3);
    expect(steps.filter((step) => step.id.startsWith('smoke-'))).toHaveLength(3);
    expect(steps.at(-1)?.id).toBe('manifest');
    expect(
      steps.filter((step) => step.id.startsWith('export-')).map((step) => step.args.slice(-4)),
    ).toEqual(
      Array(3).fill(['--snapshot', releaseInput.snapshot, '--build-id', releaseInput.buildId]),
    );
  });

  it('release có profile ngoài registry (overture) bị từ chối trước khi chạy bước nào', () => {
    expect(() =>
      poiReleaseSteps({
        ...releaseInput,
        releases: { ...releaseInput.releases, overture: 'poi-overture-20260908-120000-abcd' },
      }),
    ).toThrow(/profile/);
  });

  for (const faultAt of ['export-fsq', 'upload-osm', 'smoke-all', 'smoke-fsq']) {
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

  it('chỉ commit manifest sau khi ba upload và ba smoke đều thành công', () => {
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
