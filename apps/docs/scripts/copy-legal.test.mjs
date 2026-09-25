import { describe, expect, it } from 'vitest';
import { PAGES, withFrontmatter } from './copy-legal.mjs';

describe('withFrontmatter', () => {
  it('ghi lastUpdated KHÔNG nháy để YAML đọc thành Date — schema Starlight đòi z.date()', () => {
    const md = withFrontmatter(
      { title: 'T', description: 'D' },
      '# H1 gốc\n\nThân',
      '2026-09-21T10:38:08+07:00',
    );
    expect(md.startsWith('---\ntitle: "T"\ndescription: "D"\n')).toBe(true);
    expect(md).toContain('\nlastUpdated: 2026-09-21T10:38:08+07:00\n---\n');
    expect(md).not.toContain('# H1 gốc');
    expect(md.endsWith('Thân')).toBe(true);
  });

  it('không có ngày git thì bỏ hẳn dòng lastUpdated', () => {
    expect(withFrontmatter({ title: 'T', description: 'D' }, 'Thân', undefined)).not.toContain(
      'lastUpdated',
    );
  });
});

describe('PAGES', () => {
  it('title ≤ 48 ký tự (còn chỗ cho " — MapsLibVN"), description 120–160 ký tự', () => {
    for (const trang of PAGES) {
      expect(trang.title.length, trang.dst).toBeLessThanOrEqual(48);
      expect(trang.description.length, trang.dst).toBeGreaterThanOrEqual(120);
      expect(trang.description.length, trang.dst).toBeLessThanOrEqual(160);
    }
  });
});
