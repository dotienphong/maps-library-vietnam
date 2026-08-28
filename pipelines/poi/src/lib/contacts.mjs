const SOCIAL = new Set([
  'facebook.com',
  'fb.com',
  'm.me',
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'zalo.me',
  'shopee.vn',
  'lazada.vn',
  'tiki.vn',
  'google.com',
  'goo.gl',
  'linktr.ee',
  'twitter.com',
  'x.com',
  'grab.com',
  'foody.vn',
]);

/** Số điện thoại VN → E.164 (+84…); tổng đài 1900/1800 và số không hợp lệ → null. @param {unknown} raw */
export function normalizePhoneVN(raw) {
  let s = String(raw ?? '').replace(/[^\d+]/g, '');
  if (s.startsWith('+84')) s = s.slice(3);
  else if (s.startsWith('0084')) s = s.slice(4);
  else if (s.startsWith('84') && s.length >= 11) s = s.slice(2);
  else if (s.startsWith('0')) s = s.slice(1);
  else return null;
  if (!/^[1-9]\d{8,9}$/.test(s)) return null;
  return `+84${s}`;
}

/** @param {(string | null | undefined)[] | null | undefined} list */
export function phonesOf(list) {
  const out = new Set();
  for (const item of list ?? [])
    for (const part of String(item ?? '').split(/[;/,]/)) {
      const p = normalizePhoneVN(part);
      if (p) out.add(p);
    }
  return [...out];
}

/** Host của URL (bỏ www.), null nếu là mạng xã hội/sàn TMĐT hoặc không phải URL. @param {unknown} url */
export function domainOf(url) {
  const s = String(url ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
    if (!host.includes('.') || SOCIAL.has(host) || [...SOCIAL].some((d) => host.endsWith(`.${d}`)))
      return null;
    return host;
  } catch {
    return null;
  }
}

/** @param {(string | null | undefined)[] | null | undefined} list */
export function domainsOf(list) {
  return [...new Set((list ?? []).map(domainOf).filter((d) => d !== null))];
}
