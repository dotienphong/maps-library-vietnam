import { beforeEach, describe, expect, it, vi } from 'vitest';

type SpeakOptions = {
  language?: string;
  rate?: number;
  volume?: number;
  pitch?: number;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (e: Error) => void;
};
const mocks = vi.hoisted(() => ({
  Speech: {
    speak: vi.fn<(text: string, options?: SpeakOptions) => void>(),
    stop: vi.fn(async () => {}),
    getAvailableVoicesAsync: vi.fn(async () => [] as { language: string }[]),
  },
}));
vi.mock('./modules', () => ({
  Speech: mocks.Speech,
  Location: {},
  TaskManager: {},
  Audio: {},
  KeepAwake: {},
}));

import { expoSpeech } from './speech';

const lastOptions = (): SpeakOptions => mocks.Speech.speak.mock.calls.at(-1)?.[1] ?? {};
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.clearAllMocks());

describe('expoSpeech', () => {
  it('đọc với vi-VN; ưu tiên thấp hơn câu đang đọc thì xếp hàng (không stop); bằng/cao hơn thì stop() rồi đọc', async () => {
    const s = expoSpeech({ rate: 1.1 });
    s.speak('Rẽ phải', 3, 'vi');
    expect(mocks.Speech.speak).toHaveBeenCalledTimes(1);
    expect(lastOptions()).toMatchObject({ language: 'vi-VN', rate: 1.1 });
    s.speak('Tiếp tục 200 mét', 1, 'vi');
    expect(mocks.Speech.stop).not.toHaveBeenCalled();
    expect(mocks.Speech.speak).toHaveBeenCalledTimes(2);
    s.speak('Điểm đến ở bên trái', 3, 'en');
    expect(mocks.Speech.stop).toHaveBeenCalledTimes(1);
    await flush();
    expect(mocks.Speech.speak).toHaveBeenCalledTimes(3);
    expect(lastOptions().language).toBe('en-US');
  });

  it('onStopped của câu cũ (đến muộn) không xoá ưu tiên câu mới; onDone câu mới thì xoá', async () => {
    const s = expoSpeech();
    s.speak('A', 3, 'vi');
    const first = lastOptions();
    s.speak('B', 3, 'vi');
    await flush();
    first.onStopped?.(); // callback của A về sau khi B đã bắt đầu
    s.speak('C', 3, 'vi'); // B vẫn đang đọc → phải stop
    expect(mocks.Speech.stop).toHaveBeenCalledTimes(2);
    await flush();
    lastOptions().onDone?.();
    s.speak('D', 1, 'vi'); // không còn câu nào → đọc thẳng
    expect(mocks.Speech.stop).toHaveBeenCalledTimes(2);
  });

  it('cancel → stop(); text rỗng bỏ qua; setOptions đổi rate/volume', () => {
    const s = expoSpeech();
    s.speak('', 3, 'vi');
    expect(mocks.Speech.speak).not.toHaveBeenCalled();
    s.setOptions?.({ rate: 0.9, volume: 0.5 });
    s.speak('A', 2, 'vi');
    expect(lastOptions()).toMatchObject({ rate: 0.9, volume: 0.5 });
    s.cancel();
    expect(mocks.Speech.stop).toHaveBeenCalledTimes(1);
    s.speak('B', 1, 'vi'); // sau cancel không còn ưu tiên → không stop thêm
    expect(mocks.Speech.stop).toHaveBeenCalledTimes(1);
  });

  it('available: danh sách rỗng → true; có voice khớp → true; không khớp → false; lỗi → true', async () => {
    const s = expoSpeech();
    expect(await s.available('vi')).toBe(true);
    mocks.Speech.getAvailableVoicesAsync.mockResolvedValue([
      { language: 'vi_VN' },
      { language: 'en-US' },
    ]);
    expect(await s.available('vi')).toBe(true);
    mocks.Speech.getAvailableVoicesAsync.mockResolvedValue([{ language: 'en-US' }]);
    expect(await s.available('vi')).toBe(false);
    mocks.Speech.getAvailableVoicesAsync.mockRejectedValue(new Error('x'));
    expect(await s.available('vi')).toBe(true);
  });
});
