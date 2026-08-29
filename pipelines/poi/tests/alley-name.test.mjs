import { describe, expect, it } from 'vitest';
import { parseAlleyName, streetNameNorm } from '../src/geocode/alley-name.mjs';

describe('parseAlleyName (spec 5.7: ^(Hẻm|Ngõ|Ngách|Kiệt) (\\d+[A-Z]?)( .+)?$)', () => {
  it('nhận 4 từ khoá, số có chữ, tên đường mẹ tuỳ chọn', () => {
    expect(parseAlleyName('Hẻm 112 Nguyễn Lâm')).toEqual({
      keyword: 'hem',
      number: '112',
      parentName: 'Nguyễn Lâm',
      parentNorm: 'nguyen lam',
    });
    expect(parseAlleyName('Ngõ 25')).toEqual({
      keyword: 'ngo',
      number: '25',
      parentName: null,
      parentNorm: null,
    });
    expect(parseAlleyName('Kiệt 42A Trần Cao Vân')).toEqual({
      keyword: 'kiet',
      number: '42A',
      parentName: 'Trần Cao Vân',
      parentNorm: 'tran cao van',
    });
    expect(parseAlleyName('ngách 15 ngõ 78')).toEqual({
      keyword: 'ngach',
      number: '15',
      parentName: 'ngõ 78',
      parentNorm: 'ngo 78',
    });
  });

  it('không phải hẻm → null', () => {
    expect(parseAlleyName('Đường Nguyễn Lâm')).toBeNull();
    expect(parseAlleyName('Hẻm Cây Bàng')).toBeNull();
    expect(parseAlleyName(null)).toBeNull();
  });

  it('nhận chuỗi số hẻm nhiều cấp và khoảng số có trong OSM thật', () => {
    expect(parseAlleyName('Hẻm 100/31/18 Lê Văn Duyệt')).toEqual({
      keyword: 'hem',
      number: '100/31/18',
      parentName: 'Lê Văn Duyệt',
      parentNorm: 'le van duyet',
    });
    expect(parseAlleyName('Hẻm 108/44-46 Trần Quang Diệu')).toEqual({
      keyword: 'hem',
      number: '108/44-46',
      parentName: 'Trần Quang Diệu',
      parentNorm: 'tran quang dieu',
    });
    expect(parseAlleyName('Hẻm 18Bis/13 Nguyễn Thị Minh Khai')).toEqual({
      keyword: 'hem',
      number: '18BIS/13',
      parentName: 'Nguyễn Thị Minh Khai',
      parentNorm: 'nguyen thi minh khai',
    });
    expect(parseAlleyName('Hẻm 23-25-27 Bà Lê Chân')?.number).toBe('23-25-27');
    expect(parseAlleyName('Hẻm 382/27Nguyễn Thị Minh Khai')).toEqual({
      keyword: 'hem',
      number: '382/27',
      parentName: 'Nguyễn Thị Minh Khai',
      parentNorm: 'nguyen thi minh khai',
    });
  });

  it('nhận mã hẻm ghép chữ/số và dấu phân cách trong OSM toàn quốc', () => {
    expect(parseAlleyName('Hẻm 111K1 Bến Bình Đông')?.number).toBe('111K1');
    expect(parseAlleyName('Hẻm 453/77C-D Lê Văn Sỹ')?.number).toBe('453/77C-D');
    expect(parseAlleyName('Hẻm 02/K01 Lê Ngô Cát')?.number).toBe('02/K01');
    expect(parseAlleyName('Ngõ 102+104')).toMatchObject({ number: '102+104', parentName: null });
    expect(parseAlleyName('Ngõ 1, xóm Bảng, Cổ Điển A')).toMatchObject({
      number: '1',
      parentName: 'xóm Bảng, Cổ Điển A',
    });
    expect(parseAlleyName('Ngõ 4. Đoàn Kết')).toMatchObject({
      number: '4',
      parentName: 'Đoàn Kết',
    });
    expect(parseAlleyName('Ngách 40/Ngõ 89 Phố Bùi Huy Bích')).toMatchObject({
      number: '40',
      parentName: 'Ngõ 89 Phố Bùi Huy Bích',
    });
    expect(parseAlleyName('Hẻm 281/47- 49 Lê Văn Sỹ')).toMatchObject({
      number: '281/47-49',
      parentName: 'Lê Văn Sỹ',
    });
  });
});

describe('streetNameNorm', () => {
  it('bỏ "đường/phố" đứng đầu trừ khi theo sau là số/mã; giữ đại lộ/quốc lộ', () => {
    expect(streetNameNorm('Đường Nguyễn Lâm')).toBe('nguyen lam');
    expect(streetNameNorm('Phố Vũ Ngọc Phan')).toBe('vu ngoc phan');
    expect(streetNameNorm('Đường số 7')).toBe('duong so 7');
    expect(streetNameNorm('Đường D2')).toBe('duong d2');
    expect(streetNameNorm('Đại lộ Thăng Long')).toBe('dai lo thang long');
    expect(streetNameNorm('Quốc lộ 1A')).toBe('quoc lo 1a');
  });
});
