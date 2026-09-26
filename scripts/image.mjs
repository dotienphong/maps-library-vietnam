#!/usr/bin/env node
// pnpm image:build | pnpm image:smoke — build và kiểm tra image pipeline
import { NHAN_DIRTY, NHAN_REV, PATHSPEC } from './lib/image-khop-repo.mjs';
import { capture, run } from './lib/run.mjs';

const IMAGE = process.env.PIPELINE_IMAGE ?? 'mapslibvn/pipeline:local';
const SMOKE = [
  'planetiler --help | head -1',
  'tippecanoe -v 2>&1 | head -1',
  'duckdb --version',
  'osmium --version | head -1',
  "python -c \"from importlib.metadata import version; print('pyosmium', version('osmium'))\"",
  'rclone version | head -1',
  'pg_dump --version',
  'zstd --version | head -1',
  'cloudflared --version',
  'node --version',
  'pnpm --version',
  // Luật tên chủ quyền của patch tiles (patch_sovereignty.py) — chỉ chạy được trong image (pyosmium).
  'python -m pytest -q -p no:cacheprovider pipelines/tiles/python',
].join(' && ');

const command = process.argv[2];
if (command === 'build') {
  // Nhãn commit + trạng thái cây: server:update/setup từ chối image lệch HEAD hoặc dựng từ cây bẩn
  // (Dockerfile `COPY . .` chép cả file chưa commit, kể cả migration đang viết dở).
  const head = capture('git', ['rev-parse', 'HEAD']);
  const dirty = capture('git', ['status', '--porcelain', '--', ...PATHSPEC]) !== '';
  if (dirty) {
    console.warn(
      '[image:build] Cây có thay đổi chưa commit trong db/, scripts/, pipelines/… — image mang nhãn dirty, server:update/setup sẽ từ chối nó.',
    );
  }
  run('docker', [
    'build',
    '-f',
    'pipelines/Dockerfile',
    '--label',
    `${NHAN_REV}=${head}`,
    '--label',
    `${NHAN_DIRTY}=${dirty}`,
    '-t',
    IMAGE,
    '.',
  ]);
} else if (command === 'smoke') {
  run('docker', ['run', '--rm', IMAGE, 'sh', '-c', SMOKE]);
  console.log(`\n✔ Image ${IMAGE} có đủ công cụ.`);
} else {
  console.error('Dùng: node scripts/image.mjs build|smoke');
  process.exit(2);
}
