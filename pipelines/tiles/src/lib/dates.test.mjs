import { describe, expect, it } from 'vitest';
import { poiReleasePair, releaseName, stampVN } from './dates.mjs';

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

describe('poiReleasePair', () => {
  it('dùng chung một build id có giờ VN và nonce cho cả hai profile', () => {
    expect(poiReleasePair(new Date('2026-08-26T10:00:00Z'), 'a1b2c3d4')).toEqual({
      buildId: '20260826-170000-a1b2c3d4',
      poi: 'poi-20260826-170000-a1b2c3d4',
      poiOsm: 'poi-osm-20260826-170000-a1b2c3d4',
    });
  });

  it('từ chối nonce có thể làm hỏng tên object', () => {
    expect(() => poiReleasePair(new Date(), '../same-name')).toThrow(/nonce/i);
  });
});
