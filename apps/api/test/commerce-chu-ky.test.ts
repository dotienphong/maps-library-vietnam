import { describe, expect, it } from 'vitest';
import {
  chuoiKyDuLieu,
  khopChuKy,
  kyDuLieu,
  kyTaoLink,
  soSanhHangSo,
} from '../src/commerce/chu-ky';

/**
 * Vector dưới đây tính ĐỘC LẬP bằng `node:crypto` ngoài Worker (19/09/2026), theo đúng thuật toán
 * của SDK chính thức `@payos/node@2.0.5`. Chúng là bằng chứng mã của ta và mã của PayOS sinh ra
 * cùng một chuỗi byte — đổi một dòng trong chu-ky.ts mà quên hệ quả thì bài này đỏ.
 */
const KHOA = 'kiem-thu-checksum-key';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';

describe('kyTaoLink — chữ ký khi tạo link', () => {
  it('đúng chuỗi amount&cancelUrl&description&orderCode&returnUrl và đúng HMAC', async () => {
    const sig = await kyTaoLink(
      {
        amount: 1_950_000,
        cancelUrl: `https://api.test/console/don-hang/${ORDER_ID}?ket-qua=huy`,
        description: 'MLV100001',
        orderCode: 100001,
        returnUrl: `https://api.test/console/don-hang/${ORDER_ID}?ket-qua=thanh-cong`,
      },
      KHOA,
    );
    expect(sig).toBe('b3a5e4052d63e72368197aed9cc3e6d39c525ea6ec530c864b8564eeeb9d4f37');
  });
});

describe('chuoiKyDuLieu — luật của SDK chính thức', () => {
  const data = {
    orderCode: 100001,
    amount: 1_950_000,
    description: 'MLV100001',
    accountNumber: '0123456789',
    reference: 'FT26262ABC123',
    transactionDateTime: '2026-09-19 10:15:00',
    currency: 'VND',
    paymentLinkId: '8f3e2c1d9a7b4c6e8d0f1a2b3c4d5e6f',
    code: '00',
    desc: 'Thành công',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: null,
    counterAccountNumber: null,
    virtualAccountName: '',
    virtualAccountNumber: '',
  };

  it('sắp khoá theo bảng chữ cái, null thành rỗng, nối bằng &', () => {
    expect(chuoiKyDuLieu(data)).toBe(
      'accountNumber=0123456789&amount=1950000&code=00&counterAccountBankId=&counterAccountBankName=&counterAccountName=&counterAccountNumber=&currency=VND&desc=Thành công&description=MLV100001&orderCode=100001&paymentLinkId=8f3e2c1d9a7b4c6e8d0f1a2b3c4d5e6f&reference=FT26262ABC123&transactionDateTime=2026-09-19 10:15:00&virtualAccountName=&virtualAccountNumber=',
    );
  });

  it('bỏ trường undefined, coi chuỗi "null"/"undefined" là rỗng như SDK', () => {
    expect(chuoiKyDuLieu({ b: undefined, a: 'null', c: 'undefined', d: false })).toBe(
      'a=&c=&d=false',
    );
  });

  it('mảng: JSON.stringify sau khi sắp khoá từng phần tử (kể cả điểm kỳ quặc của SDK)', () => {
    // SDK gọi sortObjDataByKey lên MỌI phần tử; với số nguyên thì Object.keys(3) rỗng → {}.
    // Chép đúng để chữ ký khớp nếu một ngày PayOS gửi mảng; webhook hiện không có mảng.
    expect(chuoiKyDuLieu({ items: [{ z: 1, a: 2 }], n: [1] })).toBe('items=[{"a":2,"z":1}]&n=[{}]');
  });

  it('HMAC của webhook mẫu khớp vector', async () => {
    expect(await kyDuLieu(data, KHOA)).toBe(
      '993354446fbecee7a023e91e61e11b6584a473fa883e1a91c6fb5d4d44c2a754',
    );
  });

  it('khopChuKy đúng/sai, và đổi một chữ số là sai', async () => {
    const sig = await kyDuLieu(data, KHOA);
    expect(await khopChuKy(data, sig, KHOA)).toBe(true);
    expect(await khopChuKy({ ...data, amount: 1_950_001 }, sig, KHOA)).toBe(false);
    // Hex viết hoa bị từ chối: chữ ký thật của PayOS luôn là hex thường, và nới lỏng ở đây chỉ
    // mở thêm một biến thể đầu vào mà không mua được gì.
    expect(await khopChuKy(data, sig.toUpperCase(), KHOA)).toBe(false);
    expect(await khopChuKy(data, '', KHOA)).toBe(false);
    expect(await khopChuKy(data, sig, 'khoa-khac')).toBe(false);
  });

  it('chữ ký phản hồi tạo link khớp vector', async () => {
    const resp = {
      bin: '970422',
      accountNumber: '0123456789',
      accountName: 'DO TIEN PHONG',
      amount: 1_950_000,
      description: 'MLV100001',
      orderCode: 100001,
      currency: 'VND',
      paymentLinkId: '8f3e2c1d9a7b4c6e8d0f1a2b3c4d5e6f',
      status: 'PENDING',
      checkoutUrl: 'https://pay.payos.vn/web/8f3e2c1d9a7b4c6e8d0f1a2b3c4d5e6f',
      qrCode:
        '00020101021238570010A00000072701270006970422011300123456789020208QRIBFTTA53037045406195000005802VN62130809MLV1000016304ABCD',
    };
    expect(await kyDuLieu(resp, KHOA)).toBe(
      '24c32a8695fad03523cb0ba6ce5e06bfa8f37c1d90ded2b724e89c4874d6b4bb',
    );
  });
});

describe('soSanhHangSo', () => {
  it('bằng khi giống hệt, khác khi lệch độ dài hoặc một ký tự', () => {
    expect(soSanhHangSo('abc', 'abc')).toBe(true);
    expect(soSanhHangSo('abc', 'abd')).toBe(false);
    expect(soSanhHangSo('abc', 'ab')).toBe(false);
    expect(soSanhHangSo('', '')).toBe(true);
  });
});
