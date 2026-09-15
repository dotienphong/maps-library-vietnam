import { isNameLabelLayer, type Lang, nameExpression } from '@mapslibvn/core';

export type { Lang };
export { nameExpression };

interface StyleLike {
  getStyle():
    | { layers?: { id: string; type: string; layout?: Record<string, unknown> }[] }
    | undefined;
  setLayoutProperty(layerId: string, name: string, value: unknown): unknown;
}

/** Đổi nhãn sang ngôn ngữ khác lúc chạy. Bỏ qua lớp chủ quyền (luôn tiếng Việt) và nhãn không phải tên. */
export function applyLanguage(gl: StyleLike, lang: Lang): void {
  for (const l of gl.getStyle()?.layers ?? []) {
    if (isNameLabelLayer(l)) gl.setLayoutProperty(l.id, 'text-field', nameExpression(lang));
  }
}
