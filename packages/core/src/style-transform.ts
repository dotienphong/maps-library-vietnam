/**
 * Biến đổi style JSON thuần (không cần Map đang chạy) — dùng cho React Native, nơi wrapper
 * không có API đổi layout property của lớp có sẵn. Web dùng `applyLanguage` lúc chạy nhưng
 * chia sẻ `nameExpression`/`isNameLabelLayer` từ đây.
 */
export type Lang = 'vi' | 'en';

export interface StyleLayerLike {
  id: string;
  type: string;
  layout?: Record<string, unknown> | undefined;
}

export interface StyleLike {
  layers?: readonly StyleLayerLike[] | undefined;
}

export const POI_LAYER_ID = 'poi';
const SOVEREIGNTY_LABEL_ID = 'sovereignty-label';

export function nameExpression(lang: Lang): unknown[] {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
}

/** Lớp nhãn tên (symbol có `text-field` tham chiếu `name`), trừ lớp chủ quyền luôn tiếng Việt. */
export function isNameLabelLayer(layer: StyleLayerLike): boolean {
  if (layer.type !== 'symbol' || layer.id === SOVEREIGNTY_LABEL_ID) return false;
  const textField = layer.layout?.['text-field'];
  return textField !== undefined && JSON.stringify(textField).includes('name');
}

function mapLayers<T extends StyleLike>(
  style: T,
  fn: (layer: StyleLayerLike) => StyleLayerLike,
): T {
  return { ...style, layers: (style.layers ?? []).map(fn) };
}

/** Đổi nhãn sang `lang`. `vi` là mặc định của style nên trả nguyên object. */
export function localizeStyle<T extends StyleLike>(style: T, lang: Lang): T {
  if (lang === 'vi') return style;
  return mapLayers(style, (layer) =>
    isNameLabelLayer(layer)
      ? { ...layer, layout: { ...layer.layout, 'text-field': nameExpression(lang) } }
      : layer,
  );
}

/** Ẩn lớp POI bằng `layout.visibility = 'none'`; trả style mới. */
export function hidePoiLayer<T extends StyleLike>(style: T): T {
  return mapLayers(style, (layer) =>
    layer.id === POI_LAYER_ID
      ? { ...layer, layout: { ...layer.layout, visibility: 'none' } }
      : layer,
  );
}
