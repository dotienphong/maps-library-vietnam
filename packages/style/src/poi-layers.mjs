// Lớp POI (poi-YYYYMMDD.pmtiles, spec 5.8) cho template style. Icon theo nhóm (sprite osm-liberty/Maki); chi tiết lấy qua API khi bấm.
export const POI_GROUP_ICONS = {
  food_drink: 'restaurant',
  shopping: 'shop',
  services: 'shop',
  health: 'hospital',
  education: 'school',
  finance: 'bank',
  lodging: 'lodging',
  entertainment_sport: 'stadium',
  culture_tourism: 'museum',
  transport: 'bus',
  public_admin: 'town_hall',
  religion_community: 'place_of_worship',
  other: 'marker',
};

/**
 * @param {Record<string, any>} style template đã qua transformStyle (lớp cuối là sovereignty-label)
 * @param {{ theme: 'light' | 'dark', attribution: string }} opts
 *   `attribution` phải là `attributionHtml()` của `@mapslibvn/core`.
 */
export function addPoiLayers(style, opts) {
  const dark = opts.theme === 'dark';
  const layers = style.layers.filter(
    (/** @type {Record<string, any>} */ l) =>
      !(l.source === 'openmaptiles' && l['source-layer'] === 'poi'),
  );
  const rank = ['coalesce', ['get', 'r'], 5];
  const sortKey = ['coalesce', ['get', 'd'], ['-', 9, ['coalesce', ['get', 'q'], 0]]];
  const poiLayer = {
    id: 'poi',
    type: 'symbol',
    source: 'poi',
    'source-layer': 'poi',
    minzoom: 10,
    layout: {
      'icon-image': [
        'match',
        ['get', 'grp'],
        ...Object.entries(POI_GROUP_ICONS)
          .filter(([g]) => g !== 'other')
          .flat(),
        POI_GROUP_ICONS.other,
      ],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 16, 1],
      'icon-padding': 8,
      'icon-allow-overlap': false,
      'symbol-sort-key': sortKey,
    },
  };
  const labelLayout = {
    'text-field': ['get', 'name'],
    'text-font': ['Noto Sans Regular'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 18, 13],
    'text-offset': [0, 1.1],
    'text-anchor': 'top',
    'text-max-width': 8,
    'text-padding': 4,
    'symbol-sort-key': sortKey,
  };
  const labelPaint = {
    'text-color': dark ? '#e8e8e8' : '#333333',
    'text-halo-color': dark ? '#111111' : '#ffffff',
    'text-halo-width': 1.2,
  };
  const majorLabelLayer = {
    id: 'poi-label-major',
    type: 'symbol',
    source: 'poi',
    'source-layer': 'poi',
    minzoom: 12,
    filter: ['<=', rank, 2],
    layout: labelLayout,
    paint: labelPaint,
  };
  const localLabelLayer = {
    id: 'poi-label-local',
    type: 'symbol',
    source: 'poi',
    'source-layer': 'poi',
    minzoom: 16,
    filter: ['>=', rank, 3],
    layout: {
      ...labelLayout,
    },
    paint: { ...labelPaint },
  };
  const sovereigntyIdx = layers.findIndex(
    (/** @type {Record<string, any>} */ l) => l.id === 'sovereignty-label',
  );
  layers.splice(
    sovereigntyIdx < 0 ? layers.length : sovereigntyIdx,
    0,
    poiLayer,
    majorLabelLayer,
    localLabelLayer,
  );
  return {
    ...style,
    sources: {
      ...style.sources,
      poi: {
        type: 'vector',
        url: 'pmtiles://{TILES_BASE}/tiles/{POI_FILE}.pmtiles',
        // Trùng khít chuỗi của source `openmaptiles` và của `customAttribution` — MapLibre gộp lại.
        attribution: opts.attribution,
      },
    },
    layers,
  };
}
