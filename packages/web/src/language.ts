export type Lang = 'vi' | 'en';

export function nameExpression(lang: Lang): unknown[] {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
}

interface StyleLike {
  getStyle():
    | { layers?: { id: string; type: string; layout?: Record<string, unknown> }[] }
    | undefined;
  setLayoutProperty(layerId: string, name: string, value: unknown): unknown;
}

/** Đổi nhãn sang ngôn ngữ khác. Bỏ qua lớp chủ quyền (luôn tiếng Việt) và nhãn không phải tên. */
export function applyLanguage(gl: StyleLike, lang: Lang): void {
  for (const l of gl.getStyle()?.layers ?? []) {
    if (l.type !== 'symbol' || l.id === 'sovereignty-label') continue;
    const tf = l.layout?.['text-field'];
    if (tf === undefined || !JSON.stringify(tf).includes('name')) continue;
    gl.setLayoutProperty(l.id, 'text-field', nameExpression(lang));
  }
}
