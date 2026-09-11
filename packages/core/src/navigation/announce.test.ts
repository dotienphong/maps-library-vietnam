import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/directions-q1.json';
import type { DirectionsResponse, Route, RouteStep } from '../types';
import {
  composeApproach,
  formatDistance,
  formatDistanceShort,
  lowerFirst,
  planAnnouncements,
  roundForSpeech,
} from './announce';
import { NAVIGATION_THRESHOLDS, type NavigationProgress } from './types';

const route = (fixture as unknown as DirectionsResponse).routes[0] as Route;
const steps = route.legs[0]?.steps ?? [];
const th = NAVIGATION_THRESHOLDS.motorbike;

describe('formatDistance', () => {
  it('tiếng Việt: mét dưới 1 km, ki-lô-mét một chữ số lẻ dưới 10 km, nguyên từ 10 km', () => {
    expect(formatDistance(9)).toBe('9 mét');
    expect(formatDistance(85.4)).toBe('85 mét');
    expect(formatDistance(850)).toBe('850 mét');
    expect(formatDistance(1230)).toBe('1,2 ki-lô-mét');
    expect(formatDistance(1000)).toBe('1,0 ki-lô-mét');
    expect(formatDistance(12_400)).toBe('12 ki-lô-mét');
  });
  it('tiếng Anh', () => {
    expect(formatDistance(85, 'en')).toBe('85 meters');
    expect(formatDistance(1230, 'en')).toBe('1.2 kilometers');
    expect(formatDistance(12_400, 'en')).toBe('12 kilometers');
  });
  it('bản ngắn cho UI', () => {
    expect(formatDistanceShort(85)).toBe('85 m');
    expect(formatDistanceShort(1230)).toBe('1,2 km');
    expect(formatDistanceShort(12_400)).toBe('12 km');
  });
});

describe('roundForSpeech / lowerFirst / composeApproach', () => {
  it('≥ 200 m tròn 50, dưới 200 m tròn 10, tối thiểu 10', () => {
    expect(roundForSpeech(194)).toBe(190);
    expect(roundForSpeech(226)).toBe(250);
    expect(roundForSpeech(3)).toBe(10);
    expect(roundForSpeech(1180)).toBe(1200);
  });
  it('lowerFirst hạ chữ đầu kể cả Đ', () => {
    expect(lowerFirst('Đi tiếp.')).toBe('đi tiếp.');
    expect(lowerFirst('Rẽ phải')).toBe('rẽ phải');
    expect(lowerFirst('')).toBe('');
  });
  it('composeApproach ưu tiên verbal_alert, rồi verbal_pre; không có cả hai → null', () => {
    const turn = steps[1] as RouteStep;
    expect(composeApproach(194, turn, 'vi')).toBe('Trong 190 mét nữa, rẽ phải vào Nguyễn Du.');
    expect(composeApproach(194, turn, 'en')).toBe('In 190 meters, rẽ phải vào Nguyễn Du.');
    const noAlert: RouteStep = { ...turn, verbal_alert: null, verbal_pre: 'Rẽ phải.' };
    expect(composeApproach(400, noAlert, 'vi')).toBe('Trong 400 mét nữa, rẽ phải.');
    expect(composeApproach(400, { ...noAlert, verbal_pre: null }, 'vi')).toBeNull();
  });
});

describe('planAnnouncements', () => {
  const progress = (stepIndex: number, distanceToStep_m: number): NavigationProgress => ({
    status: 'navigating',
    route,
    routeIndex: 0,
    legIndex: 0,
    stepIndex,
    step: steps[stepIndex] as RouteStep,
    nextStep: steps[stepIndex + 1] ?? null,
    snapped: [0, 0],
    bearing: 0,
    shapeIndex: 0,
    traveled_m: 0,
    remaining_m: 0,
    remaining_s: 0,
    distanceToStep_m,
    offRoute_m: 0,
    fix: { lng: 0, lat: 0, timestamp: 0 },
  });

  it('step depart: đọc verbal_pre khởi hành một lần, không đọc post; step kế 140 m không có approach', () => {
    const announced = new Set<string>();
    const first = planAnnouncements(progress(0, 138), th, 'vi', announced, true);
    expect(first.map((a) => a.kind)).toEqual(['depart']);
    expect(first[0]?.priority).toBe(3);
    expect(first[0]?.text).toBe(steps[0]?.verbal_pre);
    // Fix kế: không lặp depart; D = 120 ≤ approach 200 nhưng step 0 chỉ 140 m → không approach.
    expect(planAnnouncements(progress(0, 120), th, 'vi', announced, false)).toEqual([]);
    // D = 45 ≤ pre 50 → câu rẽ của step 1
    const pre = planAnnouncements(progress(0, 45), th, 'vi', announced, false);
    expect(pre).toEqual([
      { text: 'Rẽ phải vào Nguyễn Du.', kind: 'pre', stepIndex: 1, priority: 3 },
    ]);
    expect(planAnnouncements(progress(0, 40), th, 'vi', announced, false)).toEqual([]);
  });

  it('vào step dài 294 m: post lúc đổi step, approach ở ≤ 200 m, pre ở ≤ 50 m; mỗi câu một lần', () => {
    const announced = new Set<string>();
    const enter = planAnnouncements(progress(1, 290), th, 'vi', announced, true);
    expect(enter).toEqual([
      { text: 'Tiếp tục đi thêm 300 mét.', kind: 'post', stepIndex: 1, priority: 1 },
    ]);
    const approach = planAnnouncements(progress(1, 194), th, 'vi', announced, false);
    expect(approach).toEqual([
      {
        text: 'Trong 190 mét nữa, rẽ trái vào Nam Kỳ Khởi Nghĩa.',
        kind: 'approach',
        stepIndex: 2,
        priority: 2,
      },
    ]);
    expect(planAnnouncements(progress(1, 150), th, 'vi', announced, false)).toEqual([]);
    const pre = planAnnouncements(progress(1, 30), th, 'vi', announced, false);
    expect(pre.map((a) => a.kind)).toEqual(['pre']);
  });

  it('step kế là arrive → kind arrive với câu đã vá', () => {
    const announced = new Set<string>();
    const out = planAnnouncements(progress(4, 20), th, 'vi', announced, true);
    expect(out.map((a) => a.kind)).toEqual(['arrive']);
    expect(out[0]?.text).toBe('Điểm đến ở bên trái.');
  });

  it('step cuối (arrive) không còn nextStep → không đọc gì thêm', () => {
    expect(planAnnouncements(progress(5, 0), th, 'vi', new Set(), true)).toEqual([]);
  });
});
