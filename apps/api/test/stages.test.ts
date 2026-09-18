import { describe, expect, it } from 'vitest';
import { fastGateFor, planStages, telexFallback, tsQueryAnyToken, tsQueryFor } from '../src/stages';

describe('tsQueryFor', () => {
  it('mọi token là tiền tố, AND, bỏ token < 2 ký tự, giữ token toàn số', () => {
    expect(tsQueryFor('ng hue highl')).toBe('ng:* & hue:* & highl:*');
    expect(tsQueryFor('a quan 10')).toBe('quan:* & 10:*');
  });

  it('tách trên / và - để không lọt ký tự tsquery', () => {
    // Số nhà một chữ số được GIỮ (luật "giữ token toàn số"): '9' trong '88/9' là dữ liệu thật.
    expect(tsQueryFor('88/9 nguyen-lam')).toBe('88:* & 9:* & nguyen:* & lam:*');
  });

  it('không đủ 2 token hợp lệ → null (bậc 2 không chạy)', () => {
    expect(tsQueryFor('highlands')).toBeNull();
    expect(tsQueryFor('a b')).toBeNull();
    expect(tsQueryFor('')).toBeNull();
  });

  it('không sinh ký tự đặc biệt của tsquery từ đầu vào', () => {
    // Đầu vào đã normalizeVi nên chỉ còn a-z0-9 / - và khoảng trắng, nhưng vẫn khoá lại bằng test:
    // lọt một dấu & hay ! vào to_tsquery là lỗi cú pháp 500 trên production.
    const out = tsQueryFor('quan 1 & 2 | 3') ?? '';
    expect(out).not.toMatch(/[!|()']/);
    expect(out.replace(/ & /g, ' ')).toMatch(/^[a-z0-9:* ]+$/);
  });
});

describe('planStages', () => {
  // Đổi 08/09/2026 (PHONG duyệt "cách 2"): bậc 2/3 chạy theo DỮ LIỆU CÓ SẴN, không theo số kết quả
  // của bậc 1 nữa. Lý do đo được trên production: với 1,52 triệu POI, bậc 1 luôn lấp đủ `limit`,
  // nên điều kiện cũ làm bậc 2/3 không bao giờ chạy và tiêu chí 11.6 bất khả thi.
  it('có cả tsQuery lẫn queryKey → chạy cả hai bậc, bất kể bậc 1 đã đủ hay chưa', () => {
    expect(planStages({ tsQuery: 'a:* & b:*', queryKey: 'ab' })).toEqual([2, 3]);
  });

  it('một token (tsQuery null) → chỉ bậc 3', () => {
    expect(planStages({ tsQuery: null, queryKey: 'highlands' })).toEqual([3]);
  });

  it('queryKey rỗng thì không có bậc 3', () => {
    expect(planStages({ tsQuery: null, queryKey: '' })).toEqual([]);
    expect(planStages({ tsQuery: 'a:* & b:*', queryKey: '' })).toEqual([2]);
  });
});

describe('telexFallback (bậc 3b, spec 5.6)', () => {
  it('tắt cờ → luôn null, kể cả khi chuỗi rõ ràng là telex và kết quả rỗng', () => {
    expect(telexFallback({ enabled: false, have: 0, queryNorm: 'saif gonf' })).toBeNull();
  });

  it('bật cờ nhưng đã có kết quả → null (chỉ chạy khi các bậc trước rỗng)', () => {
    expect(telexFallback({ enabled: true, have: 1, queryNorm: 'saif gonf' })).toBeNull();
  });

  it('bật cờ, rỗng, khớp mẫu telex → trả chuỗi đã gập', () => {
    expect(telexFallback({ enabled: true, have: 0, queryNorm: 'saif gonf' })).toBe('sai gon');
    // Telex thật của "Đồng Khởi" là `ddoongf khowir` (ow→ơ rồi r là dấu hỏi), không phải `khoiwr`.
    expect(telexFallback({ enabled: true, have: 0, queryNorm: 'ddoongf khowir' })).toBe(
      'dong khoi',
    );
  });

  it('bật cờ, rỗng, nhưng không phải telex hoặc gập xong không đổi → null', () => {
    expect(telexFallback({ enabled: true, have: 0, queryNorm: 'highlands' })).toBeNull();
    expect(telexFallback({ enabled: true, have: 0, queryNorm: 'circle k' })).toBeNull();
  });
});

describe('tsQueryAnyToken', () => {
  it('nhận truy vấn MỘT token, khác tsQueryFor', () => {
    expect(tsQueryAnyToken('cafe')).toBe('cafe:*');
    expect(tsQueryFor('cafe')).toBeNull();
  });

  it('nhiều token nối bằng AND, mọi token là tiền tố', () => {
    expect(tsQueryAnyToken('ben thanh')).toBe('ben:* & thanh:*');
  });

  it('bỏ token 1 ký tự nhưng GIỮ token toàn số', () => {
    expect(tsQueryAnyToken('a cafe')).toBe('cafe:*');
    expect(tsQueryAnyToken('88/9 nguyen')).toBe('88:* & 9:* & nguyen:*');
  });

  it('không còn token nào thì trả null', () => {
    expect(tsQueryAnyToken('a')).toBeNull();
    expect(tsQueryAnyToken('')).toBeNull();
  });
});

describe('fastGateFor', () => {
  it('cờ khác "1" → undefined, tức giữ nguyên hành vi cũ', () => {
    expect(fastGateFor({ enabled: false, queryNorm: 'ben thanh', limit: 10 })).toBeUndefined();
  });

  it('cờ bật → cổng mang tsquery mọi-token và limit của request', () => {
    expect(fastGateFor({ enabled: true, queryNorm: 'ben thanh', limit: 7 })).toEqual({
      tsQuery: 'ben:* & thanh:*',
      limit: 7,
    });
  });

  it('truy vấn một token vẫn có cổng', () => {
    expect(fastGateFor({ enabled: true, queryNorm: 'cafe', limit: 10 })).toEqual({
      tsQuery: 'cafe:*',
      limit: 10,
    });
  });

  it('không còn token nào → tsQuery null, collectCandidates sẽ bỏ qua bậc nhanh', () => {
    expect(fastGateFor({ enabled: true, queryNorm: 'a', limit: 10 })).toEqual({
      tsQuery: null,
      limit: 10,
    });
  });
});
