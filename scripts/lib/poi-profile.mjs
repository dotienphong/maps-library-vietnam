// Các bước publish MỘT profile nguồn POI từ dữ liệu đã có trong DB (spec 07/09 mục 5).
// Tách khỏi data-update.mjs để publish được profile mới mà không phải ingest lại ba nguồn.
// Không import @mapslibvn/core trực tiếp: workspace gốc không khai nó, `poi-filter.mjs` mới có.
import { poiReleasePrefix, sourcesForProfile } from '../../pipelines/poi/src/lib/poi-filter.mjs';

/**
 * @param {string} profile tên profile khác `all`
 * @param {string} release ví dụ poi-osm-20260907
 * @param {string} out thư mục out
 * @returns {{ label: string, args: string[] }[]}
 */
export function profilePublishSteps(profile, release, out) {
  sourcesForProfile(profile); // ném lỗi nếu profile lạ
  if (profile === 'all') {
    throw new Error(
      'profile `all` là archive chính, publish bằng `pnpm data:update --poi` để state R2 và báo cáo đi cùng nhau',
    );
  }
  const set = poiReleasePrefix(profile);
  return [
    {
      label: 'export',
      args: ['pipelines/poi/src/export-tiles.mjs', '--release', release, '--sources', profile],
    },
    {
      label: 'qa',
      args: ['pipelines/tiles/src/qa.mjs', `${out}/${release}.pmtiles`, '--skip-islands'],
    },
    { label: 'upload', args: ['pipelines/tiles/src/upload.mjs', release] },
    { label: 'smoke', args: ['pipelines/tiles/src/smoke.mjs', release, '--set', set] },
    {
      label: 'manifest',
      args: ['pipelines/tiles/src/manifest.mjs', 'set', `--${set}`, release],
    },
  ];
}
