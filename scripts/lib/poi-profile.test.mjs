import { describe, expect, it } from 'vitest';
import {
  missingProfileEnv,
  profileBatchSteps,
  profilePublishSteps,
  runProfileBatchSteps,
} from './poi-profile.mjs';

describe('profilePublishSteps', () => {
  it('đủ 5 bước theo thứ tự export → qa → upload → smoke → manifest', () => {
    const steps = profilePublishSteps('osm', 'poi-osm-20260907', '/app/out');
    expect(steps.map((s) => s.label)).toEqual(['export', 'qa', 'upload', 'smoke', 'manifest']);
    expect(steps[0]?.args).toEqual([
      'pipelines/poi/src/export-tiles.mjs',
      '--release',
      'poi-osm-20260907',
      '--sources',
      'osm',
    ]);
    expect(steps[1]?.args).toEqual([
      'pipelines/tiles/src/qa.mjs',
      '/app/out/poi-osm-20260907.pmtiles',
      '--skip-islands',
    ]);
    expect(steps[2]?.args).toEqual(['pipelines/tiles/src/upload.mjs', 'poi-osm-20260907']);
    expect(steps[3]?.args).toEqual([
      'pipelines/tiles/src/smoke.mjs',
      'poi-osm-20260907',
      '--set',
      'poi-osm',
    ]);
    expect(steps[4]?.args).toEqual([
      'pipelines/tiles/src/manifest.mjs',
      'set',
      '--poi-osm',
      'poi-osm-20260907',
    ]);
  });

  it('profile all bị từ chối: đó là việc của data:update, không phải công cụ này', () => {
    expect(() => profilePublishSteps('all', 'poi-20260907', '/app/out')).toThrowError(/all/);
  });

  it('profile lạ hoặc đã gỡ khỏi registry (overture) bị từ chối', () => {
    expect(() => profilePublishSteps('banana', 'x', '/app/out')).toThrowError(/profile/);
    expect(() => profilePublishSteps('overture', 'x', '/app/out')).toThrowError(/profile/);
    expect(() => profilePublishSteps('overture-fsq', 'x', '/app/out')).toThrowError(/profile/);
  });
});

describe('profileBatchSteps', () => {
  const input = {
    profiles: ['osm', 'fsq'],
    releases: { osm: 'poi-osm-run', fsq: 'poi-fsq-run' },
    buildId: 'run',
    snapshot: '/app/work/poi/snapshot-run.jsonl',
    out: '/app/out',
  };

  it('export/QA cả batch trước upload/smoke và chỉ set manifest một lần cuối', () => {
    const steps = profileBatchSteps(input);
    expect(steps.map(({ id }) => id)).toEqual([
      'export-osm',
      'qa-osm',
      'export-fsq',
      'qa-fsq',
      'upload-osm',
      'upload-fsq',
      'smoke-osm',
      'smoke-fsq',
      'manifest',
    ]);
    expect(steps[0]?.args).toEqual([
      'pipelines/poi/src/export-tiles.mjs',
      '--release',
      'poi-osm-run',
      '--sources',
      'osm',
      '--snapshot',
      '/app/work/poi/snapshot-run.jsonl',
      '--build-id',
      'run',
    ]);
    expect(steps.at(-1)?.args).toEqual([
      'pipelines/tiles/src/manifest.mjs',
      'set',
      '--poi-profile',
      'osm=poi-osm-run',
      '--poi-profile',
      'fsq=poi-fsq-run',
    ]);
  });

  it.each(['export-fsq', 'upload-osm', 'smoke-fsq'])(
    'lỗi tại %s không bao giờ chạy manifest',
    (failedId) => {
      /** @type {string[]} */
      const executed = [];
      expect(() =>
        runProfileBatchSteps(profileBatchSteps(input), (step) => {
          executed.push(step.id);
          if (step.id === failedId) throw new Error(`fault ${failedId}`);
        }),
      ).toThrow(`fault ${failedId}`);
      expect(executed).not.toContain('manifest');
    },
  );

  it('từ chối all, profile lạ hoặc đã gỡ (overture), release thiếu và danh sách trùng', () => {
    expect(() => profileBatchSteps({ ...input, profiles: ['all'] })).toThrow(/all/);
    expect(() => profileBatchSteps({ ...input, profiles: ['banana'] })).toThrow(/profile/);
    expect(() => profileBatchSteps({ ...input, profiles: ['overture-fsq'] })).toThrow(/profile/);
    expect(() => profileBatchSteps({ ...input, releases: { fsq: 'poi-fsq-run' } })).toThrow(
      /release/,
    );
    expect(() => profileBatchSteps({ ...input, profiles: ['fsq', 'fsq'] })).toThrow(/trùng/);
  });
});

describe('missingProfileEnv', () => {
  it('preflight đủ DB, R2, KV và Cloudflare trước build thật', () => {
    expect(missingProfileEnv({})).toContain('DATABASE_URL hoặc DB Tunnel');
    expect(
      missingProfileEnv({
        DATABASE_URL: 'postgres://local/test',
        TILES_BASE: 'https://tiles.test',
        R2_BUCKET: 'tiles',
        KV_NAMESPACE_ID_META: 'kv',
        CLOUDFLARE_ACCOUNT_ID: 'account',
        CLOUDFLARE_API_TOKEN: 'token',
        RCLONE_CONFIG_R2_ACCESS_KEY_ID: 'access',
        RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: 'secret',
        RCLONE_CONFIG_R2_ENDPOINT: 'https://r2.test',
        RCLONE_CONFIG_R2_NO_CHECK_BUCKET: 'true',
      }),
    ).toEqual([]);
  });
});
