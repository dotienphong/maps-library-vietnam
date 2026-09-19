import type { PeriodHistory } from '../billing/types';

/**
 * Mốc bắt đầu kỳ mới (spec 9.3 bước 2): muộn nhất trong {now, endsAt của mọi kỳ TRẢ PHÍ chưa kết
 * thúc}. Kỳ dùng thử bị bỏ qua — sổ quota tự cắt trial đúng lúc kỳ trả phí bắt đầu. Kỳ đã hết hạn
 * không kéo mốc về quá khứ. Đây cũng là "hiệu lực từ …" mà màn Mua hiện cho khách trước khi trả tiền.
 */
export function tinhStartsAt(history: Pick<PeriodHistory, 'periods'>, now: Date): Date {
  let moc = now.getTime();
  for (const p of history.periods) {
    if (p.tier === 'trial') continue;
    const end = Date.parse(p.endsAt);
    if (Number.isFinite(end) && end > moc) moc = end;
  }
  return new Date(moc);
}

/**
 * Sổ đã nhận đơn này chưa — nhìn bằng `lineItemId`, thứ ta luôn đặt bằng id đơn. Dùng khi sổ trả
 * `operation_conflict`: cùng operationId nhưng khác `expectedRevision` nghĩa là lần trước ĐÃ ghi,
 * và bằng chứng nằm trong lịch sử kỳ chứ không nằm trong mã lỗi.
 */
export function daCapChoDon(history: PeriodHistory, orderId: string): boolean {
  return (
    history.periods.some((p) => p.lineItemId === orderId) ||
    history.credits.some((c) => c.lineItemId === orderId)
  );
}

/** Lỗi từ Durable Object về đây là Error thường (mất class qua RPC); khớp theo message. */
export const maLoi = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
