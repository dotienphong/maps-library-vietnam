import { addMonths } from '@mapslibvn/catalog';
import { writeAudit } from '../audit';
import { quotaObject } from '../billing/object';
import type {
  CommandReceipt,
  EntitlementCommand,
  PeriodHistory,
  UsageSnapshot,
} from '../billing/types';
import type { getSql } from '../db';
import type { Env } from '../env';
import {
  type DonHang,
  datCapHong,
  datDaCap,
  datDaTra,
  datThieuTien,
  docDon,
  tongTienDaNhan,
} from './db';
import { daCapChoDon, maLoi, tinhStartsAt } from './ky-han';

type Sql = ReturnType<typeof getSql>;

/** Mặt của sổ quota mà nhóm này dùng; khai hẹp để test tiêm bản giả không cần Durable Object. */
export interface CongSo {
  applyCommand(command: EntitlementCommand): Promise<CommandReceipt>;
  readUsage(): Promise<UsageSnapshot>;
  readPeriods(limit: number): Promise<PeriodHistory>;
}

export interface FulfilDeps {
  so?: (env: Env, tenantId: string) => CongSo;
  now?: () => Date;
}

export const ACTOR_HE_THONG = 'system:payos';
/** Qua ngưỡng này cron thôi tự thử; admin xử lý bằng tay (spec 9.4). */
export const TRAN_THU_CAP = 20;
const SO_LAN_THU_REVISION = 3;

export type KetQuaCap =
  | { status: 'fulfilled'; receipt: CommandReceipt | null; daCoTuTruoc: boolean }
  | { status: 'paid_unfulfilled'; error: string }
  | { status: 'khong_ap_dung'; lyDo: string };

const congSo = (deps: FulfilDeps, env: Env, tenantId: string): CongSo =>
  (deps.so ?? quotaObject)(env, tenantId);

/** Dựng lệnh cho sổ, hoặc lý do không dựng được. Thuần — mọi số liệu đã đọc xong ở ngoài. */
function dungLenh(
  don: DonHang,
  usage: UsageSnapshot,
  history: PeriodHistory,
  thamChieu: string,
  now: Date,
): EntitlementCommand | { loi: string } {
  const chung = {
    operationId: `order:${don.id}`,
    tenantId: don.tenant_id,
    actor: ACTOR_HE_THONG,
    reason: `Đơn ${don.order_code}`,
    expectedRevision: usage.revision,
    paymentReference: thamChieu,
    lineItemId: don.id,
  };
  if (don.kind === 'plan') {
    if (!don.tier || !don.months) return { loi: 'invalid_order' };
    const startsAt = tinhStartsAt(history, now);
    return {
      ...chung,
      kind: 'grantPeriod',
      periodId: don.id,
      tier: don.tier,
      startsAt: startsAt.toISOString(),
      endsAt: addMonths(startsAt, don.months).toISOString(),
    };
  }
  if (!don.quota_group || !don.packs) return { loi: 'invalid_order' };
  // periodId lấy LÚC CẤP chứ không phải lúc tạo đơn: kỳ có thể đã đổi trong lúc khách chuyển khoản.
  if (usage.status !== 'active' || usage.tier === 'trial' || !usage.periodId) {
    return { loi: 'credits_require_paid_active' };
  }
  return {
    ...chung,
    kind: 'addCredits',
    periodId: usage.periodId,
    group: don.quota_group,
    packs: don.packs,
  };
}

/**
 * Cấp gói cho một đơn đã có tiền. Dùng chung cho webhook, cron và nút "Thử cấp lại" của admin —
 * spec 9.3. KHÔNG ném vì lỗi sổ: mọi nhánh hỏng đều thành `paid_unfulfilled` có mã, để webhook
 * vẫn trả 200 và cron biết mà thử lại. Chỉ lỗi Postgres mới bay ra ngoài.
 */
