import type { GeoFix, PositionError } from '@mapslibvn/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundUnavailable } from '../navigation/session';

const mocks = vi.hoisted(() => ({
  Location: {
    requestForegroundPermissionsAsync: vi.fn(async () => ({ granted: true, status: 'granted' })),
    watchPositionAsync: vi.fn(
      async (_options: Record<string, unknown>, _cb?: unknown, _err?: unknown) => ({
        remove: vi.fn(),
      }),
    ),
    startLocationUpdatesAsync: vi.fn(
      async (_task: string, _options?: Record<string, unknown>) => {},
    ),
    stopLocationUpdatesAsync: vi.fn(async () => {}),
    hasStartedLocationUpdatesAsync: vi.fn(async () => false),
    isBackgroundLocationAvailableAsync: vi.fn(async () => true),
  },
  TaskManager: {
    defineTask: vi.fn(),
    isTaskDefined: vi.fn(() => false),
  },
}));
vi.mock('./modules', () => ({
  Location: mocks.Location,
  TaskManager: mocks.TaskManager,
  Speech: {},
  Audio: {},
  KeepAwake: {},
}));

import {
  __resetNavigationTaskForTests,
  defineNavigationTask,
  expoLocationSource,
  NAVIGATION_TASK,
  toGeoFix,
} from './location-source';

type Executor = (body: {
  data: { locations?: unknown[] } | null;
  error: { code: string; message: string } | null;
  executionInfo: { eventId: string; taskName: string };
}) => unknown;
const executor = (): Executor => {
  const call = mocks.TaskManager.defineTask.mock.calls[0];
  if (!call) throw new Error('defineTask chưa được gọi');
  return call[1] as Executor;
};
const location = (
  over: Partial<{
    latitude: number;
    longitude: number;
    accuracy: number | null;
    heading: number | null;
    speed: number | null;
  }> = {},
  timestamp = 1_700_000_000_000,
) => ({
  coords: { latitude: 10.7798, longitude: 106.699, accuracy: 12, heading: 90, speed: 3.5, ...over },
  timestamp,
});
const info = { eventId: 'e1', taskName: NAVIGATION_TASK };

/** Đợi các await bên trong subscribe() chạy xong. */
const flush = () =>
  vi.waitFor(() => expect(mocks.Location.requestForegroundPermissionsAsync).toHaveBeenCalled());

beforeEach(() => {
  vi.clearAllMocks();
  __resetNavigationTaskForTests();
  mocks.TaskManager.isTaskDefined.mockReturnValue(false);
  mocks.Location.requestForegroundPermissionsAsync.mockResolvedValue({
    granted: true,
    status: 'granted',
  });
  mocks.Location.isBackgroundLocationAvailableAsync.mockResolvedValue(true);
  mocks.Location.startLocationUpdatesAsync.mockResolvedValue(undefined);
  mocks.Location.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
});

describe('toGeoFix', () => {
  it('ánh xạ trường; heading/speed âm (iOS không có) → null; accuracy null → bỏ; timestamp hỏng → Date.now()', () => {
    expect(toGeoFix(location())).toEqual({
      lng: 106.699,
      lat: 10.7798,
      accuracy_m: 12,
      heading: 90,
      speed_mps: 3.5,
      timestamp: 1_700_000_000_000,
    });
    const fix = toGeoFix(location({ accuracy: null, heading: -1, speed: -1 }, Number.NaN));
    expect(fix.heading).toBeNull();
    expect(fix.speed_mps).toBeNull();
    expect('accuracy_m' in fix).toBe(false);
    expect(fix.timestamp).toBeGreaterThan(1_700_000_000_000);
  });
});

