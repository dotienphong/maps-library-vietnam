import { Button } from '@mapslibvn/ui';
import { type FormEvent, useState } from 'react';

const O =
  'min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-normal';

export interface FormLyDoProps {
  /** Cũng là aria-label của form: hai form cùng ô "Lý do" trên một màn vẫn phân biệt được. */
  tieuDe: string;
  /** Nói hệ quả — cái gì sẽ xảy ra và cái gì KHÔNG xảy ra — trước khi người bấm gõ lý do. */
  moTa: string;
  nutGui: string;
  /** Viền đỏ + nút đỏ cho lệnh đáng dè chừng (vô hiệu hoá tài khoản); mặc định hổ phách. */
  nguyHiem?: boolean;
  onGui: (lyDo: string) => void;
  onThoi: () => void;
}

/**
 * Form một ô "Lý do" dùng chung cho huỷ đơn, đánh dấu hoàn tiền, vô hiệu hoá/kích hoạt lại tài
 * khoản. Tự nó KHÔNG gửi gì: cha nhận lý do rồi xếp lịch qua `useDelayedAction` (5 giây đổi ý).
 * Nút gửi khoá khi lý do rỗng — máy chủ vẫn từ chối 400 `invalid_reason`, đây là lớp tiện tay.
 */
export function FormLyDo({ tieuDe, moTa, nutGui, nguyHiem, onGui, onThoi }: FormLyDoProps) {
  const [lyDo, datLyDo] = useState('');
  const sach = lyDo.trim();
  const gui = (e: FormEvent) => {
    e.preventDefault();
    if (sach) onGui(sach);
  };
  return (
    <form
      aria-label={tieuDe}
      className={`space-y-3 rounded-[var(--radius-card)] border p-4 ${nguyHiem ? 'border-red-300' : 'border-amber-300'}`}
      onSubmit={gui}
    >
      <p className="text-sm font-bold">{tieuDe}</p>
      <p className="text-sm text-[var(--text-muted)]">{moTa}</p>
      <label className="block text-sm font-semibold">
        Lý do
        <input
          className={`${O} mt-1`}
          value={lyDo}
          onChange={(e) => datLyDo(e.target.value)}
          maxLength={500}
        />
      </label>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={!sach}
          {...(nguyHiem ? { variant: 'danger' as const } : {})}
        >
          {nutGui}
        </Button>
        <Button type="button" variant="secondary" onClick={onThoi}>
          Thôi
        </Button>
      </div>
    </form>
  );
}
