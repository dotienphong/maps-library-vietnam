#!/usr/bin/env node
// Sinh 2 trang docs từ file canonical ở gốc repo (một nguồn sự thật, không copy tay):
//   docs/legal/dieu-khoan-tenant.md → src/content/docs/dieu-khoan.md
//   THIRD_PARTY_NOTICES.md          → src/content/docs/thong-bao-ben-thu-ba.md
// Starlight tự vẽ H1 từ frontmatter nên bỏ dòng H1 đầu của file gốc. Hai file sinh nằm trong .gitignore.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGES = [
  {
    src: '../../docs/legal/dieu-khoan-tenant.md',
    dst: 'src/content/docs/dieu-khoan.md',
    title: 'Điều khoản tenant',
    description:
      'Điều khoản sử dụng MapsLibVN dành cho ứng dụng nhúng: khoá API, ghi nguồn, cấm cào dữ liệu, dữ liệu cá nhân.',
  },
  {
    src: '../../THIRD_PARTY_NOTICES.md',
    dst: 'src/content/docs/thong-bao-ben-thu-ba.md',
    title: 'Thông báo bên thứ ba',
    description: 'Giấy phép của thư viện, phông, icon và dữ liệu mà SDK MapsLibVN sử dụng.',
  },
];

/**
 * @param {{ title: string, description: string }} meta
 * @param {string} body
 */
export function withFrontmatter(meta, body) {
  const withoutH1 = body.replace(/^# .*\n+/, '');
  return `---\ntitle: ${JSON.stringify(meta.title)}\ndescription: ${JSON.stringify(meta.description)}\n---\n\n${withoutH1}`;
}

for (const page of PAGES) {
  const src = resolve(page.src);
  if (!existsSync(src)) throw new Error(`Thiếu ${page.src}`);
  writeFileSync(resolve(page.dst), withFrontmatter(page, readFileSync(src, 'utf8')));
}
console.log(`✓ sinh ${PAGES.length} trang pháp lý vào src/content/docs`);
