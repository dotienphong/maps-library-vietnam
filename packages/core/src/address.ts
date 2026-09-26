import { normalizeVi, stripDiacritics } from './normalize';
import provincesJson from './provinces.json';

export type AlleyKeyword = 'hem' | 'ngo' | 'ngach' | 'kiet';

/** Kết quả phân tích địa chỉ (spec 5.7). Trường vắng = không nhận diện được. */
export interface ParsedAddress {
  housenumber?: string;
  alleyChain: string[];
  houseInAlley?: string;
  alleyKeyword?: AlleyKeyword;
  street?: string;
  streetNorm?: string;
  /** Phương án bỏ tiền tố khi "Duong"/"pho" gõ không dấu — mơ hồ Đường/Dương, Phố/Phổ; geocoder chọn theo bảng street. */
  streetAlt?: string;
  streetNormAlt?: string;
  ward?: string;
  district?: string;
  province?: string;
  adminOriginal?: { ward?: string; district?: string; province?: string };
  confidence: number;
}

const PROVINCE_BY_ALIAS = new Map<string, string>();
for (const [name, aliases] of Object.entries(provincesJson as Record<string, string[]>)) {
  PROVINCE_BY_ALIAS.set(normalizeVi(name).replace(/^thanh pho /, ''), name);
  for (const a of aliases) PROVINCE_BY_ALIAS.set(a, name);
}

// Số nhà: "12", "130C", "272A4", "12-14"; đứng đầu còn nhận "E4", "C33", "BT2" (không nhận p6/q10/f6/tp — đó là phường/quận)
const NUM = String.raw`(?:\d+(?:[a-z](?![a-z])\d*)?(?:-\d+[a-z]?)?|[a-z]{1,2}\d+[a-z]?)`;
const NUM_LEAD = String.raw`(?:\d+(?:[a-z](?![a-z])\d*)?(?:-\d+[a-z]?)?|(?![pqf]\d|tp\d|ql\d|tl\d|dt\d|hl\d)[a-z]{1,2}\d+[a-z]?)`;
// Giữ String.raw cho CẢ khối mảnh regex bên dưới: hai dòng này tình cờ chưa có escape nào, nhưng
// bỏ lẻ chúng ra thì khối thành không nhất quán và người thêm `\d` vào sau sẽ âm thầm nhận
// regex sai.
// biome-ignore lint/complexity/noUselessStringRaw: xem ngay trên
const HN = String.raw`${NUM_LEAD}(?:/${NUM})*`;
// biome-ignore lint/complexity/noUselessStringRaw: xem chú thích ở HN phía trên.
const ALLEY_KW = String.raw`(?:hem|ngo|ngach|kiet)`;
const PREFIX = String.raw`(?:(?:so(?:\s*nha)?|sn|lo|can|kiot)\.?\s*)?`;
const RE_PREFIX = new RegExp(`^${PREFIX}`);
const RE_STREET = new RegExp(
  String.raw`^${PREFIX}(${HN})?\s*((?:${ALLEY_KW}\s*${HN}\s*)*)((?:duong|d\.|pho)\s+(?!so\b|[a-z]{1,2}\d))?(.*)$`,
);
const RE_ALLEY_EACH = new RegExp(String.raw`(${ALLEY_KW})\s*(${HN})`, 'g');
const RE_STREET_LIKE = new RegExp(
  String.raw`^${PREFIX}${NUM_LEAD}(?:/|\s|$)|\b${ALLEY_KW}\s*\d|^(?:duong|d\.|pho)\s`,
);
const RE_STREET_WORD = /^(?:duong|d\.|pho)\s/;
const RE_POSITIONAL = /^(?:gan|doi dien|cuoi|canh)\s/;
const RE_TINH = /^(?:tinh(?!\s+lo\b)|t\.)\s+(.+)$/;
const RE_CITY = /^(?:thanh pho(?=[\s\d])\s*|tp\.?\s*)(.+)$/;
const RE_DISTRICT =
  /^(?:(?:quan|huyen|thi xa)(?=[\s\d])\s*|(?:q\.|h\.|tx\.)\s*)(.+)$|^q\s*(\d.*)$|^district\s+(.+)$/;
