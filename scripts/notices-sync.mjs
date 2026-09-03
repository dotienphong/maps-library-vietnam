#!/usr/bin/env node
// Đồng bộ LICENSE + THIRD_PARTY_NOTICES.md vào các gói SDK. `--check` chỉ kiểm (CI), thoát 1 nếu lệch.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SDK_PACKAGES, noticePlan, staleCopies } from './lib/notices.mjs';

/** @param {string} path */
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

/** @param {string[]} argv */
export function main(argv) {
  const plan = noticePlan();
  const stale = staleCopies(plan, read);
  if (argv.includes('--check')) {
    if (stale.length > 0) {
      console.error(`Bản sao notices lệch gốc: ${stale.join(', ')} — chạy pnpm notices:sync`);
      return 1;
    }
    console.log(`✓ notices trong ${SDK_PACKAGES.length} gói SDK khớp gốc`);
    return 0;
  }
  for (const { src, dst } of plan) copyFileSync(src, dst);
  console.log(`đã đồng bộ ${plan.length} file (${stale.length} thay đổi)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
