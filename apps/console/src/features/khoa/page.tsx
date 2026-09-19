import { DOCS } from '@mapslibvn/catalog';
import { Badge, Button, LoadingSkeleton, useDelayedAction } from '@mapslibvn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { khoaCache } from '@/features/auth/hooks';
import { type KhoaApi, layKhoa } from '@/lib/api';
import { postJson } from '@/lib/fetcher';
import { LoiHop } from '@/lib/loi-hop';
import { KhoaMotLan } from './khoa-mot-lan';

const ngayVn = (iso: string) =>
  new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** ULID rút gọn: đủ duy nhất để một lần bấm hai lần không thành hai lệnh. */
const sinhOperationId = () =>
  `${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(2)).join('')}`.slice(0, 40);

export function Khoa() {
  const queryClient = useQueryClient();
  const { schedule } = useDelayedAction();
  const [khoaMoi, datKhoaMoi] = useState<string | null>(null);
  const [nhan, datNhan] = useState('');

  const danhSach = useQuery({ queryKey: khoaCache.khoa, queryFn: layKhoa, retry: 1 });

  const capKhoa = useMutation({
    mutationFn: () =>
      postJson<{ key: string }>('/v1/console/keys', {
        label: nhan.trim() || 'Khoá mới',
        kind: 'web',
      }),
    onSuccess: async (ketQua) => {
      datKhoaMoi(ketQua.key);
      datNhan('');
      await queryClient.invalidateQueries({ queryKey: khoaCache.khoa });
    },
  });

  const thuHoi = useMutation({
    mutationFn: (keyHash: string) =>
      postJson(`/v1/console/keys/${keyHash}/revoke`, { operationId: sinhOperationId() }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: khoaCache.khoa }),
  });

  const dangHoatDong = danhSach.data?.keys.filter((k) => k.active).length ?? 0;
  const toiDa = danhSach.data?.toiDa ?? 10;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Khoá API</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          Cấp thêm khoá <strong>không</strong> cấp thêm hạn mức: mọi khoá của tổ chức dùng chung một
          hạn mức. Cấp nhiều khoá là để tách môi trường và thu hồi riêng khi một khoá bị lộ.
        </p>
        {/* Link đặt ở đây chứ không chỉ ở màn hiện khoá: khối kia chỉ sống đúng một lần, còn
            người quay lại trang này để cấp khoá thứ hai vẫn cần biết đọc tiếp ở đâu. */}
        <p className="mt-2 text-sm">
          <a className="underline" href={DOCS.khoaApi} target="_blank" rel="noreferrer">
            Cách dùng khoá, giới hạn và cách thu hồi
          </a>
        </p>
      </div>

      {khoaMoi && <KhoaMotLan khoa={khoaMoi} apiBase={location.origin} />}

      <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-bold">Cấp khoá mới</h2>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(su) => {
            su.preventDefault();
            capKhoa.mutate();
          }}
        >
          <div className="min-w-48 flex-1">
            <label htmlFor="nhan" className="block text-sm font-semibold">
              Tên gợi nhớ
            </label>
            <input
              id="nhan"
              maxLength={80}
              value={nhan}
              onChange={(su) => datNhan(su.target.value)}
              placeholder="Ví dụ: web sản xuất"
              className="mt-1 min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3"
            />
          </div>
          <Button type="submit" disabled={capKhoa.isPending || dangHoatDong >= toiDa}>
            {capKhoa.isPending ? 'Đang cấp…' : 'Cấp khoá'}
          </Button>
        </form>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Đang dùng {dangHoatDong}/{toiDa} khoá. Khoá mới chỉ có quyền đọc địa điểm.
        </p>
        {capKhoa.isError && (
          <div className="mt-3">
            <LoiHop error={capKhoa.error} />
          </div>
        )}
      </section>

      {danhSach.isPending && <LoadingSkeleton rows={3} />}
      {danhSach.isError && <LoiHop error={danhSach.error} />}
      {thuHoi.isError && <LoiHop error={thuHoi.error} />}

      {danhSach.data && danhSach.data.keys.length === 0 && (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-8 text-center text-[var(--text-muted)]">
          Chưa có khoá nào. Cấp khoá đầu tiên ở khối bên trên.
        </p>
      )}

      <ul className="space-y-3">
        {danhSach.data?.keys.map((k: KhoaApi) => (
          <li
            key={k.keyHash}
            className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{k.label ?? 'Không tên'}</p>
                <p className="mt-1 break-all font-mono text-sm text-[var(--text-muted)]">
                  {k.keyPrefix}…
                </p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  Loại {k.kind} · cấp ngày {ngayVn(k.createdAt)}
                  {k.allowedOrigins.length > 0 && ` · origin: ${k.allowedOrigins.join(', ')}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={k.active ? 'success' : 'neutral'}>
                  {k.active ? 'Đang dùng' : 'Đã thu hồi'}
                </Badge>
                {k.active && (
                  <Button
                    variant="danger"
                    onClick={() =>
                      // Thu hồi không đảo ngược được sạch sẽ: ứng dụng đang dùng khoá đó sẽ hỏng
                      // ngay. Đi qua toast đếm ngược 5 giây, đúng cơ chế trang Admin dùng cho
                      // những thao tác cùng loại.
                      schedule({
                        label: `Thu hồi khoá ${k.keyPrefix}`,
                        run: async () => {
                          await thuHoi.mutateAsync(k.keyHash);
                        },
                      })
                    }
                  >
                    Thu hồi
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
