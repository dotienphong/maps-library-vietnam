// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeech } from './speech';

class FakeUtterance {
  text: string;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeSynth(voices: { lang: string; name: string }[]) {
  const listeners: Record<string, (() => void)[]> = {};
  const synth = {
    speaking: false,
    pending: false,
    getVoices: vi.fn(() => voices as SpeechSynthesisVoice[]),
    speak: vi.fn(),
    cancel: vi.fn(),
    addEventListener: vi.fn((ev: string, fn: () => void) => {
      (listeners[ev] ??= []).push(fn);
    }),
  } as unknown as SpeechSynthesis;
  return { synth, fire: (ev: string) => listeners[ev]?.forEach((fn) => fn()) };
}

beforeEach(() => vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance));
afterEach(() => vi.unstubAllGlobals());

describe('createSpeech', () => {
  it('chọn voice vi-*, đặt lang vi-VN, rate/volume; câu ưu tiên cao cắt câu đang đọc', () => {
    const { synth } = fakeSynth([
      { lang: 'en-US', name: 'Samantha' },
      { lang: 'vi-VN', name: 'Linh' },
    ]);
    const s = createSpeech({ lang: 'vi', rate: 1.1, volume: 0.8, synth });
    expect(s.available).toBe(true);
    s.speak('Tiếp tục đi thêm 300 mét.', 1);
    const first = (synth.speak as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as FakeUtterance;
    expect(first.lang).toBe('vi-VN');
    expect(first.voice?.name).toBe('Linh');
    expect(first.rate).toBe(1.1);
    expect(first.volume).toBe(0.8);
    expect(synth.cancel).not.toHaveBeenCalled();

    (synth as { speaking: boolean }).speaking = true;
    s.speak('Rẽ phải vào Nguyễn Du.', 3);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(2);

    // Câu ưu tiên thấp hơn không cắt câu ưu tiên 3 đang đọc — xếp hàng.
    s.speak('Tiếp tục đi thêm 200 mét.', 1);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(3);
  });

  it('voice chưa có lúc đầu → chờ voiceschanged; không có voice vi → onUnavailable một lần, speak im', () => {
    const { synth, fire } = fakeSynth([]);
    const onUnavailable = vi.fn();
    const s = createSpeech({ lang: 'vi', synth, onUnavailable });
    expect(s.available).toBe(true); // chưa biết → coi là có
    expect(onUnavailable).not.toHaveBeenCalled();
    (synth.getVoices as ReturnType<typeof vi.fn>).mockReturnValue([
      { lang: 'en-GB', name: 'Daniel' },
    ] as SpeechSynthesisVoice[]);
    fire('voiceschanged');
    expect(s.available).toBe(false);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    s.speak('Rẽ trái.', 3);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('không có speechSynthesis → onUnavailable ngay, mọi hàm vô hại', () => {
    const onUnavailable = vi.fn();
    const s = createSpeech({ lang: 'en', synth: undefined, onUnavailable });
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(s.available).toBe(false);
    expect(() => {
      s.speak('Turn left.', 3);
      s.warmUp();
      s.cancel();
    }).not.toThrow();
  });

  it('warmUp đọc câu rỗng âm lượng 0 (mở khoá iOS); cancel gọi synth.cancel', () => {
    const { synth } = fakeSynth([{ lang: 'vi_VN', name: 'Google Tiếng Việt' }]);
    const s = createSpeech({ lang: 'vi', synth });
    s.warmUp();
    const u = (synth.speak as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as FakeUtterance;
    expect(u.text).toBe('');
    expect(u.volume).toBe(0);
    s.cancel();
    expect(synth.cancel).toHaveBeenCalled();
    expect(s.available).toBe(true); // vi_VN (gạch dưới) vẫn nhận
  });
});
