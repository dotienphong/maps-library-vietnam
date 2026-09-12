import type { AudioSession, KeepAwake } from '../navigation/session';
import { Audio, KeepAwake as ExpoKeepAwake } from './modules';
import { SILENT_AUDIO_DATA_URI } from './silence-audio';

/**
 * Phiên âm thanh để giọng đọc phát khi khoá máy và làm nhỏ nhạc đang phát (spec C 6.3).
 *
 * Hai bước đều bắt buộc, xác nhận bằng thực địa trên iPhone thật 12/09/2026 (giọng đọc im lặng
 * hoàn toàn ngay khi khoá màn hình cho tới khi vá cả hai):
 *
 * 1. `setAudioModeAsync` chỉ đặt category AVAudioSession; nó KHÔNG gọi `AVAudioSession.setActive`
 *    (xác nhận trong mã nguồn expo-audio: `AudioModule.swift` hàm `setAudioMode` chỉ
 *    `session.setCategory`, `setActive` nằm ở hàm riêng `setIsAudioActive`) → phải gọi thêm
 *    `setIsAudioActiveAsync(true)`.
 * 2. Chỉ kích hoạt phiên KHÔNG đủ: giữa hai câu chỉ dẫn (vài chục giây không có âm thanh nào thật
 *    sự phát ra), iOS coi app không còn dùng "audio" background mode một cách chính đáng và thu hồi
 *    quyền chạy nền — `AVSpeechSynthesizer.speak()` gọi sau đó không phát ra tiếng. Phải phát một
 *    vòng lặp âm thanh (im lặng tuyệt đối, toàn mẫu 0) liên tục trong suốt lúc dẫn đường để giữ phiên
 *    "đang phát" thật sự — đây là kỹ thuật chuẩn của app điều hướng/audiobook, đã ghi làm phương án
 *    dự phòng (a) trong spec C mục 11 rủi ro 1.
 */
export function expoAudioSession(): AudioSession {
  let player: {
    loop: boolean;
    volume: number;
    play(): void;
    pause(): void;
    remove(): void;
  } | null = null;

  return {
    async activate() {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'duckOthers',
        });
      } catch {
        /* thiếu expo-audio native → vẫn thử kích hoạt bên dưới */
      }
      try {
        await Audio.setIsAudioActiveAsync(true);
      } catch {
        /* vẫn thử phát vòng lặp bên dưới */
      }
      try {
        if (!player) {
          player = Audio.createAudioPlayer(SILENT_AUDIO_DATA_URI, { keepAudioSessionActive: true });
          player.loop = true;
        }
        player.play();
      } catch {
        /* vẫn dẫn đường, chỉ mất bảo hiểm giữ phiên khi nền */
      }
    },
    async deactivate() {
      try {
        player?.pause();
        player?.remove();
      } catch {
        /* bỏ qua */
      }
      player = null;
      try {
        await Audio.setIsAudioActiveAsync(false);
      } catch {
        /* vẫn thử trả mode về bên dưới */
      }
      try {
        await Audio.setAudioModeAsync({
          shouldPlayInBackground: false,
          interruptionMode: 'mixWithOthers',
        });
      } catch {
        /* bỏ qua */
      }
    },
  };
}

export const KEEP_AWAKE_TAG = 'mapslibvn-navigation';

export function expoKeepAwake(): KeepAwake {
  return {
    async activate() {
      try {
        await ExpoKeepAwake.activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      } catch {
        /* bỏ qua */
      }
    },
    async deactivate() {
      try {
        await ExpoKeepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG);
      } catch {
        /* bỏ qua */
      }
    },
  };
}
