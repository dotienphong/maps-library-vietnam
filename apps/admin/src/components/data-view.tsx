import { type ReactNode, useEffect, useState } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
  className?: string;
}

interface RecordViewProps<T> {
  items: T[];
  columns: Column<T>[];
  renderCard: (item: T) => ReactNode;
  rowKey: (item: T) => string;
}

const WIDE = '(min-width: 1024px)';

/**
 * Một ngưỡng duy nhất cho cả trang, đo theo khung nhìn chứ không theo container: hành vi đoán
 * được, và không phải nghĩ xem mỗi màn hình đang rộng bao nhiêu.
 */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia(WIDE).matches : false,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(WIDE);
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return wide;
}

/**
 * Tên là RecordView chứ không phải DataView: `DataView` là một global sẵn có của JavaScript
 * (view trên ArrayBuffer) và trình lint chặn việc che khuất nó.
 */
export function RecordView<T>({ items, columns, renderCard, rowKey }: RecordViewProps<T>) {
  const wide = useIsWide();

  if (!wide) {
    return (
      <div className="space-y-3">
        {items.map((item) => (
          <div key={rowKey(item)}>{renderCard(item)}</div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-black/[0.03] dark:bg-white/[0.04]">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={rowKey(item)} className="border-t border-[var(--border)]">
              {columns.map((column) => (
                <td key={column.key} className={column.className ?? 'px-3 py-2 align-top'}>
                  {column.render(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
