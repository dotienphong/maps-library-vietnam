import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ApiKey } from './api';
import { tenantDate } from './tenant-card';

export const KIND_VI: Record<ApiKey['kind'], string> = {
  web: 'Trang web',
  mobile: 'Ứng dụng',
  server: 'Máy chủ',
};

interface KeyRowProps {
  apiKey: ApiKey;
  onRevoke: (apiKey: ApiKey, revoked: boolean) => void;
}

export function KeyRow({ apiKey, onRevoke }: KeyRowProps) {
  const song = apiKey.active && apiKey.revoked_at === null;
  return (
    <li className="rounded-[var(--radius-card)] border border-[var(--border)] p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* Tiền tố là tất cả những gì hệ thống còn giữ để nhận diện một khoá — DB bỏ cột khoá
              rõ từ migration 0011. Cho phép chọn/sao chép được vì nó dùng để đối chiếu với khách. */}
          <p className="select-all font-mono text-sm font-semibold">{apiKey.key_prefix}</p>
          <p className="text-sm text-[var(--text-muted)]">{apiKey.label ?? 'Không có nhãn'}</p>
        </div>
        <Badge tone={song ? 'success' : 'danger'}>{song ? 'Đang dùng' : 'Đã thu hồi'}</Badge>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge>{KIND_VI[apiKey.kind]}</Badge>
        {apiKey.scopes.map((scope) => (
          <Badge key={scope} tone="brand">
            {scope}
          </Badge>
        ))}
        {apiKey.quota_directions_per_day !== null && (
          <Badge tone="warning">{apiKey.quota_directions_per_day} tuyến/ngày</Badge>
        )}
      </div>

      {apiKey.allowed_origins.length > 0 && (
        <p className="mt-2 break-all text-xs text-[var(--text-muted)]">
          Origin cho phép: {apiKey.allowed_origins.join(', ')}
        </p>
      )}
      {apiKey.allowed_bundle_ids.length > 0 && (
        <p className="mt-1 break-all text-xs text-[var(--text-muted)]">
          Bundle id: {apiKey.allowed_bundle_ids.join(', ')}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">
          Cấp ngày {tenantDate(apiKey.created_at)}
          {apiKey.revoked_at ? ` · thu hồi ${tenantDate(apiKey.revoked_at)}` : ''}
        </span>
        <Button
          variant={song ? 'danger' : 'secondary'}
          className="ml-auto"
          onClick={() => onRevoke(apiKey, song)}
        >
          {song ? 'Thu hồi' : 'Khôi phục'}
        </Button>
      </div>
    </li>
  );
}
