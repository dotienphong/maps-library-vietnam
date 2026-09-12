import type { HeadingFix } from '@mapslibvn/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  Location: {
    requestForegroundPermissionsAsync: vi.fn(async () => ({ granted: true, status: 'granted' })),
    watchHeadingAsync: vi.fn(async (_cb: unknown, _err?: unknown) => ({ remove: vi.fn() })),
  },
  Gyroscope: {
    isAvailableAsync: vi.fn(async () => true),
    setUpdateInterval: vi.fn(),
    addListener: vi.fn((_cb: unknown) => ({ remove: vi.fn() })),
  },
  Accelerometer: {
    isAvailableAsync: vi.fn(async () => true),
    setUpdateInterval: vi.fn(),
    addListener: vi.fn((_cb: unknown) => ({ remove: vi.fn() })),
  },
}));
vi.mock('./modules', () => ({
  Location: mocks.Location,
  Sensors: { Gyroscope: mocks.Gyroscope, Accelerometer: mocks.Accelerometer },
  TaskManager: {},
  Speech: {},
  Audio: {},
  KeepAwake: {},
}));
vi.mock('react-native', () => import('../test/react-native-mock'));

import { Platform } from 'react-native';
import { setAppState } from '../test/react-native-mock';
import {
  __resetHeadingSourceForTests,
  expoHeadingSource,
  toAccuracy,
  toCompassSample,
} from './heading-source';

type HeadingCb = (h: { trueHeading: number; magHeading: number; accuracy: number }) => void;
type GyroCb = (m: { x: number; y: number; z: number; timestamp: number }) => void;
const headingCb = (i = 0): HeadingCb =>
  mocks.Location.watchHeadingAsync.mock.calls[i]?.[0] as HeadingCb;
const gyroCb = (i = 0): GyroCb => mocks.Gyroscope.addListener.mock.calls[i]?.[0] as GyroCb;
const accelCb = (i = 0): GyroCb => mocks.Accelerometer.addListener.mock.calls[i]?.[0] as GyroCb;
const started = () => vi.waitFor(() => expect(mocks.Location.watchHeadingAsync).toHaveBeenCalled());
const gyroStarted = () =>
  vi.waitFor(() => expect(mocks.Gyroscope.addListener).toHaveBeenCalledTimes(1));
const accelStarted = () =>
  vi.waitFor(() => expect(mocks.Accelerometer.addListener).toHaveBeenCalledTimes(1));

beforeEach(() => {
  __resetHeadingSourceForTests();
  mocks.Location.requestForegroundPermissionsAsync
    .mockReset()
    .mockResolvedValue({ granted: true, status: 'granted' });
  mocks.Location.watchHeadingAsync
    .mockReset()
    .mockImplementation(async () => ({ remove: vi.fn() }));
  mocks.Gyroscope.isAvailableAsync.mockReset().mockResolvedValue(true);
  mocks.Gyroscope.setUpdateInterval.mockReset();
  mocks.Gyroscope.addListener.mockReset().mockImplementation(() => ({ remove: vi.fn() }));
  mocks.Accelerometer.isAvailableAsync.mockReset().mockResolvedValue(true);
  mocks.Accelerometer.setUpdateInterval.mockReset();
  mocks.Accelerometer.addListener.mockReset().mockImplementation(() => ({ remove: vi.fn() }));
  Platform.OS = 'ios';
  setAppState('active');
});

describe('toAccuracy / toCompassSample', () => {
  it('thang 0–3 → mức; trueHeading âm → dùng hướng từ; cả hai hỏng → null', () => {
    expect([0, 1, 2, 3, 7, -1, Number.NaN].map(toAccuracy)).toEqual([
      'unreliable',
      'low',
      'medium',
      'high',
      'high',
      'unreliable',
      'unreliable',
    ]);
    expect(toCompassSample({ trueHeading: 10, magHeading: 12, accuracy: 3 }, 5)).toEqual({
      heading: 10,
      magnetic: 12,
      accuracy: 'high',
      timestamp: 5,
    });
    expect(toCompassSample({ trueHeading: -1, magHeading: 12, accuracy: 2 }, 5)).toEqual({
      heading: 12,
      magnetic: 12,
      accuracy: 'medium',
      timestamp: 5,
    });
    expect(toCompassSample({ trueHeading: -1, magHeading: Number.NaN, accuracy: 0 }, 5)).toBeNull();
  });
});

