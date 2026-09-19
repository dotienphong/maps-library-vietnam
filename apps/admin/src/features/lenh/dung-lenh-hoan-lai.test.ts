import { afterEach, describe, expect, it, vi } from 'vitest';
import { dungLenhHoanLai } from './dung-lenh-hoan-lai';

afterEach(() => vi.restoreAllMocks());

describe('dungLenhHoanLai', () => {
  it('operationId sinh lúc bấm (lúc gọi hàm trả về), không sinh lại lúc lệnh thật sự chạy', async () => {
    const idLucBam = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
    const idNeuSinhLai = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb';
    const sinhUUID = vi
      .spyOn(crypto, 'randomUUID')
      // biome-ignore lint/suspicious/noExplicitAny: khớp kiểu template-literal của crypto.randomUUID
      .mockReturnValueOnce(idLucBam as any)
      // biome-ignore lint/suspicious/noExplicitAny: khớp kiểu template-literal của crypto.randomUUID
      .mockReturnValue(idNeuSinhLai as any);

    let lenhDaXep: { label: string; run: () => Promise<void> } | undefined;
    const schedule = vi.fn((input: { label: string; run: () => Promise<void> }) => {
      lenhDaXep = input;
    });
    const onClose = vi.fn();
    const run = vi.fn(async (_operationId: string) => {});

    const guiLenh = dungLenhHoanLai({ schedule, onClose, label: 'Thu hồi khoá' });
    guiLenh(run);

    // operationId đã sinh NGAY lúc bấm — trước khi lệnh xếp lịch thật sự chạy.
    expect(sinhUUID).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Thu hồi khoá', run: expect.any(Function) }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();

    // Mô phỏng năm giây sau: lệnh thật sự chạy qua `run` mà `schedule` giữ lại.
    await lenhDaXep?.run();

    // Vẫn đúng operationId sinh lúc bấm, KHÔNG phải operationId nếu sinh lại lúc chạy — và
    // crypto.randomUUID không bị gọi thêm lần nào.
    expect(run).toHaveBeenCalledExactlyOnceWith(idLucBam.replace(/-/g, ''));
    expect(sinhUUID).toHaveBeenCalledTimes(1);
  });

  it('gọi lại hàm trả về nhiều lần sinh operationId khác nhau cho mỗi lần bấm', () => {
    const schedule = vi.fn();
    const onClose = vi.fn();
    const run = vi.fn(async () => {});

    const guiLenh = dungLenhHoanLai({ schedule, onClose, label: 'Nhãn' });
    guiLenh(run);
    guiLenh(run);

    const [lanMot, lanHai] = schedule.mock.calls.map(([input]) => input.label);
    expect(lanMot).toBe('Nhãn');
    expect(lanHai).toBe('Nhãn');
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
