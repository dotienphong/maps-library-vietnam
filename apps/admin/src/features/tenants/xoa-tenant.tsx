import { Button } from '@mapslibvn/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { type FormEvent, useState } from 'react';
import { useXoaTenant } from './hooks';

const field =
  'min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm';

/**
 * Hộp thoại xoá vĩnh viễn một tenant.
 *
 * Thiết kế theo đúng cặp `--apply --confirm` của `scripts/db-tenant-xoa.mjs`: người bấm phải gõ
 * lại TÊN tổ chức. Một hộp thoại chỉ có nút "Xác nhận" thì bấm nhầm hai lần liên tiếp là xong
 * chuyện; gõ tên thì không nhầm được, và lúc gõ xong người ta đã đọc kỹ mình đang xoá cái gì.
 *
 * Nút xoá KHÔNG mở ra khi ô còn trống hoặc gõ sai, để phản hồi đến ngay tại chỗ thay vì sau một
 * vòng mạng. Máy chủ vẫn kiểm lại y hệt — đây là lớp tiện tay, không phải lớp bảo vệ.
 */
export function XoaTenantDialog({
  tenantId,
  tenantName,
  soKhoa,
  onClose,
  onXoaXong,
}: {
  tenantId: string;
  tenantName: string;
  soKhoa: number;
  onClose: () => void;
  onXoaXong: () => void;
}) {
  const [goLai, setGoLai] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const xoa = useXoaTenant();

  const khop = goLai.trim() === tenantName;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoi(null);
    try {
      await xoa.mutateAsync({ tenantId, confirmName: goLai.trim() });
      onXoaXong();
    } catch (error) {
      // Giữ nguyên thông điệp máy chủ: "còn N đóng góp POI" là thứ nói cho người vận hành biết
      // phải làm gì tiếp, còn "không xoá được" thì không.
      setLoi(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/55" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-[70] max-h-[90vh] overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--bg)] p-4 lg:inset-0 lg:m-auto lg:h-fit lg:max-w-lg lg:rounded-[var(--radius-card)]">
          <Dialog.Title className="text-base font-semibold">Xoá tổ chức vĩnh viễn</Dialog.Title>

          <div className="mt-3 rounded-[var(--radius-btn)] bg-red-100 px-4 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
            <p>
              Thao tác này <strong>không lùi lại được</strong>. Sẽ xoá:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong data-testid="so-khoa">{soKhoa}</strong> khoá API — mọi ứng dụng đang dùng
                chúng sẽ hỏng
              </li>
              <li>bản ghi tổ chức và danh sách thành viên</li>
            </ul>
            <p className="mt-2">
              Tài khoản đăng nhập của khách được <strong>giữ lại</strong>, chỉ gỡ liên kết tới tổ
              chức này. Khách vẫn đăng nhập được và tạo tổ chức mới.
            </p>
          </div>

          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Khoá vừa xoá còn sống thêm tối đa 5 phút vì tầng xác thực có bộ nhớ đệm. Hạn mức của tổ
            chức nằm ngoài cơ sở dữ liệu nên không xoá kèm; nó thành sổ không ai đọc.
          </p>

          <form className="mt-3 space-y-3" onSubmit={(event) => void onSubmit(event)}>
            <label className="block text-sm font-medium">
              Gõ lại tên tổ chức để xác nhận
              <input
                className={`mt-1 ${field}`}
                value={goLai}
                onChange={(event) => setGoLai(event.target.value)}
                placeholder={tenantName}
                autoComplete="off"
                aria-describedby="goi-y-ten"
              />
            </label>
            <p id="goi-y-ten" className="text-sm text-[var(--text-muted)]">
              Tên cần gõ: <span className="select-all font-mono">{tenantName}</span>
            </p>

            {loi && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                {loi}
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" variant="danger" disabled={!khop || xoa.isPending}>
                {xoa.isPending ? 'Đang xoá…' : 'Xoá vĩnh viễn'}
              </Button>
              <Dialog.Close asChild>
                <Button variant="secondary" className="ml-auto">
                  Huỷ
                </Button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
