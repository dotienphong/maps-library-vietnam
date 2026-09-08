// Các bước publish MỘT profile nguồn POI từ dữ liệu đã có trong DB (spec 07/09 mục 5).
// Tách khỏi data-update.mjs để publish được profile mới mà không phải ingest lại ba nguồn.
// Không import @mapslibvn/core trực tiếp: workspace gốc không khai nó, `poi-filter.mjs` mới có.
import { poiReleasePrefix, sourcesForProfile } from '../../pipelines/poi/src/lib/poi-filter.mjs';

const PROFILE_LIVE_ENV = [
  'TILES_BASE',
  'R2_BUCKET',
  'KV_NAMESPACE_ID_META',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'RCLONE_CONFIG_R2_ACCESS_KEY_ID',
  'RCLONE_CONFIG_R2_SECRET_ACCESS_KEY',
  'RCLONE_CONFIG_R2_ENDPOINT',
  'RCLONE_CONFIG_R2_NO_CHECK_BUCKET',
];

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
export function missingProfileEnv(env) {
  const missing = PROFILE_LIVE_ENV.filter((name) => !env[name]?.trim());
  const hasDirectDatabase = Boolean(env.DATABASE_URL?.trim());
  const hasDatabaseTunnel = [
    'DB_TUNNEL_HOSTNAME',
    'PIPELINE_DATABASE_URL',
    'CF_ACCESS_CLIENT_ID',
    'CF_ACCESS_CLIENT_SECRET',
  ].every((name) => env[name]?.trim());
  if (!hasDirectDatabase && !hasDatabaseTunnel) missing.push('DATABASE_URL hoặc DB Tunnel');
  return missing;
}

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
      args:
        profile === 'osm'
          ? ['pipelines/tiles/src/manifest.mjs', 'set', '--poi-osm', release]
          : ['pipelines/tiles/src/manifest.mjs', 'set', '--poi-profile', `${profile}=${release}`],
    },
  ];
}

/**
 * Các bước phát hành nguyên tử nhiều profile từ cùng snapshot. Manifest luôn là bước cuối.
 * @param {{ profiles: string[], releases: Record<string, string>, buildId: string,
 *   snapshot: string, out: string }} input
 * @returns {{ id: string, command: 'node', args: string[] }[]}
 */
export function profileBatchSteps({ profiles, releases, buildId, snapshot, out }) {
  if (profiles.length === 0) throw new Error('Batch profile rỗng');
  if (new Set(profiles).size !== profiles.length) throw new Error('Batch profile bị trùng');
  for (const profile of profiles) {
    sourcesForProfile(profile);
    if (profile === 'all') throw new Error('Profile all không thuộc batch bootstrap');
    if (!releases[profile]) throw new Error(`Thiếu release cho profile ${profile}`);
  }

  const steps = [];
  for (const profile of profiles) {
    const release = /** @type {string} */ (releases[profile]);
    steps.push(
      {
        id: `export-${profile}`,
        command: /** @type {const} */ ('node'),
        args: [
          'pipelines/poi/src/export-tiles.mjs',
          '--release',
          release,
          '--sources',
          profile,
          '--snapshot',
          snapshot,
          '--build-id',
          buildId,
        ],
      },
      {
        id: `qa-${profile}`,
        command: /** @type {const} */ ('node'),
        args: ['pipelines/tiles/src/qa.mjs', `${out}/${release}.pmtiles`, '--skip-islands'],
      },
    );
  }
  for (const profile of profiles) {
    steps.push({
      id: `upload-${profile}`,
      command: /** @type {const} */ ('node'),
      args: ['pipelines/tiles/src/upload.mjs', /** @type {string} */ (releases[profile])],
    });
  }
  for (const profile of profiles) {
    steps.push({
      id: `smoke-${profile}`,
      command: /** @type {const} */ ('node'),
      args: [
        'pipelines/tiles/src/smoke.mjs',
        /** @type {string} */ (releases[profile]),
        '--set',
        poiReleasePrefix(profile),
      ],
    });
  }
  steps.push({
    id: 'manifest',
    command: /** @type {const} */ ('node'),
    args: [
      'pipelines/tiles/src/manifest.mjs',
      'set',
      ...profiles.flatMap((profile) => [
        '--poi-profile',
        `${profile}=${/** @type {string} */ (releases[profile])}`,
      ]),
    ],
  });
  return steps;
}

/**
 * @param {{ id: string, command: 'node', args: string[] }[]} steps
 * @param {(step: { id: string, command: 'node', args: string[] }) => void} execute
 */
export function runProfileBatchSteps(steps, execute) {
  for (const step of steps) execute(step);
}
