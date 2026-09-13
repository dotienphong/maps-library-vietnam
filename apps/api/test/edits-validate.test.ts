import { describe, expect, it } from 'vitest';
import { validateEditBody } from '../src/edits/validate';
import { ApiError } from '../src/errors';

const base = { end_user_token: 'user-abc' };

describe('validateEditBody', () => {
  it('update hợp lệ: whitelist changes + dẫn xuất name_norm/street_norm', () => {
    const edit = validateEditBody({
      ...base,
      poi_id: '01ABC',
      kind: 'update',
      changes: {
        name: 'Cà Phê Cộng',
        street: 'Thi Sách',
        hours: { osm: 'Mo-Su 07:00-22:00' },
        hack: 'x',
      },
    });
    expect(edit.kind).toBe('update');
    expect(edit.poiId).toBe('01ABC');
    expect(edit.changes).toEqual({
      name: 'Cà Phê Cộng',
      name_norm: 'ca phe cong',
      street: 'Thi Sách',
      street_norm: 'thi sach',
      hours: { osm: 'Mo-Su 07:00-22:00' },
    });
  });

  it('hours dạng chuỗi được bọc thành {osm}', () => {
    const edit = validateEditBody({
      ...base,
      poi_id: '01ABC',
      kind: 'update',
      changes: { hours: 'Mo-Fr 08:00-17:00' },
    });
    expect(edit.changes.hours).toEqual({ osm: 'Mo-Fr 08:00-17:00' });
  });

  it('create cần name + lat/lng trong bbox VN', () => {
    const edit = validateEditBody({
      ...base,
      kind: 'create',
      changes: { name: 'Quán Mới', lat: 10.77, lng: 106.7, ward: 'Bến Nghé', province: 'TP.HCM' },
    });
    expect(edit.poiId).toBeNull();
    expect(edit.changes).toMatchObject({
      name: 'Quán Mới',
      name_norm: 'quan moi',
      lat: 10.77,
      lng: 106.7,
      ward_norm: 'ben nghe',
    });
    expect(() =>
      validateEditBody({ ...base, kind: 'create', changes: { name: 'X', lat: 48.8, lng: 2.3 } }),
    ).toThrowError(ApiError);
    expect(() =>
      validateEditBody({ ...base, kind: 'create', changes: { lat: 10.77, lng: 106.7 } }),
    ).toThrowError(ApiError);
  });

  it('update phải có poi_id và ≥ 1 trường; lat phải đi cùng lng', () => {
    expect(() =>
      validateEditBody({ ...base, kind: 'update', changes: { name: 'X' } }),
    ).toThrowError(ApiError);
    expect(() =>
      validateEditBody({ ...base, poi_id: '01ABC', kind: 'update', changes: {} }),
    ).toThrowError(ApiError);
    expect(() =>
      validateEditBody({ ...base, poi_id: '01ABC', kind: 'update', changes: { lat: 10.7 } }),
    ).toThrowError(ApiError);
  });

  it('close/reopen: changes phải rỗng; report: cần note', () => {
    expect(validateEditBody({ ...base, poi_id: '01ABC', kind: 'close' }).changes).toEqual({});
    expect(() =>
      validateEditBody({ ...base, poi_id: '01ABC', kind: 'close', changes: { name: 'X' } }),
    ).toThrowError(ApiError);
    expect(
      validateEditBody({ ...base, poi_id: '01ABC', kind: 'report', note: 'POI trùng' }).note,
    ).toBe('POI trùng');
    expect(() => validateEditBody({ ...base, poi_id: '01ABC', kind: 'report' })).toThrowError(
      ApiError,
    );
  });

  it('end_user_token bắt buộc 1..128 ký tự; photo_url phải https; contact đúng shape', () => {
    expect(() => validateEditBody({ poi_id: '01ABC', kind: 'close' })).toThrowError(ApiError);
    expect(() =>
      validateEditBody({
        ...base,
        end_user_token: 'a'.repeat(129),
        poi_id: '01ABC',
        kind: 'close',
      }),
    ).toThrowError(ApiError);
    expect(() =>
      validateEditBody({
        ...base,
        poi_id: '01ABC',
        kind: 'update',
        changes: { name: 'X' },
        photo_url: 'http://x.vn/a.jpg',
      }),
    ).toThrowError(ApiError);
    const edit = validateEditBody({
      ...base,
      poi_id: '01ABC',
      kind: 'update',
      changes: { contact: { phone: ['+84901234567'], website: ['https://x.vn'], facebook: 'xvn' } },
    });
    expect(edit.changes.contact).toEqual({
      phone: ['+84901234567'],
      website: ['https://x.vn'],
      facebook: 'xvn',
    });
    expect(() =>
      validateEditBody({
        ...base,
        poi_id: '01ABC',
        kind: 'update',
        changes: { contact: { phone: 'chuỗi' } },
      }),
    ).toThrowError(ApiError);
  });

  /**
   * `update` chỉ đổi `hours`/`contact` trên POI quality ≥ 60 được TỰ DUYỆT (edits/rules.ts), rồi
   * `contact` được trả nguyên văn qua `Place.contact` cho mọi app nhúng. Một scheme thực thi được
   * lọt vào đây là XSS lưu trữ xuyên tenant trong app của khách, không qua mắt người duyệt nào.
   */
  const contactEdit = (contact: unknown) =>
    validateEditBody({ ...base, poi_id: '01ABC', kind: 'update', changes: { contact } });

  it('contact.website chỉ nhận http/https tuyệt đối', () => {
    expect(contactEdit({ website: ['https://x.vn'] }).changes.contact).toEqual({
      website: ['https://x.vn'],
    });
    expect(contactEdit({ website: ['http://x.vn/a?b=1'] }).changes.contact).toEqual({
      website: ['http://x.vn/a?b=1'],
    });
    for (const value of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'x.vn',
      'ftp://x.vn',
    ]) {
      expect(() => contactEdit({ website: [value] })).toThrowError(ApiError);
    }
  });

  it('contact.facebook nhận handle trần hoặc URL http/https, chặn scheme thực thi', () => {
    expect(contactEdit({ facebook: 'xvn' }).changes.contact).toEqual({ facebook: 'xvn' });
    expect(contactEdit({ facebook: 'https://facebook.com/xvn' }).changes.contact).toEqual({
      facebook: 'https://facebook.com/xvn',
    });
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,x',
      'có khoảng trắng',
      '<script>',
    ]) {
      expect(() => contactEdit({ facebook: value })).toThrowError(ApiError);
    }
  });

  it('contact.phone chỉ nhận ký tự số điện thoại', () => {
    expect(contactEdit({ phone: ['+84 90 123 4567', '(028) 3822-1234'] }).changes.contact).toEqual({
      phone: ['+84 90 123 4567', '(028) 3822-1234'],
    });
    for (const value of ['javascript:alert(1)', '<script>', 'gọi cho tôi', '123']) {
      expect(() => contactEdit({ phone: [value] })).toThrowError(ApiError);
    }
  });

  it('kind lạ → 400', () => {
    expect(() => validateEditBody({ ...base, poi_id: '01ABC', kind: 'delete' })).toThrowError(
      ApiError,
    );
  });
});
