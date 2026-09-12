import type { AudioSession, KeepAwake } from '../navigation/session';
import { Audio, KeepAwake as ExpoKeepAwake } from './modules';

/** Phiên âm thanh để giọng đọc phát khi khoá máy và làm nhỏ nhạc đang phát (spec C 6.3). */
export function expoAudioSession(): AudioSession {
  return {
    async activate() {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'duckOthers',
        });
      } catch {
        /* thiếu expo-audio native → vẫn dẫn đường, chỉ không phát khi nền */
      }
    },
    async deactivate() {
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
