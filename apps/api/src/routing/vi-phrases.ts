/**
 * Bảng cụm từ vá câu tiếng Việt dịch máy của Valhalla (spec B mục 6.2).
 *
 * Locale nằm TRONG binary Valhalla (kiểm image 3.8.3 ngày 12/09/2026) nên không sửa được ở máy chủ;
 * Worker sửa trên chuỗi đã sinh. Mọi luật phải neo vào chữ của CÂU MẪU: `^` đầu câu, `\.$` cuối câu,
 * hoặc cụm nhiều từ không thể là tên đường. Test corpus (tên đường fixture, 341 địa chỉ, 34 tỉnh) bảo vệ.
 * Bảng vượt ~30 luật → cân nhắc để Worker tự sinh câu (spec B mục 10), không nhồi thêm.
 */
export interface ViPhraseRule {
  /** Cờ `u` bắt buộc; thêm `g` khi cụm có thể lặp trong một câu. */
  pattern: RegExp;
  replace: string | ((match: string, ...groups: string[]) => string);
  /** Khối/câu mẫu trong `locales/vi-VN.json` bị ảnh hưởng, để PHONG duyệt. */
  note: string;
}

const lowerFirstLetter = (_match: string, lead: string, letter: string): string =>
  `${lead}${letter.toLowerCase()}`;

export const VI_PHRASE_RULES: readonly ViPhraseRule[] = [
  {
    pattern: /^Điểm đến của bạn nằm ở (trái|phải)\.$/u,
    replace: 'Điểm đến ở bên $1.',
    note: 'destination.2 / destination_verbal.2',
  },
  {
    pattern: /^Địa điểm của bạn sẽ nằm ở (trái|phải)\.$/u,
    replace: 'Điểm đến ở bên $1.',
    note: 'destination_verbal_alert.2',
  },
  {
    pattern: /^Rẽ (trái|phải) hình chữ U/u,
    replace: 'Quay đầu bên $1',
    note: 'uturn.* / uturn_verbal.*',
  },
  { pattern: /^Sáp nhập\.$/u, replace: 'Nhập làn.', note: 'merge.0' },
  { pattern: /^Sáp nhập (trái|phải)/u, replace: 'Nhập làn bên $1', note: 'merge.1 .3 .5' },
  { pattern: /^Sáp nhập vào/u, replace: 'Nhập vào', note: 'merge.2' },
  { pattern: /^Sáp nhập về hướng/u, replace: 'Nhập làn về hướng', note: 'merge.4' },
  { pattern: /đoạn đường nối/gu, replace: 'đường nhánh', note: 'ramp.* / ramp_verbal.*' },
  {
    pattern: /^Rẽ ra ngoài (?:tại|vào) đoạn rẽ (trái|phải)\.$/u,
    replace: 'Ra ở lối ra bên $1.',
    note: 'exit.0 (chỉ hướng, không biển số)',
  },
  {
    pattern: /^Rẽ ra ngoài (?:tại|vào) đoạn rẽ/u,
    replace: 'Ra ở lối ra',
    note: 'exit.2 .4 .6 (có biển/hướng)',
  },
  { pattern: /^Rẽ vào đoạn rẽ (\d+)/u, replace: 'Vào lối ra $1', note: 'exit.1 .3 .5 .7' },
  { pattern: /đoạn rẽ (\d+)/gu, replace: 'lối ra $1', note: 'keep.1 .3 .5 .7 (giữa câu)' },
  { pattern: /^Giữ (trái|phải)/u, replace: 'Giữ bên $1', note: 'keep.* / keep_to_stay_on.*' },
  { pattern: /^Lái về phía/u, replace: 'Đi về hướng', note: 'start.* cho xe máy và ô tô' },
  {
    pattern: /(nữa, |Rồi, |Rồi )(\p{Lu})/gu,
    replace: lowerFirstLetter,
    note: 'verbal_multi_cue.*: chữ hoa đầu cue thứ hai giữa câu',
  },
];

/** Áp tuần tự mọi luật; câu không khớp luật nào trả về nguyên văn. */
export function applyViPhrases(text: string): string {
  let out = text;
  for (const rule of VI_PHRASE_RULES) {
    out =
      typeof rule.replace === 'string'
        ? out.replace(rule.pattern, rule.replace)
        : out.replace(rule.pattern, rule.replace);
  }
  return out;
}