const RE_WARD =
  /^(?:(?:phuong|xa(?!\s+lo\b)|thi tran)(?=[\s\d])\s*|(?:p\.|x\.|tt\.|f\.)\s*|tt\s+)(.+)$|^[pf]\s*(\d.*)$|^(.+?)\s+ward$/;
const RE_IGNORE =
  /^(?:to|khu pho|kp|ap|thon|xom|khom|khu vuc|kv|to dan pho|tdp|lo|toa nha|tn|chung cu|cc|block|tang|lau|can ho|kdc|khu dan cu|kdt|khu do thi|kcn|khu cong nghiep|kcx|khu che xuat|khu cong nghe cao|khu|cu xa|cx|ttm|tttm)\b/;
// Tách chuỗi không có dấu phẩy tại từ khoá hành chính. Bản "theo phần" (đã có dấu phẩy) bỏ `xa`/`x.` vì
// tên đường có thể chứa "Xã" ("36 Xã Đàn"); `tinh lo` (tỉnh lộ) không phải "tỉnh"; "Lô P2"/"Căn F3" không phải phường.
const RE_SPLIT =
  /\s(?=(?:phuong|xa(?!\s+lo\b)|thi tran|quan|huyen|thi xa|thanh pho|tinh(?!\s+lo\b))(?:\s|\d)|(?:p|q|f|tp|tt|tx|h|x)\.\s*\S|tp\s*\S)|(?<!\b(?:lo|can|kiot|block|toa|khu|so))\s(?=[pqf]\s*\d)/g;
const RE_SPLIT_PART =
  /\s(?=(?:phuong|thi tran|quan|huyen|thi xa|thanh pho|tinh(?!\s+lo\b))(?:\s|\d)|(?:p|q|f|tp|tt|tx|h)\.\s*\S|tp\s*\S)|(?<!\b(?:lo|can|kiot|block|toa|khu|so))\s(?=[pqf]\s*\d)/g;

/** Chuỗi khoá để so mẫu: lowercase + bỏ dấu, cùng độ dài với chuỗi NFC gốc (căn chỉ số 1–1). */
const keyOf = (s: string) => stripDiacritics(s.toLowerCase());
const cleanTail = (s: string) => s.trim().replace(/^[\s,.;:\-/]+|[\s,.;:-]+$/g, '');

function lookupProvince(part: string): string | undefined {
  const n = normalizeVi(part).replace(/^(?:tinh|thanh pho|tp)\s+/, '');
  return PROVINCE_BY_ALIAS.get(n);
}

/** "Đường"/"Phố" thật (có dấu) mới là tiền tố; "Dương", "Phổ" là tên riêng — sau khi bỏ dấu không phân biệt được. */
function isStreetWord(orig: string, at: number, word: string): boolean {
  if (word.startsWith('d.')) return true;
  const c0 = orig[at] ?? '';
  if (word.startsWith('duong'))
    return c0 === 'Đ' || c0 === 'đ' || c0 === 'D' || c0 === 'd' ? c0 === 'Đ' || c0 === 'đ' : false;
  // pho: cần "ố" ở vị trí 3 (Phố), không phải "ổ" (Phổ)
  const c2 = orig[at + 2] ?? '';
  return c2 === 'ố' || c2 === 'Ố';
}

/** Gộp chuỗi hẻm từ "Hẻm N" và từ số nhà "N/M/K": trùng đầu thì lấy chuỗi dài hơn, không thì nối. */
function mergeChain(fromAlley: string[], fromHn: string[]): string[] {
  const startsWith = (a: string[], b: string[]) => b.every((x, i) => a[i] === x);
  if (startsWith(fromHn, fromAlley)) return fromHn;
  if (startsWith(fromAlley, fromHn)) return fromAlley;
  return [...fromAlley, ...fromHn];
}

