// @vitest-environment jsdom
import { type DirectionsResponse, type Route, simulateFixes } from '@mapslibvn/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../core/tests/fixtures/directions-q1.json';
import { createNavigation, FOLLOW_ZOOM } from './navigation';
import { playbackSource } from './position-source';

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;

class FakeUtterance {
  text: string;
  lang = '';
  voice: unknown = null;
  rate = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeDeps() {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const gl = {
    easeTo: vi.fn(),
    on: vi.fn((ev: string, fn: (e: unknown) => void) => {
      handlers[ev] ??= [];
      handlers[ev].push(fn);
    }),
    off: vi.fn((ev: string, fn: (e: unknown) => void) => {
      handlers[ev] = (handlers[ev] ?? []).filter((h) => h !== fn);
    }),
  };
  class Marker {
    options: unknown;
    setLngLat = vi.fn(() => this);
    setRotation = vi.fn(() => this);
    addTo = vi.fn(() => this);
    remove = vi.fn();
    constructor(options: unknown) {
      this.options = options;
    }
  }
  const routes = {
    show: vi.fn(),
    showFleet: vi.fn(),
    setActive: vi.fn(),
    setProgress: vi.fn(),
    clear: vi.fn(),
  };
  const places = { directions: vi.fn(async () => response) };
  const synth = {
    speaking: false,
    pending: false,
    getVoices: vi.fn(() => [{ lang: 'vi-VN', name: 'Linh' }]),
    speak: vi.fn(),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
  };
  const sentinel = { release: vi.fn(async () => {}) };
  const wakeLock = { request: vi.fn(async () => sentinel) };
  return {
    gl,
    Marker,
    routes,
    places,
    synth,
    wakeLock,
    sentinel,
    fire: (ev: string, e?: unknown) => {
      for (const fn of handlers[ev] ?? []) fn(e);
    },
    handlerCount: (ev: string) => (handlers[ev] ?? []).length,
    make: () =>
      createNavigation({
        gl: gl as never,
        ml: { Marker } as never,
        places: places as never,
        routes,
        lang: 'vi',
        wakeLock: wakeLock as never,
        document,
      }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createNavigation', () => {
  it('start: vẽ tuyến, wake lock, puck, camera bám theo mode; announce → speak vi-VN; arrive → dừng nguồn', async () => {
    const d = fakeDeps();
    vi.stubGlobal('speechSynthesis', d.synth);
    const nav = d.make();
    const statuses: string[] = [];
    nav.on('status', (e) => statuses.push(e.status));
    const fixes = simulateFixes(route);
    nav.start({ response, source: playbackSource(fixes, { rate: 0 }) });

    expect(d.routes.show).toHaveBeenCalledWith(response, { active: 0 });
    expect(d.wakeLock.request).toHaveBeenCalledWith('screen');
    // warmUp trong gesture
    expect(d.synth.speak).toHaveBeenCalledTimes(1);
    const utter = d.synth.speak.mock.calls[0]?.[0] as FakeUtterance | undefined;
    expect(utter?.text).toBe('');

    await vi.runAllTimersAsync();

    expect(nav.status).toBe('arrived');
    expect(statuses).toEqual(['navigating', 'arrived']);
    expect(d.routes.setProgress).toHaveBeenCalled();
    const ease = d.gl.easeTo.mock.calls[0]?.[0] as { zoom: number; pitch: number; bearing: number };
    expect(ease.zoom).toBe(FOLLOW_ZOOM.motorbike);
    expect(ease.pitch).toBe(45);
    expect(ease.bearing).toBeGreaterThanOrEqual(0);
    const spoken = d.synth.speak.mock.calls.slice(1).map((c) => c[0] as FakeUtterance);
    expect(spoken.length).toBe(12);
    expect(spoken.every((u) => u.lang === 'vi-VN')).toBe(true);
    expect(spoken.at(-1)?.text).toBe('Điểm đến ở bên trái.');
    expect(nav.state?.status).toBe('arrived');
    // arrive → nhả wake lock, tuyến vẫn trên bản đồ
    expect(d.sentinel.release).toHaveBeenCalled();
    expect(d.routes.clear).not.toHaveBeenCalled();
  });

  it('kéo bản đồ tắt bám (followChange false, easeTo dừng); recenter bật lại', async () => {
    const d = fakeDeps();
    const nav = d.make();
    const follow = vi.fn();
    nav.on('followChange', follow);
    const fixes = simulateFixes(route).slice(0, 40);
    nav.start({ response, voice: false, source: playbackSource(fixes, { rate: 1 }) });
    await vi.advanceTimersByTimeAsync(5000);
    const before = d.gl.easeTo.mock.calls.length;
    expect(before).toBeGreaterThan(3);
    d.fire('dragstart');
    expect(follow).toHaveBeenCalledWith(false);
    expect(nav.following).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(d.gl.easeTo.mock.calls.length).toBe(before);
    nav.recenter();
    expect(follow).toHaveBeenCalledWith(true);
    expect(d.gl.easeTo.mock.calls.length).toBe(before + 1);
    expect(d.synth.speak).not.toHaveBeenCalled();
  });

  it('follow: false → không easeTo; voice: false → không speech; lang en truyền xuống provider khi tính lại', async () => {
    const d = fakeDeps();
    const nav = d.make();
    const fixes = simulateFixes(route).slice(0, 5);
    nav.start({
      response,
      voice: false,
      follow: false,
      lang: 'en',
      source: playbackSource(fixes, { rate: 0 }),
    });
    await vi.runAllTimersAsync();
    expect(d.gl.easeTo).not.toHaveBeenCalled();
    await nav.reroute();
    expect(d.places.directions).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en' }));
  });

  it('positionError chuyển tiếp; không có speechSynthesis → voiceUnavailable một lần', () => {
    const d = fakeDeps();
    vi.stubGlobal('speechSynthesis', undefined);
    const nav = d.make();
    const onError = vi.fn();
    const onVoice = vi.fn();
    nav.on('positionError', onError);
    nav.on('voiceUnavailable', onVoice);
    nav.start({
      response,
      source: {
        subscribe: (_onFix, onErr) => {
          onErr?.({ code: 'denied', message: 'x' });
          return () => {};
        },
      },
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'denied' }));
    expect(onVoice).toHaveBeenCalledTimes(1);
  });

  it('stop(): huỷ nguồn, cancel speech, nhả wake lock, gỡ puck và listener kéo; start lần hai tự stop trước', async () => {
    const d = fakeDeps();
    vi.stubGlobal('speechSynthesis', d.synth);
    const nav = d.make();
    const fixes = simulateFixes(route);
    nav.start({ response, source: playbackSource(fixes, { rate: 1 }) });
    await vi.advanceTimersByTimeAsync(3000);
    expect(d.handlerCount('dragstart')).toBe(1);
    nav.stop();
    const calls = d.routes.setProgress.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(d.routes.setProgress.mock.calls.length).toBe(calls);
    expect(d.synth.cancel).toHaveBeenCalled();
    expect(d.sentinel.release).toHaveBeenCalled();
    expect(d.handlerCount('dragstart')).toBe(0);
    expect(nav.status).toBe('idle');
    expect(nav.state).toBeNull();

    nav.start({ response, source: playbackSource(fixes, { rate: 1 }) });
    nav.start({ response, source: playbackSource(fixes, { rate: 1 }) });
    expect(d.handlerCount('dragstart')).toBe(1);
    expect(d.routes.show).toHaveBeenCalledTimes(3);
  });
});
