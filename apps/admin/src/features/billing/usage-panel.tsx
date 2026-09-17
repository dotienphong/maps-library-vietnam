import { Badge } from '@/components/ui/badge';
import type { GroupUsage, MissingAcks, UsageSnapshot } from './api';

export type Muc = 'khong-co' | 'ok' | 'sap-het' | 'het';

/**
 * Ngưỡng theo spec 11.4: hổ phách từ 80 %, đỏ từ 100 %.
 *
 * Mẫu số là `limit + credits` chứ không phải `limit`: credit đã mua thêm là hạn mức thật của kỳ,
 * bỏ ra ngoài thì một khách vừa mua thêm 3.000 lượt vẫn bị báo đỏ. Tử số cộng cả `reserved` vì
 * phần đang giữ chỗ không dùng lại được.
 */
export function mucCanhBao(group: GroupUsage): Muc {
  const tong = group.limit + group.credits;
  if (tong <= 0) return 'khong-co';
  const daTieu = group.used + group.reserved;
  if (daTieu >= tong) return 'het';
  return daTieu / tong >= 0.8 ? 'sap-het' : 'ok';
}

export function phanTram(group: GroupUsage): number {
  const tong = group.limit + group.credits;
  if (tong <= 0) return 0;
  return Math.min(100, Math.round(((group.used + group.reserved) / tong) * 100));
}

const TRANG_THAI_VI: Record<UsageSnapshot['status'], string> = {
  none: 'Chưa có quyền thương mại',
  active: 'Đang hoạt động',
  suspended: 'Đang tạm dừng',
  expired: 'Đã hết hạn',
};

const TONE: Record<UsageSnapshot['status'], 'neutral' | 'success' | 'warning' | 'danger'> = {
  none: 'neutral',
  active: 'success',
  suspended: 'warning',
  expired: 'danger',
};

export const ngayVn = (iso: string): string =>
  new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const so = (value: number): string => value.toLocaleString('vi-VN');

export const gioNgayVn = (iso: string): string =>
  new Date(iso).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

/**
 * Cửa sổ receipt chưa xác nhận. Trước 17/09/2026 màn này không hiện gì cả — chỉ có mỗi nút "Mở
 * khoá receipt" — nên người trực không biết đang có mấy dòng hay bao giờ khoá tự mở, và phải đoán.
 *
 * Im lặng khi count = 0: một khối luôn hiện với số 0 là nhiễu, và nhiễu thì người ta thôi đọc.
 */
function MissingAcksPanel({ missingAcks }: { missingAcks: MissingAcks }) {
  if (missingAcks.count === 0) return null;
  const dem = `${so(missingAcks.count)}/${so(missingAcks.limit)}`;

  if (!missingAcks.locked) {
    return (
      <p data-testid="missing-acks" className="text-sm text-[var(--text-muted)]">
        Có {dem} receipt chưa xác nhận trong 24 giờ qua. Chạm ngưỡng là tenant bị khoá — nếu con số
        này tự bò lên thì SDK phía khách đang bỏ rơi receipt, mở khoá không chữa được.
      </p>
    );
  }

  return (
    <p
      data-testid="missing-acks"
      role="alert"
      className="rounded-[var(--radius-btn)] bg-red-100 px-3 py-2 text-sm text-red-900 dark:bg-red-900 dark:text-red-100"
    >
      Đang khoá: {dem} receipt chưa xác nhận trong 24 giờ qua. Mọi request của tenant này trả 429{' '}
      <code>ack_required</code>, kể cả khi còn thừa hạn mức.
      {missingAcks.opensAt !== null && ` Tự mở lúc ${gioNgayVn(missingAcks.opensAt)}.`} Bấm "Mở khoá
      receipt" để mở sớm — nhưng chỉ sau khi đã sửa nguyên nhân, không thì nó khoá lại ngay.
    </p>
  );
}