/** Cắt phần "đầu đường": số nhà, chuỗi hẻm, tên đường. */
function parseStreetPart(orig: string, key: string, out: ParsedAddress): void {
  const m = RE_STREET.exec(key);
  if (!m) return;
  const [, hnRaw, alleyText = '', streetWord = '', rest0 = ''] = m;
  let rest = rest0;
  let restAt = key.length - rest0.length;
  let altAt = -1;
  if (streetWord && !isStreetWord(orig, restAt - streetWord.length, streetWord)) {
    // Gõ không dấu thì không biết là tiền tố hay tên riêng: giữ tên gốc, nhớ vị trí sau tiền tố.
    const word = orig.slice(restAt - streetWord.length, restAt).trimEnd();
    if (/^[A-Za-z]+$/.test(word)) altAt = restAt;
    rest = streetWord + rest0;
    restAt -= streetWord.length;
  }
  let hn: string | undefined;
  let hnAt = -1;
  if (hnRaw) {
    const prefixLen = RE_PREFIX.exec(key)?.[0].length ?? 0;
    hnAt = key.indexOf(hnRaw, prefixLen);
    hn = orig.slice(hnAt, hnAt + hnRaw.length);
  }
  // "3 Tháng 2", "2 Tháng 4": số đầu là tên đường, không phải số nhà
  if (hn && !alleyText && /^thang\s+\d/.test(rest.trim())) {
    out.street = cleanTail(orig.slice(hnAt));
    out.streetNorm = normalizeVi(out.street);
    return;
  }
  const streetFrom = (at: number) =>
    cleanTail(orig.slice(at).replace(/\s(?:[Kk]hóm|[Tt]ổ|[Ấấ]p|KP|[Kk]hu phố)\s+\d.*$/, ''));
  const street = streetFrom(restAt);
  if (street) {
    out.street = street;
    out.streetNorm = normalizeVi(street);
    const alt = altAt >= 0 ? streetFrom(altAt) : '';
    if (alt) {
      out.streetAlt = alt;
      out.streetNormAlt = normalizeVi(alt);
    }
  }
  const alleys = [...alleyText.matchAll(RE_ALLEY_EACH)];
  const alleyNums = alleys
    .map((a) => (a[2] as string).toUpperCase().split('/'))
    .reverse()
    .flat(); // "Ngách 15 Ngõ 78" → ngoài trước: ["78","15"]
  const segs = hn ? hn.split('/') : [];
  const house = segs.at(-1);
  const chain = mergeChain(
    alleyNums,
    segs.slice(0, -1).map((s) => s.toUpperCase()),
  );
  if (alleys.length) {
    out.alleyKeyword = alleys[0]?.[1] as AlleyKeyword;
    out.alleyChain = chain;
    if (house) {
      out.houseInAlley = house;
      out.housenumber = [...chain, house].join('/');
    }
  } else if (hn) {
    out.housenumber = hn;
    out.alleyChain = chain;
    if (chain.length && house) out.houseInAlley = house;
  }
}

