import { EmptyState } from '@mapslibvn/ui';
import type { LegacyUsage } from './api';
import { ngayVn, so } from './usage-panel';

/**
 * Tenant chưa bật chế độ thương mại không có gì trong sổ Durable Object. Nguồn duy nhất là bộ đếm
 * xấp xỉ trong KV, theo NGÀY và theo TỪNG KHOÁ — hạn mức legacy vốn tính theo khoá chứ không theo
 * tenant, nên bảng này giữ đúng chiều đó thay vì gộp lại cho đẹp mắt.
 */
export function LegacyPanel({ legacy }: { legacy: LegacyUsage }) {
  return (
    <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">
          Hôm nay ({ngayVn(`${legacy.day}T00:00:00+07:00`)})
        </h2>
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          Số xấp xỉ, đếm theo giờ Việt Nam · chặn khi vượt {legacy.blockAtMultiple}× hạn mức ngày
        </span>
      </div>

      {!legacy.quotaEnabled && (
        <p
          role="alert"
          className="rounded-[var(--radius-btn)] bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100"
        >
          Bộ đếm đang tắt trên môi trường này (QUOTA_ENABLED khác 1), nên mọi số dưới đây là 0.
        </p>
      )}
      {!legacy.counted && (
        <p
          role="alert"
          className="rounded-[var(--radius-btn)] bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100"
        >
          Hệ thống không đếm lượt cho tenant internal (tiết kiệm lượt ghi KV), nên số 0 ở đây là
          thiết kế chứ không phải khách không dùng.
        </p>
      )}

      {legacy.keys.length === 0 ? (
        <EmptyState
          title="Tenant này chưa có khoá nào đang hoạt động"
          hint="Cấp khoá ở màn Tenant & khoá API, hoặc khôi phục khoá đã thu hồi."
        />
      ) : (
        <ul className="space-y-2">
          {legacy.keys.map((key) => (
            <li
              key={key.keyPrefix}
              className="rounded-[var(--radius-btn)] border border-[var(--border)] p-3 text-sm"
            >
              <p className="font-mono text-sm">{key.keyPrefix}</p>
              {key.label && <p className="text-xs text-[var(--text-muted)]">{key.label}</p>}
              <p className="mt-1">
                Places {so(key.places.used)} / {so(key.places.limit)} · Directions{' '}
                {so(key.directions.used)} / {so(key.directions.limit)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm">
        Tổng hôm nay: Places <strong>{so(legacy.total.places.used)}</strong> /{' '}
        {so(legacy.total.places.limit)} · Directions{' '}
        <strong>{so(legacy.total.directions.used)}</strong> / {so(legacy.total.directions.limit)}
      </p>
    </section>
  );
}
