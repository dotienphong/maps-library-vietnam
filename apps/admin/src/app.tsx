import { useCallback, useEffect, useState } from 'react';
import { type AdminEdit, type EditStatus, listEdits, reviewEdit } from './api';

const STATUSES: EditStatus[] = ['pending', 'approved', 'rejected', 'auto_approved'];
const KIND_VI: Record<AdminEdit['kind'], string> = {
  create: 'Tạo mới',
  update: 'Sửa',
  close: 'Đóng cửa',
  reopen: 'Mở lại',
  report: 'Báo lỗi',
};

export function App() {
  const [status, setStatus] = useState<EditStatus>('pending');
  const [items, setItems] = useState<AdminEdit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = useCallback(async (next: EditStatus) => {
    setError(null);
    try {
      setItems(await listEdits(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload(status);
  }, [status, reload]);

  const review = async (id: number, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      await reviewEdit(id, action);
      await reload(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        margin: '2rem auto',
        maxWidth: 960,
        padding: '0 1rem',
      }}
    >
      <h1>Duyệt đóng góp POI</h1>
      <p>
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            disabled={s === status}
            style={{ marginRight: 8, padding: '4px 12px' }}
          >
            {s}
          </button>
        ))}
      </p>
      {error && <p style={{ color: 'crimson' }}>Lỗi: {error}</p>}
      {items.length === 0 && !error && <p>Không có edit nào ở trạng thái “{status}”.</p>}
      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Loại</th>
            <th>POI</th>
            <th>Thay đổi</th>
            <th>Ghi chú</th>
            <th>Lúc gửi</th>
            {status === 'pending' && <th>Hành động</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.id}</td>
              <td>{KIND_VI[item.kind]}</td>
              <td>
                {item.poi_name ?? item.poi_id ?? '—'}
                {item.poi_status ? ` (${item.poi_status})` : ''}
              </td>
              <td>
                <pre style={{ margin: 0, maxWidth: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {item.changes ? JSON.stringify(item.changes, null, 1) : '—'}
                </pre>
              </td>
              <td>{item.note ?? '—'}</td>
              <td>{new Date(item.created_at).toLocaleString('vi-VN')}</td>
              {status === 'pending' && (
                <td>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => review(item.id, 'approve')}
                  >
                    Duyệt
                  </button>{' '}
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => review(item.id, 'reject')}
                  >
                    Từ chối
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
