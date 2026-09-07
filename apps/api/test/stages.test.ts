import { describe, expect, it } from 'vitest';
import { planStages, telexFallback, tsQueryFor } from '../src/stages';

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
  it('chỉ bậc 1 khi đã đủ limit', () => {
    expect(planStages({ have: 10, limit: 10, tsQuery: 'a:* & b:*', queryKey: 'ab' })).toEqual([]);
  });

  it('thiếu và có ≥2 token → bậc 2 rồi bậc 3; thiếu mà 1 token → chỉ bậc 3', () => {
    expect(planStages({ have: 3, limit: 10, tsQuery: 'a:* & b:*', queryKey: 'ab' })).toEqual([
      2, 3,
    ]);
    expect(planStages({ have: 3, limit: 10, tsQuery: null, queryKey: 'highlands' })).toEqual([3]);
  });

  it('queryKey rỗng thì không có bậc 3', () => {
    expect(planStages({ have: 0, limit: 10, tsQuery: null, queryKey: '' })).toEqual([]);
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
