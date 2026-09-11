import { decodePolyline6, encodePolyline6 } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import { mergeLegShapes, translateDirections, translateTrip } from '../src/routing/translate';
import type { ValhallaLeg, ValhallaRouteResponse, ValhallaTrip } from '../src/routing/valhalla';
import real from './fixtures/valhalla/q1-motorbike.json';
import fixture from './fixtures/valhalla/two-legs.json';

const json = fixture as unknown as ValhallaRouteResponse;

describe('mergeLegShapes', () => {
  it('bỏ điểm trùng giữa hai leg và ghi offset', () => {
    const merged = mergeLegShapes(json.trip.legs);
    expect(merged.coords).toEqual([
      [106.699, 10.7798],
      [106.6985, 10.778],
      [106.698, 10.776],
      [106.6975, 10.7745],
      [106.6981, 10.7725],
    ]);
    expect(merged.offsets).toEqual([0, 2]);
  });

  it('nối tuyến 200.000 điểm mà không vượt giới hạn đối số và giữ chỉ số global', () => {
    const firstCoords: [number, number][] = Array.from({ length: 200_000 }, (_, i) => [
      106 + i / 1_000_000,
      10,
    ]);
    const legs: ValhallaLeg[] = [
      {
        shape: encodePolyline6(firstCoords),
        summary: {
          time: 1,
          length: 200,
          min_lat: 10,
          min_lon: 106,
          max_lat: 10,
          max_lon: 106.199999,
        },
        maneuvers: [],
      },
      {
        shape: encodePolyline6([
          [106.199999, 10],
          [106.2, 10],
        ]),
        summary: {
          time: 1,
          length: 0.001,
          min_lat: 10,
          min_lon: 106.199999,
          max_lat: 10,
          max_lon: 106.2,
        },
        maneuvers: [
          {
            type: 8,
            instruction: 'Đi tiếp.',
            time: 1,
            length: 0.001,
            begin_shape_index: 0,
            end_shape_index: 1,
          },
        ],
      },
    ];
    const merged = mergeLegShapes(legs);

    expect(merged.coords).toHaveLength(200_001);
    expect(merged.coords[0]).toEqual([106, 10]);
    expect(merged.coords[199_999]).toEqual([106.199999, 10]);
    expect(merged.coords[200_000]).toEqual([106.2, 10]);
    expect(merged.offsets).toEqual([0, 199_999]);

    const trip: ValhallaTrip = {
      legs,
      locations: [],
      summary: {
        time: 2,
        length: 200.001,
        min_lat: 10,
        min_lon: 106,
        max_lat: 10,
        max_lon: 106.2,
      },
    };
    const route = translateTrip(trip, 'car', merged);
    expect(route.legs[1]).toMatchObject({ shape_offset: 199_999 });
    expect(route.legs[1]?.steps[0]).toMatchObject({
      shape_begin: 199_999,
      shape_end: 200_000,
      location: [106.199999, 10],
    });
  });
});

