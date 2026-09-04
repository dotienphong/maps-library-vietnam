// Biến style MapLibre nền thành template MapsLibVN.
// Placeholder: {TILES_BASE} {VN_FILE} — Worker điền khi phục vụ /v1/styles/*.json.

export const ALLOWED_FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
export const NAME_EXPRESSION = ['coalesce', ['get', 'name:vi'], ['get', 'name']];

/** @param {string} font */
export function mapFont(font) {
  if (/italic/i.test(font)) return 'Noto Sans Italic';
  if (/bold|medium|semi|black|heavy/i.test(font)) return 'Noto Sans Bold';
  return 'Noto Sans Regular';
}

/** @param {unknown} textFont */
function mapTextFont(textFont) {
  if (Array.isArray(textFont) && textFont.every((font) => typeof font === 'string')) {
    return [...new Set(textFont.map((font) => mapFont(String(font))))];
  }
  if (Array.isArray(textFont) && textFont[0] === 'literal' && Array.isArray(textFont[1])) {
    return [...new Set(textFont[1].map((font) => mapFont(String(font))))];
  }
  return ['Noto Sans Regular'];
}

/**
 * @param {Record<string, any>} base Style nền.
 * @param {{ theme: 'light' | 'dark', sovereignty: Record<string, any>, attribution: string }} options
 *   `attribution` phải là `attributionHtml()` của `@mapslibvn/core` — xem chú thích ở dưới.
 */
export function transformStyle(base, options) {
  const sourceLayers = /** @type {Record<string, any>[]} */ (base.layers);
  const layers = sourceLayers
    .filter((layer) => !layer.source || layer.source === 'openmaptiles')
    .map((layer) => {
      if (layer.type !== 'symbol' || !layer.layout) return layer;
      const layout = { ...layer.layout };
      const textField = layout['text-field'];
      if (textField !== undefined && JSON.stringify(textField).includes('name')) {
        layout['text-field'] = NAME_EXPRESSION;
      }
      if (layout['text-font'] !== undefined) {
        layout['text-font'] = mapTextFont(layout['text-font']);
      }
      return { ...layer, layout };
    });

  layers.push({
    id: 'sovereignty-label',
    type: 'symbol',
    source: 'sovereignty',
    minzoom: 4,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 8, 16],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'symbol-sort-key': 0,
    },
    paint: {
      'text-color': options.theme === 'dark' ? '#f4f4f4' : '#1b3a6b',
      'text-halo-color': options.theme === 'dark' ? '#111111' : '#ffffff',
      'text-halo-width': 1.5,
    },
  });

  return {
    version: 8,
    name: options.theme === 'dark' ? 'MapsLibVN Dark' : 'MapsLibVN Light',
    metadata: {
      'mapslibvn:theme': options.theme,
      'mapslibvn:base': base.name ?? 'unknown',
    },
    sources: {
      openmaptiles: {
        type: 'vector',
        url: 'pmtiles://{TILES_BASE}/tiles/{VN_FILE}.pmtiles',
        // Chuỗi ghi nguồn ĐẦY ĐỦ, giống hệt chuỗi SDK truyền vào `customAttribution` và giống
        // hệt chuỗi của source `poi`. MapLibre gộp các chuỗi trùng khít nhau nên người dùng chỉ
        // thấy một lần, đồng thời mỗi bên đều tự đủ: nạp style thẳng vào maplibre-gl thuần vẫn có
        // ghi nguồn, mà ẩn lớp POI hay thiếu bản POI cũng không làm mất nguồn nào (spec 7.2).
        attribution: options.attribution,
      },
      sovereignty: { type: 'geojson', data: options.sovereignty },
    },
    glyphs: '{TILES_BASE}/assets/fonts/{fontstack}/{range}.pbf',
    sprite: '{TILES_BASE}/assets/sprites/osm-liberty',
    layers,
  };
}

/**
 * Điền placeholder vào template JSON.
 * @param {string} templateJson
 * @param {Record<string, string>} values
 */
export function fillTemplate(templateJson, values) {
  return templateJson.replace(
    /\{(TILES_BASE|VN_FILE|POI_FILE)\}/g,
    (match, key) => values[key] ?? match,
  );
}
