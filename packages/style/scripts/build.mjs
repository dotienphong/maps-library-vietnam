#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attributionHtml } from '@mapslibvn/core';
import { addPoiLayers } from '../src/poi-layers.mjs';
import { transformStyle } from '../src/transform.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const sovereignty = readJson('src/sovereignty.geojson');
mkdirSync(resolve(root, 'dist'), { recursive: true });

const baseThemes = /** @type {const} */ ([
  ['src/base/osm-liberty.json', 'light'],
  ['src/base/dark-matter.json', 'dark'],
]);

for (const [base, theme] of baseThemes) {
  // Một nguồn sự thật duy nhất cho chuỗi ghi nguồn: @mapslibvn/core.
  const attribution = attributionHtml();
  const output = addPoiLayers(transformStyle(readJson(base), { theme, sovereignty, attribution }), {
    theme,
    attribution,
  });
  const file = resolve(root, `dist/mapslibvn-${theme}.template.json`);
  writeFileSync(file, JSON.stringify(output));
  console.log('✓', file.replace(`${root}/`, ''), `${output.layers.length} layers`);
}

copyFileSync(resolve(root, 'src/sovereignty.geojson'), resolve(root, 'dist/sovereignty.geojson'));
