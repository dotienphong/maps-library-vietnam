import { describe, expect, it } from 'vitest';
import { thamSoDon } from './api';

describe('thamSoDon', () => {
  it('chỉ đưa vào URL những bộ lọc có giá trị; limit mặc định 25', () => {
    expect(thamSoDon({}).toString()).toBe('limit=25');
    expect(
      thamSoDon({
        status: 'pending',
        tenant: 't1',
        from: '2026-09-01',
        to: '2026-09-19',
        cursor: 'c|d',
        limit: 5,
      }).toString(),
    ).toBe('limit=5&status=pending&tenant=t1&from=2026-09-01&to=2026-09-19&cursor=c%7Cd');
  });

  it('chuỗi rỗng coi như không lọc', () => {
    expect(thamSoDon({ tenant: '', from: '' }).toString()).toBe('limit=25');
  });
});
