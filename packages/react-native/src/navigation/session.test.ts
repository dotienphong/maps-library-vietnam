import {
  type DirectionsResponse,
  type GeoFix,
  type HeadingError,
  type HeadingFix,
  type HeadingSource,
  type PositionError,
  type Route,
  simulateFixes,
} from '@mapslibvn/core';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import {
  createNavigationSession,
  MISSING_SOURCE_MESSAGE,
  type SessionEvents,
  type SessionPositionSource,
} from './session';

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;
const provider = { directions: vi.fn(async () => response) };

function fakeSource(calls: string[]) {
  let onFix: ((fix: GeoFix) => void) | null = null;
  let onError: ((e: PositionError) => void) | undefined;
  let bgCb: ((e: SessionEvents['backgroundUnavailable']) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    onFix = null;
  });
  const source: SessionPositionSource = {
    setMode: (mode) => {
      calls.push(`setMode:${mode}`);
    },
    onBackgroundUnavailable: (cb) => {
      bgCb = cb;
    },
    subscribe: (fix, err) => {
      calls.push('subscribe');
      onFix = fix;
      onError = err;
      return unsubscribe;
    },
  };
  return {
    source,
    unsubscribe,
    push(fixes: readonly GeoFix[]) {
      for (const f of fixes) onFix?.(f);
    },
    fail(e: PositionError) {
      onError?.(e);
    },
    background(e: SessionEvents['backgroundUnavailable']) {
      bgCb?.(e);
    },
  };
}

function fakeDevice(calls: string[]) {
  return {
    speech: {
      speak: vi.fn((_text: string, priority: number, lang: string) => {
        calls.push(`speak:${priority}:${lang}`);
      }),
      cancel: vi.fn(() => {
        calls.push('cancel');
      }),
      available: vi.fn(async () => {
        calls.push('available');
        return true;
      }),
      setOptions: vi.fn(),
    },
    keepAwake: {
      activate: vi.fn(async () => {
        calls.push('keep:on');
      }),
      deactivate: vi.fn(async () => {
        calls.push('keep:off');
      }),
    },
    audio: {
      activate: vi.fn(async () => {
        calls.push('audio:on');
      }),
      deactivate: vi.fn(async () => {
        calls.push('audio:off');
      }),
    },
  };
}

function fakeHeading() {
  let onHeading: ((h: HeadingFix) => void) | null = null;
  let onError: ((e: HeadingError) => void) | undefined;
  const unsubscribe = vi.fn(() => {
    onHeading = null;
  });
  const source: HeadingSource = {
    subscribe: vi.fn((h: (fix: HeadingFix) => void, e?: (error: HeadingError) => void) => {
      onHeading = h;
      onError = e;
      return unsubscribe;
    }),
  };
  return {
    source,
    unsubscribe,
    push(h: HeadingFix) {
      onHeading?.(h);
    },
    fail(e: HeadingError) {
      onError?.(e);
    },
  };
}
const headingAt = (heading: number, timestamp = 1_700_000_000_000): HeadingFix => ({
  heading,
  accuracy: 'high',
  timestamp,
  source: 'compass',
});

