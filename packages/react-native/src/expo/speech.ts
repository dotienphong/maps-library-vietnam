import type { DirectionsLang } from '@mapslibvn/core';
import type { Speaker } from '../navigation/session';
import { Speech } from './modules';

export interface ExpoSpeechOptions {
  /** 1 = tốc độ thường của hệ. */
  rate?: number;
  /** 0–1. */
  volume?: number;
  pitch?: number;
}

const BCP47: Readonly<Record<DirectionsLang, string>> = { vi: 'vi-VN', en: 'en-US' };

/**
 * `Speaker` trên expo-speech. Android xếp hàng (`QUEUE_ADD`) và iOS cũng xếp hàng, nên muốn cắt câu
 * phải `stop()` trước rồi mới `speak`. Theo dõi câu đang đọc bằng số thứ tự để callback của câu cũ
 * đến muộn không xoá nhầm ưu tiên câu mới.
 */
export function expoSpeech(opts: ExpoSpeechOptions = {}): Speaker {
  let rate = opts.rate;
  let volume = opts.volume;
  const pitch = opts.pitch;
  let current = 0; // ưu tiên câu đang đọc, 0 = im
  let seq = 0;

  const say = (text: string, priority: 1 | 2 | 3, lang: DirectionsLang): void => {
    seq += 1;
    const id = seq;
    current = Math.max(current, priority); // câu xếp hàng không hạ ưu tiên câu đang đọc
    const done = (): void => {
      if (seq === id) current = 0;
    };
    Speech.speak(text, {
      language: BCP47[lang],
      ...(rate !== undefined ? { rate } : {}),
      ...(volume !== undefined ? { volume } : {}),
      ...(pitch !== undefined ? { pitch } : {}),
      onDone: done,
      onStopped: done,
      onError: done,
    });
  };

  return {
    speak(text, priority, lang) {
      if (!text) return;
      if (current > 0 && priority >= current) {
        seq += 1; // vô hiệu callback của câu bị cắt
        void Speech.stop()
          .catch(() => {
            /* vẫn đọc */
          })
          .then(() => say(text, priority, lang));
        return;
      }
      say(text, priority, lang);
    },
    cancel() {
      seq += 1;
      current = 0;
      void Speech.stop().catch(() => {
        /* không có gì để dừng */
      });
    },
    async available(lang) {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        if (voices.length === 0) return true; // Android chưa khởi tạo TTS — không báo sai
        return voices.some((v) => v.language.toLowerCase().replace('_', '-').startsWith(lang));
      } catch {
        return true;
      }
    },
    setOptions(o) {
      if (o.rate !== undefined) rate = o.rate;
      if (o.volume !== undefined) volume = o.volume;
    },
  };
}
