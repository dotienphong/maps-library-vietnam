#!/usr/bin/env node
// Sinh 2 trang docs từ file canonical ở gốc repo (một nguồn sự thật, không copy tay):
//   docs/legal/dieu-khoan-tenant.md → src/content/docs/dieu-khoan.md
//   THIRD_PARTY_NOTICES.md          → src/content/docs/thong-bao-ben-thu-ba.md
// Starlight tự vẽ H1 từ frontmatter nên bỏ dòng H1 đầu của file gốc. Hai file sinh nằm trong
// .gitignore, nên ngày "Cập nhật lần cuối" lấy từ git của file GỐC và ghi vào frontmatter.
// Chỉ chạy khi gọi thẳng bằng `node`; import (test, scripts/lastmod.mjs) thì không ghi tệp nào.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ngayGit } from './ngay-git.mjs';

/** Thư mục apps/docs — mọi đường dẫn trong PAGES tính từ đây. */
export const GOC_DOCS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{ src: string, dst: string, title: string, description: string }[]} */
export const PAGES = [
  {
    src: '../../docs/legal/dieu-khoan-tenant.md',
    dst: 'src/content/docs/dieu-khoan.md',
    title: 'Điều khoản sử dụng API cho tenant',
    description:
      'Điều khoản sử dụng MapsLibVN cho ứng dụng nhúng: khoá API, chuỗi ghi nguồn bắt buộc, hành vi bị cấm như cào dữ liệu, dữ liệu cá nhân theo Nghị định 13/2023.',
  },
  {
    src: '../../THIRD_PARTY_NOTICES.md',
    dst: 'src/content/docs/thong-bao-ben-thu-ba.md',
    title: 'Thông báo bên thứ ba',
    description:
      'Giấy phép của thư viện, phông chữ, icon, style nền và dữ liệu mà SDK và API MapsLibVN đóng gói hoặc phục vụ tới client, kèm ghi chú về nhãn hiệu MapLibre.',
  },
];

/**
 * @param {{ title: string, description: string }} meta
 * @param {string} body
 * @param {string | undefined} lastUpdated ISO 8601 — ngày commit cuối của file gốc
 */
export function withFrontmatter(meta, body, lastUpdated) {
  const withoutH1 = body.replace(/^# .*\n+/, '');
  const dong = [
    `title: ${JSON.stringify(meta.title)}`,
    `description: ${JSON.stringify(meta.description)}`,
    // KHÔNG nháy: YAML đọc timestamp trần thành Date, đúng kiểu `z.date()` của Starlight; có nháy
    // là chuỗi và `astro build` đỏ.
    ...(lastUpdated ? [`lastUpdated: ${lastUpdated}`] : []),
  ];
  return `---\n${dong.join('\n')}\n---\n\n${withoutH1}`;
}

function main() {
  for (const page of PAGES) {
    const src = resolve(GOC_DOCS, page.src);
    if (!existsSync(src)) throw new Error(`Thiếu ${page.src}`);
    writeFileSync(
      resolve(GOC_DOCS, page.dst),
      withFrontmatter(page, readFileSync(src, 'utf8'), ngayGit(src)?.suaLuc),
    );
  }
  console.log(`✓ sinh ${PAGES.length} trang pháp lý vào src/content/docs`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
