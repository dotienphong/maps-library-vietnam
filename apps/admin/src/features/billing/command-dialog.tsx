import * as Dialog from '@radix-ui/react-dialog';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Command, PaidTier, PlanCatalog, QuotaGroup, UsageSnapshot } from './api';
import {
  dungLenh,
  type FormLenh,
  homNayVn,
  kiemForm,
  type LoaiLenh,
  thangSau,
} from './command-builder';
import { so } from './usage-panel';

const TIEU_DE: Record<LoaiLenh, string> = {
  trial: 'Bật bản dùng thử',
  grant: 'Cấp kỳ trả phí',
  credits: 'Cộng credit',
  suspend: 'Tạm dừng thuê bao',
  resume: 'Mở lại thuê bao',
  unlock: 'Mở khoá receipt chưa xác nhận',
};

const NHAN_GUI: Record<LoaiLenh, string> = {
  trial: 'Bật dùng thử',
  grant: 'Cấp kỳ',
  credits: 'Cộng credit',
  suspend: 'Tạm dừng',
  resume: 'Mở lại',
  unlock: 'Mở khoá receipt',
};

const field =
  'min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm';

interface Props {
  loai: LoaiLenh;
  usage: UsageSnapshot;
  catalog: PlanCatalog | undefined;
  /** Lệnh đã dựng + nhãn tiếng Việt cho toast đếm ngược. `unlock` đi qua `onMoKhoa`. */
  onGui: (command: Command, nhan: string) => void;
  onMoKhoa?: (operationId: string, reason: string, nhan: string) => void;
  onDong: () => void;
}

export function CommandDialog({ loai, usage, catalog, onGui, onMoKhoa, onDong }: Props) {
  const homNay = homNayVn();
  const [form, setForm] = useState<FormLenh>({
    reason: '',
    ngayBatDau: homNay,
    ngayKetThuc: thangSau(homNay),
    tier: 'starter',
    paymentReference: '',
    lineItemId: 'period-1',
    group: 'places',
    packs: 1,
  });
  const [loi, setLoi] = useState<string | null>(null);
  /**
   * Sinh MỘT lần cho mỗi lần mở hộp thoại và giữ nguyên tới lúc gửi: máy chủ dùng nó để lệnh lặp
   * không thành hai lệnh, và để thử lại sau một 503 mà không cộng tiền hai lần. Sinh lại lúc bấm
   * là vứt bỏ đúng tính chất đó.
   */
  const [operationId] = useState(() => crypto.randomUUID());
  const [periodId] = useState(() => crypto.randomUUID());

  const bac = catalog?.tiers.find((item) => item.tier === form.tier);
  const addOn = catalog?.addOns.find((item) => item.group === form.group);
  const dat = (thayDoi: Partial<FormLenh>) => setForm((truoc) => ({ ...truoc, ...thayDoi }));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const sai = kiemForm(loai, form, usage);
    if (sai) {
      setLoi(sai);
      return;
    }
    const nhan = `${NHAN_GUI[loai]} cho tenant`;
    if (loai === 'unlock') {
      onMoKhoa?.(operationId, form.reason.trim(), nhan);
    } else {
      onGui(dungLenh(loai, form, usage, operationId, periodId), nhan);
    }
    onDong();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDong()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/55" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-[70] max-h-[90vh] overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--bg)] p-4 lg:inset-0 lg:m-auto lg:h-fit lg:max-w-lg lg:rounded-[var(--radius-card)]">
          <Dialog.Title className="text-base font-semibold">{TIEU_DE[loai]}</Dialog.Title>

          <form className="mt-3 space-y-3" onSubmit={onSubmit}>
            {(loai === 'trial' || loai === 'grant') && (
              <label className="block text-sm">
                Ngày bắt đầu
                <input
                  type="date"
                  className={field}
                  value={form.ngayBatDau}
                  onChange={(event) => dat({ ngayBatDau: event.target.value })}
                />
              </label>
            )}

            {loai === 'grant' && (
              <>
                <label className="block text-sm">
                  Ngày kết thúc
                  <input
                    type="date"
                    className={field}
                    value={form.ngayKetThuc}
                    onChange={(event) => dat({ ngayKetThuc: event.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Bậc
                  <select
                    className={field}
                    value={form.tier}
                    onChange={(event) => dat({ tier: event.target.value as PaidTier })}
                  >
                    <option value="starter">starter</option>
                    <option value="professional">professional</option>
                    <option value="business">business</option>
                  </select>
                </label>
                {bac && (
                  <p className="text-xs text-[var(--text-muted)]">
                    Bậc này cho {so(bac.places)} places và {so(bac.directions)} directions mỗi kỳ.
                  </p>
                )}
              </>
            )}

            {loai === 'credits' && (
              <>
                <label className="block text-sm">
                  Nhóm
                  <select
                    className={field}
                    value={form.group}
                    onChange={(event) => dat({ group: event.target.value as QuotaGroup })}
                  >
                    <option value="places">places</option>
                    <option value="directions">directions</option>
                  </select>
                </label>
                <label className="block text-sm">
                  Số gói
                  <input
                    type="number"
                    min={1}
                    className={field}
                    value={form.packs}
                    onChange={(event) => dat({ packs: Number(event.target.value) })}
                  />
                </label>
                {addOn && (
                  <p className="text-xs text-[var(--text-muted)]">
                    Cộng {so(addOn.units * form.packs)} lượt vào kỳ {usage.periodId ?? '—'}.
                  </p>
                )}
              </>
            )}

            {(loai === 'grant' || loai === 'credits') && (
              <>
                <label className="block text-sm">
                  Mã thanh toán
                  <input
                    className={field}
                    value={form.paymentReference}
                    onChange={(event) => dat({ paymentReference: event.target.value })}
                    placeholder="ví dụ CK-8821"
                  />
                </label>
                <label className="block text-sm">
                  Dòng hoá đơn
                  <input
                    className={field}
                    value={form.lineItemId}
                    onChange={(event) => dat({ lineItemId: event.target.value })}
                  />
                </label>
                <p className="text-xs text-[var(--text-muted)]">
                  Cặp mã thanh toán + dòng hoá đơn là định danh giao dịch: gửi lại y hệt sẽ trả về
                  biên lai cũ chứ không cộng tiền lần nữa.
                </p>
              </>
            )}

            <label className="block text-sm">
              Lý do
              <textarea
                className={`${field} min-h-20 py-2`}
                value={form.reason}
                onChange={(event) => dat({ reason: event.target.value })}
                placeholder="Ghi đủ để sáu tháng sau đọc lại vẫn hiểu"
              />
            </label>

            <p className="text-xs text-[var(--text-muted)]">
              Mã thao tác:{' '}
              <span data-testid="ma-thao-tac" className="font-mono">
                {operationId}
              </span>
            </p>

            {loi && (
              <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">
                {loi}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" block>
                Gửi lệnh
              </Button>
              <Button type="button" variant="secondary" onClick={onDong}>
                Đóng
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
