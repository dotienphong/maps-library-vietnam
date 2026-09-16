import type { Command, PaidTier, QuotaGroup, UsageSnapshot } from './api';

export type LoaiLenh = 'trial' | 'grant' | 'credits' | 'suspend' | 'resume' | 'unlock';

export interface FormLenh {
  reason: string;
  /** YYYY-MM-DD theo giờ VN, đúng dạng của <input type="date">. */
  ngayBatDau: string;
  ngayKetThuc: string;
  tier: PaidTier;
  paymentReference: string;
  lineItemId: string;
  group: QuotaGroup;
  packs: number;
}

/**
 * Ngày VN → mốc ISO UTC của 00:00 giờ Việt Nam. Chuỗi PHẢI mang offset `+07:00`:
 * `new Date('…T00:00:00')` đọc theo múi giờ của máy, nên cùng một thao tác cho ra hai kết quả lệch
 * bảy giờ giữa máy dev và máy chủ, và một kỳ "bắt đầu 01/10" hoá ra bắt đầu 30/09.
 */
export function mocVn(ngay: string): string {
  const moc = new Date(`${ngay}T00:00:00+07:00`);
  if (Number.isNaN(moc.getTime())) throw new Error(`ngày không hợp lệ: ${ngay}`);
  return moc.toISOString();
}

/** Hôm nay theo giờ VN, dạng YYYY-MM-DD — giá trị mặc định cho ô ngày. */
export function homNayVn(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Cùng ngày của tháng kế tiếp; tháng ngắn hơn thì lùi về ngày cuối tháng (31/01 → 28/02). */
export function thangSau(ngay: string): string {
  const [nam, thang, ngayTrongThang] = ngay.split('-').map(Number) as [number, number, number];
  const soNgayThangSau = new Date(Date.UTC(nam, thang + 1, 0)).getUTCDate();
  const moc = new Date(Date.UTC(nam, thang, Math.min(ngayTrongThang, soNgayThangSau)));
  return moc.toISOString().slice(0, 10);
}

/**
 * Chặn tại chỗ những gì máy chủ cũng chặn. Không phải để "tin vào client" — máy chủ vẫn là nơi
 * quyết định — mà để người vận hành không phải đợi một vòng mạng chỉ để biết mình quên một ô.
 * Trả về câu tiếng Việt, hoặc null nếu hợp lệ.
 */
export function kiemForm(loai: LoaiLenh, form: FormLenh, usage: UsageSnapshot): string | null {
  if (form.reason.trim().length === 0) return 'Lý do là bắt buộc cho mọi lệnh billing.';

  if (loai === 'trial') {
    if (usage.trialUsedOnce) return 'Tenant này đã dùng thử một lần rồi, không bật lại được.';
    return null;
  }

  if (loai === 'grant') {
    if (form.paymentReference.trim().length === 0) return 'Thiếu mã thanh toán của giao dịch.';
    if (form.lineItemId.trim().length === 0) return 'Thiếu dòng hoá đơn.';
    if (Date.parse(mocVn(form.ngayKetThuc)) <= Date.parse(mocVn(form.ngayBatDau))) {
      return 'Ngày kết thúc phải sau ngày bắt đầu.';
    }
    return null;
  }

  if (loai === 'credits') {
    if (usage.periodId === null) return 'Không có kỳ nào đang chạy để cộng credit vào.';
    if (usage.status !== 'active') return 'Chỉ cộng credit khi thuê bao đang hoạt động.';
    if (usage.tier === 'trial') return 'Không cộng credit cho bản dùng thử.';
    if (form.paymentReference.trim().length === 0) return 'Thiếu mã thanh toán của giao dịch.';
    if (form.lineItemId.trim().length === 0) return 'Thiếu dòng hoá đơn.';
    if (!Number.isInteger(form.packs) || form.packs < 1) {
      return 'Số gói phải là số nguyên ít nhất 1.';
    }
    return null;
  }

  return null; // suspend / resume / unlock: chỉ cần lý do
}

/**
 * Dựng đúng tập trường của từng `kind`. Máy chủ kiểm bằng allowlist đóng nên KHÔNG được thêm gì,
 * kể cả `tenantId`/`actor` (máy chủ tự điền) hay một trường ghi chú để hiển thị.
 */
export function dungLenh(
  loai: Exclude<LoaiLenh, 'unlock'>,
  form: FormLenh,
  usage: UsageSnapshot,
  operationId: string,
  periodId: string,
): Command {
  const chung = { operationId, reason: form.reason.trim(), expectedRevision: usage.revision };
  if (loai === 'trial') {
    return { ...chung, kind: 'activateTrial', startsAt: mocVn(form.ngayBatDau) };
  }
  if (loai === 'grant') {
    return {
      ...chung,
      kind: 'grantPeriod',
      periodId,
      tier: form.tier,
      startsAt: mocVn(form.ngayBatDau),
      endsAt: mocVn(form.ngayKetThuc),
      paymentReference: form.paymentReference.trim(),
      lineItemId: form.lineItemId.trim(),
    };
  }
  if (loai === 'credits') {
    return {
      ...chung,
      kind: 'addCredits',
      // Kỳ để cộng credit LUÔN là kỳ đang chạy do máy chủ báo về: máy chủ so đúng bằng và trả
      // period_not_active nếu lệch, nên để người dùng gõ tay chỉ tạo ra một cách sai mới.
      periodId: usage.periodId as string,
      group: form.group,
      packs: form.packs,
      paymentReference: form.paymentReference.trim(),
      lineItemId: form.lineItemId.trim(),
    };
  }
  return { ...chung, kind: loai };
}
