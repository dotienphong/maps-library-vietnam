import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { EmailPort, ThuGui } from '../src/email/port';
import type { Env } from '../src/env';
import {
  CHO_DO_LAI_MS,
  KHOA_KV,
  NHIP_GHI_MS,
  TRAN_THU_NGAY,
  type TrangThaiCanhBao,
  theoDoiSucKhoe,
} from '../src/health/canh-bao';
import type { KetQua, TenThanhPhan } from '../src/health/phep-do';

const NOW = new Date('2026-09-20T03:05:00Z');
const ISO = NOW.toISOString();
const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };

const OK: KetQua<object> = { ok: true, ms: 10 };
const HONG = (error: string): KetQua<object> => ({ ok: false, ms: 6001, error });

/**
 * Phép đo giả theo kịch bản: `kichBan[ten]` là danh sách kết quả trả lần lượt cho mỗi lần gọi
 * thành phần đó; hết danh sách thì trả phần tử cuối. Nhờ vậy kiểm được "lần 1 hỏng, đo lại tốt".
 */
function phepDoGia(kichBan: Partial<Record<TenThanhPhan, KetQua<object>[]>>) {
  const soLan: Record<string, number> = {};
  return vi.fn((ten: TenThanhPhan) => {
    const ds = kichBan[ten] ?? [OK];
    const i = Math.min(soLan[ten] ?? 0, ds.length - 1);
    soLan[ten] = (soLan[ten] ?? 0) + 1;
    return Promise.resolve(ds[i] as KetQua<object>);
  });
}

function emailGia(loi?: Error) {
  const daGui: ThuGui[] = [];
  const port: EmailPort = {
    ten: 'debug',
    send(thu) {
      if (loi) return Promise.reject(loi);
      daGui.push(thu);
      return Promise.resolve({ id: `t${daGui.length}` });
    },
  };
  return { port, daGui };
}

/** Bọc KV thật để đếm số lần `put`. */
function kvDem() {
  let soPut = 0;
  const kv = {
    get: (k: string, o?: unknown) => env.META.get(k, o as never),
    put: (k: string, v: string) => {
      soPut += 1;
      return env.META.put(k, v);
    },
  } as unknown as KVNamespace;
  return { kv, soPut: () => soPut };
}

const moiTruong = (kv: KVNamespace, them: Partial<Env> = {}): Env =>
  ({
    ...env,
    META: kv,
    ALERT_EMAIL: 'phong@vidu.vn',
    CONSOLE_ORIGIN: 'https://api.test',
    ...them,
  }) as Env;

const docKv = () => env.META.get<TrangThaiCanhBao>(KHOA_KV, 'json');

const ghiKv = (tt: Partial<TrangThaiCanhBao>) =>
  env.META.put(
    KHOA_KV,
    JSON.stringify({
      v: 1,
      kiemLuc: '2026-09-20T03:00:00.000Z',
      ghiLuc: '2026-09-20T03:00:00.000Z',
      thanhPhan: {
        db: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
        routing: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
        data: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
      },
      guiTrongNgay: { ngay: '2026-09-20', so: 0 },
      ...tt,
    } satisfies TrangThaiCanhBao),
  );

function chay(
  kv: KVNamespace,
  tuyChon: {
    kichBan?: Partial<Record<TenThanhPhan, KetQua<object>[]>>;
    email?: ReturnType<typeof emailGia>;
    now?: Date;
    envThem?: Partial<Env>;
  } = {},
) {
  const cho = vi.fn(() => Promise.resolve());
  const phepDo = phepDoGia(tuyChon.kichBan ?? {});
  const email = tuyChon.email ?? emailGia();
  const baoCao = theoDoiSucKhoe(moiTruong(kv, tuyChon.envThem), ctx, {
    phepDo,
    emailPort: () => email.port,
    cho,
    now: () => tuyChon.now ?? NOW,
  });
  return { baoCao, cho, phepDo, email };
}

