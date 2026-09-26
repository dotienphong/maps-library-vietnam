import { describe, expect, it } from 'vitest';
import {
  osmDisplayName,
  osmEmails,
  osmFallbackName,
  osmNameAlt,
  resolveOsmName,
  splitNames,
} from '../src/lib/osm-names.mjs';
import { atmName } from '../src/lib/vn-banks.mjs';

describe('splitNames', () => {
  it('tách giá trị ";" của OSM, bỏ khoảng trắng và phần tử rỗng', () => {
    expect(splitNames('A;B; C;;')).toEqual(['A', 'B', 'C']);
    expect(splitNames(undefined)).toEqual([]);
  });
});

describe('osmDisplayName', () => {
  it('tên có ";" → lấy phần đầu làm tên, phần còn lại thành tên thay thế', () => {
    expect(osmDisplayName({ name: 'Chợ Bến Thành;Ben Thanh Market' })).toEqual({
      name: 'Chợ Bến Thành',
      extraAlt: ['Ben Thanh Market'],
    });
    expect(osmDisplayName({ name: 'Chợ Lớn' })).toEqual({ name: 'Chợ Lớn', extraAlt: [] });
    expect(osmDisplayName({})).toEqual({ name: null, extraAlt: [] });
  });
});

describe('osmNameAlt', () => {
  it('gồm name:en, alt_name, old_name, official_name, name:vi, short_name, loc_name, int_name', () => {
    const tags = {
      'name:en': 'Ben Thanh Market',
      alt_name: 'Chợ Sài Gòn;Chợ Bến Thành cũ',
      old_name: 'Chợ Bến Thành xưa',
      official_name: 'Chợ Bến Thành Quận 1',
      'name:vi': 'Chợ Bến Thành Sài Gòn',
      short_name: 'Bến Thành',
      loc_name: 'Chợ BT',
      int_name: 'Ben Thanh',
    };
    expect(osmNameAlt(tags, 'Chợ Bến Thành')).toEqual([
      'Ben Thanh Market',
      'Chợ Sài Gòn',
      'Chợ Bến Thành cũ',
      'Chợ Bến Thành xưa',
      'Chợ Bến Thành Quận 1',
      'Chợ Bến Thành Sài Gòn',
      'Bến Thành',
      'Chợ BT',
      'Ben Thanh',
    ]);
  });
  it('bỏ phần tử bằng tên hiển thị, trùng nhau, và chuỗi chứa chữ CJK', () => {
    expect(
      osmNameAlt({ 'name:vi': 'Cửa khẩu', int_name: '友谊关', short_name: 'CK' }, 'Cửa khẩu'),
    ).toEqual(['CK']);
    expect(osmNameAlt({ alt_name: 'X;X', 'name:en': 'X' }, 'Y')).toEqual(['X']);
  });
  it('nhận thêm tên thay thế từ phần sau ";" của name', () => {
    expect(osmNameAlt({}, 'A', ['B'])).toEqual(['B']);
  });
});

describe('osmFallbackName (POI thiếu tag name)', () => {
  it('thứ tự name:vi → name:en → brand', () => {
    expect(osmFallbackName({ 'name:vi': 'Quán Bà Tư', 'name:en': 'Mrs Tu' }, 'restaurant')).toBe(
      'Quán Bà Tư',
    );
    expect(osmFallbackName({ 'name:en': 'Mrs Tu Kitchen' }, 'restaurant')).toBe('Mrs Tu Kitchen');
    expect(osmFallbackName({ brand: 'Circle K' }, 'convenience')).toBe('Circle K');
  });
  it('tên chung chung hoặc name:en dạng mô tả → null', () => {
    expect(osmFallbackName({ 'name:en': 'Local food' }, 'restaurant')).toBeNull();
    expect(osmFallbackName({ 'name:en': 'mechanic' }, 'car_repair')).toBeNull();
    expect(osmFallbackName({ 'name:en': 'Parking 3' }, 'parking')).toBeNull();
    expect(osmFallbackName({ 'name:en': 'Quán cà phê' }, 'cafe')).toBeNull();
    expect(
      osmFallbackName(
        { 'name:en': 'A very nice place to eat noodles with the local people' },
        'restaurant',
      ),
    ).toBeNull();
    expect(osmFallbackName({ 'name:en': 'Best view!' }, 'viewpoint')).toBeNull();
  });
  it('chỉ có tên ngoại ngữ khác (name:zh, name:ru…) → null', () => {
    expect(osmFallbackName({ 'name:zh': '河内', 'name:ru': 'Ханой' }, 'restaurant')).toBeNull();
  });
  it('operator chỉ làm tên cho cây xăng/ngân hàng/ATM; nhóm UNNAMED_OK không lấy brand/operator', () => {
    expect(osmFallbackName({ operator: 'Petrolimex' }, 'fuel')).toBe('Petrolimex');
    expect(osmFallbackName({ operator: 'Vingroup' }, 'restaurant')).toBeNull();
    expect(osmFallbackName({ operator: 'Transerco' }, 'bus_stop', 'transport')).toBeNull();
    expect(osmFallbackName({ brand: 'Hanoibus' }, 'bus_stop', 'transport')).toBeNull();
    expect(osmFallbackName({ 'name:vi': 'Trạm Kim Mã' }, 'bus_stop', 'transport')).toBe(
      'Trạm Kim Mã',
    );
  });
  it('ATM đi qua bảng ngân hàng', () => {
    expect(osmFallbackName({ operator: 'Vietcombank' }, 'atm')).toBe('ATM Vietcombank');
    expect(osmFallbackName({ operator: 'MHB' }, 'atm')).toBeNull();
  });
});

