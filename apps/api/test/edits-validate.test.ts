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

  it('kind lạ → 400', () => {
    expect(() => validateEditBody({ ...base, poi_id: '01ABC', kind: 'delete' })).toThrowError(
      ApiError,
    );
  });
});
