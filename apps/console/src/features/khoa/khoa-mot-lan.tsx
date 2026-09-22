import { DOCS } from '@mapslibvn/catalog';
import { Button } from '@mapslibvn/ui';
import { useState } from 'react';

/**
 * Hiện khoá API vừa cấp. Khoá dạng rõ chỉ tồn tại ở đúng màn hình này một lần; máy chủ chỉ giữ
 * bản băm nên không ai lấy lại được, kể cả người vận hành.
 *
 * Nút sao chép có nhánh dự phòng: trình duyệt chặn clipboard trong ngữ cảnh không an toàn hoặc
 * khi thiếu quyền, và một nút bấm vào không làm gì là cách chắc chắn để khách mất khoá.
 */
export function KhoaMotLan({ khoa, apiBase }: { khoa: string; apiBase: string }) {
  const [trangThai, datTrangThai] = useState<'cho' | 'xong' | 'hong'>('cho');

  const sao = async () => {
    try {
      await navigator.clipboard.writeText(khoa);
      datTrangThai('xong');
    } catch {
      datTrangThai('hong');
    }
  };

  const lenhThu = `curl -H "X-Api-Key: ${khoa}" \\
  "${apiBase}/v1/search?q=c%C3%A0%20ph%C3%AA"`;

  const doanMa = `const map = MapsLibVN.createMap({
  container: 'map',
  apiKey: '${khoa}',
  apiBase: '${apiBase}',
  center: [106.7, 10.776],
  zoom: 13,
});`;

  return (
    <section
      aria-labelledby="tt-khoa"
      className="rounded-[var(--radius-card)] border border-accent-text bg-[var(--surface)] p-5"
    >
      <h2 id="tt-khoa" className="text-base font-bold">
        Khoá API của bạn
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Khoá này chỉ hiện <strong>một lần</strong>. Hệ thống chỉ lưu bản băm, nên không ai lấy lại
        được — kể cả chúng tôi. Hãy lưu vào nơi an toàn trước khi rời trang.
      </p>

      <p
        data-testid="khoa-mot-lan"
        className="mt-4 select-all break-all rounded-[var(--radius-btn)] bg-black/5 p-3 font-mono text-sm dark:bg-white/10"
      >
        {khoa}
      </p>

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={() => void sao()}>Sao chép khoá</Button>
        {trangThai === 'xong' && (
          <span role="status" className="text-sm text-green-700 dark:text-green-300">
            Đã sao chép
          </span>
        )}
        {trangThai === 'hong' && (
          <span role="status" className="text-sm text-amber-700 dark:text-amber-300">
            Trình duyệt chặn sao chép — hãy bôi đen chuỗi trên rồi chép tay.
          </span>
        )}
      </div>

      {/* Ba bước, đủ để khoá chạy được ngay trên máy khách trước khi họ rời trang. Dài hơn thế
          thì thuộc về tài liệu, và link ở cuối dẫn sang đó. */}
      <div className="mt-6 border-t border-[var(--border)] pt-5">
        <h3 className="text-sm font-bold">Dùng khoá này thế nào</h3>

        <ol className="mt-3 space-y-4 text-sm">
          <li>
            <p className="font-semibold">1. Thử ngay bằng một lệnh</p>
            <p className="mt-1 text-[var(--text-muted)]">
              Dán vào terminal. Khoá đi trong header <code>X-Api-Key</code>, không bao giờ đặt trên
              URL vì URL lọt vào log và bộ nhớ đệm.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-[var(--radius-btn)] bg-black/5 p-3 text-xs dark:bg-white/10">
              <code>{lenhThu}</code>
            </pre>
          </li>

          <li>
            <p className="font-semibold">2. Cài thư viện</p>
            <pre className="mt-2 overflow-x-auto rounded-[var(--radius-btn)] bg-black/5 p-3 text-xs dark:bg-white/10">
              <code>npm i @mapslibvn/web</code>
            </pre>
          </li>

          <li>
            <p className="font-semibold">3. Dựng bản đồ đầu tiên</p>
            <pre className="mt-2 overflow-x-auto rounded-[var(--radius-btn)] bg-black/5 p-3 text-xs dark:bg-white/10">
              <code>{doanMa}</code>
            </pre>
          </li>
        </ol>

        <p className="mt-4 text-sm">
          <a
            className="font-semibold underline"
            href={DOCS.batDau}
            target="_blank"
            rel="noreferrer"
          >
            Hướng dẫn bắt đầu trong 5 phút
          </a>
          <span className="text-[var(--text-muted)]"> · </span>
          <a className="underline" href={DOCS.khoaApi} target="_blank" rel="noreferrer">
            Tất cả về khoá API
          </a>
        </p>
      </div>
    </section>
  );
}
