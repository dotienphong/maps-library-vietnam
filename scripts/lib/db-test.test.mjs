import { describe, expect, it } from 'vitest';
import { isolatedDbUrl } from './db-test.mjs';

describe('isolatedDbUrl', () => {
  it('luôn chuyển DB local sang mapslibvn_task8_test', () => {
    expect(isolatedDbUrl('postgres://u:p@localhost:5432/mapslibvn').pathname).toBe(
      '/mapslibvn_task8_test',
    );
  });

  it('từ chối host không phải local', () => {
    expect(() => isolatedDbUrl('postgres://u:p@db.example.com:5432/mapslibvn')).toThrow(
      /chỉ chạy trên DB local/,
    );
  });
});
