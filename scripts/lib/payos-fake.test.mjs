import { describe, expect, it } from 'vitest';
import { chuoiKyDuLieu, dungWebhook, kyDuLieu, kyTaoLink } from './payos-fake.mjs';

/**
 * CÙNG vector với apps/api/test/commerce-chu-ky.test.ts: bản giả phải ký y hệt PayOS thật, nếu
 * không thì mọi bài e2e chỉ chứng minh hai đoạn mã sai giống nhau.
 */
const KHOA = 'kiem-thu-checksum-key';

describe('payos-fake ký như PayOS thật', () => {
  it('kyTaoLink khớp vector', () => {
    expect(
      kyTaoLink(
        {
          amount: 1950000,
          cancelUrl:
            'https://api.test/console/don-hang/11111111-1111-4111-8111-111111111111?ket-qua=huy',
          description: 'MLV100001',
          orderCode: 100001,
          returnUrl:
            'https://api.test/console/don-hang/11111111-1111-4111-8111-111111111111?ket-qua=thanh-cong',
        },
        KHOA,
      ),
    ).toBe('b3a5e4052d63e72368197aed9cc3e6d39c525ea6ec530c864b8564eeeb9d4f37');
  });

  it('kyDuLieu khớp vector webhook, null thành rỗng', () => {
    const data = {
      orderCode: 100001,
      amount: 1950000,
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
    expect(chuoiKyDuLieu(data)).toContain('counterAccountName=&');
    expect(kyDuLieu(data, KHOA)).toBe(
      '993354446fbecee7a023e91e61e11b6584a473fa883e1a91c6fb5d4d44c2a754',
    );
  });

  it('dungWebhook trả thân đầy đủ, chữ ký khớp chính data của nó', () => {
    const than = dungWebhook({ orderCode: 100001, amount: 650000, reference: 'FT1' }, KHOA);
    expect(than.code).toBe('00');
    expect(than.data.orderCode).toBe(100001);
    expect(than.data.description).toBe('MLV100001');
    expect(than.signature).toBe(kyDuLieu(than.data, KHOA));
  });
});
