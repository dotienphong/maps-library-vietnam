import { writeAudit } from '../audit';
import { quotaObject } from '../billing/object';
import type { PeriodHistory, UsageSnapshot } from '../billing/types';
import { endSql, getSql } from '../db';
import { type LoaiNhac, mauNhacHan } from '../email/mau-don-hang';
import type { EmailPort } from '../email/port';
import type { Env } from '../env';
import { moTaLoi } from '../errors';
import {
  coSuKienHopLe,
  daNhacRoi,
  datHetHan,
  donCanCapLai,
  donDepPhienVaMa,
  donPendingCanDoiSoat,
  donPendingQuaHan,
  ghiSuKienThanhToan,
  tenantThuongMaiCoChu,
} from './db';
import {
  ACTOR_HE_THONG,
  apDungThanhToan,
  type CongSo,
  type FulfilDeps,
  TRAN_THU_CAP,
} from './fulfil';
import { maLoi } from './ky-han';
import { chonPayosPort, type PayosPort } from './payos';
import { thongBaoSauApDung } from './thong-bao';
import { guiThuGiaoDich } from './thu';

type Sql = ReturnType<typeof getSql>;
type Ctx = { waitUntil(promise: Promise<unknown>): void };

export const CRON_MOI_5_PHUT = '*/5 * * * *';
/** 02:00 UTC = 09:00 giờ Việt Nam. */
export const CRON_HANG_NGAY = '0 2 * * *';
const ACTOR_CRON = 'system:cron';
const TEN_GOI: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
};

export interface CronDeps extends FulfilDeps {
  sql?: (env: Env) => Sql;
  payos?: (env: Env) => PayosPort;
  emailPort?: (env: Env) => EmailPort;
}

export interface BaoCaoViec {
  ten: string;
  ok: boolean;
  soLuong: number;
  loi?: string;
}

/**
 * Mỗi việc bọc try/catch RIÊNG (spec 9.4): DB ngủ lúc việc thứ nhất chạy thì việc thứ hai vẫn
 * chạy, và không việc nào ném ra ngoài làm hỏng lượt cron sau. Báo cáo trả về để log và để test
 * khẳng định từng việc.
 */
async function viec(ten: string, fn: () => Promise<number>): Promise<BaoCaoViec> {
  try {
    return { ten, ok: true, soLuong: await fn() };
  } catch (error) {
    console.error(`[cron] ${ten} lỗi: ${moTaLoi(error)}`, error);
    return { ten, ok: false, soLuong: 0, loi: maLoi(error) };
  }
}

export async function chayCron(
  env: Env,
  ctx: Ctx,
  cron: string,
  deps: CronDeps = {},
): Promise<BaoCaoViec[]> {
  const sql = (deps.sql ?? getSql)(env);
  const now = deps.now ?? (() => new Date());
  const so = (tenantId: string): CongSo => (deps.so ?? quotaObject)(env, tenantId);
  const origin = (env.CONSOLE_ORIGIN ?? '').replace(/\/+$/, '');
  const thongBao = (kq: Parameters<typeof thongBaoSauApDung>[2], suKienMoi: boolean) =>
    thongBaoSauApDung(
      env,
      ctx,
      kq,
      { origin, suKienMoi },
      { sql: deps.sql ?? getSql, ...(deps.emailPort ? { emailPort: deps.emailPort } : {}) },
    );

  try {
    if (cron === CRON_HANG_NGAY) {
      return [await viec('nhacHan', () => nhacHan(sql, env, so, now(), origin, deps))];
    }
    return [
      await viec('capLaiDonTreo', async () => {
        let n = 0;
        for (const don of await donCanCapLai(sql, TRAN_THU_CAP)) {
          const kq = await apDungThanhToan(sql, env, don.id, { ...deps, now });
          if (kq.trangThai === 'fulfilled') n += 1;
          thongBao(kq, false);
        }
        return n;
      }),
      await viec('doiSoatPending', async () => {
        const payos = (deps.payos ?? chonPayosPort)(env);
        let n = 0;
        for (const don of await donPendingCanDoiSoat(sql, now())) {
          const tt = await payos.docLink(don.order_code);
          if (!tt) continue;
          if (tt.status === 'PAID') {
            if (!(await coSuKienHopLe(sql, don.id))) {
              // Webhook rơi: dựng sự kiện từ chính dữ liệu PayOS trả về qua GET. Không có
              // transactions thì lấy paymentLinkId làm khoá — vẫn duy nhất cho mỗi đơn.
              const giaoDich =
                tt.transactions.length > 0
                  ? tt.transactions
                  : [
                      {
                        reference: `payos-get:${tt.paymentLinkId}`,
                        amount: tt.amountPaid,
                        transactionDateTime: '',
                      },
                    ];
              for (const gd of giaoDich) {
                await ghiSuKienThanhToan(sql, {
                  orderId: don.id,
                  provider: 'payos',
                  reference: gd.reference,
                  orderCode: don.order_code,
                  amountVnd: gd.amount > 0 ? gd.amount : null,
                  signatureValid: true,
                  payload: { nguon: 'cron-doi-soat', ...gd, status: tt.status },
                });
              }
            }
            const kq = await apDungThanhToan(sql, env, don.id, { ...deps, now });
            thongBao(kq, true);
            n += 1;
          } else if (tt.status === 'CANCELLED' || tt.status === 'EXPIRED') {
            if (await datHetHan(sql, don.id)) {
              await writeAudit(sql, {
                actor: ACTOR_CRON,
                action: 'order.expired',
                target: don.id,
                detail: { order_code: don.order_code, payos_status: tt.status },
              });
              n += 1;
            }
          }
        }
        return n;
      }),
      await viec('hetHanDon', async () => {
        let n = 0;
        for (const don of await donPendingQuaHan(sql, now())) {
          if (await datHetHan(sql, don.id)) {
            await writeAudit(sql, {
              actor: ACTOR_CRON,
              action: 'order.expired',
              target: don.id,
              detail: { order_code: don.order_code, ly_do: 'qua_han_link' },
            });
            n += 1;
          }
        }
        return n;
      }),
      await viec('donDep', async () => {
        const { ma, phien } = await donDepPhienVaMa(sql, now());
        return ma + phien;
      }),
    ];
  } finally {
    endSql(ctx, sql);
  }
}