describe('atmName (bảng ngân hàng VN)', () => {
  it('ngân hàng đang hoạt động → "ATM <tên chuẩn>"', () => {
    expect(atmName({ operator: 'Vietcombank' })).toBe('ATM Vietcombank');
    expect(atmName({ brand: 'BIDV' })).toBe('ATM BIDV');
    expect(atmName({ operator: 'Ngân hàng TMCP Kỹ Thương Việt Nam' })).toBe('ATM Techcombank');
  });
  it('ngân hàng đổi thương hiệu → tên mới', () => {
    expect(atmName({ operator: 'Maritime Bank' })).toBe('ATM MSB');
    expect(atmName({ operator: 'LienVietPostBank' })).toBe('ATM LPBank');
    expect(atmName({ operator: 'Navibank' })).toBe('ATM NCB');
  });
  it('ngân hàng đã sáp nhập/rút khỏi/chuyển giao bắt buộc → null', () => {
    for (const operator of ['MHB', 'Habubank', 'Southern Bank', 'ANZ', 'DongA Bank', 'OceanBank'])
      expect(atmName({ operator }), operator).toBeNull();
  });
  it('máy POS hoặc không có dấu hiệu ngân hàng → null', () => {
    expect(atmName({ operator: 'BIDV - May Pos - ATM' })).toBeNull();
    expect(atmName({ operator: 'comfeed' })).toBeNull();
    expect(atmName({ operator: 'kfc go vap' })).toBeNull();
    expect(atmName({})).toBeNull();
  });
});

describe('osmEmails', () => {
  it('email + contact:email, tách ";", chữ thường, bỏ hộp thư miễn phí và chuỗi không phải email', () => {
    expect(
      osmEmails({
        email: 'Info@Hotel.vn;ban.hang@gmail.com',
        'contact:email': 'sales@hotel.vn; not-an-email',
      }),
    ).toEqual(['info@hotel.vn', 'sales@hotel.vn']);
    expect(osmEmails({ email: 'x@yahoo.com.vn' })).toEqual([]);
    expect(osmEmails({})).toEqual([]);
  });
});

describe('resolveOsmName — thứ tự tên cho một POI OSM', () => {
  const label = (/** @type {string} */ code) => ({ bus_stop: 'Trạm xe buýt' })[code] ?? code;
  it('có name → dùng name', () => {
    expect(
      resolveOsmName({ name: 'Trạm Kim Mã' }, { code: 'bus_stop', group: 'transport' }, label),
    ).toEqual({ name: 'Trạm Kim Mã', extraAlt: [] });
  });
  it('không name, có name:vi → tên dự phòng', () => {
    expect(
      resolveOsmName(
        { 'name:vi': 'Trạm Ngọc Khánh' },
        { code: 'bus_stop', group: 'transport' },
        label,
      ),
    ).toEqual({ name: 'Trạm Ngọc Khánh', extraAlt: [] });
  });
  it('không tên nào, nhóm UNNAMED_OK → nhãn loại', () => {
    expect(resolveOsmName({}, { code: 'bus_stop', group: 'transport' }, label)).toEqual({
      name: 'Trạm xe buýt',
      extraAlt: [],
    });
  });
  it('không tên nào, loại *_other → bỏ (1.000 node office=religion rác ở Quảng Ngãi, 10/2025)', () => {
    expect(
      resolveOsmName(
        { office: 'religion' },
        { code: 'religion_community_other', group: 'religion_community' },
        label,
      ),
    ).toBeNull();
  });
  it('không tên nào, nhóm ngoài UNNAMED_OK → bỏ', () => {
    expect(resolveOsmName({}, { code: 'cafe', group: 'food_drink' }, label)).toBeNull();
  });
});
