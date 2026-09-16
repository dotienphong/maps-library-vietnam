import { AdminApiError } from '@/lib/fetcher';
import { Button } from './ui/button';

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Đang tải" className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: khối xương không mang dữ liệu và danh sách không bao giờ bị sắp xếp lại hay chèn giữa, nên vị trí chính là danh tính duy nhất
          key={index}
          data-skeleton-row
          className="h-24 animate-pulse rounded-[var(--radius-card)] border border-[var(--border)] bg-black/5 dark:bg-white/5"
        />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = error instanceof AdminApiError ? error : null;
  const forbidden = api?.status === 403;
  return (
    <div className="rounded-[var(--radius-card)] border border-red-300 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950">
      <p className="font-semibold text-red-800 dark:text-red-100">
        {forbidden ? 'Tài khoản này không có quyền xem mục đó' : 'Không tải được dữ liệu'}
      </p>
      <p className="mt-1 text-sm text-red-700 dark:text-red-200">
        {api ? `${api.code} — ${api.message}` : String(error)}
      </p>
      {onRetry && !forbidden && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

export function OfflineBanner() {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-btn)] bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100"
    >
      Mất kết nối mạng. Dữ liệu hiển thị có thể đã cũ.
    </div>
  );
}
