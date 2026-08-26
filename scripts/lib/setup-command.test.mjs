import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOCUMENTED_FILES = [
  'README.md',
  'scripts/setup.mjs',
  'docs/DEVLOG.md',
  'docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md',
  'docs/superpowers/plans/2026-08-26-roadmap-toan-bo-spec.md',
  'docs/superpowers/plans/2026-08-26-m1a-nen-tang-moi-truong.md',
  'docs/superpowers/plans/2026-08-26-m1c-worker-web-sdk-docs.md',
];

describe('setup command contract', () => {
  it('khai báo script setup trong package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.setup).toBe('node scripts/setup.mjs');
  });

  it('không tài liệu nào chỉ dẫn chạy `pnpm setup` vì trùng lệnh built-in của pnpm', () => {
    for (const file of DOCUMENTED_FILES) {
      const violations = readFileSync(file, 'utf8')
        .split('\n')
        .filter(
          (line) => /\bpnpm setup\b/.test(line) && !/(không phải|built-in|trùng lệnh)/.test(line),
        );
      expect(violations, file).toEqual([]);
    }
  });
});