/**
 * Loại thư nhắc cho một tenant hôm nay, hoặc null. Mỗi mốc chỉ trúng đúng một ngày vì cron chạy
 * một lần mỗi ngày; bản dùng thử và tenant đã có kỳ kế tiếp thì không nhắc.
 */
export function phanLoaiNhac(
  usage: UsageSnapshot,
  history: Pick<PeriodHistory, 'periods'>,
  now: Date,
): { loai: LoaiNhac; periodId: string } | null {
  if (!usage.endsAt || !usage.periodId || usage.tier === 'trial' || usage.tier === null) return null;
  const end = Date.parse(usage.endsAt);
  if (!Number.isFinite(end)) return null;
  const coKyKeTiep = history.periods.some(
    (p) => p.tier !== 'trial' && Date.parse(p.startsAt) >= end,
  );
  if (coKyKeTiep) return null;

  const NGAY = 86_400_000;
  if (usage.status === 'active') {
    const conNgay = Math.ceil((end - now.getTime()) / NGAY);
    if (conNgay === 7) return { loai: '7d', periodId: usage.periodId };
    if (conNgay === 1) return { loai: '1d', periodId: usage.periodId };
    return null;
  }
  if (usage.status === 'expired' && now.getTime() >= end && now.getTime() - end < NGAY) {
    return { loai: 'het', periodId: usage.periodId };
  }
  return null;
}

async function nhacHan(
  sql: Sql,
  env: Env,
  so: (tenantId: string) => CongSo,
  now: Date,
  origin: string,
  deps: CronDeps,
): Promise<number> {
  let n = 0;
  for (const t of await tenantThuongMaiCoChu(sql)) {
    let usage: UsageSnapshot;
    let history: PeriodHistory;
    try {
      usage = await so(t.id).readUsage();
      history = await so(t.id).readPeriods(12);
    } catch (error) {
      // Một sổ không trả lời không được làm hỏng thư của những tenant còn lại.
      console.error(`[cron] nhắc hạn: đọc sổ ${t.id} lỗi: ${moTaLoi(error)}`);
      continue;
    }
    const nhac = phanLoaiNhac(usage, history, now);
    if (!nhac) continue;
    const target = `${t.id}:${nhac.periodId}:${nhac.loai}`;
    if (await daNhacRoi(sql, target)) continue;

    const da = await guiThuGiaoDich(
      env,
      sql,
      {
        to: [t.email],
        mau: mauNhacHan({
          tenTenant: t.name,
          tenGoi: TEN_GOI[usage.tier ?? ''] ?? String(usage.tier),
          hetHan: usage.endsAt as string,
          loai: nhac.loai,
          consoleUrl: origin ? `${origin}/console/mua` : null,
        }),
        loai: 'nhac-han',
        hangLoat: true,
      },
      deps.emailPort ? { port: deps.emailPort(env) } : {},
    );
    // Hết ngân sách thì dừng lượt này; mai gửi tiếp — KHÔNG ghi dấu, để mai còn nhắc được.
    if (!da) break;
    await writeAudit(sql, {
      actor: ACTOR_HE_THONG,
      action: 'email.reminder',
      target,
      detail: { tenant_id: t.id, loai: nhac.loai },
    });
    n += 1;
  }
  return n;
}
