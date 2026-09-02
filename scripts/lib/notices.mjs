// Đồng bộ LICENSE + THIRD_PARTY_NOTICES.md từ gốc repo vào các gói SDK publish npm (spec 12.1).
export const NOTICE_FILES = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];
export const SDK_PACKAGES = ['packages/core', 'packages/web', 'packages/react'];

/** @returns {{ src: string, dst: string }[]} */
export function noticePlan() {
  return SDK_PACKAGES.flatMap((pkg) =>
    NOTICE_FILES.map((file) => ({ src: file, dst: `${pkg}/${file}` })),
  );
}

/**
 * Bản sao thiếu hoặc khác nội dung gốc.
 * @param {{ src: string, dst: string }[]} plan
 * @param {(path: string) => string | undefined} read trả undefined nếu file không tồn tại
 */
export function staleCopies(plan, read) {
  return plan.filter(({ src, dst }) => read(dst) !== read(src)).map(({ dst }) => dst);
}
