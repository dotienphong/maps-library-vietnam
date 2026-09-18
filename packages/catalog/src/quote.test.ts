import { describe, expect, it } from 'vitest';
import { CatalogError, MAX_PACKS, quoteOrder } from './quote';

describe('quoteOrder', () => {
  it('gói theo tháng: giá nhân số tháng, không chiết khấu', () => {
    expect(quoteOrder({ kind: 'plan', tier: 'starter', months: 1 })).toEqual({
      amountVnd: 650_000,
      amountUsdCents: 2_500,
    });
    expect(quoteOrder({ kind: 'plan', tier: 'starter', months: 3 })).toEqual({
      amountVnd: 1_950_000,
      amountUsdCents: 7_500,
    });
    expect(quoteOrder({ kind: 'plan', tier: 'business', months: 12 })).toEqual({
      amountVnd: 124_800_000,
      amountUsdCents: 480_000,
    });
  });

  it('mua thêm lượt: đơn giá khối nhân số khối', () => {
    expect(quoteOrder({ kind: 'addon', group: 'places', packs: 5 })).toEqual({
      amountVnd: 130_000,
      amountUsdCents: 500,
    });
    expect(quoteOrder({ kind: 'addon', group: 'directions', packs: 2 })).toEqual({
      amountVnd: 156_000,
      amountUsdCents: 600,
    });
  });

  it('từ chối kỳ ngoài 1/3/6/12 dù kiểu TypeScript bị lách qua JSON', () => {
    const input = { kind: 'plan', tier: 'starter', months: 2 } as unknown as Parameters<
      typeof quoteOrder
    >[0];
    expect(() => quoteOrder(input)).toThrow(CatalogError);
    expect(() => quoteOrder(input)).toThrow('invalid_months');
  });

  it('từ chối trial và bậc lạ ở đơn gói', () => {
    const trial = { kind: 'plan', tier: 'trial', months: 1 } as unknown as Parameters<
      typeof quoteOrder
    >[0];
    expect(() => quoteOrder(trial)).toThrow('invalid_tier');
    const la = { kind: 'plan', tier: 'enterprise', months: 1 } as unknown as Parameters<
      typeof quoteOrder
    >[0];
    expect(() => quoteOrder(la)).toThrow('invalid_tier');
  });

  it('từ chối số khối không nguyên, bằng 0 hoặc vượt trần', () => {
    expect(() => quoteOrder({ kind: 'addon', group: 'places', packs: 0 })).toThrow('invalid_packs');
    expect(() => quoteOrder({ kind: 'addon', group: 'places', packs: 1.5 })).toThrow(
      'invalid_packs',
    );
    expect(() => quoteOrder({ kind: 'addon', group: 'places', packs: MAX_PACKS + 1 })).toThrow(
      'invalid_packs',
    );
    expect(quoteOrder({ kind: 'addon', group: 'places', packs: MAX_PACKS }).amountVnd).toBe(
      26_000 * MAX_PACKS,
    );
  });

  it('từ chối nhóm quota lạ và loại đơn lạ', () => {
    const nhom = { kind: 'addon', group: 'tiles', packs: 1 } as unknown as Parameters<
      typeof quoteOrder
    >[0];
    expect(() => quoteOrder(nhom)).toThrow('invalid_group');
    const loai = { kind: 'gift' } as unknown as Parameters<typeof quoteOrder>[0];
    expect(() => quoteOrder(loai)).toThrow('invalid_kind');
  });

  it('CatalogError mang mã ở cả .code lẫn .message để route API dịch thẳng sang 400', () => {
    try {
      quoteOrder({ kind: 'addon', group: 'places', packs: 0 });
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogError);
      expect((error as CatalogError).code).toBe('invalid_packs');
      expect((error as CatalogError).name).toBe('CatalogError');
    }
  });
});
