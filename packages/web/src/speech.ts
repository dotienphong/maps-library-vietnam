import type { DirectionsLang } from '@mapslibvn/core';

export interface SpeechOptions {
  lang: DirectionsLang;
  rate?: number;
  volume?: number;
  /** Tiêm cho test; mặc định `speechSynthesis` toàn cục. */
  synth?: SpeechSynthesis | undefined;
  /** Gọi đúng một lần khi xác định không đọc được (không có API hoặc không có voice khớp). */
  onUnavailable?: () => void;
}

export interface Speech {
  /** Cắt câu đang đọc nếu `priority` ≥ ưu tiên câu đó; thấp hơn thì xếp hàng. */
  speak(text: string, priority: 1 | 2 | 3): void;
  /** Đọc câu rỗng trong user gesture để iOS mở khoá âm thanh. */
  warmUp(): void;
  cancel(): void;
  /** false khi không có API hoặc đã biết danh sách voice mà không có voice khớp. */
  readonly available: boolean;
}

const BCP47: Readonly<Record<DirectionsLang, string>> = { vi: 'vi-VN', en: 'en-US' };

export function createSpeech(opts: SpeechOptions): Speech {
  const synth =
    'synth' in opts
      ? opts.synth
      : typeof speechSynthesis !== 'undefined'
        ? speechSynthesis
        : undefined;
  const prefix = opts.lang;
  let voice: SpeechSynthesisVoice | null = null;
  let voicesKnown = false;
  let reported = false;
  let current = 0;

  const reportUnavailable = (): void => {
    if (reported) return;
    reported = true;
    opts.onUnavailable?.();
  };
  const pickVoice = (): void => {
    if (!synth) return;
    const voices = synth.getVoices();
    if (voices.length === 0) return;
    voicesKnown = true;
    voice = voices.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(prefix)) ?? null;
    if (!voice) reportUnavailable();
  };

  if (!synth) reportUnavailable();
  else {
    pickVoice();
    if (!voicesKnown && typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', pickVoice, { once: true });
    }
  }

  const utterance = (text: string): SpeechSynthesisUtterance => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP47[opts.lang];
    if (voice) u.voice = voice;
    u.rate = opts.rate ?? 1;
    u.volume = opts.volume ?? 1;
    return u;
  };

  return {
    get available() {
      return Boolean(synth) && (!voicesKnown || voice !== null);
    },
    speak(text, priority) {
      if (!synth || !text) return;
      if (voicesKnown && !voice) return;
      if ((synth.speaking || synth.pending) && priority >= current) synth.cancel();
      const u = utterance(text);
      current = priority;
      u.onend = () => {
        current = 0;
      };
      u.onerror = () => {
        current = 0;
      };
      synth.speak(u);
    },
    warmUp() {
      if (!synth) return;
      const u = utterance('');
      u.volume = 0;
      synth.speak(u);
    },
    cancel() {
      synth?.cancel();
      current = 0;
    },
  };
}
