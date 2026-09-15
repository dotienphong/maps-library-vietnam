import { describe, expect, it } from 'vitest';
import { MANEUVER_KINDS, maneuverKindFromValhalla, VALHALLA_MANEUVER_KIND } from './maneuver';

describe('maneuver', () => {
  it('ánh xạ đủ các mã Valhalla dùng cho đường bộ (spec A mục 5.2)', () => {
    expect(maneuverKindFromValhalla(1)).toBe('depart');
    expect(maneuverKindFromValhalla(3)).toBe('depart');
    expect(maneuverKindFromValhalla(5)).toBe('arrive');
    expect(maneuverKindFromValhalla(8)).toBe('continue');
    expect(maneuverKindFromValhalla(22)).toBe('continue');
    expect(maneuverKindFromValhalla(10)).toBe('turn_right');
    expect(maneuverKindFromValhalla(15)).toBe('turn_left');
    expect(maneuverKindFromValhalla(12)).toBe('uturn_right');
    expect(maneuverKindFromValhalla(26)).toBe('roundabout_enter');
    expect(maneuverKindFromValhalla(27)).toBe('roundabout_exit');
    expect(maneuverKindFromValhalla(37)).toBe('merge_right');
    expect(maneuverKindFromValhalla(43)).toBe('building_exit');
  });

  it('mã transit (30–36), 0 và mã lạ → other', () => {
    for (const code of [0, 30, 31, 32, 33, 34, 35, 36, 99, -1]) {
      expect(maneuverKindFromValhalla(code)).toBe('other');
    }
  });

  it('mọi giá trị trong bảng đều nằm trong MANEUVER_KINDS và bảng phủ 1–29 + 37–43', () => {
    for (const kind of Object.values(VALHALLA_MANEUVER_KIND)) {
      expect(MANEUVER_KINDS).toContain(kind);
    }
    const expected = [...Array.from({ length: 29 }, (_, i) => i + 1), 37, 38, 39, 40, 41, 42, 43];
    expect(
      Object.keys(VALHALLA_MANEUVER_KIND)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(expected);
    expect(MANEUVER_KINDS).toContain('other');
  });
});
