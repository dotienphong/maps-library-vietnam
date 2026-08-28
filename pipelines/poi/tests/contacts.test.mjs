import { describe, expect, it } from 'vitest';
import { domainOf, domainsOf, normalizePhoneVN, phonesOf } from '../src/lib/contacts.mjs';

describe('normalizePhoneVN → E.164', () => {
  it('cố định và di động, mọi cách viết', () => {
    expect(normalizePhoneVN('028 3822 9999')).toBe('+842838229999');
    expect(normalizePhoneVN('(028) 3822-9999')).toBe('+842838229999');
    expect(normalizePhoneVN('+84 28 3822 9999')).toBe('+842838229999');
    expect(normalizePhoneVN('0909 123 456')).toBe('+84909123456');
    expect(normalizePhoneVN('84909123456')).toBe('+84909123456');
    expect(normalizePhoneVN('0084909123456')).toBe('+84909123456');
  });
  it('tổng đài 1900/1800, số quá ngắn/dài, rác → null', () => {
    expect(normalizePhoneVN('1900 1234')).toBeNull();
    expect(normalizePhoneVN('0123')).toBeNull();
    expect(normalizePhoneVN('0909123456789')).toBeNull();
    expect(normalizePhoneVN('không có')).toBeNull();
  });
  it('phonesOf: tách ; và /, loại trùng, bỏ null', () => {
    expect(phonesOf(['0909 123 456; 028 3822 9999', '+84909123456', 'abc'])).toEqual([
      '+84909123456',
      '+842838229999',
    ]);
  });
});

describe('domainOf / domainsOf', () => {
  it('lấy host, bỏ www, thêm scheme nếu thiếu', () => {
    expect(domainOf('https://www.highlandscoffee.com.vn/stores/1')).toBe('highlandscoffee.com.vn');
    expect(domainOf('phuclong.com.vn')).toBe('phuclong.com.vn');
    expect(domainOf('HTTP://Shop.Example.COM')).toBe('shop.example.com');
  });
  it('mạng xã hội/sàn TMĐT không dùng để khớp → null', () => {
    expect(domainOf('https://www.facebook.com/congcaphe')).toBeNull();
    expect(domainOf('https://shopee.vn/abc')).toBeNull();
    expect(domainOf('not a url at all ...')).toBeNull();
  });
  it('domainsOf loại trùng', () => {
    expect(domainsOf(['https://a.vn/x', 'http://www.a.vn', 'https://facebook.com/a'])).toEqual([
      'a.vn',
    ]);
  });
});