export function parseAddress(input: string): ParsedAddress {
  const out: ParsedAddress = { alleyChain: [], confidence: 0 };
  const rememberAdmin = (key: 'ward' | 'district' | 'province', value: string) => {
    out.adminOriginal ??= {};
    if (!out.adminOriginal[key]) out.adminOriginal[key] = value;
  };
  const orig = input
    .normalize('NFC')
    .replace(/\([^)]*\)?/g, ' ') // chú thích trong ngoặc: "(nối dài)", "(P13 Q10 cũ)"
    .replace(/\s+/g, ' ')
    .replace(/\s+[-–—]\s+/g, ', ')
    .trim()
    .replace(/,?\s*(?:việt nam|viet nam|vietnam)\.?\s*$/i, '')
    .replace(/,?\s*\b\d{5,6}\s*$/, '')
    .trim();
  if (!orig) return out;

  const splitBy = (s: string, re: RegExp) => {
    const key = keyOf(s);
    const cuts = [...key.matchAll(re)].map((m) => m.index ?? 0);
    return [0, ...cuts]
      .map((start, i, arr) => cleanTail(s.slice(start, arr[i + 1])))
      .filter(Boolean);
  };
  const commaParts = orig.split(',').map(cleanTail).filter(Boolean);
  const parts =
    commaParts.length === 1
      ? splitBy(orig, RE_SPLIT)
      : commaParts.flatMap((p) => splitBy(p, RE_SPLIT_PART));

  let streetIdx = -1;
  let firstAdminIdx = Number.POSITIVE_INFINITY; // vị trí phần hành chính đầu tiên (phường/quận/tỉnh)
  const unknown: { part: string; i: number }[] = [];
  const numbers: string[] = [];
  parts.forEach((part, i) => {
    const key = keyOf(part);
    if (!key || RE_POSITIONAL.test(key)) return;
    const markAdmin = () => {
      firstAdminIdx = Math.min(firstAdminIdx, i);
    };
    if (streetIdx < 0 && RE_STREET_LIKE.test(key)) {
      parseStreetPart(part, key, out);
      streetIdx = i;
      return;
    }
    // "736/169/10, Đ. Lê Đức Thọ": số nhà đứng riêng, tên đường ở phần kế tiếp
    if (streetIdx >= 0 && !out.street && i === streetIdx + 1 && RE_STREET_WORD.test(key)) {
      parseStreetPart(part, key, out);
      return;
    }
    const tinh = RE_TINH.exec(key);
    if (tinh) {
      markAdmin();
      rememberAdmin('province', part);
      out.province =
        lookupProvince(tinh[1] ?? '') ?? cleanTail(part.slice(key.length - (tinh[1] ?? '').length));
      return;
    }
    const city = RE_CITY.exec(key);
    if (city) {
      markAdmin();
      const rest = city[1] ?? '';
      const prov = lookupProvince(rest);
      if (prov) {
        rememberAdmin('province', part);
        out.province = prov;
      } else if (!out.district) {
        rememberAdmin('district', part);
        out.district = cleanTail(part.slice(key.length - rest.length));
      }
      return;
    }
    const d = RE_DISTRICT.exec(key);
    if (d) {
      markAdmin();
      const rest = d[1] ?? d[2] ?? d[3] ?? '';
      if (!out.district) {
        rememberAdmin('district', part);
        out.district = cleanTail(part.slice(key.length - rest.length));
      }
      return;
    }
    const w = RE_WARD.exec(key);
    if (w) {
      markAdmin();
      const rest = w[1] ?? w[2] ?? w[3] ?? '';
      const at = w[3] !== undefined ? 0 : key.length - rest.length;
      if (!out.ward) {
        rememberAdmin('ward', part);
        out.ward = cleanTail(part.slice(at, at + rest.length));
      }
      return;
    }
    const prov = lookupProvince(part);
    if (prov) {
      markAdmin();
      rememberAdmin('province', part);
      out.province = prov;
      return;
    }
    if (RE_IGNORE.test(key)) return;
    if (/^\d+$/.test(key)) {
      numbers.push(part);
      return;
    }
    unknown.push({ part, i });
  });

  // Chưa có tên đường: phần chưa phân loại đứng TRƯỚC mọi phần hành chính (và sau số nhà, nếu có) là tên đường
  // ("Quốc lộ 1A, Xã …", "89, Dương Văn An, phường …"); đứng SAU thì là phường/quận ("Thị trấn Hóc Môn, Hóc Môn").
  if (!out.street && unknown.length) {
    const k = unknown.findIndex((u) => u.i > streetIdx && u.i < firstAdminIdx);
    if (k >= 0) {
      const [first] = unknown.splice(k, 1) as [{ part: string; i: number }];
      const keep = {
        housenumber: out.housenumber,
        alleyChain: out.alleyChain,
        houseInAlley: out.houseInAlley,
      };
      parseStreetPart(first.part, keyOf(first.part), out);
      if (keep.housenumber && !out.housenumber) {
        out.housenumber = keep.housenumber;
        out.alleyChain = keep.alleyChain;
        if (keep.houseInAlley !== undefined) out.houseInAlley = keep.houseInAlley;
      }
      streetIdx = Math.max(streetIdx, first.i);
    }
  }
  for (const u of unknown) {
    if (u.i < streetIdx) continue; // tên toà nhà/POI đứng trước phần đường → bỏ
    if (!out.ward) out.ward = u.part;
    else if (!out.district) out.district = u.part;
  }
  for (const n of numbers) {
    if (!out.ward) out.ward = n;
    else if (!out.district) out.district = n;
  }

  out.confidence =
    Math.round(
      ((out.housenumber ? 0.25 : 0) +
        (out.street ? 0.35 : 0) +
        (out.ward ? 0.15 : 0) +
        (out.district ? 0.1 : 0) +
        (out.province ? 0.15 : 0)) *
        100,
    ) / 100;
  return out;
}
