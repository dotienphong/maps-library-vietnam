import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attributionHtml, FIRST_SYMBOL_LAYER_ID } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import { addPoiLayers } from './poi-layers.mjs';
import { transformStyle } from './transform.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const readJson = (path: string) => JSON.parse(readFileSync(resolve(here, path), 'utf8'));
const sovereignty = readJson('sovereignty.geojson');

// Spec C mục 4: RN chèn tuyến trước lớp này (không có getStyle() ở native). Style đổi thứ tự lớp
// thì test này đỏ, thay vì tuyến lặng lẽ đè lên nhãn đường trên máy người dùng.
describe('FIRST_SYMBOL_LAYER_ID của core khớp style dựng thật', () => {
  const themes = [
    ['base/osm-liberty.json', 'light'],
    ['base/dark-matter.json', 'dark'],
  ] as const;
  for (const [base, theme] of themes) {
    it(`${theme}: lớp symbol đầu tiên là ${FIRST_SYMBOL_LAYER_ID[theme]}`, () => {
      const attribution = attributionHtml();
      const out = addPoiLayers(
        transformStyle(readJson(base), { theme, sovereignty, attribution }),
        { theme, attribution },
      );
      const firstSymbol = out.layers.find((layer) => layer.type === 'symbol');
      expect(firstSymbol?.id).toBe(FIRST_SYMBOL_LAYER_ID[theme]);
    });
  }
});
