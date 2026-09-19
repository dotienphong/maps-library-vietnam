import { Button, LoadingSkeleton, useDelayedAction } from '@mapslibvn/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { dangXuat, dangXuatMoiThietBi } from '@/features/auth/api';
import { khoaCache, useCauHinh, useTenant, useToi } from '@/features/auth/hooks';
import type { TenantDayDu } from '@/lib/api';
import { patchJson } from '@/lib/fetcher';
import { LoiHop } from '@/lib/loi-hop';

export function CaiDat() {
  const { data: toi } = useToi();
  const { data: cauHinh } = useCauHinh();
  const { data: tenant, isPending: dangTaiTenant } = useTenant(Boolean(toi?.onboarded));
  const queryClient = useQueryClient();
  const { schedule } = useDelayedAction();
  const [form, datForm] = useState({
    name: '',
    billingName: '',
    billingTaxCode: '',
    billingAddress: '',
    billingEmail: '',
  });
  const [daLuu, datDaLuu] = useState(false);

  // Nạp CẢ NĂM trường, không riêng tên. Bản cũ chỉ nạp `name`, nên bốn ô biên nhận luôn hiện
  // rỗng sau khi tải lại trang — trông như "bấm Lưu mà không lưu" — và tệ hơn: lần lưu kế tiếp
  // gửi bốn ô rỗng đó lên và GHI NULL ĐÈ lên dữ liệu đã nhập, vì `PATCH /v1/console/tenant` đặt
  // lại cả năm cột chứ không vá từng cột. Sự cố 19/09/2026.
  useEffect(() => {
    if (!tenant) return;
    datForm({
      name: tenant.name ?? '',
      billingName: tenant.billing_name ?? '',
      billingTaxCode: tenant.billing_tax_code ?? '',
      billingAddress: tenant.billing_address ?? '',
      billingEmail: tenant.billing_email ?? '',
    });
  }, [tenant]);

  const luu = useMutation({
    mutationFn: () =>
      patchJson<{ tenant: TenantDayDu }>('/v1/console/tenant', {
        name: form.name.trim(),
        billingName: form.billingName.trim() || null,
        billingTaxCode: form.billingTaxCode.trim() || null,
        billingAddress: form.billingAddress.trim() || null,
        billingEmail: form.billingEmail.trim() || null,
      }),
    onSuccess: async (ketQua) => {
      datDaLuu(true);
      // Ghi thẳng kết quả vào cache rồi mới làm mới: giá trị máy chủ đã chuẩn hoá (cắt khoảng
      // trắng, chuỗi rỗng thành null) là thứ biểu mẫu phải hiện, không phải thứ vừa gõ.
      queryClient.setQueryData(khoaCache.tenant, ketQua.tenant);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: khoaCache.toi }),
        queryClient.invalidateQueries({ queryKey: khoaCache.tenant }),
      ]);
    },
  });

  const thoat = useMutation({
    mutationFn: dangXuat,
    onSuccess: () => {
      // Tải lại hẳn thay vì điều hướng: cách chắc chắn nhất để không còn dữ liệu của phiên cũ
      // nằm trong bộ nhớ trang.
      location.href = '/console/dang-nhap';
    },
  });

  const thoatMoiNoi = useMutation({ mutationFn: dangXuatMoiThietBi });

  if (!toi) return <LoadingSkeleton rows={3} />;

  const o = (
    id: keyof typeof form,
    nhan: string,
    them: { type?: string; maxLength?: number; goiY?: string } = {},
  ) => (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold">
        {nhan}
      </label>
      <input
        id={id}
        type={them.type ?? 'text'}
        maxLength={them.maxLength ?? 250}
        value={form[id]}
        onChange={(su) => {
          datDaLuu(false);
          datForm((cu) => ({ ...cu, [id]: su.target.value }));
        }}
        className="mt-1 min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3"
      />
      {them.goiY && <p className="mt-1 text-sm text-[var(--text-muted)]">{them.goiY}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Cài đặt</h1>

      <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-bold">Tài khoản</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--text-muted)]">Email đăng nhập</dt>
            <dd className="font-semibold">{toi.email}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--text-muted)]">Đăng nhập bằng Google</dt>
            <dd className="font-semibold">{cauHinh?.googleEnabled ? 'Có thể dùng' : 'Chưa bật'}</dd>
          </div>
        </dl>
      </section>

      {toi.onboarded && dangTaiTenant && <LoadingSkeleton rows={5} />}

      {toi.onboarded && !dangTaiTenant && (
        <form
          className="space-y-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5"
          onSubmit={(su) => {
            su.preventDefault();
            luu.mutate();
          }}
        >
          <h2 className="text-base font-bold">Tổ chức và thông tin biên nhận</h2>
          {o('name', 'Tên tổ chức', { maxLength: 120 })}
          {o('billingName', 'Tên trên biên nhận', {
            goiY: 'Để trống thì dùng tên tổ chức ở trên.',
          })}
          {o('billingTaxCode', 'Mã số thuế', { maxLength: 20 })}
          {o('billingAddress', 'Địa chỉ', { maxLength: 500 })}
          {o('billingEmail', 'Email nhận biên nhận', {
            type: 'email',
            goiY: 'Để trống thì gửi về email đăng nhập.',
          })}

          {luu.isError && <LoiHop error={luu.error} />}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={luu.isPending || !form.name.trim()}>
              {luu.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
            </Button>
            {daLuu && (
              <span role="status" className="text-sm text-green-700 dark:text-green-300">
                Đã lưu
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            Hệ thống phát hành biên nhận thanh toán, chưa có hoá đơn điện tử VAT.
          </p>
        </form>
      )}

      <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-bold">Phiên đăng nhập</h2>
        {thoatMoiNoi.isError && <LoiHop error={thoatMoiNoi.error} />}
        {thoatMoiNoi.isSuccess && (
          <p role="status" className="text-sm text-green-700 dark:text-green-300">
            Đã đăng xuất {thoatMoiNoi.data.daXoa} thiết bị khác.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => thoat.mutate()} disabled={thoat.isPending}>
            Đăng xuất
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              schedule({
                label: 'Đăng xuất mọi thiết bị khác',
                run: async () => {
                  await thoatMoiNoi.mutateAsync();
                },
              })
            }
          >
            Đăng xuất mọi thiết bị khác
          </Button>
        </div>
        <p className="text-sm text-[var(--text-muted)]">
          Thiết bị bạn đang dùng vẫn giữ nguyên phiên.
        </p>
      </section>
    </div>
  );
}
