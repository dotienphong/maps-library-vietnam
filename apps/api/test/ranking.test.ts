import { describe, expect, it } from 'vitest';
import {
  COEFF,
  gridKey,
  isAdminOnlyQuery,
  priorFor,
  proxScore,
  rankScore,
  STAGE_PENALTY,
  withAreaSlot,
} from '../src/ranking';

describe('ranking spec 6.2', () => {
  it('hệ số đúng spec', () => {
    expect(COEFF).toEqual({ sim: 0.55, prox: 0.25, pop: 0.15, prior: 0.05 });
  });

  it('prox: không near → 0.5; d=0 → 1; d=5km → e^-1', () => {
    expect(proxScore(null)).toBe(0.5);
    expect(proxScore(0)).toBe(1);
    expect(proxScore(5000)).toBeCloseTo(Math.exp(-1), 5);
  });

  it('prior: POI 1, đường 0.7; q bắt đầu bằng số → đảo (địa chỉ 1, POI 0.5)', () => {
    expect(priorFor('poi', false)).toBe(1);
    expect(priorFor('street', false)).toBe(0.7);
    expect(priorFor('address', true)).toBe(1);
    expect(priorFor('poi', true)).toBe(0.5);
    expect(priorFor('street', true)).toBe(0.7);
    expect(priorFor('area', false)).toBe(0.6);
    expect(priorFor('area', true)).toBe(0.6);
  });

  it('prefix cộng 0.1 vào sim', () => {
    const base = {
      sim: 0.8,
      prefix: false,
      dMeters: null,
      pop: 0,
      type: 'poi' as const,
      qStartsWithDigit: false,
    };
    expect(rankScore({ ...base, prefix: true }) - rankScore(base)).toBeCloseTo(0.55 * 0.1, 5);
  });

  it('kịch bản fixture: tên khớp hẳn + pop cao thắng tên dài hơn dù gần hơn một chút', () => {
    const linhXuan = rankScore({
      sim: 1,
      prefix: true,
      dMeters: 12_500,
      pop: 0.9,
      type: 'poi',
      qStartsWithDigit: false,
    });
    const truong2 = rankScore({
      sim: 0.93,
      prefix: true,
      dMeters: 14_900,
      pop: 0.4,
      type: 'poi',
      qStartsWithDigit: false,
    });
    expect(linhXuan).toBeGreaterThan(truong2);
  });

  it('gridKey chia bucket 0.05° ổn định, kể cả toạ độ âm', () => {
    expect(gridKey(10.77, 106.7)).toBe(gridKey(10.78, 106.71));
    expect(gridKey(10.77, 106.7)).not.toBe(gridKey(10.9, 106.7));
    expect(gridKey(-10.77, -106.71)).toBe(gridKey(-10.78, -106.72));
  });
});

// Cổng 7.6 đo được: vùng hành chính luôn thua POI vì `pop` của vùng là 0, mất trắng 0,15·pop,
// trong khi `prior` chỉ nặng 0,05 nên không bù nổi. Không sửa bằng cách bịa `pop` cho vùng —
// plan cấm đổi xếp hạng POI/đường — mà dành một suất cuối khi truy vấn là thuần tên hành chính.
describe('withAreaSlot', () => {
  const poi = (score: number) => ({ type: /** @type {const} */ ('poi'), score }) as const;
  const area = (score: number) => ({ type: /** @type {const} */ ('area'), score }) as const;
  const ranked = [poi(0.9), poi(0.88), poi(0.87), area(0.76), area(0.7)];

  it('không phải truy vấn hành chính thì cắt như cũ', () => {
    expect(withAreaSlot(ranked, 3, false)).toEqual([poi(0.9), poi(0.88), poi(0.87)]);
  });

  it('truy vấn hành chính mà vùng bị đẩy ra thì vùng điểm cao nhất chiếm suất cuối', () => {
    const result = withAreaSlot(ranked, 3, true);
    expect(result).toEqual([poi(0.9), poi(0.88), area(0.76)]);
    expect(result).toHaveLength(3);
  });

  it('chỉ dành đúng một suất, không đẩy thêm vùng thứ hai', () => {
    expect(withAreaSlot(ranked, 4, true).filter((item) => item.type === 'area')).toHaveLength(1);
  });

  it('vùng đã nằm trong top thì không đổi gì', () => {
    const withArea = [poi(0.9), area(0.85), poi(0.8)];
    expect(withAreaSlot(withArea, 2, true)).toEqual([poi(0.9), area(0.85)]);
  });

  it('không có ứng viên vùng nào thì giữ nguyên POI', () => {
    expect(withAreaSlot([poi(0.9), poi(0.8)], 2, true)).toEqual([poi(0.9), poi(0.8)]);
  });

  it('limit 1 vẫn trả đúng một mục và là vùng', () => {
    expect(withAreaSlot(ranked, 1, true)).toEqual([area(0.76)]);
  });
});

describe('isAdminOnlyQuery', () => {
  it('tên hành chính trần là truy vấn hành chính', () => {
    expect(isAdminOnlyQuery({ alleyChain: [], confidence: 0.2, district: '10' })).toBe(true);
    expect(isAdminOnlyQuery({ alleyChain: [], confidence: 0.2, ward: 'an loi dong' })).toBe(true);
    expect(isAdminOnlyQuery({ alleyChain: [], confidence: 0.2, province: 'Bình Dương' })).toBe(
      true,
    );
  });

  it('có số nhà hoặc tên đường thì KHÔNG phải: người dùng đang tìm địa chỉ', () => {
    expect(
      isAdminOnlyQuery({
        alleyChain: [],
        confidence: 1,
        housenumber: '88/9',
        street: 'Nguyễn Lâm',
        ward: '6',
        district: '10',
      }),
    ).toBe(false);
    expect(
      isAdminOnlyQuery({ alleyChain: [], confidence: 0.4, street: 'Lê Lợi', district: '1' }),
    ).toBe(false);
  });

  it('không có phần hành chính nào thì không phải', () => {
    expect(isAdminOnlyQuery({ alleyChain: [], confidence: 0 })).toBe(false);
  });
});

describe('STAGE_PENALTY — bậc sau không được vượt bậc trước khi sim tương đương', () => {
  const base = {
    sim: 0.8,
    prefix: false,
    dMeters: null,
    pop: 0.5,
    type: 'poi' as const,
    qStartsWithDigit: false,
  };

  it('bậc 3 thấp hơn bậc 1 đúng 2 × STAGE_PENALTY, bậc 2 đúng 1 ×', () => {
    expect(rankScore({ ...base, stage: 1 })).toBeCloseTo(
      rankScore({ ...base, stage: 2 }) + STAGE_PENALTY,
      10,
    );
    expect(rankScore({ ...base, stage: 1 })).toBeCloseTo(
      rankScore({ ...base, stage: 3 }) + 2 * STAGE_PENALTY,
      10,
    );
  });

  it('không truyền stage thì điểm y hệt stage 1 — kết quả cũ không đổi', () => {
    expect(rankScore(base)).toBe(rankScore({ ...base, stage: 1 }));
  });
});
