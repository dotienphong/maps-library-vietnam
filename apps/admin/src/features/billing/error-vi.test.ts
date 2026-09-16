import { describe, expect, it } from 'vitest';
import { AdminApiError } from '@/lib/fetcher';
import { loiVi, MA_LOI_BILLING } from './error-vi';

describe('dịch mã lỗi billing sang tiếng Việt', () => {
  it('mỗi mã 409 của máy chủ đều có câu riêng — chúng ứng với các cổng chặn khác nhau', () => {
    for (const ma of [
      'operation_conflict',
      'revision_conflict',
      'business_identity_conflict',
      'tenant_conflict',
      'period_overlap',
      'period_not_active',
      'trial_already_used',
      'credits_require_paid_active',
      'no_entitlement',
    ]) {
      expect(MA_LOI_BILLING[ma], `thiếu câu cho ${ma}`).toBeTruthy();
    }
    // Không có hai mã nào dùng chung một câu: dùng chung là mất đúng thứ người vận hành cần biết.
    const cau = Object.values(MA_LOI_BILLING);
    expect(new Set(cau).size).toBe(cau.length);
  });

  it('trả cả mã lẫn câu, vì spec đòi hiện mã thật', () => {
    const ket = loiVi(new AdminApiError(409, 'period_overlap', 'trùng kỳ'));
    expect(ket.ma).toBe('period_overlap');
    expect(ket.cau).toContain('chồng lên một kỳ đã có');
  });

  it('mã lạ → giữ nguyên thông điệp máy chủ, không nuốt thành "có lỗi xảy ra"', () => {
    const ket = loiVi(new AdminApiError(500, 'mot_ma_moi_nao_do', 'máy chủ nói câu này'));
    expect(ket.ma).toBe('mot_ma_moi_nao_do');
    expect(ket.cau).toBe('máy chủ nói câu này');
  });

  it('lỗi không phải AdminApiError (mất mạng) vẫn ra câu đọc được', () => {
    const ket = loiVi(new TypeError('Failed to fetch'));
    expect(ket.ma).toBe('khong_goi_duoc');
    expect(ket.cau).toContain('Không gọi được máy chủ');
  });
});
