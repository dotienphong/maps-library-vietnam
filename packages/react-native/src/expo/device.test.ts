import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakePlayer {
  loop: boolean;
  volume: number;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  setActiveForLockScreen: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => {
  const players: FakePlayer[] = [];
  return {
    players,
    Audio: {
      setAudioModeAsync: vi.fn(async (_mode: Record<string, unknown>) => {}),
      setIsAudioActiveAsync: vi.fn(async (_active: boolean) => {}),
      createAudioPlayer: vi.fn((_source?: unknown, _options?: unknown) => {
        const p = {
          loop: false,
          volume: 1,
          play: vi.fn(),
          pause: vi.fn(),
          remove: vi.fn(),
          setActiveForLockScreen: vi.fn(),
        };
        players.push(p);
        return p;
      }),
    },
    KeepAwake: {
      activateKeepAwakeAsync: vi.fn(async (_tag?: string) => {}),
      deactivateKeepAwake: vi.fn(async (_tag?: string) => {}),
    },
  };
});
vi.mock('./modules', () => ({
  Audio: mocks.Audio,
  KeepAwake: mocks.KeepAwake,
  Location: {},
  TaskManager: {},
  Speech: {},
}));

import { KEEP_AWAKE_TAG, expoAudioSession, expoKeepAwake } from './device';
import { SILENT_AUDIO_DATA_URI } from './silence-audio';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.players.length = 0;
});

describe('expoAudioSession', () => {
  it('activate: đặt mode → kích hoạt session → phát vòng lặp im lặng → đăng ký làm phiên media đang phát (thứ tự bắt buộc)', async () => {
    const a = expoAudioSession();
    const order: string[] = [];
    mocks.Audio.setAudioModeAsync.mockImplementation(async () => {
      order.push('mode');
    });
    mocks.Audio.setIsAudioActiveAsync.mockImplementation(async (active: boolean) => {
      order.push(active ? 'active' : 'inactive');
    });
    await a.activate();
    expect(mocks.Audio.setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
    expect(mocks.Audio.setIsAudioActiveAsync).toHaveBeenCalledWith(true);
    expect(mocks.Audio.createAudioPlayer).toHaveBeenCalledWith(SILENT_AUDIO_DATA_URI, {
      keepAudioSessionActive: true,
    });
    const player = mocks.players[0];
    expect(player?.loop).toBe(true);
    expect(player?.play).toHaveBeenCalledTimes(1);
    // Android: MediaSessionService (foreground riêng, độc lập với foreground service định vị)
    // chỉ được hệ điều hành công nhận là "đang phát" qua bước này — thiếu nó, JS/TTS đứng yên
    // khi khoá màn hình dù foreground service định vị vẫn còn (thực địa Android thật 12/09/2026).
    expect(player?.setActiveForLockScreen).toHaveBeenCalledWith(true, { title: 'Đang dẫn đường' });
    expect(order).toEqual(['mode', 'active']); // setActive PHẢI sau setCategory, trước khi phát
  });

  it('activate hai lần liên tiếp không tạo player thứ hai (dùng lại, chỉ play() + setActiveForLockScreen lại)', async () => {
    const a = expoAudioSession();
    await a.activate();
    await a.activate();
    expect(mocks.Audio.createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mocks.players[0]?.play).toHaveBeenCalledTimes(2);
    expect(mocks.players[0]?.setActiveForLockScreen).toHaveBeenCalledTimes(2);
  });

  it('deactivate: gỡ đăng ký media, dừng + gỡ player, ngừng session, trả mode về mixWithOthers; lỗi ở bất kỳ bước nào đều nuốt', async () => {
    const a = expoAudioSession();
    await a.activate();
    const player = mocks.players[0];
    await a.deactivate();
    expect(player?.setActiveForLockScreen).toHaveBeenLastCalledWith(false);
    expect(player?.pause).toHaveBeenCalledTimes(1);
    expect(player?.remove).toHaveBeenCalledTimes(1);
    expect(mocks.Audio.setIsAudioActiveAsync).toHaveBeenLastCalledWith(false);
    expect(mocks.Audio.setAudioModeAsync).toHaveBeenLastCalledWith({
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    });
    // activate lại sau deactivate → tạo player mới (cái cũ đã remove())
    await a.deactivate(); // gọi thừa không có player → không ném lỗi
    mocks.Audio.setAudioModeAsync.mockRejectedValueOnce(new Error('x'));
    await expect(a.activate()).resolves.toBeUndefined();
    mocks.Audio.setIsAudioActiveAsync.mockRejectedValueOnce(new Error('x'));
    await expect(a.activate()).resolves.toBeUndefined();
    mocks.Audio.createAudioPlayer.mockImplementationOnce(() => {
      throw new Error('x');
    });
    await expect(a.activate()).resolves.toBeUndefined();
    mocks.Audio.setIsAudioActiveAsync.mockRejectedValueOnce(new Error('x'));
    await expect(a.deactivate()).resolves.toBeUndefined();
    mocks.players.at(-1)?.setActiveForLockScreen.mockImplementationOnce(() => {
      throw new Error('x');
    });
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
