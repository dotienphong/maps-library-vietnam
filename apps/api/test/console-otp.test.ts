import { describe, expect, it, vi } from 'vitest';
import {
  chuanHoaEmail,
  HAN_PHUT,
  hetHanLuc,
  laEmailHopLe,
  maConDung,
  SO_LAN_THU_TOI_DA,
  sinhMa,
} from '../src/console/otp';
import { kiemTurnstile } from '../src/console/turnstile';

describe('sinhMa', () => {
  it('đúng sáu chữ số, giữ cả số 0 đứng đầu', () => {
    for (let i = 0; i < 200; i += 1) expect(sinhMa()).toMatch(/^\d{6}$/);
  });

  it('không lặp lại ngay — 200 lần sinh cho ra nhiều hơn 150 giá trị khác nhau', () => {
    const tap = new Set(Array.from({ length: 200 }, () => sinhMa()));
    expect(tap.size).toBeGreaterThan(150);
  });
});

describe('email', () => {
  it('chuẩn hoá về chữ thường và cắt khoảng trắng', () => {
    expect(chuanHoaEmail('  Khach@ViDu.VN ')).toBe('khach@vidu.vn');
  });

  it('nhận dạng hợp lệ tối thiểu, từ chối rác', () => {
    expect(laEmailHopLe('a@b.vn')).toBe(true);
    expect(laEmailHopLe('khach.hang+thu@vi-du.com.vn')).toBe(true);
    expect(laEmailHopLe('khong-co-a-cong')).toBe(false);
    expect(laEmailHopLe('a@b')).toBe(false);
    expect(laEmailHopLe('co khoang trang@vidu.vn')).toBe(false);
    expect(laEmailHopLe(`${'a'.repeat(250)}@b.vn`)).toBe(false);
  });
});

describe('vòng đời mã', () => {
  it('hết hạn sau 10 phút', () => {
    expect(HAN_PHUT).toBe(10);
    const moc = new Date('2026-09-18T00:00:00Z');
    expect(hetHanLuc(moc).toISOString()).toBe('2026-09-18T00:10:00.000Z');
  });

  it('cho tối đa năm lần thử một mã', () => {
    expect(SO_LAN_THU_TOI_DA).toBe(5);
  });

  it('mã còn dùng được khi chưa hết hạn, chưa dùng, chưa quá số lần thử', () => {
    const now = new Date('2026-09-18T00:05:00Z');
    const con = { expires_at: new Date('2026-09-18T00:10:00Z'), consumed_at: null, attempts: 0 };
    expect(maConDung(con, now)).toBe(true);
    expect(maConDung({ ...con, expires_at: new Date('2026-09-18T00:04:00Z') }, now)).toBe(false);
    expect(maConDung({ ...con, consumed_at: new Date() }, now)).toBe(false);
    expect(maConDung({ ...con, attempts: SO_LAN_THU_TOI_DA }, now)).toBe(false);
    // Lần thử thứ năm vẫn được phép; chết từ lần thứ sáu.
    expect(maConDung({ ...con, attempts: SO_LAN_THU_TOI_DA - 1 }, now)).toBe(true);
  });
});

describe('kiemTurnstile', () => {
  it('vắng secret ngoài production thì cho qua và ghi log cảnh báo', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await kiemTurnstile({ ENVIRONMENT: 'dev' }, 'bat-ky')).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('vắng secret ở production thì TỪ CHỐI — không mở toang chống bot vì quên cấu hình', async () => {
    expect(await kiemTurnstile({ ENVIRONMENT: 'production' }, 'bat-ky')).toBe(false);
  });

  it('có secret thì gọi siteverify và theo đúng kết quả', async () => {
    const env = { ENVIRONMENT: 'production', TURNSTILE_SECRET: 'bi-mat' };
    const dung = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
    expect(await kiemTurnstile(env, 'token', dung as unknown as typeof fetch)).toBe(true);
    const sai = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false })));
    expect(await kiemTurnstile(env, 'token', sai as unknown as typeof fetch)).toBe(false);
  });

  it('token rỗng thì trượt ngay, không tốn một lời gọi mạng', async () => {
    const goi = vi.fn();
    expect(
      await kiemTurnstile(
        { ENVIRONMENT: 'production', TURNSTILE_SECRET: 'x' },
        '',
        goi as unknown as typeof fetch,
      ),
    ).toBe(false);
    expect(goi).not.toHaveBeenCalled();
  });

  it('siteverify chết thì coi như KHÔNG qua', async () => {
    const hong = vi.fn().mockRejectedValue(new Error('mạng chết'));
    expect(
      await kiemTurnstile(
        { ENVIRONMENT: 'production', TURNSTILE_SECRET: 'x' },
        'token',
        hong as unknown as typeof fetch,
      ),
    ).toBe(false);
  });
});
