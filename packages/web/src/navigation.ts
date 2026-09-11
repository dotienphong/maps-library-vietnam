import {
  type DirectionsLang,
  type DirectionsResponse,
  type MapsLibVNClient,
  type NavigationEvents,
  type NavigationProgress,
  type NavigationStatus,
  type NavigationThresholds,
  type Navigator,
  type NavigatorOptions,
  type PositionError,
  type PositionSource,
  type RouteProvider,
  type TravelMode,
  createNavigator,
} from '@mapslibvn/core';
import type * as maplibregl from 'maplibre-gl';
import { geolocationSource } from './position-source';
import type { RoutesLayer } from './routes-layer';
import { type Speech, type SpeechOptions, createSpeech } from './speech';

export interface NavigationStartOptions {
  response: DirectionsResponse;
  routeIndex?: number;
  /** Mặc định `map.places`. */
  provider?: RouteProvider;
  /** Mặc định 'auto'. */
  reroute?: 'auto' | 'manual';
  /** Mặc định theo `lang` của map. */
  lang?: DirectionsLang;
  /** Mặc định true. */
  voice?: boolean | { rate?: number; volume?: number };
  /** Mặc định true; zoom theo phương tiện, pitch 45. */
  follow?: boolean | { zoom?: number; pitch?: number; padding?: maplibregl.PaddingOptions };
  /** Mặc định `geolocationSource()`. */
  source?: PositionSource;
  thresholds?: Partial<NavigationThresholds>;
  /** Mặc định true. */
  wakeLock?: boolean;
}

export interface WebNavigationEvents extends NavigationEvents {
  followChange: boolean;
  positionError: PositionError;
  voiceUnavailable: undefined;
}

export interface NavigationController {
  start(opts: NavigationStartOptions): void;
  /** Dừng GPS, giọng nói, wake lock, puck; KHÔNG xoá tuyến (gọi `map.routes.clear()` nếu cần). */
  stop(): void;
  recenter(): void;
  reroute(): Promise<void>;
  readonly state: NavigationProgress | null;
  readonly status: NavigationStatus;
  readonly following: boolean;
  on<K extends keyof WebNavigationEvents>(
    event: K,
    handler: (e: WebNavigationEvents[K]) => void,
  ): void;
  off<K extends keyof WebNavigationEvents>(
    event: K,
    handler: (e: WebNavigationEvents[K]) => void,
  ): void;
}

export interface NavigationDeps {
  gl: maplibregl.Map;
  ml: { Marker: typeof maplibregl.Marker };
  places: MapsLibVNClient;
  routes: RoutesLayer;
  lang: DirectionsLang;
  /** Tiêm cho test; mặc định `navigator.wakeLock`. */
  wakeLock?: WakeLock | undefined;
  /** Tiêm cho test; mặc định `document`. */
  document?: Document | undefined;
}

export const FOLLOW_ZOOM: Readonly<Record<TravelMode, number>> = {
  walk: 17,
  motorbike: 16.5,
  car: 15.5,
};
const FOLLOW_PITCH = 45;
/** Mũi tên hướng bắc; Marker xoay theo bearing với rotationAlignment 'map'. */
const PUCK_STYLE =
  'width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;' +
  'border-bottom:26px solid #2458a6;filter:drop-shadow(0 0 2px #fff) drop-shadow(0 1px 3px rgba(0,0,0,.5));';
const NAV_EVENTS = [
  'status',
  'progress',
  'step',
  'waypoint',
  'offRoute',
  'reroute',
  'rerouteFailed',
  'announce',
  'arrive',
] as const;

