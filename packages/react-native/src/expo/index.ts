import type { NavigationSessionOptions } from '../navigation/session';
import { KEEP_AWAKE_TAG, expoAudioSession, expoKeepAwake } from './device';
import {
  type ExpoLocationSourceOptions,
  NAVIGATION_TASK,
  defineNavigationTask,
  expoLocationSource,
  toGeoFix,
} from './location-source';
import { type ExpoSpeechOptions, expoSpeech } from './speech';

export { NAVIGATION_TASK, defineNavigationTask, expoLocationSource, toGeoFix };
export type { ExpoLocationAccuracy, ExpoLocationSourceOptions } from './location-source';
export { expoSpeech };
export type { ExpoSpeechOptions } from './speech';
export { KEEP_AWAKE_TAG, expoAudioSession, expoKeepAwake };

export type ExpoNavigationOptions = ExpoLocationSourceOptions & { speech?: ExpoSpeechOptions };

/** Bộ adapter Expo mặc định cho `createNavigationSession({ provider, ...expoNavigation() })`. */
export function expoNavigation(
  opts: ExpoNavigationOptions = {},
): Required<Pick<NavigationSessionOptions, 'source' | 'speech' | 'audio' | 'keepAwake'>> {
  const { speech, ...location } = opts;
  return {
    source: expoLocationSource(location),
    speech: expoSpeech(speech ?? {}),
    audio: expoAudioSession(),
    keepAwake: expoKeepAwake(),
  };
}