describe('createNavigationSession', () => {
  it('start: audio → available → keep-awake → setMode → subscribe; hết fix → arrived, end{arrived}, nhả nguồn và thiết bị', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const d = fakeDevice(calls);
    const session = createNavigationSession({ provider, source: s.source, ...d });
    const events: string[] = [];
    session.on('status', (e) => events.push(e.status));
    session.on('end', (e) => events.push(`end:${e.reason}`));
    session.on('route', (e) => events.push(`route:${e.routeIndex}`));

    await session.start({ response });
    expect(calls).toEqual(['audio:on', 'available', 'keep:on', 'setMode:motorbike', 'subscribe']);
    expect(session.status).toBe('navigating');
    expect(session.response).toBe(response);
    expect(session.state).toBeNull();

    s.push(simulateFixes(route));
    expect(session.status).toBe('arrived');
    expect(session.state?.status).toBe('arrived');
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(d.audio.deactivate).toHaveBeenCalledTimes(1));
    expect(d.keepAwake.deactivate).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['route:0', 'navigating', 'arrived', 'end:arrived']);
    const spoken = d.speech.speak.mock.calls;
    expect(spoken).toHaveLength(12);
    expect(spoken.every((c) => c[2] === 'vi')).toBe(true);
    expect(spoken.at(-1)?.[0]).toBe('Điểm đến ở bên trái.');

    await session.stop(); // sau khi đến nơi: không phát end lần hai, status về idle
    expect(events.filter((e) => e.startsWith('end:'))).toEqual(['end:arrived']);
    expect(session.status).toBe('idle');
  });

  it('stop: cắt giọng, nhả thiết bị, gỡ nguồn, end{stopped} một lần; status idle, state null, response giữ', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const d = fakeDevice(calls);
    const session = createNavigationSession({ provider, source: s.source, ...d });
    const ends: string[] = [];
    const statuses: string[] = [];
    session.on('end', (e) => ends.push(e.reason));
    session.on('status', (e) => statuses.push(e.status));
    await session.start({ response });
    s.push(simulateFixes(route).slice(0, 5));
    expect(session.state?.status).toBe('navigating');
    await session.stop();
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    expect(d.speech.cancel).toHaveBeenCalledTimes(1);
    expect(d.keepAwake.deactivate).toHaveBeenCalledTimes(1);
    expect(d.audio.deactivate).toHaveBeenCalledTimes(1);
    expect(ends).toEqual(['stopped']);
    expect(statuses).toEqual(['navigating', 'idle']);
    expect(session.status).toBe('idle');
    expect(session.state).toBeNull();
    expect(session.response).toBe(response);
    await session.stop(); // lần hai: no-op
    expect(ends).toEqual(['stopped']);
  });

  it('thiếu source → reject với thông điệp chỉ cách truyền', async () => {
    const session = createNavigationSession({ provider });
    await expect(session.start({ response })).rejects.toThrow(MISSING_SOURCE_MESSAGE);
    expect(session.status).toBe('idle');
  });

  it('voice false → không audio/speech; available() false → voiceUnavailable một lần; voice {rate} → setOptions', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const d = fakeDevice(calls);
    const session = createNavigationSession({ provider, source: s.source, ...d });
    await session.start({ response, voice: false });
    expect(calls).toEqual(['keep:on', 'setMode:motorbike', 'subscribe']);
    s.push(simulateFixes(route).slice(0, 3));
    expect(d.speech.speak).not.toHaveBeenCalled();

    d.speech.available.mockResolvedValueOnce(false);
    const unavailable = vi.fn();
    session.on('voiceUnavailable', unavailable);
    await session.start({ response, voice: { rate: 1.2 } });
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(d.speech.setOptions).toHaveBeenCalledWith({ rate: 1.2 });
  });

  it('positionError và backgroundUnavailable của nguồn phát lại trên phiên', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const session = createNavigationSession({ provider, source: s.source });
    const errors: string[] = [];
    session.on('positionError', (e) => errors.push(e.code));
    session.on('backgroundUnavailable', (e) => errors.push(e.reason));
    await session.start({ response });
    s.fail({ code: 'denied', message: 'từ chối' });
    s.background({ reason: 'task_not_defined', message: 'chưa defineNavigationTask' });
    expect(errors).toEqual(['denied', 'task_not_defined']);
  });

  /**
   * Từ chối quyền vị trí là hỏng vĩnh viễn, không phải trục trặc tạm thời: sẽ không bao giờ có fix
   * nào nữa. Trước 13/09/2026 phiên chỉ phát `positionError` rồi vẫn `running`, nên status kẹt ở
   * `navigating` trong khi chống khoá màn hình, vòng âm thanh im lặng và thông báo dịch vụ nền cứ
   * chạy cho tới khi app chủ tự nhận ra và gọi `stop()`.
   */
  it('quyền vị trí bị từ chối → phiên tự dừng, không kẹt ở navigating', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const session = createNavigationSession({ provider, source: s.source });
    const statuses: string[] = [];
    session.on('status', (e) => statuses.push(e.status));
    const errors: string[] = [];
    session.on('positionError', (e) => errors.push(e.code));
    await session.start({ response });
    expect(session.status).toBe('navigating');

    s.fail({ code: 'denied', message: 'từ chối' });
    await vi.waitFor(() => expect(session.status).toBe('idle'));
    // Vẫn báo lỗi cho app chủ trước khi dừng — app cần biết vì sao.
    expect(errors).toEqual(['denied']);
    expect(statuses.at(-1)).toBe('idle');
  });

  it('lỗi vị trí tạm thời (unavailable) KHÔNG dừng phiên', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const session = createNavigationSession({ provider, source: s.source });
    await session.start({ response });
    s.fail({ code: 'unavailable', message: 'mất tín hiệu trong hầm' });
    await Promise.resolve();
    expect(session.status).toBe('navigating');
  });

  it('start khi đang chạy → stop trước: gỡ nguồn cũ, end:stopped rồi route mới', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const session = createNavigationSession({ provider, source: s.source });
    const events: string[] = [];
    session.on('end', (e) => events.push(`end:${e.reason}`));
    session.on('route', (e) => events.push(`route:${e.routeIndex}`));
    await session.start({ response });
    await session.start({ response, routeIndex: 0 });
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c === 'subscribe')).toHaveLength(2);
    expect(events).toEqual(['route:0', 'end:stopped', 'route:0']);
  });

  it('setRoute đổi response/routeIndex và phát route; reroute khi chưa start → reject', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const session = createNavigationSession({ provider, source: s.source });
    await expect(session.reroute()).rejects.toThrow(/chưa start/);
    const routes: number[] = [];
    session.on('route', (e) => routes.push(e.routeIndex));
    await session.start({ response });
    session.setRoute(response, 0);
    expect(routes).toEqual([0, 0]);
    expect(session.response).toBe(response);
  });

  it('không speech/keepAwake/audio: phiên tối giản vẫn chạy tới arrived', async () => {
    const calls: string[] = [];
    const s = fakeSource(calls);
    const session = createNavigationSession({ provider, source: s.source });
    const progress = vi.fn();
    session.on('progress', progress);
    await session.start({ response, keepAwake: false });
    s.push(simulateFixes(route));
    expect(session.status).toBe('arrived');
    expect(progress).toHaveBeenCalled();
    expect(calls).toEqual(['setMode:motorbike', 'subscribe']);
  });
});