describe('translateDirections', () => {
  const out = translateDirections(json, 'motorbike', '2026-09-15');
  const route = out.routes[0];

  it('tuyến: mét/giây nguyên, bbox [minLng,minLat,maxLng,maxLat], flags, geometry nối', () => {
    expect(out.routes).toHaveLength(1);
    expect(route).toMatchObject({
      mode: 'motorbike',
      distance_m: 820,
      duration_s: 110,
      bbox: [106.6975, 10.7725, 106.699, 10.7798],
      flags: { toll: true, highway: false, ferry: false },
    });
    expect(decodePolyline6(route?.geometry ?? '')).toHaveLength(5);
    expect(route?.geometry).toBe('oh}pSonkojEnoBf^~{Bf^v|Af^~{Bod@');
  });

  it('leg và bước: offset, chỉ số shape đã dịch, kind, verbal, roundabout_exit, location', () => {
    const [leg0, leg1] = route?.legs ?? [];
    expect(leg0).toMatchObject({ distance_m: 450, duration_s: 75, shape_offset: 0 });
    expect(leg1).toMatchObject({ distance_m: 370, duration_s: 35, shape_offset: 2 });
    expect(leg0?.steps.map((s) => s.kind)).toEqual(['depart', 'turn_left', 'arrive']);
    expect(leg0?.steps[0]).toMatchObject({
      verbal_pre: 'Đi về hướng nam trên Đồng Khởi trong 200 mét.',
      verbal_post: 'Đi tiếp 200 mét.',
      street_names: ['Đồng Khởi'],
      distance_m: 200,
      duration_s: 30,
      shape_begin: 0,
      shape_end: 1,
      location: [106.699, 10.7798],
      roundabout_exit: null,
    });
    expect(leg0?.steps[1]).toMatchObject({ verbal_post: null, distance_m: 250, duration_s: 45 });
    expect(leg0?.steps[2]).toMatchObject({ street_names: [], shape_begin: 2, shape_end: 2 });
    expect(leg1?.steps[0]).toMatchObject({ kind: 'continue', shape_begin: 2, shape_end: 3 });
    expect(leg1?.steps[1]).toMatchObject({
      kind: 'roundabout_enter',
      roundabout_exit: 2,
      shape_begin: 3,
      shape_end: 4,
      location: [106.6975, 10.7745],
    });
    expect(leg1?.steps[2]).toMatchObject({ kind: 'arrive', location: [106.6981, 10.7725] });
  });

  it('waypoints: location gốc, snapped = đầu leg / cuối tuyến, name null', () => {
    expect(out.waypoints).toEqual([
      { location: [106.699, 10.7798], snapped: [106.699, 10.7798], name: null },
      { location: [106.698, 10.776], snapped: [106.698, 10.776], name: null },
      { location: [106.6981, 10.7725], snapped: [106.6981, 10.7725], name: null },
    ]);
  });

  it('verbal_alert: null khi Valhalla không trả, có thì giữ nguyên (spec B mục 6.1)', () => {
    expect(route?.legs[0]?.steps[0]?.verbal_alert).toBeNull();
    const realOut = translateDirections(real as unknown as ValhallaRouteResponse, 'motorbike', null);
    expect(realOut.routes[0]?.legs[0]?.steps[1]?.verbal_alert).toBe('Rẽ phải vào Nguyễn Du.');
    expect(realOut.routes[0]?.legs[0]?.steps[0]?.verbal_alert).toBeNull();
  });

  it('attribution và engine', () => {
    expect(out.attribution).toBe('© OpenStreetMap contributors');
    expect(out.engine).toEqual({ name: 'valhalla', graph: '2026-09-15' });
    expect(translateDirections(json, 'car', null).engine).toEqual({
      name: 'valhalla',
      graph: null,
    });
  });

  it('alternates → routes[1], cùng mode', () => {
    const withAlt = { ...json, alternates: [{ trip: json.trip }] };
    const alt = translateDirections(withAlt, 'car', null);
    expect(alt.routes).toHaveLength(2);
    expect(alt.routes[1]?.mode).toBe('car');
    expect(alt.routes[1]?.distance_m).toBe(820);
  });
});

describe('fixture Valhalla thật (Quận 1, capture bằng pnpm test:routing --capture)', () => {
  it('lang=vi (mặc định) áp bảng cụm từ; lang=en giữ nguyên chữ Valhalla', () => {
    const vi = translateDirections(real as unknown as ValhallaRouteResponse, 'motorbike', null);
    const steps = vi.routes[0]?.legs[0]?.steps ?? [];
    expect(steps.at(-1)?.instruction).toBe('Điểm đến ở bên trái.');
    expect(steps.at(-1)?.verbal_alert).toBe('Điểm đến ở bên trái.');
    expect(steps[0]?.instruction).toBe('Đi về hướng đông nam trên Công trường Công xã Paris.');
    expect(steps[0]?.verbal_pre).toBe(
      'Đi về hướng đông nam trên Công trường Công xã Paris. Rồi, trong 100 mét nữa, rẽ phải vào Nguyễn Du.',
    );
    const en = translateDirections(real as unknown as ValhallaRouteResponse, 'motorbike', null, 'en');
    expect(en.routes[0]?.legs[0]?.steps.at(-1)?.instruction).toBe('Điểm đến của bạn nằm ở trái.');
  });

  it('dịch được, chỉ số shape của bước cuối trỏ đúng điểm cuối polyline', () => {
    const out = translateDirections(real as unknown as ValhallaRouteResponse, 'motorbike', null);
    const route = out.routes[0];
    const coords = decodePolyline6(route?.geometry ?? '');
    const last = route?.legs.at(-1)?.steps.at(-1);
    expect(last?.kind).toBe('arrive');
    expect(last?.shape_end).toBe(coords.length - 1);
    expect(route?.distance_m).toBeGreaterThan(800);
    expect(route?.legs[0]?.steps[0]?.kind).toBe('depart');
    expect(out.waypoints[1]?.snapped).toEqual(coords.at(-1));
  });
});
