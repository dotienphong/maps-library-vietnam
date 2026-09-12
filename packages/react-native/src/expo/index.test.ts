import { describe, expect, it, vi } from 'vitest';

vi.mock('./modules', () => ({
  Location: {},
  TaskManager: {},
  Speech: {},
  Audio: {},
  KeepAwake: {},
  Sensors: { Gyroscope: {} },
}));
vi.mock('react-native', () => import('../test/react-native-mock'));

import { expoNavigation } from './index';

describe('expoNavigation', () => {
  it('mặc định kèm nguồn hướng; heading: false thì không có khoá heading', () => {
    const on = expoNavigation();
    expect(typeof on.heading?.subscribe).toBe('function');
    expect(typeof on.source.subscribe).toBe('function');
    const off = expoNavigation({ heading: false });
    expect('heading' in off).toBe(false);
    expect(typeof off.speech.speak).toBe('function');
  });
});
