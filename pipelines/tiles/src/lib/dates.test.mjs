import { describe, expect, it } from 'vitest';
import { releaseName, stampVN } from './dates.mjs';

describe('stampVN', () => {
  it('đổi thời điểm UTC sang ngày giờ VN (UTC+7) dạng YYYYMMDD', () => {
    expect(stampVN(new Date('2026-08-26T18:30:00Z'))).toBe('20260827');
    expect(stampVN(new Date('2026-08-26T10:00:00Z'))).toBe('20260826');
  });
});

describe('releaseName', () => {
  it('ghép tiền tố và ngày', () => {
    expect(releaseName('vn', new Date('2026-08-26T10:00:00Z'))).toBe('vn-20260826');
  });

  it('nhận tiền tố profile poi-osm', () => {
    expect(releaseName('poi-osm', new Date('2026-08-26T10:00:00Z'))).toBe('poi-osm-20260826');
  });
});
