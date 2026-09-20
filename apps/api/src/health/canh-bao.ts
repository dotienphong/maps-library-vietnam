import { mauCanhBaoSucKhoe } from '../email/mau-canh-bao';
import { chonEmailPort, type EmailPort } from '../email/port';
import type { Env } from '../env';
import { moTaLoi } from '../errors';
import {
  doPhepDo,
  type KetQua,
  TEN_THANH_PHAN,
  type TenThanhPhan,
  THANH_PHAN,
  type WaitUntil,
} from './phep-do';

/**
 * Cron 5 phút đo ba thành phần và gửi thư khi trạng thái ĐỔI (spec 2026-09-20-canh-bao-suc-khoe
 * mục 5). Không phải "gửi khi hỏng": một sự cố kéo dài cả đêm là một thư hỏng và một thư phục hồi,
 * không phải 96 thư.
 *
 * Đường gửi thư KHÔNG chạm Postgres — Postgres có thể chính là thứ đang chết. Vì vậy trần thư/ngày
 * đếm trong KV, và gửi bằng `chonEmailPort` thẳng chứ không qua `guiThuGiaoDich`.
 */

export const KHOA_KV = 'health:canh-bao';
/** Resend miễn phí 100 thư/ngày cho cả tài khoản; 10 là đủ cho một hệ nhấp nháy tệ. */
export const TRAN_THU_NGAY = 10;
/** Nhịp ghi KV khi không có gì đổi — Workers Free chỉ cho 1.000 ghi/ngày, cron chạy 288 lượt. */
export const NHIP_GHI_MS = 30 * 60_000;
/** Phép đo hỏng được đo lại sau khoảng này; hỏng cả hai lần mới tính. */
export const CHO_DO_LAI_MS = 15_000;

export interface TrangThaiThanhPhan {
  ok: boolean;
  /** Thời điểm chuyển sang trạng thái hiện tại — để thư phục hồi nói "hỏng N phút". */
  tuLuc: string;
  loi?: string;
}

export interface TrangThaiCanhBao {
  v: 1;
  /** Lần cron đo gần nhất (có thể mới hơn `ghiLuc` tới 30 phút vì ghi có chọn lọc). */
  kiemLuc: string;
  ghiLuc: string;
  thanhPhan: Record<TenThanhPhan, TrangThaiThanhPhan>;
  /** Đếm theo ngày UTC, cùng cách Resend tính. */
  guiTrongNgay: { ngay: string; so: number };
}

