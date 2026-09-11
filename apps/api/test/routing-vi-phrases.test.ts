import { describe, expect, it } from 'vitest';
import provinces from '../../../packages/core/src/provinces.json';
import addresses from '../../../packages/core/tests/fixtures/addresses.jsonl?raw';
import type { ValhallaRouteResponse } from '../src/routing/valhalla';
import { VI_PHRASE_RULES, applyViPhrases } from '../src/routing/vi-phrases';
import q1 from './fixtures/valhalla/q1-motorbike.json';
import twoLegs from './fixtures/valhalla/two-legs.json';

/** [câu Valhalla, câu mong đợi] — bảng spec B mục 6.2, PHONG duyệt trước khi deploy. */
const CASES: [string, string][] = [
  ['Điểm đến của bạn nằm ở trái.', 'Điểm đến ở bên trái.'],
  ['Điểm đến của bạn nằm ở phải.', 'Điểm đến ở bên phải.'],
  ['Địa điểm của bạn sẽ nằm ở trái.', 'Điểm đến ở bên trái.'],
  ['Rẽ trái hình chữ U vào Lê Lợi.', 'Quay đầu bên trái vào Lê Lợi.'],
  ['Rẽ phải hình chữ U.', 'Quay đầu bên phải.'],
  ['Sáp nhập.', 'Nhập làn.'],
  ['Sáp nhập trái vào Xa lộ Hà Nội.', 'Nhập làn bên trái vào Xa lộ Hà Nội.'],
  ['Sáp nhập vào Xa lộ Hà Nội.', 'Nhập vào Xa lộ Hà Nội.'],
  ['Sáp nhập về hướng Biên Hòa.', 'Nhập làn về hướng Biên Hòa.'],
  ['Đi vào đoạn đường nối phía phải.', 'Đi vào đường nhánh phía phải.'],
  ['Rẽ trái để đi vào đoạn đường nối.', 'Rẽ trái để đi vào đường nhánh.'],
  ['Rẽ ra ngoài tại đoạn rẽ phải.', 'Ra ở lối ra bên phải.'],
  ['Rẽ ra ngoài tại đoạn rẽ QL1 phía trái.', 'Ra ở lối ra QL1 phía trái.'],
  ['Rẽ vào đoạn rẽ 12 phía trái.', 'Vào lối ra 12 phía trái.'],
  ['Giữ trái tại điểm giao.', 'Giữ bên trái tại điểm giao.'],
  [
    'Giữ phải để rẽ ra ngoài tại đoạn rẽ 3 vào Võ Nguyên Giáp.',
    'Giữ bên phải để rẽ ra ngoài tại lối ra 3 vào Võ Nguyên Giáp.',
  ],
  [
    'Lái về phía đông nam trên Công trường Công xã Paris.',
    'Đi về hướng đông nam trên Công trường Công xã Paris.',
  ],
  [
    'Lái về phía đông nam trên Công trường Công xã Paris. Rồi, trong 100 mét nữa, Rẽ phải vào Nguyễn Du.',
    'Đi về hướng đông nam trên Công trường Công xã Paris. Rồi, trong 100 mét nữa, rẽ phải vào Nguyễn Du.',
  ],
  [
    'Rẽ trái vào Lê Lợi. Rồi Rẽ phải vào Nguyễn Huệ.',
    'Rẽ trái vào Lê Lợi. Rồi rẽ phải vào Nguyễn Huệ.',
  ],
  // Giữ nguyên
  ['Rẽ trái vào Lê Lợi.', 'Rẽ trái vào Lê Lợi.'],
  ['Bạn đã đến điểm dừng.', 'Bạn đã đến điểm dừng.'],
  ['Bạn đã tới nơi.', 'Bạn đã tới nơi.'],
  ['Vào vòng xuyến và đi lối ra thứ 2.', 'Vào vòng xuyến và đi lối ra thứ 2.'],
  ['Tiếp tục đi thêm 300 mét.', 'Tiếp tục đi thêm 300 mét.'],
  ['Đi tiếp trên Lê Lợi.', 'Đi tiếp trên Lê Lợi.'],
];

const streetNames = (json: ValhallaRouteResponse): string[] =>
  json.trip.legs.flatMap((leg) => leg.maneuvers.flatMap((m) => m.street_names ?? []));

describe('applyViPhrases', () => {
  for (const [input, expected] of CASES) {
    it(`"${input}" → "${expected}"`, () => {
      expect(applyViPhrases(input)).toBe(expected);
    });
  }

  it('mọi luật có cờ u và ghi chú câu mẫu; bảng không quá 30 luật (spec B 1.5: vượt thì cân nhắc tự sinh câu)', () => {
    expect(VI_PHRASE_RULES.length).toBeLessThanOrEqual(30);
    for (const rule of VI_PHRASE_RULES) {
      expect(rule.pattern.flags).toContain('u');
      expect(rule.note.length).toBeGreaterThan(0);
    }
  });

  it('không luật nào đụng tên đường trong fixture, 341 địa chỉ thật và 34 tỉnh + alias', () => {
    const corpus = [
      ...streetNames(q1 as unknown as ValhallaRouteResponse),
      ...streetNames(twoLegs as unknown as ValhallaRouteResponse),
      ...addresses
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { input: string }).input),
      ...Object.keys(provinces),
      ...Object.values(provinces as Record<string, string[]>).flat(),
    ];
    expect(corpus.length).toBeGreaterThan(400);
    for (const text of corpus) {
      expect(applyViPhrases(text), text).toBe(text);
      // Tên đường đứng sau "vào " trong câu rẽ cũng không được đổi.
      expect(applyViPhrases(`Rẽ trái vào ${text}.`)).toBe(`Rẽ trái vào ${text}.`);
    }
  });
});
