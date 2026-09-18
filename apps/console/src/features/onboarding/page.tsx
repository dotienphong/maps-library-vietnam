import { Button } from '@mapslibvn/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { khoaCache } from '@/features/auth/hooks';
import { KhoaMotLan } from '@/features/khoa/khoa-mot-lan';
import { postJson } from '@/lib/fetcher';
import { LoiHop } from '@/lib/loi-hop';

export function BatDau() {
  const [ten, datTen] = useState('');
  const [khoa, datKhoa] = useState<string | null>(null);
  const dieuHuong = useNavigate();
  const queryClient = useQueryClient();

  const tao = useMutation({
    mutationFn: async () => {
      // Hai bước TUẦN TỰ chứ không song song: cấp khoá cần tenant đã tồn tại. Nếu bước hai lỗi,
      // tenant vẫn còn và khách cấp khoá sau ở màn Khoá API — không mất gì.
      await postJson<{ tenant: { id: string } }>('/v1/console/tenant', { name: ten.trim() });
      await queryClient.invalidateQueries({ queryKey: khoaCache.toi });
      return await postJson<{ key: string }>('/v1/console/keys', {
        label: 'Khoá đầu tiên',
        kind: 'web',
      });
    },
    onSuccess: (ketQua) => datKhoa(ketQua.key),
  });

  if (khoa) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Xong rồi</h1>
          <p className="mt-2 text-[var(--text-muted)]">
            Tổ chức đã tạo và bản dùng thử đã kích hoạt: 2.000 lượt Places và 200 lượt tính tuyến
            trong 30 ngày.
          </p>
        </div>
        <KhoaMotLan khoa={khoa} apiBase={location.origin} />
        <Button block onClick={() => void dieuHuong('/')}>
          Tôi đã lưu khoá
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-bold">Tạo tổ chức</h1>
      <p className="mt-2 text-[var(--text-muted)]">
        Một bước cuối. Chúng tôi tạo tổ chức, kích hoạt bản dùng thử và cấp khoá API đầu tiên cho
        bạn.
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(su) => {
          su.preventDefault();
          tao.mutate();
        }}
      >
        <div>
          <label htmlFor="ten" className="block text-sm font-semibold">
            Tên tổ chức
          </label>
          <input
            id="ten"
            required
            maxLength={120}
            value={ten}
            onChange={(su) => datTen(su.target.value)}
            placeholder="Công ty của bạn"
            className="mt-1 min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3"
          />
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Tên này hiện trên biên nhận thanh toán; đổi lại được ở màn Cài đặt.
          </p>
        </div>

        {tao.isError && <LoiHop error={tao.error} />}

        <Button type="submit" block disabled={tao.isPending || !ten.trim()}>
          {tao.isPending ? 'Đang tạo…' : 'Tạo và lấy khoá'}
        </Button>
      </form>
    </div>
  );
}