const MAU: Record<Muc, string> = {
  'khong-co': 'bg-black/20 dark:bg-white/20',
  ok: 'bg-brand-600',
  'sap-het': 'bg-amber-500',
  het: 'bg-red-600',
};

const CHU: Record<Muc, string> = {
  'khong-co': '',
  ok: '',
  'sap-het': 'Sắp hết hạn mức',
  het: 'Đã hết hạn mức',
};

function Thanh({ nhan, group }: { nhan: string; group: GroupUsage }) {
  const muc = mucCanhBao(group);
  const pct = phanTram(group);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-semibold">{nhan}</span>
        <span className="text-[var(--text-muted)]">
          {so(group.used + group.reserved)} / {so(group.limit + group.credits)}
          {group.credits > 0 && ` (gồm ${so(group.credits)} credit đã mua thêm)`}
        </span>
        {/* Cảnh báo luôn kèm chữ: spec mục 5 cấm truyền đạt trạng thái chỉ bằng màu. */}
        {CHU[muc] && (
          <span
            className={
              muc === 'het'
                ? 'font-semibold text-red-700 dark:text-red-300'
                : 'font-semibold text-amber-700 dark:text-amber-300'
            }
          >
            · {CHU[muc]}
          </span>
        )}
      </div>
      {/* Thanh là ĐỒ HOẠ thuần: dòng chữ ngay trên đã nói đủ "đã tiêu / tổng" và mức cảnh báo,
          nên lặp lại bằng một role ARIA chỉ khiến trình đọc màn hình đọc hai lần cùng một điều. */}
      <div
        aria-hidden="true"
        data-testid={`thanh-${nhan.toLowerCase()}`}
        className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
      >
        <div className={`h-full ${MAU[muc]}`} style={{ width: `${pct}%` }} />
      </div>
      {group.reserved > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          Đang giữ chỗ {so(group.reserved)} lượt (request chưa xác nhận xong).
        </p>
      )}
    </div>
  );
}

export function UsagePanel({ usage }: { usage: UsageSnapshot }) {
  const coKy = usage.periodId !== null;
  const batDau = usage.startsAt ? new Date(usage.startsAt) : null;
  const trongTuongLai = batDau !== null && batDau.getTime() > Date.now();

  return (
    <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Kỳ hiện tại</h2>
        <Badge tone={TONE[usage.status]}>{TRANG_THAI_VI[usage.status]}</Badge>
        {usage.tier && <Badge tone="brand">{usage.tier}</Badge>}
        <span className="ml-auto text-xs text-[var(--text-muted)]">Bản sổ số {usage.revision}</span>
      </div>

      {usage.maintenance && (
        <p
          role="alert"
          className="rounded-[var(--radius-btn)] bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100"
        >
          Sổ quota đang bảo trì: mọi request của tenant này bị từ chối, không phải vì hết lượt.
        </p>
      )}

      <MissingAcksPanel missingAcks={usage.missingAcks} />

      {coKy && usage.startsAt && usage.endsAt ? (
        <>
          <p className="text-sm text-[var(--text-muted)]">
            {trongTuongLai
              ? `Kỳ bắt đầu ngày ${ngayVn(usage.startsAt)} và chạy tới ${ngayVn(usage.endsAt)} — hạn mức chưa có hiệu lực.`
              : `${ngayVn(usage.startsAt)} → ${ngayVn(usage.endsAt)}`}
          </p>
          <Thanh nhan="Places" group={usage.places} />
          <Thanh nhan="Directions" group={usage.directions} />
          <p className="text-xs text-[var(--text-muted)]">
            Số theo từng endpoint nằm ở màn Sức khoẻ hệ thống; sổ quota chỉ đếm theo hai nhóm này.
          </p>
        </>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Chưa có kỳ nào đang chạy. Dùng các nút bên dưới để bật bản dùng thử hoặc cấp một kỳ trả
          phí.
        </p>
      )}
    </section>
  );
}
