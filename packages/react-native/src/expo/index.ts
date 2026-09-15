import type { NavigationSessionOptions } from '../navigation/session';
import { expoAudioSession, expoKeepAwake, KEEP_AWAKE_TAG } from './device';
import {
  type ExpoHeadingOptions,
  expoHeadingSource,
  HEADING_ACCURACY_LEVELS,
  toAccuracy,
  toCompassSample,
} from './heading-source';
import {
  defineNavigationTask,
  type ExpoLocationSourceOptions,
  expoLocationSource,
  NAVIGATION_TASK,
  toGeoFix,
} from './location-source';
import { type ExpoSpeechOptions, expoSpeech } from './speech';

export type { ExpoHeadingOptions } from './heading-source';
export type { ExpoLocationAccuracy, ExpoLocationSourceOptions } from './location-source';
export type { ExpoSpeechOptions } from './speech';
export {
  defineNavigationTask,
  expoAudioSession,
  expoHeadingSource,
  expoKeepAwake,
  expoLocationSource,
  expoSpeech,
  HEADING_ACCURACY_LEVELS,
  KEEP_AWAKE_TAG,
  NAVIGATION_TASK,
  toAccuracy,
  toCompassSample,
  toGeoFix,
};

export type ExpoNavigationOptions = ExpoLocationSourceOptions & {
  speech?: ExpoSpeechOptions;
  /** false → không kèm nguồn hướng; object → tuỳ chọn cho expoHeadingSource. Mặc định bật. */
  heading?: false | ExpoHeadingOptions;
};

/** Bộ adapter Expo mặc định cho `createNavigationSession({ provider, ...expoNavigation() })`. */
export function expoNavigation(
  opts: ExpoNavigationOptions = {},
): Required<Pick<NavigationSessionOptions, 'source' | 'speech' | 'audio' | 'keepAwake'>> &
  Pick<NavigationSessionOptions, 'heading'> {
  const { speech, heading, ...location } = opts;
  return {
    source: expoLocationSource(location),
    speech: expoSpeech(speech ?? {}),
    audio: expoAudioSession(),
    keepAwake: expoKeepAwake(),
    ...(heading === false ? {} : { heading: expoHeadingSource(heading ?? {}) }),
  };
}