describe('theoDoiSucKhoe', () => {
  it('thiếu ALERT_EMAIL → không đo, báo cáo thieu-cau-hinh', async () => {
    const { kv } = kvDem();
    const { baoCao, phepDo } = chay(kv, { envThem: { ALERT_EMAIL: '' } });
    expect((await baoCao).trangThai).toBe('thieu-cau-hinh');
    expect(phepDo).not.toHaveBeenCalled();
  });

  it('lần đầu: ghi trạng thái, không gửi thư', async () => {
    const { kv, soPut } = kvDem();
    const { baoCao, email } = chay(kv);
    const bc = await baoCao;
    expect(bc.trangThai).toBe('lan-dau');
    expect(email.daGui).toHaveLength(0);
    expect(soPut()).toBe(1);
    const tt = await docKv();
    expect(tt?.thanhPhan.routing).toEqual({ ok: true, tuLuc: ISO });
    expect(tt?.kiemLuc).toBe(ISO);
  });

  it('ok → hỏng: một thư có tên thành phần và lỗi; trạng thái ok=false', async () => {
    await ghiKv({});
    const { kv } = kvDem();
    const { baoCao, email } = chay(kv, {
      kichBan: { routing: [HONG('Dịch vụ chỉ đường không phản hồi')] },
    });
    const bc = await baoCao;
    expect(bc.trangThai).toBe('da-gui');
    expect(bc.hong).toEqual(['routing']);
    expect(email.daGui).toHaveLength(1);
    expect(email.daGui[0]?.to).toBe('phong@vidu.vn');
    expect(email.daGui[0]?.subject).toBe('[MapsLibVN] HỎNG: Định tuyến');
    expect(email.daGui[0]?.text).toContain('Dịch vụ chỉ đường không phản hồi');
    expect(email.daGui[0]?.text).toContain('https://api.test/admin/health');
    const tt = await docKv();
    expect(tt?.thanhPhan.routing).toEqual({
      ok: false,
      tuLuc: ISO,
      loi: 'Dịch vụ chỉ đường không phản hồi',
    });
    expect(tt?.guiTrongNgay).toEqual({ ngay: '2026-09-20', so: 1 });
  });

  it('hỏng → hỏng: không gửi, giữ tuLuc cũ', async () => {
    await ghiKv({
      thanhPhan: {
        db: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
        routing: { ok: false, tuLuc: '2026-09-20T02:00:00.000Z', loi: 'x' },
        data: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
      },
    });
    const { kv } = kvDem();
    const { baoCao, email } = chay(kv, { kichBan: { routing: [HONG('x')] } });
    expect((await baoCao).trangThai).toBe('khong-doi');
    expect(email.daGui).toHaveLength(0);
    expect((await docKv())?.thanhPhan.routing.tuLuc).toBe('2026-09-20T02:00:00.000Z');
  });

  it('hỏng → ok: thư phục hồi nói hỏng bao nhiêu phút', async () => {
    await ghiKv({
      thanhPhan: {
        db: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
        routing: { ok: false, tuLuc: '2026-09-20T02:42:00.000Z', loi: 'x' },
        data: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },
      },
    });
    const { kv } = kvDem();
    const { baoCao, email } = chay(kv);
    const bc = await baoCao;
    expect(bc.phucHoi).toEqual(['routing']);
    expect(email.daGui[0]?.subject).toBe('[MapsLibVN] PHỤC HỒI: Định tuyến (hỏng 23 phút)');
    expect((await docKv())?.thanhPhan.routing).toEqual({ ok: true, tuLuc: ISO });
  });

  it('hai thành phần chết cùng lượt → đúng một thư, cả hai tên trong tiêu đề', async () => {
    await ghiKv({});
    const { kv } = kvDem();
    const { baoCao, email } = chay(kv, {
      kichBan: {
        db: [HONG('Không nối được DB')],
        routing: [HONG('Dịch vụ chỉ đường không phản hồi')],
      },
    });
    expect((await baoCao).hong).toEqual(['db', 'routing']);
    expect(email.daGui).toHaveLength(1);
    expect(email.daGui[0]?.subject).toBe('[MapsLibVN] HỎNG: Cơ sở dữ liệu, Định tuyến');
  });

  it('nhấp nháy: lần 1 hỏng, đo lại tốt → không gửi, không đổi trạng thái, chờ đúng một lần', async () => {
    await ghiKv({});
    const { kv, soPut } = kvDem();
    const { baoCao, email, cho, phepDo } = chay(kv, {
      kichBan: { routing: [HONG('quá hạn'), OK] },
    });
    expect((await baoCao).trangThai).toBe('khong-doi');
    expect(email.daGui).toHaveLength(0);
    expect(cho).toHaveBeenCalledTimes(1);
    expect(cho).toHaveBeenCalledWith(CHO_DO_LAI_MS);
    // 3 phép đo lần một + đúng 1 phép đo lại (routing), không đo lại db/data đang tốt.
    expect(phepDo).toHaveBeenCalledTimes(4);
    expect((await docKv())?.thanhPhan.routing.ok).toBe(true);
    // Không chuyển trạng thái và ghiLuc mới 5 phút → không tốn một lượt ghi KV.
    expect(soPut()).toBe(0);
  });

  it('không đo lại khi cả ba đều tốt', async () => {
    await ghiKv({});
    const { kv } = kvDem();
    const { baoCao, cho, phepDo } = chay(kv);
    await baoCao;
    expect(cho).not.toHaveBeenCalled();
    expect(phepDo).toHaveBeenCalledTimes(3);
  });

  it('gửi thư lỗi: thành phần vừa chuyển giữ trạng thái CŨ để lượt sau thử lại', async () => {
    await ghiKv({});
    const { kv } = kvDem();
    const email = emailGia(new Error('email_send_failed_500'));
    const { baoCao } = chay(kv, { kichBan: { routing: [HONG('x')] }, email });
    const bc = await baoCao;
    expect(bc.trangThai).toBe('gui-loi');
    expect(bc.ok).toBe(false);
    expect(bc.loi).toContain('email_send_failed_500');
    const tt = await docKv();
    expect(tt?.thanhPhan.routing.ok).toBe(true);
    expect(tt?.guiTrongNgay.so).toBe(0);
    // Nhịp vẫn cập nhật: cron có chạy, chỉ thư là không đi.
    expect(tt?.kiemLuc).toBe(ISO);
  });

  it('trần thư/ngày: vượt trần thì lưu trạng thái mới nhưng không gửi; sang ngày UTC mới đếm lại', async () => {
    await ghiKv({ guiTrongNgay: { ngay: '2026-09-20', so: TRAN_THU_NGAY } });
    const { kv } = kvDem();
    const a = chay(kv, { kichBan: { routing: [HONG('x')] } });
    expect((await a.baoCao).trangThai).toBe('qua-tran');
    expect(a.email.daGui).toHaveLength(0);
    expect((await docKv())?.thanhPhan.routing.ok).toBe(false);

    // Ngày hôm sau: routing phục hồi → đếm lại từ 0 và gửi được.
    const b = chay(kv, { now: new Date('2026-09-21T00:10:00Z') });
    expect((await b.baoCao).trangThai).toBe('da-gui');
    expect((await docKv())?.guiTrongNgay).toEqual({ ngay: '2026-09-21', so: 1 });
  });

  it('nhịp tim: không đổi trạng thái nhưng ghiLuc cũ hơn 30 phút → có ghi KV', async () => {
    await ghiKv({ ghiLuc: new Date(NOW.getTime() - NHIP_GHI_MS - 1).toISOString() });
    const { kv, soPut } = kvDem();
    await chay(kv).baoCao;
    expect(soPut()).toBe(1);
    expect((await docKv())?.ghiLuc).toBe(ISO);
  });

  it('KV có rác (không phải trạng thái hợp lệ) → coi như lần đầu, không ném', async () => {
    await env.META.put(KHOA_KV, '{"v":99}');
    const { kv } = kvDem();
    const { baoCao, email } = chay(kv, { kichBan: { db: [HONG('x')] } });
    expect((await baoCao).trangThai).toBe('lan-dau');
    expect(email.daGui).toHaveLength(0);
  });
});
