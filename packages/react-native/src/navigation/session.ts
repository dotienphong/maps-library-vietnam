import {
  createNavigator,
  type DirectionsLang,
  type DirectionsResponse,
  type HeadingError,
  type HeadingFix,
  type HeadingSource,
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
} from '@mapslibvn/core';

/** Bộ đọc câu — mặc định Expo ở `@mapslibvn/react-native/expo`; app thay bằng TTS riêng được. */
export interface Speaker {
  /** Cắt câu đang đọc nếu `priority` ≥ ưu tiên câu đó; thấp hơn thì xếp hàng. */
  speak(text: string, priority: 1 | 2 | 3, lang: DirectionsLang): void;
  cancel(): void;
  /** Có giọng khớp `lang` không; phiên gọi một lần lúc `start()` để phát `voiceUnavailable`. */
  available(lang: DirectionsLang): Promise<boolean>;
  /** Nhận `voice: { rate, volume }` của `start()`; tuỳ chọn. */
  setOptions?(options: { rate?: number; volume?: number }): void;
}

export interface KeepAwake {
  activate(): Promise<void> | void;
  deactivate(): Promise<void> | void;
}

export interface AudioSession {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
}

export interface BackgroundUnavailable {
  reason: 'task_not_defined' | 'not_configured' | 'permission' | 'unsupported';
  message: string;
}

/** `PositionSource` của core cộng hai móc tuỳ chọn; phiên nhận diện bằng `'setMode' in source`. */
export interface SessionPositionSource extends PositionSource {
  /** Phiên gọi trước `subscribe` với `mode` của tuyến (iOS activityType, Android ưu tiên). */
  setMode?(mode: TravelMode): void;
  /** Nguồn báo đã rơi về tiền cảnh; phiên phát lại thành `backgroundUnavailable`. */
  onBackgroundUnavailable?(cb: (e: BackgroundUnavailable) => void): void;
}

export interface NavigationSessionOptions {
  provider: RouteProvider;
  /** Bắt buộc để `start()` chạy; thiếu → reject với `MISSING_SOURCE_MESSAGE`. */
  source?: SessionPositionSource;
  /** Thiếu → không đọc, không phát `voiceUnavailable`. */
  speech?: Speaker;
  keepAwake?: KeepAwake;
  audio?: AudioSession;
  /** Nguồn hướng la bàn (spec la bàn 5.3); thiếu → puck/camera như cũ, không có sự kiện heading. */
  heading?: HeadingSource;
}

export interface NavigationSessionStartOptions {
  response: DirectionsResponse;
  /** Mặc định 0. */
  routeIndex?: number;
  /** Mặc định 'auto'. */
  reroute?: 'auto' | 'manual';
  /** Mặc định 'vi'. */
  lang?: DirectionsLang;
  /** Mặc định true khi có `speech`. */
  voice?: boolean | { rate?: number; volume?: number };
  thresholds?: Partial<NavigationThresholds>;
  /** Mặc định true khi có `keepAwake`. */
  keepAwake?: boolean;
}

export interface SessionEvents extends NavigationEvents {
  /** Tuyến hiện tại đổi: `start()`, `setRoute()`, hoặc tính lại xong. Map gắn vào vẽ theo đây. */
  route: { response: DirectionsResponse; routeIndex: number };
  positionError: PositionError;
  voiceUnavailable: undefined;
  /** Nguồn vị trí không chạy nền được, đã rơi về tiền cảnh (một lần mỗi `start`). */
  backgroundUnavailable: BackgroundUnavailable;
  /** Phiên đã dừng nguồn vị trí: đến nơi hoặc app gọi `stop()`. */
  end: { reason: 'arrived' | 'stopped' };
  /** Hướng la bàn đã lọc — phiên chuyển tiếp nguyên từ `heading`. */
  heading: HeadingFix;
  /** Nguồn hướng lỗi (từ chối quyền, máy không có la bàn) — một lần mỗi start. */
  headingUnavailable: HeadingError;
}

