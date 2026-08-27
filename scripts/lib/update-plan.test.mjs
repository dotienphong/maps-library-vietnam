import { describe, expect, it } from 'vitest';
import { decideWork, missingLiveEnv, nextState } from './update-plan.mjs';

const state = {
  osm: { lastModified: 'Mon, 18 Aug 2026 20:00:00 GMT', md5: 'aaa' },
  releases: { vn: 'vn-20260819', poi: null },
};
const same = {
  osm: { lastModified: 'Mon, 18 Aug 2026 20:00:00 GMT', md5: 'aaa' },
};
const newer = {
  osm: { lastModified: 'Mon, 25 Aug 2026 20:00:00 GMT', md5: 'bbb' },
};

describe('decideWork', () => {
  it('không có gì mới → không làm gì', () => {
    expect(decideWork(state, same, {})).toEqual({
      tiles: false,
      poi: false,
      reasons: [],
    });
  });

  it('OSM mới → tiles và poi', () => {
    expect(decideWork(state, newer, {})).toEqual({
      tiles: true,
      poi: true,
      reasons: ['OSM đổi (md5 aaa → bbb)'],
    });
  });

  it('--force → làm tất cả kể cả khi không mới', () => {
    expect(decideWork(state, same, { force: true })).toEqual({
      tiles: true,
      poi: true,
      reasons: ['--force'],
    });
  });

  it('--tiles chỉ giữ tiles', () => {
    expect(decideWork(state, newer, { onlyTiles: true })).toEqual({
      tiles: true,
      poi: false,
      reasons: ['OSM đổi (md5 aaa → bbb)'],
    });
  });

  it('state rỗng (lần đầu) → làm tất cả', () => {
    expect(decideWork({}, same, {})).toEqual({
      tiles: true,
      poi: true,
      reasons: ['OSM đổi (md5 ∅ → aaa)'],
    });
  });
});

describe('nextState', () => {
  it('ghi phiên bản nguồn và tên release mới, giữ poi cũ', () => {
    expect(nextState(state, newer, { vn: 'vn-20260826' })).toEqual({
      osm: newer.osm,
      releases: { vn: 'vn-20260826', poi: null },
    });
  });
});

describe('missingLiveEnv', () => {
  it('dry-run không đòi credentials upload', () => {
    expect(missingLiveEnv({}, { dryRun: true })).toEqual([]);
  });

  it('live tiles liệt kê đúng credentials còn thiếu', () => {
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
    ]);
  });
});