describe('createNavigationSession — nguồn hướng', () => {
  it('có heading: đăng ký lúc start sau source, phát lại sự kiện, getter; stop() huỷ và xoá', async () => {
    const calls: string[] = [];
    const src = fakeSource(calls);
    const hd = fakeHeading();
    const session = createNavigationSession({ provider, source: src.source, heading: hd.source });
    const got: HeadingFix[] = [];
    session.on('heading', (h) => got.push(h));
    expect(session.heading).toBeNull();
    await session.start({ response });
    expect(calls).toContain('subscribe');
    expect(hd.source.subscribe).toHaveBeenCalledTimes(1);
    hd.push(headingAt(123));
    expect(got.map((h) => h.heading)).toEqual([123]);
    expect(session.heading?.heading).toBe(123);
    await session.stop();
    expect(hd.unsubscribe).toHaveBeenCalledTimes(1);
    expect(session.heading).toBeNull();
  });

  it('đến nơi huỷ đăng ký hướng; lỗi nguồn → headingUnavailable đúng một lần mỗi start', async () => {
    const calls: string[] = [];
    const src = fakeSource(calls);
    const hd = fakeHeading();
    const session = createNavigationSession({ provider, source: src.source, heading: hd.source });
    const errors: HeadingError[] = [];
    session.on('headingUnavailable', (e) => errors.push(e));
    await session.start({ response });
    hd.fail({ code: 'unavailable', message: 'simulator không có la bàn' });
    hd.fail({ code: 'unavailable', message: 'lại' });
    expect(errors).toHaveLength(1);
    src.push(simulateFixes(route));
    expect(session.status).toBe('arrived');
    expect(hd.unsubscribe).toHaveBeenCalledTimes(1);
    expect(session.heading).toBeNull();
  });

  it('không heading: không sự kiện, getter null, mọi thứ khác như cũ', async () => {
    const calls: string[] = [];
    const src = fakeSource(calls);
    const session = createNavigationSession({ provider, source: src.source });
    const onHeading = vi.fn();
    session.on('heading', onHeading);
    await session.start({ response });
    src.push(simulateFixes(route).slice(0, 3));
    expect(onHeading).not.toHaveBeenCalled();
    expect(session.heading).toBeNull();
    await session.stop();
  });
});
