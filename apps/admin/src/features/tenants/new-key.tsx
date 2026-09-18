import { Button } from '@mapslibvn/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { type FormEvent, useState } from 'react';
import type { KeyKind, NewKeyInput, NewKeyResult } from './api';
import { useIssueKey } from './hooks';

const KINDS: { value: KeyKind; label: string; hint: string }[] = [
  { value: 'server', label: 'Máy chủ', hint: 'Gọi từ backend của khách; không kiểm origin.' },
  { value: 'web', label: 'Trang web', hint: 'Nằm công khai trong HTML — bắt buộc khai origin.' },
  { value: 'mobile', label: 'Ứng dụng', hint: 'Gọi từ app iOS/Android; có thể khai bundle id.' },
];

const field =
  'min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm';

export function NewKeyDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<KeyKind>('server');
  const [origins, setOrigins] = useState('');
  const [bundleIds, setBundleIds] = useState('');
  const [editsWrite, setEditsWrite] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [ketQua, setKetQua] = useState<NewKeyResult | null>(null);
  const [daChep, setDaChep] = useState(false);
  const issue = useIssueKey();

  const danhSach = (value: string) =>
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoi(null);
    const allowedOrigins = danhSach(origins);
    // Chặn tại chỗ trước khi gửi: máy chủ cũng chặn, nhưng bắt người dùng đợi một vòng mạng để
    // biết mình quên một ô là phí thời gian của họ.
    if (kind === 'web' && allowedOrigins.length === 0) {
      setLoi('Khoá trang web bắt buộc có ít nhất một origin, ví dụ https://khach.example.com');
      return;
    }

    const bundle = danhSach(bundleIds);
    const input: NewKeyInput = {
      label: label.trim(),
      kind,
      scopes: editsWrite ? ['places:read', 'edits:write'] : ['places:read'],
      ...(allowedOrigins.length > 0 ? { allowed_origins: allowedOrigins } : {}),
      ...(kind === 'mobile' && bundle.length > 0 ? { allowed_bundle_ids: bundle } : {}),
    };

    try {
      setKetQua(await issue.mutateAsync({ tenantId, input }));
    } catch (error) {
      // Giữ nguyên thông điệp máy chủ trả về (fetcher đã đặt nó vào AdminApiError.message):
      // "không cấp được khoá" không giúp ai sửa được gì.
      setLoi(error instanceof Error ? error.message : String(error));
    }
  };

  const sao = async () => {
    if (!ketQua) return;
    try {
      await navigator.clipboard.writeText(ketQua.key);
      setDaChep(true);
    } catch {
      // Trình duyệt từ chối clipboard (ngữ cảnh không bảo mật): khoá vẫn hiện để chọn tay.
      setDaChep(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/55" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-[70] max-h-[90vh] overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--bg)] p-4 lg:inset-0 lg:m-auto lg:h-fit lg:max-w-lg lg:rounded-[var(--radius-card)]">
          <Dialog.Title className="text-base font-semibold">
            {ketQua ? 'Khoá mới — lưu ngay' : 'Cấp khoá API mới'}
          </Dialog.Title>

          {ketQua ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-[var(--radius-btn)] bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                Khoá này <strong>chỉ hiện một lần</strong>. Máy chủ chỉ lưu bản băm, không có cách
                nào xem lại — mất thì phải cấp khoá khác và thu hồi khoá này.
              </div>
              <p className="select-all break-all rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-sm">
                {ketQua.key}
              </p>
              <div className="flex items-center gap-2">
                <Button onClick={() => void sao()}>Sao chép khoá</Button>
                {daChep && <span className="text-sm text-[var(--text-muted)]">Đã sao chép</span>}
                <Dialog.Close asChild>
                  <Button variant="secondary" className="ml-auto">
                    Tôi đã lưu
                  </Button>
                </Dialog.Close>
              </div>
            </div>
          ) : (
            <form className="mt-3 space-y-3" onSubmit={(event) => void onSubmit(event)}>
              <label className="block text-sm font-medium">
                Nhãn
                <input
                  className={`mt-1 ${field}`}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="vd: trang nhúng của khách A"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                Loại khoá
                <select
                  className={`mt-1 ${field}`}
                  value={kind}
                  onChange={(event) => setKind(event.target.value as KeyKind)}
                >
                  {KINDS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-[var(--text-muted)]">
                {KINDS.find((item) => item.value === kind)?.hint}
              </p>

              {kind === 'web' && (
                <label className="block text-sm font-medium">
                  Origin cho phép (mỗi dòng một origin)
                  <textarea
                    className="mt-1 min-h-24 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
                    value={origins}
                    onChange={(event) => setOrigins(event.target.value)}
                    placeholder={'https://khach.example.com\nhttps://*.khach.example.com'}
                  />
                </label>
              )}

              {kind === 'mobile' && (
                <label className="block text-sm font-medium">
                  Bundle id (mỗi dòng một id, có thể bỏ trống)
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
                    value={bundleIds}
                    onChange={(event) => setBundleIds(event.target.value)}
                    placeholder="vn.example.app"
                  />
                </label>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editsWrite}
                  onChange={(event) => setEditsWrite(event.target.checked)}
                />
                Cho phép gửi đóng góp POI (scope edits:write)
              </label>

              {loi && (
                <p role="alert" className="text-sm text-red-700 dark:text-red-200">
                  {loi}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="submit" block disabled={issue.isPending}>
                  {issue.isPending ? 'Đang cấp…' : 'Cấp khoá'}
                </Button>
                <Dialog.Close asChild>
                  <Button variant="secondary" block>
                    Huỷ
                  </Button>
                </Dialog.Close>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
