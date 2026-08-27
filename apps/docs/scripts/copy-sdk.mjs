#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve('../../packages/web/dist');
const dst = resolve('public/sdk');
mkdirSync(dst, { recursive: true });
for (const f of ['mapslibvn.umd.js', 'mapslibvn.umd.js.map', 'mapslibvn.css']) {
  if (!existsSync(resolve(src, f)))
    throw new Error(`Thiếu ${f} — chạy pnpm --filter @mapslibvn/web build trước`);
  copyFileSync(resolve(src, f), resolve(dst, f));
}
console.log('✓ copy SDK vào public/sdk');
