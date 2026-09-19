import { voiSql } from '../console/db';
import type { getSql } from '../db';
import { mauBaoAdminThieuTien, mauBienNhan, mauThieuTien, moTaDon } from '../email/mau-don-hang';
import type { EmailPort } from '../email/port';
import type { Env } from '../env';
import { moTaLoi } from '../errors';
import { chuTenant, noiDungChuyenKhoan } from './db';
import type { KetQuaApDung } from './fulfil';
import { guiThuGiaoDich } from './thu';

type Sql = ReturnType<typeof getSql>;
type Ctx = { waitUntil(promise: Promise<unknown>): void };

export interface ThongBaoDeps {
  sql?: (env: Env) => Sql;
  emailPort?: (env: Env) => EmailPort;
}

/** Người nhận thư của một tenant: chủ sở hữu, cộng địa chỉ nhận biên nhận nếu khác. */
export const nguoiNhan = (chu: { email: string; billingEmail: string | null }): string[] =>
  chu.billingEmail && chu.billingEmail !== chu.email ? [chu.email, chu.billingEmail] : [chu.email];

/**
 * Gửi thư tương ứng với kết quả `apDungThanhToan`. Chạy trong waitUntil với client Postgres
 * RIÊNG: client của request đã bị `endSql` đóng ở `finally` trước khi tới đây.
 *
 * - fulfilled lần đầu (không phải `daCoTuTruoc`) → biên nhận cho khách.
 * - underpaid và sự kiện là MỚI → thư thiếu tiền cho khách và cho admin. Webhook gửi lại không
 *   làm khách nhận thư lần hai.
 * - paid_unfulfilled → không gửi gì; biên nhận sẽ đi khi cron cấp được.
 */
export function thongBaoSauApDung(
  env: Env,
  ctx: Ctx,
  kq: KetQuaApDung,
  tuyChon: { origin: string; suKienMoi: boolean },
  deps: ThongBaoDeps = {},
): void {
  const guiBienNhan =
    kq.trangThai === 'fulfilled' && kq.cap.status === 'fulfilled' && !kq.cap.daCoTuTruoc;
  const guiThieu = kq.trangThai === 'underpaid' && tuyChon.suKienMoi;
  if (!guiBienNhan && !guiThieu) return;

  const viec = async (sql: Sql) => {
    const chu = await chuTenant(sql, kq.don.tenant_id);
    if (!chu) return;
    const port = deps.emailPort?.(env);
    const guiDeps = port ? { port } : {};

    if (guiBienNhan) {
      const bienLai = (kq.don.entitlement_receipt ?? {}) as Record<string, unknown>;
      await guiThuGiaoDich(
        env,
        sql,
        {
          to: nguoiNhan(chu),
          mau: mauBienNhan({
            orderCode: kq.don.order_code,
            moTa: moTaDon(kq.don),
            amountVnd: kq.don.paid_amount_vnd ?? kq.don.amount_vnd,
            tenTenant: chu.tenantName,
            hieuLucTu: typeof bienLai.startsAt === 'string' ? bienLai.startsAt : null,
            hetHan: typeof bienLai.endsAt === 'string' ? bienLai.endsAt : null,
            consoleUrl: tuyChon.origin ? `${tuyChon.origin}/console/don-hang/${kq.don.id}` : null,
          }),
          loai: 'bien-nhan',
        },
        guiDeps,
      );
    }

    if (guiThieu) {
      await guiThuGiaoDich(
        env,
        sql,
        {
          to: nguoiNhan(chu),
          mau: mauThieuTien({
            orderCode: kq.don.order_code,
            amountVnd: kq.don.amount_vnd,
            daNhan: kq.don.paid_amount_vnd ?? 0,
            noiDungChuyenKhoan: noiDungChuyenKhoan(kq.don.order_code),
            supportEmail: env.SUPPORT_EMAIL ?? '',
          }),
          loai: 'thieu-tien',
        },
        guiDeps,
      );
      if (env.SUPPORT_EMAIL) {
        await guiThuGiaoDich(
          env,
          sql,
          {
            to: [env.SUPPORT_EMAIL],
            mau: mauBaoAdminThieuTien({
              orderCode: kq.don.order_code,
              tenTenant: chu.tenantName,
              amountVnd: kq.don.amount_vnd,
              daNhan: kq.don.paid_amount_vnd ?? 0,
              adminUrl: `${tuyChon.origin}/admin/orders?id=${kq.don.id}`,
            }),
            loai: 'thieu-tien-admin',
          },
          guiDeps,
        );
      }
    }
  };

  const chay = deps.sql ? viec(deps.sql(env)) : voiSql(env, ctx, viec);
  ctx.waitUntil(
    chay.catch((error: unknown) =>
      console.error(`[commerce] thư sau khi áp dụng thanh toán lỗi: ${moTaLoi(error)}`, error),
    ),
  );
}
