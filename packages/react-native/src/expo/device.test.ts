import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  Audio: { setAudioModeAsync: vi.fn(async (_mode: Record<string, unknown>) => {}) },
  KeepAwake: {
    activateKeepAwakeAsync: vi.fn(async (_tag?: string) => {}),
    deactivateKeepAwake: vi.fn(async (_tag?: string) => {}),
  },
}));
vi.mock('./modules', () => ({
  Audio: mocks.Audio,
  KeepAwake: mocks.KeepAwake,
  Location: {},
  TaskManager: {},
  Speech: {},
}));

import { KEEP_AWAKE_TAG, expoAudioSession, expoKeepAwake } from './device';

beforeEach(() => vi.clearAllMocks());

describe('expoAudioSession', () => {
  it('activate: phát khi im lặng, nền, duck nhạc; deactivate: trả về mixWithOthers; lỗi nuốt', async () => {
    const a = expoAudioSession();
    await a.activate();
    expect(mocks.Audio.setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
    await a.deactivate();
    expect(mocks.Audio.setAudioModeAsync).toHaveBeenLastCalledWith({
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    });
    mocks.Audio.setAudioModeAsync.mockRejectedValueOnce(new Error('x'));
    await expect(a.activate()).resolves.toBeUndefined();
  });
});

describe('expoKeepAwake', () => {
  it('activate/deactivate cùng tag; lỗi nuốt', async () => {
    const k = expoKeepAwake();
    await k.activate();
    expect(mocks.KeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith(KEEP_AWAKE_TAG);
    await k.deactivate();
    expect(mocks.KeepAwake.deactivateKeepAwake).toHaveBeenCalledWith(KEEP_AWAKE_TAG);
    mocks.KeepAwake.activateKeepAwakeAsync.mockRejectedValueOnce(new Error('x'));
    await expect(k.activate()).resolves.toBeUndefined();
  });
});
