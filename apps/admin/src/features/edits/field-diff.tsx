import type { PoiSnapshot } from './api';

/** Các khoá do máy chủ sinh ra từ giá trị người dùng gửi — hiện chúng chỉ làm nhiễu. */
const DERIVED = new Set(['name_norm', 'street_norm', 'ward_norm', 'province_norm']);

const LABELS: Record<string, string> = {
  name: 'Tên',
  category: 'Danh mục',
  housenumber: 'Số nhà',
  street: 'Đường',
  ward: 'Phường/xã',
  province: 'Tỉnh/thành',
  address_text: 'Địa chỉ',
  contact: 'Liên hệ',
  hours: 'Giờ mở cửa',
  'toạ độ': 'Toạ độ',
};

export interface DiffRow {
  field: string;
  before: string | null;
  after: string;
}

const show = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

// Dấu phẩy thập phân theo cách viết tiếng Việt.
const coords = (lat: unknown, lng: unknown): string =>
  `${Number(lat).toFixed(4).replace('.', ',')} · ${Number(lng).toFixed(4).replace('.', ',')}`;

export function buildDiff(
  changes: Record<string, unknown> | null,
  poi: PoiSnapshot | null,
): DiffRow[] {
  if (!changes) return [];
  const rows: DiffRow[] = [];

  if ('lat' in changes || 'lng' in changes) {
    rows.push({
      field: 'toạ độ',
      before: poi ? coords(poi.lat, poi.lng) : null,
      after: coords(changes.lat ?? poi?.lat, changes.lng ?? poi?.lng),
    });
  }

  for (const [key, value] of Object.entries(changes)) {
    if (key === 'lat' || key === 'lng' || DERIVED.has(key)) continue;
    const before = poi ? show((poi as unknown as Record<string, unknown>)[key]) : null;
    rows.push({ field: key, before, after: show(value) });
  }

  return rows;
}

export function FieldDiff({
  changes,
  poi,
}: {
  changes: Record<string, unknown> | null;
  poi: PoiSnapshot | null;
}) {
  const rows = buildDiff(changes, poi);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Không có trường nào thay đổi — đóng góp này chỉ đổi trạng thái của địa điểm.
      </p>
    );
  }

  return (
    <dl className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
      {rows.map((row) => (
        <div
          key={row.field}
          className="flex flex-wrap items-baseline gap-2 border-b border-[var(--border)] px-3 py-2 last:border-b-0"
        >
          <dt className="w-24 shrink-0 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            {LABELS[row.field] ?? row.field}
          </dt>
          <dd className="flex flex-1 flex-wrap items-baseline gap-2 text-sm">
            {row.before !== null && (
              <>
                <span className="text-[var(--text-muted)] line-through">{row.before}</span>
                <span aria-hidden="true">→</span>
              </>
            )}
            <span className="font-semibold text-green-700 dark:text-green-300">{row.after}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
