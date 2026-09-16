import { Button } from '@/components/ui/button';
import type { CommandReceipt } from './api';

export type KetQuaLenh =
  | { loai: 'bien-lai'; nhan: string; receipt: CommandReceipt }
  | { loai: 'mo-khoa'; nhan: string; unlocked: number }
  | { loai: 'thong-bao'; nhan: string; cau: string }
  | { loai: 'loi'; nhan: string; ma: string; cau: string };

/**
 * Biên lai hiện Ở TRANG chứ không trong hộp thoại: hộp thoại phải đóng ngay khi xếp lịch gửi, nếu
 * không toast đếm ngược nằm ngoài nó sẽ bị aria-hidden và pointer-events:none, tức mất luôn nút Huỷ.
 */
export function ReceiptPanel({ ketQua, onDong }: { ketQua: KetQuaLenh; onDong: () => void }) {
  const loi = ketQua.loai === 'loi';
  return (
    <section
      role={loi ? 'alert' : 'status'}
      className={
        loi
          ? 'rounded-[var(--radius-card)] border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950'
          : 'rounded-[var(--radius-card)] border border-green-300 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950'
      }
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {loi ? `Không gửi được: ${ketQua.nhan}` : `Đã gửi: ${ketQua.nhan}`}
          </p>

          {ketQua.loai === 'loi' && (
            <p className="mt-1 text-sm">
              <span className="font-mono">{ketQua.ma}</span> — {ketQua.cau}
            </p>
          )}

          {ketQua.loai === 'bien-lai' && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-[var(--text-muted)]">Mã thao tác</dt>
              <dd className="break-all font-mono">{ketQua.receipt.operationId}</dd>
              <dt className="text-[var(--text-muted)]">Bản sổ</dt>
              <dd>{ketQua.receipt.revision}</dd>
              <dt className="text-[var(--text-muted)]">Trạng thái sau lệnh</dt>
              <dd>
                {ketQua.receipt.status}
                {ketQua.receipt.tier ? ` · ${ketQua.receipt.tier}` : ''}
              </dd>
              <dt className="text-[var(--text-muted)]">Lúc</dt>
              {/* Có cả giờ: dòng admin_audit tương ứng được tra theo thời điểm, ngày không đủ. */}
              <dd>{new Date(ketQua.receipt.appliedAt).toLocaleString('vi-VN')}</dd>
            </dl>
          )}

          {ketQua.loai === 'mo-khoa' && (
            <p className="mt-1 text-sm">Đã mở {ketQua.unlocked} receipt đang bị giữ.</p>
          )}

          {ketQua.loai === 'thong-bao' && <p className="mt-1 text-sm">{ketQua.cau}</p>}
        </div>
        <Button variant="ghost" aria-label="Đóng biên lai" onClick={onDong}>
          ✕
        </Button>
      </div>
    </section>
  );
}
