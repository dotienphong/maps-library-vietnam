// server:setup, server:update và server:restore chạy migration, db-restore, db-permissions và cron BÊN
// TRONG image pipeline. Image cũ hơn repo thì các lệnh đó chạy mã cũ mà vẫn báo xong — sự cố 26/09/2026:
// image cục bộ trên MacBook bỏ sót migration 0025, rồi (dù đã có 0025) vẫn mang db-permissions.mjs cũ,
// nên một lần restore sẽ lặp lại đúng lỗi làm chết trang admin. So TÊN migration không bắt được ca sau,
// nên so COMMIT: CI và `pnpm image:build` gắn nhãn commit + trạng thái cây, ở đây đòi không file nào
// chạy trong image khác giữa commit đó và HEAD.
import { spawnSync } from 'node:child_process';
import { capture } from './run.mjs';

export const NHAN_REV = 'org.opencontainers.image.revision';
export const NHAN_DIRTY = 'vn.mapslibvn.tree-dirty';

/**
 * Mọi thứ chạy trong image ở các lệnh máy chủ (pipelines dùng @mapslibvn/core và style), bỏ test và
 * tài liệu để một commit chỉ sửa test không bắt dựng lại image. Dùng chung cho `git diff` và `git status`.
 */
export const PATHSPEC = [
  'db',
  'scripts',
  'pipelines',
  'packages/core',
  'packages/style',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  ':(exclude,glob)**/*.test.mjs',
  ':(exclude,glob)**/*.dbtest.mjs',
  ':(exclude,glob)**/*.itest.mjs',
  ':(exclude,glob)**/tests/**',
  ':(exclude,glob)**/*.md',
];

/** @param {string} out output của `docker image inspect --format {{ index .Config.Labels … }}` */
export function docNhan(out) {
  const value = out.trim();
  return value === '<no value>' ? '' : value;
}

/** @param {string} image @param {string} head */
function cachSua(image, head) {
  return /:local$/.test(image.trim())
    ? [
        '  Image dựng tại máy: commit (hoặc stash) thay đổi rồi `pnpm image:build`, sau đó chạy lại lệnh này.',
      ]
    : [
        `  Image kéo từ GHCR: chờ job \`image\` của workflow CI xanh cho ${head.slice(0, 7) || 'HEAD'}`,
        '  (`gh run list --workflow CI --limit 3`) rồi chạy lại lệnh này.',
      ];
}

/**
 * @param {{ image: string, rev: string, dirty: string, head: string, revCoTrongRepo: boolean,
 *   thayDoi: string[] }} x
 * @returns {string | null} thông báo lỗi, hoặc null khi image khớp repo
 */
export function loiImageLechRepo({ image, rev, dirty, head, revCoTrongRepo, thayDoi }) {
  const duoi = [
    '  Chạy tiếp là migration/script trong image là bản cũ mà lệnh vẫn báo xong. Chưa đổi gì trên DB.',
    ...cachSua(image, head),
  ];
  if (!rev) {
    return [
      `✗ Image ${image} không có nhãn ${NHAN_REV} (dựng trước 26/09/2026) — không biết nó khớp repo không.`,
      ...duoi,
    ].join('\n');
  }
  if (dirty === 'true') {
    return [
      `✗ Image ${image} dựng từ cây có thay đổi chưa commit trong db/, scripts/, pipelines/… — không đưa lên máy chủ.`,
      ...duoi,
    ].join('\n');
  }
  if (!revCoTrongRepo) {
    return [
      `✗ Image ${image} dựng từ commit ${rev.slice(0, 7)} không có trong repo này — \`git fetch\` hoặc dựng lại image.`,
      ...duoi,
    ].join('\n');
  }
  if (thayDoi.length > 0) {
    const hien = thayDoi.slice(0, 10).join(', ');
    const them = thayDoi.length > 10 ? ` … và ${thayDoi.length - 10} file nữa` : '';
    return [
      `✗ Image ${image} dựng từ ${rev.slice(0, 7)}, repo đang ở ${head.slice(0, 7)}: ${thayDoi.length} file chạy trong image đã đổi (${hien}${them}).`,
      ...duoi,
    ].join('\n');
  }
  return null;
}

/**
 * Dừng tiến trình (mã 1) nếu image không khớp HEAD. Không pull: lệnh gọi đã pull/inspect image trước.
 * @param {string} image
 */
export function phaiKhopRepo(image) {
  const head = capture('git', ['rev-parse', 'HEAD']);
  if (!capture('docker', ['image', 'inspect', '--format', '{{.Id}}', image])) {
    console.error([`✗ Không có image ${image} tại máy.`, ...cachSua(image, head)].join('\n'));
    process.exit(1);
  }
  /** @param {string} key */
  const nhan = (key) =>
    docNhan(
      capture('docker', [
        'image',
        'inspect',
        '--format',
        `{{ index .Config.Labels "${key}" }}`,
        image,
      ]),
    );
  const rev = nhan(NHAN_REV);
  const revCoTrongRepo =
    Boolean(rev) &&
    spawnSync('git', ['cat-file', '-e', `${rev}^{commit}`], { stdio: 'ignore' }).status === 0;
  const thayDoi = revCoTrongRepo
    ? capture('git', ['diff', '--name-only', rev, 'HEAD', '--', ...PATHSPEC])
        .split('\n')
        .filter(Boolean)
    : [];
  const loi = loiImageLechRepo({
    image,
    rev,
    dirty: nhan(NHAN_DIRTY),
    head,
    revCoTrongRepo,
    thayDoi,
  });
  if (loi) {
    console.error(loi);
    process.exit(1);
  }
  console.log(`✓ Image ${image} khớp repo (${rev.slice(0, 7)}).`);
}