describe('defineNavigationTask', () => {
  it('define đúng một lần dù gọi hai lần; dừng task cũ còn sót', async () => {
    mocks.Location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    defineNavigationTask();
    defineNavigationTask();
    expect(mocks.TaskManager.defineTask).toHaveBeenCalledTimes(1);
    expect(mocks.TaskManager.defineTask.mock.calls[0]?.[0]).toBe(NAVIGATION_TASK);
    await vi.waitFor(() =>
      expect(mocks.Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(NAVIGATION_TASK),
    );
  });

  it('executor chạy khi không ai nghe (app bị đánh thức lại) → tự dừng task', async () => {
    defineNavigationTask();
    executor()({ data: { locations: [location()] }, error: null, executionInfo: info });
    await vi.waitFor(() =>
      expect(mocks.Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1),
    );
  });
});

describe('expoLocationSource — đường nền', () => {
  it('quyền → startLocationUpdatesAsync đúng options theo mode; executor đẩy fix theo thứ tự; unsubscribe dừng task', async () => {
    defineNavigationTask();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    const source = expoLocationSource({ notification: { title: 'Demo', color: '#2458a6' } });
    source.setMode?.('walk');
    const fixes: GeoFix[] = [];
    const bg = vi.fn();
    source.onBackgroundUnavailable?.(bg);
    const stop = source.subscribe((f) => fixes.push(f));
    await vi.waitFor(() =>
      expect(mocks.Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1),
    );
    expect(mocks.Location.startLocationUpdatesAsync).toHaveBeenCalledWith(NAVIGATION_TASK, {
      accuracy: 6,
      timeInterval: 1000,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      activityType: 3,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Demo',
        notificationBody: 'Chạm để mở ứng dụng',
        notificationColor: '#2458a6',
        killServiceOnDestroy: true,
      },
    });
    expect(mocks.Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(bg).not.toHaveBeenCalled();
    executor()({
      data: { locations: [location({}, 1), location({}, 2)] },
      error: null,
      executionInfo: info,
    });
    expect(fixes.map((f) => f.timestamp)).toEqual([1, 2]);
    stop();
    expect(mocks.Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(NAVIGATION_TASK);
    executor()({ data: { locations: [location({}, 3)] }, error: null, executionInfo: info });
    expect(fixes).toHaveLength(2);
  });

  /**
   * `fixListeners` là Set cấp module, còn task nền là tài nguyên hệ điều hành DÙNG CHUNG cho mọi
   * nguồn trong app. Hai `<MapsLibVNMap>` cùng lúc, hoặc một map mount đè lên map cũ chưa kịp gỡ,
   * là có hai người nghe: người rời trước không được phép tắt GPS nền của người còn lại.
   */
  it('còn người nghe khác thì unsubscribe KHÔNG dừng task nền', async () => {
    defineNavigationTask();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    const a = expoLocationSource();
    const b = expoLocationSource();
    const fixesA: GeoFix[] = [];
    const fixesB: GeoFix[] = [];
    const stopA = a.subscribe((f) => fixesA.push(f));
    const stopB = b.subscribe((f) => fixesB.push(f));
    await vi.waitFor(() =>
      expect(mocks.Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(2),
    );

    stopA();
    expect(mocks.Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    executor()({ data: { locations: [location({}, 7)] }, error: null, executionInfo: info });
    expect(fixesA).toHaveLength(0);
    expect(fixesB.map((f) => f.timestamp)).toEqual([7]);

    stopB();
    expect(mocks.Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(NAVIGATION_TASK);
  });

  it('mode mặc định motorbike → activityType 2; executor báo error → positionError unavailable', async () => {
    defineNavigationTask();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    const errors: PositionError[] = [];
    expoLocationSource().subscribe(
      () => {},
      (e) => errors.push(e),
    );
    await vi.waitFor(() =>
      expect(mocks.Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1),
    );
    expect(mocks.Location.startLocationUpdatesAsync.mock.calls[0]?.[1]).toMatchObject({
      activityType: 2,
    });
    executor()({
      data: null,
      error: { code: 'E_LOCATION', message: 'GPS tắt' },
      executionInfo: info,
    });
    expect(errors).toEqual([
      {
        code: 'unavailable',
        message: 'GPS tắt',
        raw: { code: 'E_LOCATION', message: 'GPS tắt' },
      },
    ]);
  });
});

describe('expoLocationSource — rơi về tiền cảnh', () => {
  const runFallback = async (): Promise<BackgroundUnavailable | undefined> => {
    const bg = vi.fn();
    const source = expoLocationSource();
    source.onBackgroundUnavailable?.(bg);
    source.subscribe(() => {});
    await vi.waitFor(() => expect(mocks.Location.watchPositionAsync).toHaveBeenCalledTimes(1));
    return bg.mock.calls[0]?.[0] as BackgroundUnavailable | undefined;
  };

  it('task chưa define → task_not_defined', async () => {
    expect(await runFallback()).toMatchObject({ reason: 'task_not_defined' });
    expect(mocks.Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(mocks.Location.watchPositionAsync.mock.calls[0]?.[0]).toEqual({
      accuracy: 6,
      timeInterval: 1000,
      distanceInterval: 0,
    });
  });

  it('isBackgroundLocationAvailableAsync false → not_configured, không gọi start', async () => {
    defineNavigationTask();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    mocks.Location.isBackgroundLocationAvailableAsync.mockResolvedValue(false);
    expect(await runFallback()).toMatchObject({ reason: 'not_configured' });
    expect(mocks.Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('start ném: UIBackgroundModes → not_configured; Not authorized → permission; khác → unsupported', async () => {
    defineNavigationTask();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    mocks.Location.startLocationUpdatesAsync.mockRejectedValueOnce(
      new Error(
        "Background location has not been configured, make sure to add 'location' to 'UIBackgroundModes' in the Info.plist file",
      ),
    );
    expect(await runFallback()).toMatchObject({ reason: 'not_configured' });
    vi.clearAllMocks();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    mocks.Location.startLocationUpdatesAsync.mockRejectedValueOnce(
      new Error('Not authorized to use background location services'),
    );
    expect(await runFallback()).toMatchObject({ reason: 'permission' });
    vi.clearAllMocks();
    mocks.TaskManager.isTaskDefined.mockReturnValue(true);
    mocks.Location.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('boom'));
    expect(await runFallback()).toMatchObject({ reason: 'unsupported', message: 'boom' });
  });

  it('background:false → thẳng watchPositionAsync, không báo backgroundUnavailable; unsubscribe remove()', async () => {
    const remove = vi.fn();
    mocks.Location.watchPositionAsync.mockResolvedValue({ remove });
    const bg = vi.fn();
    const source = expoLocationSource({
      background: false,
      accuracy: 'high',
      timeInterval_ms: 500,
    });
    source.onBackgroundUnavailable?.(bg);
    const stop = source.subscribe(() => {});
    await vi.waitFor(() => expect(mocks.Location.watchPositionAsync).toHaveBeenCalledTimes(1));
    expect(mocks.Location.watchPositionAsync.mock.calls[0]?.[0]).toEqual({
      accuracy: 4,
      timeInterval: 500,
      distanceInterval: 0,
    });
    expect(bg).not.toHaveBeenCalled();
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('expoLocationSource — quyền và huỷ sớm', () => {
  it('từ chối quyền → positionError denied, không start/watch', async () => {
    mocks.Location.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      status: 'denied',
    });
    const errors: PositionError[] = [];
    expoLocationSource().subscribe(
      () => {},
      (e) => errors.push(e),
    );
    await flush();
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]?.code).toBe('denied');
    expect(mocks.Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(mocks.Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('unsubscribe trước khi quyền trả về → không đăng ký gì', async () => {
    const gate: { grant: ((v: { granted: boolean; status: string }) => void) | null } = {
      grant: null,
    };
    mocks.Location.requestForegroundPermissionsAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.grant = resolve;
        }),
    );
    const stop = expoLocationSource({ background: false }).subscribe(() => {});
    stop();
    gate.grant?.({ granted: true, status: 'granted' });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.Location.watchPositionAsync).not.toHaveBeenCalled();
  });
});