export interface NavigationSession {
  /** Resolve sau khi đã đăng ký nguồn vị trí (có thể chờ hộp thoại quyền). Reject chỉ khi thiếu `source`. */
  start(opts: NavigationSessionStartOptions): Promise<void>;
  stop(): Promise<void>;
  reroute(): Promise<void>;
  setRoute(response: DirectionsResponse, routeIndex?: number): void;
  /** 'idle' khi chưa start hoặc đã stop; 'navigating' ngay sau start (core chỉ đổi ở fix đầu). */
  readonly status: NavigationStatus;
  readonly state: NavigationProgress | null;
  /** Tuyến hiện tại — map gắn muộn vẽ lại từ đây; `stop()` không xoá. */
  readonly response: DirectionsResponse | null;
  readonly routeIndex: number;
  /** Hướng la bàn cuối của phiên đang chạy; null khi idle hoặc chưa có mẫu. */
  readonly heading: HeadingFix | null;
  on<K extends keyof SessionEvents>(event: K, handler: (e: SessionEvents[K]) => void): void;
  off<K extends keyof SessionEvents>(event: K, handler: (e: SessionEvents[K]) => void): void;
}

export const MISSING_SOURCE_MESSAGE =
  'Phiên dẫn đường thiếu nguồn vị trí: truyền source (ví dụ expoLocationSource() từ @mapslibvn/react-native/expo)';

/** Sự kiện core phát lại nguyên; `status` xử lý riêng (lọc 'stopped' và idle→navigating). */
const FORWARDED = [
  'progress',
  'step',
  'waypoint',
  'offRoute',
  'reroute',
  'rerouteFailed',
  'announce',
  'arrive',
] as const;

type Listener = (e: never) => void;

