import { type ClipboardEvent, type KeyboardEvent, useRef } from 'react';

const SO_O = 6;

/**
 * Ô nhập mã sáu số. Ba điều làm nó dùng được trên điện thoại, và cả ba đều có bài test:
 *  - `inputMode="numeric"` gọi bàn phím số, `autoComplete="one-time-code"` cho iOS và Android gợi
 *    ý mã ngay từ thanh thông báo;
 *  - dán cả mã vào một ô thì điền hết sáu ô, vì người dùng luôn copy cả chuỗi;
 *  - xoá lùi ở ô rỗng nhảy về ô trước, nếu không người dùng kẹt ở ô cuối.
 */
export function OMa({ onXong, disabled }: { onXong: (ma: string) => void; disabled?: boolean }) {
  const oRef = useRef<(HTMLInputElement | null)[]>([]);

  const docMa = () => oRef.current.map((o) => o?.value ?? '').join('');

  const xongNeuDu = () => {
    const ma = docMa();
    if (ma.length === SO_O) onXong(ma);
  };

  const onChange = (i: number, gia: string) => {
    const chiSo = gia.replace(/\D/g, '');
    const o = oRef.current[i];
    if (!o) return;
    o.value = chiSo.slice(-1);
    if (o.value && i < SO_O - 1) oRef.current[i + 1]?.focus();
    xongNeuDu();
  };

  const onKeyDown = (i: number, su: KeyboardEvent<HTMLInputElement>) => {
    if (su.key === 'Backspace' && !oRef.current[i]?.value && i > 0) {
      su.preventDefault();
      const truoc = oRef.current[i - 1];
      if (truoc) {
        truoc.value = '';
        truoc.focus();
      }
    }
    if (su.key === 'ArrowLeft' && i > 0) oRef.current[i - 1]?.focus();
    if (su.key === 'ArrowRight' && i < SO_O - 1) oRef.current[i + 1]?.focus();
  };

  const onPaste = (su: ClipboardEvent<HTMLInputElement>) => {
    const chiSo = su.clipboardData.getData('text').replace(/\D/g, '').slice(0, SO_O);
    if (!chiSo) return;
    su.preventDefault();
    chiSo.split('').forEach((ky, i) => {
      const o = oRef.current[i];
      if (o) o.value = ky;
    });
    oRef.current[Math.min(chiSo.length, SO_O - 1)]?.focus();
    xongNeuDu();
  };

  return (
    <div className="flex justify-center gap-2" data-o-ma>
      {Array.from({ length: SO_O }, (_, i) => (
        <input
          // biome-ignore lint/suspicious/noArrayIndexKey: sáu ô cố định, không bao giờ sắp lại hay chèn giữa
          key={i}
          ref={(el) => {
            oRef.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          disabled={disabled}
          aria-label={`Chữ số thứ ${i + 1}`}
          onChange={(su) => onChange(i, su.target.value)}
          onKeyDown={(su) => onKeyDown(i, su)}
          onPaste={onPaste}
          className="h-14 w-11 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] text-center text-2xl font-bold disabled:opacity-50"
        />
      ))}
    </div>
  );
}
