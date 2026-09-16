import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import type { AdminEdit, EditKind } from './api';

export const KIND_VI: Record<EditKind, string> = {
  create: 'Tạo mới',
  update: 'Sửa',
  close: 'Đóng cửa',
  reopen: 'Mở lại',
  report: 'Báo lỗi',
};

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}

export function editTitle(edit: AdminEdit): string {
  const fromChanges = typeof edit.changes?.name === 'string' ? edit.changes.name : null;
  return edit.poi_name ?? fromChanges ?? edit.poi_id ?? `Đóng góp #${edit.id}`;
}

interface EditCardProps {
  edit: AdminEdit;
  onOpen: (id: number) => void;
  onReview: (id: number, action: 'approve' | 'reject') => void;
}

export function EditCard({ edit, onOpen, onReview }: EditCardProps) {
  const address = [edit.poi_ward, edit.poi_province].filter(Boolean).join(', ');
  const pending = edit.status === 'pending';

  return (
    <Card interactive>
      <div className="flex items-center gap-2">
        <Badge tone={edit.kind === 'create' ? 'brand' : 'neutral'}>{KIND_VI[edit.kind]}</Badge>
        {edit.distance_m !== null && <Badge tone="warning">Đổi vị trí · {edit.distance_m} m</Badge>}
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          {relativeTime(edit.created_at)}
        </span>
      </div>

      {/* `after:inset-0` kéo vùng bấm của nút này ra CẢ thẻ: bấm vào khoảng trống, vào huy hiệu
          hay vào dòng thời gian đều mở chi tiết. Vẫn là một nút thật nên bàn phím và trình đọc
          màn hình tới được, khác hẳn gắn onClick lên thẻ. */}
      <button
        type="button"
        onClick={() => onOpen(edit.id)}
        className="mt-2 block w-full text-left after:absolute after:inset-0 after:content-['']"
      >
        <CardTitle>{editTitle(edit)}</CardTitle>
        {address && <p className="mt-0.5 text-sm text-[var(--text-muted)]">{address}</p>}
      </button>

      {pending && (
        // `relative z-10`: nằm TRÊN lớp phủ, nếu không thì bấm Duyệt lại mở chi tiết.
        <div className="relative z-10 mt-3 flex gap-2">
          <Button block onClick={() => onReview(edit.id, 'approve')}>
            Duyệt
          </Button>
          <Button block variant="secondary" onClick={() => onReview(edit.id, 'reject')}>
            Từ chối
          </Button>
        </div>
      )}
    </Card>
  );
}
