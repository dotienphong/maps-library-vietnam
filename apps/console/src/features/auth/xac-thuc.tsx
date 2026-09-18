import { Button } from '@mapslibvn/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { LoiHop } from '@/lib/loi-hop';
import { xacThucMa, xinMa } from './api';
import { khoaCache } from './hooks';
import { OMa } from './o-ma';

/** Máy chủ cho một mã mỗi phút; nút gửi lại khoá đúng bằng con số đó thay vì để khách nhận 429. */
const CHO_GUI_LAI_GIAY = 60;

export function XacThuc() {
  const [tham] = useSearchParams();
  const email = tham.get('email') ?? '';
  const next = tham.get('next');
  const dieuHuong = useNavigate();
  const queryClient = useQueryClient();
  const [conLai, datConLai] = useState(CHO_GUI_LAI_GIAY);

  useEffect(() => {
    if (conLai <= 0) return;
    const dongHo = setTimeout(() => datConLai((n) => n - 1), 1000);
    return () => clearTimeout(dongHo);
  }, [conLai]);

  const xacThuc = useMutation({
    mutationFn: (ma: string) => xacThucMa(email, ma),
    onSuccess: async (ketQua) => {
      // Dọn cache trước khi điều hướng: thông tin "tôi là ai" của phiên trước không được phép
      // sống sót sang phiên mới.
      await queryClient.invalidateQueries({ queryKey: khoaCache.toi });
      void dieuHuong(ketQua.onboarded ? (next ?? '/') : '/bat-dau');
    },
  });

  const guiLai = useMutation({
    mutationFn: () => xinMa(email, ''),
    onSuccess: () => datConLai(CHO_GUI_LAI_GIAY),
  });

  if (!email) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <p className="text-[var(--text-muted)]">Thiếu địa chỉ email.</p>
        <Button className="mt-4" onClick={() => void dieuHuong('/dang-nhap')}>
          Quay lại đăng nhập
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold">Nhập mã</h1>
      <p className="mt-2 text-[var(--text-muted)]">
        Chúng tôi đã gửi một mã sáu số tới <strong>{email}</strong>. Mã có hiệu lực trong 10 phút.
      </p>

      <div className="mt-8">
        <OMa onXong={(ma) => xacThuc.mutate(ma)} disabled={xacThuc.isPending} />
      </div>

      {xacThuc.isError && (
        <div className="mt-5">
          <LoiHop error={xacThuc.error} />
        </div>
      )}
      {guiLai.isError && (
        <div className="mt-5">
          <LoiHop error={guiLai.error} />
        </div>
      )}

      <div className="mt-8 text-center">
        <Button
          variant="secondary"
          disabled={conLai > 0 || guiLai.isPending}
          onClick={() => guiLai.mutate()}
        >
          {conLai > 0 ? `Gửi lại mã sau ${conLai} giây` : 'Gửi lại mã'}
        </Button>
        <p className="mt-4">
          <Button variant="ghost" onClick={() => void dieuHuong('/dang-nhap')}>
            Đổi địa chỉ email
          </Button>
        </p>
      </div>
    </div>
  );
}