export function createNavigationSession(opts: NavigationSessionOptions): NavigationSession {
  const listeners = new Map<string, Set<Listener>>();
  const emit = <K extends keyof SessionEvents>(event: K, e: SessionEvents[K]): void => {
    for (const fn of listeners.get(event) ?? []) (fn as (e: SessionEvents[K]) => void)(e);
  };

  let nav: Navigator | null = null;
  let unsubscribe: (() => void) | null = null;
  let unsubscribeHeading: (() => void) | null = null;
  let lastHeading: HeadingFix | null = null;
  let running = false;
  let ended = false;
  let startToken = 0;
  let response: DirectionsResponse | null = null;
  let routeIndex = 0;
  let voiceOn = false;
  let keepOn = false;
  let audioOn = false;

  const currentStatus = (): NavigationStatus => {
    if (!nav) return 'idle';
    return nav.status === 'idle' ? 'navigating' : nav.status;
  };
  const releaseSource = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    unsubscribeHeading?.();
    unsubscribeHeading = null;
    lastHeading = null;
  };
  const releaseDevice = async (): Promise<void> => {
    if (keepOn) {
      keepOn = false;
      try {
        await opts.keepAwake?.deactivate();
      } catch {
        /* không chặn dừng */
      }
    }
    if (audioOn) {
      audioOn = false;
      try {
        await opts.audio?.deactivate();
      } catch {
        /* không chặn dừng */
      }
    }
  };

  async function stop(): Promise<void> {
    if (!running) return;
    running = false;
    startToken += 1;
    const previous = currentStatus();
    releaseSource();
    if (voiceOn) opts.speech?.cancel();
    voiceOn = false;
    const engine = nav;
    nav = null;
    engine?.stop(); // core phát status 'stopped' — bị lọc, phiên tự phát 'idle' bên dưới
    await releaseDevice();
    emit('status', { status: 'idle', previous });
    if (!ended) emit('end', { reason: 'stopped' });
    ended = false;
  }

  async function start(o: NavigationSessionStartOptions): Promise<void> {
    if (running) await stop();
    const source = opts.source;
    if (!source) throw new Error(MISSING_SOURCE_MESSAGE);
    running = true;
    ended = false;
    startToken += 1;
    const token = startToken;
    response = o.response;
    routeIndex = o.routeIndex ?? 0;
    const lang: DirectionsLang = o.lang ?? 'vi';
    const navOptions: NavigatorOptions = {
      response: o.response,
      routeIndex,
      provider: opts.provider,
      reroute: o.reroute ?? 'auto',
      lang,
    };
    if (o.thresholds) navOptions.thresholds = o.thresholds;
    const engine = createNavigator(navOptions);
    const mode: TravelMode = o.response.routes[routeIndex]?.mode ?? 'motorbike';

    voiceOn = o.voice !== false && Boolean(opts.speech);
    if (voiceOn && opts.speech) {
      if (typeof o.voice === 'object') opts.speech.setOptions?.(o.voice);
      if (opts.audio) {
        audioOn = true;
        try {
          await opts.audio.activate();
        } catch {
          /* vẫn thử đọc */
        }
      }
      let available = true;
      try {
        available = await opts.speech.available(lang);
      } catch {
        /* coi như có giọng */
      }
      if (token !== startToken) return; // stop() hoặc start() khác đã chen vào lúc chờ
      if (!available) emit('voiceUnavailable', undefined);
    }
    keepOn = (o.keepAwake ?? true) && Boolean(opts.keepAwake);
    if (keepOn) {
      try {
        await opts.keepAwake?.activate();
      } catch {
        /* không chặn */
      }
    }
    if (token !== startToken) return;

    nav = engine;
    for (const name of FORWARDED) {
      engine.on(name, (e) => emit(name, e as SessionEvents[typeof name]));
    }
    engine.on('status', (e) => {
      if (e.status === 'stopped') return;
      if (e.status === 'navigating' && e.previous === 'idle') return; // đã phát lúc start()
      emit('status', e);
    });
    engine.on('announce', (a) => {
      if (voiceOn) opts.speech?.speak(a.text, a.priority, lang);
    });
    engine.on('reroute', (e) => {
      response = e.response;
      routeIndex = 0;
      emit('route', { response: e.response, routeIndex: 0 });
    });
    engine.on('arrive', () => {
      ended = true;
      releaseSource();
      void releaseDevice();
      emit('end', { reason: 'arrived' });
    });

    emit('route', { response: o.response, routeIndex });
    emit('status', { status: 'navigating', previous: 'idle' });
    source.setMode?.(mode);
    source.onBackgroundUnavailable?.((e) => emit('backgroundUnavailable', e));
    unsubscribe = source.subscribe(
      (fix) => engine.update(fix),
      (error) => {
        emit('positionError', error);
        // `denied` là hỏng vĩnh viễn: sẽ không có fix nào nữa, nên giữ phiên "đang chạy" chỉ khiến
        // chống khoá màn hình, vòng âm thanh im lặng và thông báo dịch vụ nền sống mãi trong khi
        // bản đồ đứng im. Các mã khác (mất tín hiệu, timeout) là tạm thời — không đụng tới.
        if (error.code === 'denied') void stop();
      },
    );
    const headingSource = opts.heading;
    if (headingSource) {
      let reported = false;
      unsubscribeHeading = headingSource.subscribe(
        (h) => {
          lastHeading = h;
          emit('heading', h);
        },
        (error) => {
          if (reported) return;
          reported = true;
          emit('headingUnavailable', error);
        },
      );
    }
  }

  return {
    start,
    stop,
    reroute() {
      return nav ? nav.reroute() : Promise.reject(new Error('Phiên dẫn đường chưa start()'));
    },
    setRoute(next, index = 0) {
      response = next;
      routeIndex = index;
      nav?.setRoute(next, index);
      emit('route', { response: next, routeIndex: index });
    },
    get status() {
      return currentStatus();
    },
    get state() {
      return nav?.progress ?? null;
    },
    get response() {
      return response;
    },
    get routeIndex() {
      return routeIndex;
    },
    get heading() {
      return lastHeading;
    },
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler as Listener);
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler as Listener);
    },
  };
}
