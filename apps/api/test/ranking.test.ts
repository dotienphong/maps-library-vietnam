import { describe, expect, it } from 'vitest';
import { COEFF, gridKey, priorFor, proxScore, rankScore } from '../src/ranking';

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