export function createNavigation(deps: NavigationDeps): NavigationController {
  const { gl, ml, routes } = deps;
  const doc = 'document' in deps ? deps.document : typeof document !== 'undefined' ? document : undefined;
  const wakeLockApi =
    'wakeLock' in deps
      ? deps.wakeLock
      : typeof navigator !== 'undefined'
        ? navigator.wakeLock
        : undefined;

  const listeners = new Map<string, Set<(e: never) => void>>();
  const emit = <K extends keyof WebNavigationEvents>(k: K, e: WebNavigationEvents[K]): void => {
    for (const fn of listeners.get(k) ?? []) (fn as (e: WebNavigationEvents[K]) => void)(e);
  };

  let nav: Navigator | null = null;
  let unsubscribe: (() => void) | null = null;
  let speech: Speech | null = null;
  let puck: maplibregl.Marker | null = null;
  let puckOnMap = false;
  let running = false;
  let following = false;
  let follow: { zoom: number; pitch: number; padding?: maplibregl.PaddingOptions } | null = null;
  let sentinel: WakeLockSentinel | null = null;
  let lastFixTs: number | null = null;

  const onUserMove = (): void => {
    if (!following) return;
    following = false;
    emit('followChange', false);
  };

  const camera = (p: NavigationProgress): void => {
    if (!follow) return;
    const dt = lastFixTs === null ? 500 : p.fix.timestamp - lastFixTs;
    lastFixTs = p.fix.timestamp;
    const options: maplibregl.EaseToOptions = {
      center: p.snapped,
      bearing: p.bearing,
      zoom: follow.zoom,
      pitch: follow.pitch,
      duration: Math.max(0, Math.min(1000, dt)),
    };
    if (follow.padding) options.padding = follow.padding;
    gl.easeTo(options);
  };

  const requestWakeLock = async (): Promise<void> => {
    if (!wakeLockApi) return;
    try {
      sentinel = await wakeLockApi.request('screen');
    } catch {
      sentinel = null;
    }
  };
  const releaseWakeLock = (): void => {
    void sentinel?.release();
    sentinel = null;
  };
  const onVisibility = (): void => {
    if (running && doc?.visibilityState === 'visible' && sentinel === null) void requestWakeLock();
  };

  function stop(): void {
    if (!running) return;
    running = false;
    unsubscribe?.();
    unsubscribe = null;
    speech?.cancel();
    speech = null;
    releaseWakeLock();
    doc?.removeEventListener('visibilitychange', onVisibility);
    gl.off('dragstart', onUserMove);
    gl.off('wheel', onUserMove);
    puck?.remove();
    puck = null;
    puckOnMap = false;
    nav?.stop();
    nav = null;
    lastFixTs = null;
    following = false;
    follow = null;
  }

  function start(opts: NavigationStartOptions): void {
    if (running) stop();
    running = true;
    const lang = opts.lang ?? deps.lang;
    const routeIndex = opts.routeIndex ?? 0;
    const navOptions: NavigatorOptions = {
      response: opts.response,
      routeIndex,
      provider: opts.provider ?? deps.places,
      reroute: opts.reroute ?? 'auto',
      lang,
    };
    if (opts.thresholds) navOptions.thresholds = opts.thresholds;
    const engine = createNavigator(navOptions);
    nav = engine;
    routes.show(opts.response, { active: routeIndex });

    if (opts.voice !== false) {
      const v = typeof opts.voice === 'object' ? opts.voice : {};
      const speechOptions: SpeechOptions = {
        lang,
        onUnavailable: () => emit('voiceUnavailable', undefined),
      };
      if (v.rate !== undefined) speechOptions.rate = v.rate;
      if (v.volume !== undefined) speechOptions.volume = v.volume;
      speech = createSpeech(speechOptions);
      speech.warmUp();
    }

    if (opts.follow !== false) {
      const f = typeof opts.follow === 'object' ? opts.follow : {};
      const mode = opts.response.routes[routeIndex]?.mode ?? 'motorbike';
      follow = { zoom: f.zoom ?? FOLLOW_ZOOM[mode], pitch: f.pitch ?? FOLLOW_PITCH };
      if (f.padding) follow.padding = f.padding;
      following = true;
      gl.on('dragstart', onUserMove);
      gl.on('wheel', onUserMove);
    }

    const el = doc?.createElement('div');
    if (el) {
      el.setAttribute('style', PUCK_STYLE);
      el.setAttribute('aria-hidden', 'true');
      puck = new ml.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
    }

    engine.on('progress', (p) => {
      routes.setProgress(p.shapeIndex, p.snapped);
      if (puck) {
        puck.setLngLat(p.snapped).setRotation(p.bearing);
        if (!puckOnMap) {
          puck.addTo(gl);
          puckOnMap = true;
        }
      }
      if (following) camera(p);
    });
    engine.on('announce', (a) => speech?.speak(a.text, a.priority));
    engine.on('reroute', (e) => routes.show(e.response, { active: 0 }));
    engine.on('arrive', () => {
      unsubscribe?.();
      unsubscribe = null;
      releaseWakeLock();
    });
    for (const name of NAV_EVENTS) {
      engine.on(name, (e) => emit(name, e as WebNavigationEvents[typeof name]));
    }

    const source = opts.source ?? geolocationSource();
    unsubscribe = source.subscribe(
      (fix) => engine.update(fix),
      (error) => emit('positionError', error),
    );
    if (opts.wakeLock !== false) {
      void requestWakeLock();
      doc?.addEventListener('visibilitychange', onVisibility);
    }
  }

  return {
    start,
    stop,
    recenter() {
      if (!running || !follow) return;
      following = true;
      emit('followChange', true);
      if (nav?.progress) camera(nav.progress);
    },
    reroute() {
      return nav ? nav.reroute() : Promise.reject(new Error('map.navigation chưa start()'));
    },
    get state() {
      return nav?.progress ?? null;
    },
    get status() {
      return nav?.status ?? 'idle';
    },
    get following() {
      return following;
    },
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler as (e: never) => void);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler as (e: never) => void);
    },
  };
}