describe('expoHeadingSource', () => {
  it('từ chối quyền → denied, không watchHeadingAsync', async () => {
    mocks.Location.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      status: 'denied',
    });
    const onError = vi.fn();
    expoHeadingSource().subscribe(vi.fn(), onError);
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'denied' })),
    );
    expect(mocks.Location.watchHeadingAsync).not.toHaveBeenCalled();
  });

  it('hai người nghe → MỘT đăng ký la bàn + một gyro; mẫu tới cả hai; rời hết → remove cả hai', async () => {
    const removeHeading = vi.fn();
    const removeGyro = vi.fn();
    const removeAccel = vi.fn();
    mocks.Location.watchHeadingAsync.mockResolvedValue({ remove: removeHeading });
    mocks.Gyroscope.addListener.mockReturnValue({ remove: removeGyro });
    mocks.Accelerometer.addListener.mockReturnValue({ remove: removeAccel });
    const a: HeadingFix[] = [];
    const b: HeadingFix[] = [];
    const offA = expoHeadingSource().subscribe((h) => a.push(h));
    const offB = expoHeadingSource({ gyro: false }).subscribe((h) => b.push(h));
    await started();
    await gyroStarted();
    await accelStarted();
    expect(mocks.Location.watchHeadingAsync).toHaveBeenCalledTimes(1);
    expect(mocks.Gyroscope.setUpdateInterval).toHaveBeenCalledWith(50);
    expect(mocks.Accelerometer.setUpdateInterval).toHaveBeenCalledWith(50);
    headingCb()({ trueHeading: 45, magHeading: 46, accuracy: 3 });
    expect(a.map((h) => h.heading)).toEqual([45]);
    expect(b.map((h) => h.heading)).toEqual([45]);
    offA(); // người dùng gyro cuối rời → gỡ gyro + gia tốc kế, giữ la bàn cho B
    expect(removeGyro).toHaveBeenCalledTimes(1);
    expect(removeAccel).toHaveBeenCalledTimes(1);
    expect(removeHeading).not.toHaveBeenCalled();
    offB();
    expect(removeHeading).toHaveBeenCalledTimes(1);
  });

  const NO_PULL = { minInterval_ms: 0, minDelta_deg: 0, tau_s: Number.POSITIVE_INFINITY } as const;

  it('gyro góp vào: hai mẫu gyro sau la bàn → fix fused (máy nằm ngang, chưa có gia tốc kế → trục z)', async () => {
    const got: HeadingFix[] = [];
    expoHeadingSource(NO_PULL).subscribe((h) => got.push(h));
    await started();
    await gyroStarted();
    headingCb()({ trueHeading: 180, magHeading: 180, accuracy: 3 });
    gyroCb()({ x: 0, y: 0, z: Math.PI / 2, timestamp: 10 }); // 90°/s, đồng hồ cảm biến (giây)
    gyroCb()({ x: 0, y: 0, z: Math.PI / 2, timestamp: 11 }); // 1 s sau
    expect(got.at(-1)?.heading).toBeCloseTo(90, 3);
    expect(got.at(-1)?.source).toBe('fused');
  });

  it('máy dựng đứng (iOS: gia tốc kế báo trọng lực, lên = −a): xoay quanh trục y vẫn đổi hướng', async () => {
    const got: HeadingFix[] = [];
    expoHeadingSource(NO_PULL).subscribe((h) => got.push(h));
    await started();
    await gyroStarted();
    await accelStarted();
    headingCb()({ trueHeading: 180, magHeading: 180, accuracy: 3 });
    for (let i = 0; i < 40; i++) accelCb()({ x: 0, y: -1, z: 0, timestamp: i }); // đỉnh máy hướng lên
    gyroCb()({ x: 0, y: Math.PI / 2, z: 0, timestamp: 10 });
    gyroCb()({ x: 0, y: Math.PI / 2, z: 0, timestamp: 11 });
    expect(got.at(-1)?.heading).toBeCloseTo(90, 1); // bản cũ chỉ lấy z → đứng nguyên 180
  });

  it('Android: gia tốc kế báo phản lực (lên = +a) → cùng kết quả; tiltCompensation false → chỉ trục z', async () => {
    Platform.OS = 'android';
    const got: HeadingFix[] = [];
    expoHeadingSource(NO_PULL).subscribe((h) => got.push(h));
    await started();
    await gyroStarted();
    await accelStarted();
    headingCb()({ trueHeading: 180, magHeading: 180, accuracy: 3 });
    for (let i = 0; i < 40; i++) accelCb()({ x: 0, y: 1, z: 0, timestamp: i });
    gyroCb()({ x: 0, y: Math.PI / 2, z: 0, timestamp: 10 });
    gyroCb()({ x: 0, y: Math.PI / 2, z: 0, timestamp: 11 });
    expect(got.at(-1)?.heading).toBeCloseTo(90, 1);

    __resetHeadingSourceForTests();
    mocks.Gyroscope.addListener.mockClear();
    mocks.Accelerometer.addListener.mockClear();
    const raw: HeadingFix[] = [];
    expoHeadingSource({ ...NO_PULL, tiltCompensation: false }).subscribe((h) => raw.push(h));
    await started();
    await gyroStarted();
    await accelStarted();
    headingCb()({ trueHeading: 180, magHeading: 180, accuracy: 3 });
    for (let i = 0; i < 40; i++) accelCb()({ x: 0, y: 1, z: 0, timestamp: i });
    gyroCb()({ x: 0, y: Math.PI / 2, z: 0, timestamp: 10 });
    gyroCb()({ x: 0, y: Math.PI / 2, z: 0, timestamp: 11 });
    expect(raw.at(-1)?.heading).toBe(180);
  });

  it('máy không có gyro → chỉ la bàn; watchHeadingAsync reject → unavailable một lần', async () => {
    mocks.Gyroscope.isAvailableAsync.mockResolvedValue(false);
    const got: HeadingFix[] = [];
    expoHeadingSource().subscribe((h) => got.push(h));
    await started();
    await vi.waitFor(() => expect(mocks.Gyroscope.isAvailableAsync).toHaveBeenCalled());
    expect(mocks.Gyroscope.addListener).not.toHaveBeenCalled();
    headingCb()({ trueHeading: 10, magHeading: 10, accuracy: 3 });
    expect(got).toHaveLength(1);

    __resetHeadingSourceForTests();
    mocks.Location.watchHeadingAsync.mockRejectedValue(new Error('Heading unavailable'));
    const onError = vi.fn();
    expoHeadingSource().subscribe(vi.fn(), onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 'unavailable' });
  });

  it('app vào nền → gỡ cảm biến; active lại → đăng ký lại', async () => {
    const remove = vi.fn();
    mocks.Location.watchHeadingAsync.mockResolvedValue({ remove });
    expoHeadingSource({ gyro: false }).subscribe(vi.fn());
    await started();
    setAppState('background');
    expect(remove).toHaveBeenCalledTimes(1);
    setAppState('active');
    await vi.waitFor(() => expect(mocks.Location.watchHeadingAsync).toHaveBeenCalledTimes(2));
  });
});