export async function fulfilOrder(
  sql: Sql,
  env: Env,
  orderId: string,
  deps: FulfilDeps = {},
): Promise<KetQuaCap> {
  const don = await docDon(sql, orderId);
  if (!don) return { status: 'khong_ap_dung', lyDo: 'order_not_found' };
  if (don.status === 'fulfilled') {
    return {
      status: 'fulfilled',
      receipt: (don.entitlement_receipt as CommandReceipt | null) ?? null,
      daCoTuTruoc: true,
    };
  }
  if (don.status !== 'paid' && don.status !== 'paid_unfulfilled') {
    return { status: 'khong_ap_dung', lyDo: `order_${don.status}` };
  }
  const { thamChieu } = await tongTienDaNhan(sql, don.id);
  // Không có mã tham chiếu nghĩa là chưa có đồng nào ghi nhận được; cấp gói bằng một khoá bịa ra
  // sẽ phá luôn tính idempotent của sổ.
  if (!thamChieu) return { status: 'khong_ap_dung', lyDo: 'no_payment_reference' };

  const so = congSo(deps, env, don.tenant_id);
  const now = (deps.now ?? (() => new Date()))();
  let loiCuoi = 'unknown';

  for (let lan = 0; lan < SO_LAN_THU_REVISION; lan += 1) {
    let usage: UsageSnapshot;
    let history: PeriodHistory;
    try {
      usage = await so.readUsage();
      history = await so.readPeriods(60);
    } catch (error) {
      loiCuoi = maLoi(error);
      break;
    }

    // Sổ đã có kỳ hoặc credit mang lineItemId của đơn: lần trước đã ghi (cuộc đua với cron, hoặc
    // operation_conflict ở vòng trước). Chỉ ghi nhận, tuyệt đối không cấp lần hai.
    if (daCapChoDon(history, don.id)) {
      await datDaCap(sql, don.id, { daCoTuTruoc: true });
      await writeAudit(sql, {
        actor: ACTOR_HE_THONG,
        action: 'order.fulfilled',
        target: don.id,
        detail: { order_code: don.order_code, tenant_id: don.tenant_id, da_co_tu_truoc: true },
      });
      return { status: 'fulfilled', receipt: null, daCoTuTruoc: true };
    }

    const lenh = dungLenh(don, usage, history, thamChieu, now);
    if ('loi' in lenh) {
      loiCuoi = lenh.loi;
      break;
    }

    try {
      const receipt = await so.applyCommand(lenh);
      // `fulfilled` chỉ SAU biên lai. Ghi kèm startsAt/endsAt của lệnh để thư biên nhận in được
      // hiệu lực — CommandReceipt của sổ không mang hai mốc đó.
      await datDaCap(sql, don.id, {
        ...receipt,
        ...(lenh.kind === 'grantPeriod' ? { startsAt: lenh.startsAt, endsAt: lenh.endsAt } : {}),
      });
      await writeAudit(sql, {
        actor: ACTOR_HE_THONG,
        action: 'order.fulfilled',
        target: don.id,
        detail: {
          order_code: don.order_code,
          tenant_id: don.tenant_id,
          kind: don.kind,
          revision: receipt.revision,
        },
      });
      return { status: 'fulfilled', receipt, daCoTuTruoc: false };
    } catch (error) {
      loiCuoi = maLoi(error);
      // Ba mã này đều nói "sổ đã đổi từ lúc đọc": đọc lại rồi thử lại, và vòng sau `daCapChoDon`
      // sẽ thấy nếu chính ta là người đã ghi.
      if (
        loiCuoi === 'revision_conflict' ||
        loiCuoi === 'operation_conflict' ||
        loiCuoi === 'business_identity_conflict'
      ) {
        continue;
      }
      break;
    }
  }

  await datCapHong(sql, don.id, loiCuoi);
  await writeAudit(sql, {
    actor: ACTOR_HE_THONG,
    action: 'order.fulfil_failed',
    target: don.id,
    detail: {
      order_code: don.order_code,
      tenant_id: don.tenant_id,
      error: loiCuoi,
      attempts: don.fulfil_attempts + 1,
    },
  });
  console.error(`[commerce] cấp gói đơn ${don.order_code} lỗi: ${loiCuoi}`);
  return { status: 'paid_unfulfilled', error: loiCuoi };
}

export type KetQuaApDung =
  | { trangThai: 'fulfilled' | 'paid_unfulfilled'; don: DonHang; cap: KetQuaCap }
  | { trangThai: 'underpaid'; don: DonHang; thieu: number }
  | { trangThai: 'khong_doi'; don: DonHang };

/**
 * Từ các sự kiện tiền vào tới trạng thái đơn. Idempotent và không cần transaction: mỗi bước là
 * một UPDATE mang điều kiện trạng thái cũ, chạy lại bao nhiêu lần cũng ra cùng kết quả. Webhook,
 * cron đối soát và lệnh xác nhận tay của admin đều đi qua ĐÚNG hàm này.
 *
 * Tiền so theo TỔNG các sự kiện hợp lệ chứ không theo một webhook: PayOS hỗ trợ trả từng phần,
 * và khách chuyển thiếu rồi chuyển bù là chuyện thường.
 */
export async function apDungThanhToan(
  sql: Sql,
  env: Env,
  orderId: string,
  deps: FulfilDeps = {},
): Promise<KetQuaApDung> {
  const don = await docDon(sql, orderId);
  if (!don) throw new Error('order_not_found');
  if (don.status === 'fulfilled' || don.status === 'refunded') {
    return { trangThai: 'khong_doi', don };
  }

  const { tong, luc } = await tongTienDaNhan(sql, don.id);
  if (tong <= 0) return { trangThai: 'khong_doi', don };

  if (tong < don.amount_vnd) {
    const doi = await datThieuTien(sql, don.id, tong);
    // Chỉ ghi audit khi đơn VỪA chuyển sang underpaid; gọi lại với cùng số tiền thì im lặng.
    if (doi && don.status !== 'underpaid') {
      await writeAudit(sql, {
        actor: ACTOR_HE_THONG,
        action: 'order.underpaid',
        target: don.id,
        detail: {
          order_code: don.order_code,
          tenant_id: don.tenant_id,
          da_nhan: tong,
          gia: don.amount_vnd,
        },
      });
    }
    return {
      trangThai: 'underpaid',
      don: { ...don, status: 'underpaid', paid_amount_vnd: tong },
      thieu: don.amount_vnd - tong,
    };
  }

  if (don.status !== 'paid' && don.status !== 'paid_unfulfilled') {
    const doi = await datDaTra(sql, don.id, tong, luc ?? (deps.now ?? (() => new Date()))());
    if (doi) {
      await writeAudit(sql, {
        actor: ACTOR_HE_THONG,
        action: 'order.paid',
        target: don.id,
        detail: { order_code: don.order_code, tenant_id: don.tenant_id, da_nhan: tong },
      });
    }
  }

  const cap = await fulfilOrder(sql, env, don.id, deps);
  const donSau = (await docDon(sql, don.id)) ?? don;
  return {
    trangThai: cap.status === 'fulfilled' ? 'fulfilled' : 'paid_unfulfilled',
    don: donSau,
    cap,
  };
}
