import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ngayGit } from './ngay-git.mjs';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/;

describe('ngayGit', () => {
  it('tệp có lịch sử: hai ngày ISO 8601, ngày tạo không sau ngày sửa', () => {
    const ngay = ngayGit(resolve('apps/docs/src/content/docs/api.md'));
    expect(ngay?.taoLuc).toMatch(ISO);
    expect(ngay?.suaLuc).toMatch(ISO);
    expect(Date.parse(ngay?.taoLuc ?? '')).toBeLessThanOrEqual(Date.parse(ngay?.suaLuc ?? ''));
  });

  it('tệp không có lịch sử git trả undefined, không ném lỗi', () => {
    const tep = join(mkdtempSync(join(tmpdir(), 'mlv-git-')), 'moi.md');
    writeFileSync(tep, 'x');
    expect(ngayGit(tep)).toBeUndefined();
  });
});