export interface CanhBaoDeps {
  phepDo?: (ten: TenThanhPhan, env: Env, ctx: WaitUntil) => Promise<KetQua<object>>;
  emailPort?: (env: Env) => EmailPort;
  cho?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export type TrangThaiLuot =
  | 'thieu-cau-hinh'
  | 'lan-dau'
  | 'khong-doi'
  | 'da-gui'
  | 'gui-loi'
  | 'qua-tran'
  | 'loi';

export interface BaoCaoCanhBao {
  ten: 'canhBaoSucKhoe';
  ok: boolean;
  trangThai: TrangThaiLuot;
  hong: TenThanhPhan[];
  phucHoi: TenThanhPhan[];
  daGhiKv: boolean;
  loi?: string;
}

const ngayUtc = (d: Date): string => d.toISOString().slice(0, 10);

const laTrangThai = (x: unknown): x is TrangThaiCanhBao => {
  if (!x || typeof x !== 'object') return false;
  const t = x as Partial<TrangThaiCanhBao>;
  return (
    t.v === 1 &&
    typeof t.kiemLuc === 'string' &&
    typeof t.ghiLuc === 'string' &&
    !!t.thanhPhan &&
    THANH_PHAN.every((k) => typeof t.thanhPhan?.[k]?.ok === 'boolean') &&
    typeof t.guiTrongNgay?.so === 'number'
  );
};

/** Đọc KHÔNG `cacheTtl`: trạng thái này đổi mỗi 5 phút và đọc cũ là cảnh báo đúp hoặc lỡ. */
export async function docTrangThai(kv: KVNamespace): Promise<TrangThaiCanhBao | null> {
  const raw = await kv.get(KHOA_KV, 'json');
  return laTrangThai(raw) ? raw : null;
}

/** Phần trang Sức khoẻ cần biết về cron: còn chạy không, và hôm nay đã gửi mấy thư. */
export function tomTatWatcher(
  tt: TrangThaiCanhBao | null,
  now: Date = new Date(),
): { kiem_luc: string; gui_trong_ngay: number } | null {
  if (!tt) return null;
  return {
    kiem_luc: tt.kiemLuc,
    gui_trong_ngay: tt.guiTrongNgay.ngay === ngayUtc(now) ? tt.guiTrongNgay.so : 0,
  };
}

const baoCao = (trangThai: TrangThaiLuot, them: Partial<BaoCaoCanhBao> = {}): BaoCaoCanhBao => ({
  ten: 'canhBaoSucKhoe',
  ok: trangThai !== 'gui-loi' && trangThai !== 'loi',
  trangThai,
  hong: [],
  phucHoi: [],
  daGhiKv: false,
  ...them,
});

export async function theoDoiSucKhoe(
  env: Env,
  ctx: WaitUntil,
  deps: CanhBaoDeps = {},
): Promise<BaoCaoCanhBao> {
  const den = env.ALERT_EMAIL?.trim();
  if (!den) return baoCao('thieu-cau-hinh');

  const now = deps.now ?? (() => new Date());
  const phepDo = deps.phepDo ?? doPhepDo;
  const cho = deps.cho ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  try {
    const doNhieu = async (ds: readonly TenThanhPhan[]) => {
      const kq = await Promise.all(ds.map((t) => phepDo(t, env, ctx)));
      return Object.fromEntries(ds.map((t, i) => [t, kq[i]])) as Record<
        TenThanhPhan,
        KetQua<object>
      >;
    };

    // Đo lần một; phép nào hỏng thì chờ rồi đo lại ĐÚNG phép đó. Một `/route` quá hạn vì máy chủ
    // đang bận build graph không phải sự cố, và một thư lúc 3 giờ sáng vì việc đó là cách nhanh
    // nhất để người trực tắt cảnh báo.
    let ketQua = await doNhieu(THANH_PHAN);
    const hongLan1 = THANH_PHAN.filter((t) => !ketQua[t].ok);
    if (hongLan1.length > 0) {
      await cho(CHO_DO_LAI_MS);
      ketQua = { ...ketQua, ...(await doNhieu(hongLan1)) };
    }

    const luc = now();
    const iso = luc.toISOString();
    const cu = await docTrangThai(env.META);

    const thanhPhan = {} as Record<TenThanhPhan, TrangThaiThanhPhan>;
    const hong: TenThanhPhan[] = [];
    const phucHoi: TenThanhPhan[] = [];
    for (const t of THANH_PHAN) {
      const kq = ketQua[t];
      const truoc = cu?.thanhPhan[t];
      if (truoc && truoc.ok === kq.ok) {
        thanhPhan[t] = truoc;
        continue;
      }
      thanhPhan[t] = { ok: kq.ok, tuLuc: iso, ...(kq.ok ? {} : { loi: kq.error }) };
      if (truoc) (kq.ok ? phucHoi : hong).push(t);
    }

    const ngay = ngayUtc(luc);
    const guiTrongNgay = cu?.guiTrongNgay.ngay === ngay ? { ...cu.guiTrongNgay } : { ngay, so: 0 };
    const coThayDoi = hong.length + phucHoi.length > 0;
    let trangThai: TrangThaiLuot = cu ? (coThayDoi ? 'da-gui' : 'khong-doi') : 'lan-dau';
    let loi: string | undefined;

    if (cu && coThayDoi) {
      if (guiTrongNgay.so >= TRAN_THU_NGAY) {
        trangThai = 'qua-tran';
        console.warn(
          `[health] không gửi cảnh báo (${hong.join(',')}|${phucHoi.join(',')}): đã ${guiTrongNgay.so} thư hôm nay`,
        );
      } else {
        const origin = (env.CONSOLE_ORIGIN ?? '').replace(/\/+$/, '');
        const thu = mauCanhBaoSucKhoe({
          hong: hong.map((t) => ({
            ten: TEN_THANH_PHAN[t],
            loi: thanhPhan[t].loi ?? 'Lỗi không xác định',
          })),
          phucHoi: phucHoi.map((t) => ({
            ten: TEN_THANH_PHAN[t],
            hongPhut: Math.max(
              1,
              Math.round((luc.getTime() - Date.parse(cu.thanhPhan[t].tuLuc)) / 60_000),
            ),
          })),
          luc: iso,
          adminUrl: origin ? `${origin}/admin/health` : null,
        });
        const port = (deps.emailPort ?? chonEmailPort)(env);
        try {
          await port.send({ to: den, subject: thu.subject, html: thu.html, text: thu.text });
          guiTrongNgay.so += 1;
        } catch (error) {
          // Giữ trạng thái CŨ cho thành phần vừa chuyển: lượt sau thấy lại cùng chuyển trạng thái
          // và thử gửi lại. In cả message — Observability chỉ giữ stack.
          trangThai = 'gui-loi';
          loi = moTaLoi(error);
          console.error(`[health] gửi cảnh báo lỗi: ${loi}`, error);
          for (const t of [...hong, ...phucHoi]) thanhPhan[t] = cu.thanhPhan[t];
        }
      }
    }

    const canGhi = !cu || coThayDoi || luc.getTime() - Date.parse(cu.ghiLuc) >= NHIP_GHI_MS;
    if (canGhi) {
      const moi: TrangThaiCanhBao = { v: 1, kiemLuc: iso, ghiLuc: iso, thanhPhan, guiTrongNgay };
      await env.META.put(KHOA_KV, JSON.stringify(moi));
    }

    return baoCao(trangThai, { hong, phucHoi, daGhiKv: canGhi, ...(loi ? { loi } : {}) });
  } catch (error) {
    const moTa = moTaLoi(error);
    console.error(`[health] cron cảnh báo lỗi: ${moTa}`, error);
    return baoCao('loi', { loi: moTa });
  }
}
