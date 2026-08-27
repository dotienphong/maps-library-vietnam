import abbrevJson from './abbrev.json';
import brandAliasJson from './brand_alias.json';

const ABBREV: Record<string, string> = abbrevJson;
const BRAND_ALIAS: Record<string, string[]> = brandAliasJson;

/** Từ đệm bị bỏ ở đầu tên POI khi so khớp (spec 5.3 bước 5; thêm `mtv`). Không dùng cho hiển thị. */
export const NAME_FILLERS = [
  'cong ty',
  'cty',
  'tnhh',
  'mtv',
  'co phan',
  'cua hang',
  'quan',
  'tiem',
  'nha hang',
  'shop',
  'cafe',
  'ca phe',
  'coffee',
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ABBREV_RULES = Object.entries(ABBREV).map(([key, value]) => {
  const after = key.endsWith('.') ? '' : '(?=[\\s\\d,.]|$)';
  return {
    re: new RegExp(`(^|[\\s,.(])${escapeRegExp(key)}${after}`, 'g'),
    replacement: `$1${value} `,
  };
});

const ALIAS_RULES = Object.entries(BRAND_ALIAS)
  .flatMap(([canonical, variants]) => variants.map((variant) => ({ variant, canonical })))
  .sort((a, b) => b.variant.length - a.variant.length);

/** Bỏ dấu tiếng Việt (giữ chữ hoa/thường), đ → d. */
export function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Thay viết tắt (bảng abbrev.json) trên chuỗi đã lowercase + bỏ dấu; `f` trước số → `phuong`. */
export function expandAbbrev(s: string): string {
  let out = s;
  for (const { re, replacement } of ABBREV_RULES) out = out.replace(re, replacement);
  out = out.replace(/(^|\s)f\.?(?=\s*\d)/g, '$1phuong ');
  return out.replace(/ {2,}/g, ' ').trim();
}

/** Chuẩn hoá spec 5.3 bước 1–4: NFC → lowercase → bỏ dấu → viết tắt → bỏ dấu câu (giữ `/`, `-`) → gộp khoảng trắng. */
export function normalizeVi(input: string): string {
  let s = stripDiacritics(input.normalize('NFC').toLowerCase());
  s = expandAbbrev(s);
  s = s.replace(/[^a-z0-9/\-\s]/g, ' ');
  s = s.replace(/\s*\/\s*/g, '/');
  s = s.replace(/\s+-\s+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Alias thương hiệu: chỉ thay khi biến thể đứng đầu chuỗi (hoặc bằng cả chuỗi). */
export function applyBrandAlias(s: string): string {
  for (const { variant, canonical } of ALIAS_RULES) {
    if (s === variant) return canonical;
    if (s.startsWith(`${variant} `)) return canonical + s.slice(variant.length);
  }
  return s;
}

/** Tên rút gọn để so khớp trigram (spec 5.3 bước 5–6). Nếu bỏ hết từ đệm mà rỗng thì giữ tên chuẩn hoá. */
export function nameCore(input: string): string {
  const norm = normalizeVi(input);
  let s = norm;
  let changed = true;
  while (changed && s) {
    changed = false;
    for (const filler of NAME_FILLERS) {
      if (s === filler) {
        s = '';
        break;
      }
      if (s.startsWith(`${filler} `)) {
        s = s.slice(filler.length + 1);
        changed = true;
      }
    }
  }
  return applyBrandAlias(s || norm);
}
