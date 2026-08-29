import { normalizeVi } from '@mapslibvn/core';

const ALLEY_RE =
  /^(hẻm|hem|ngõ|ngo|ngách|ngach|kiệt|kiet)\s+(\d[a-z0-9]*(?:\/\s*(?:\d[a-z0-9]*|[a-z]+\d[a-z0-9]*)|[+-]\s*[a-z0-9]+)*)/i;
const KEYWORD = /** @type {Record<string, 'hem' | 'ngo' | 'ngach' | 'kiet'>} */ ({
  hẻm: 'hem',
  hem: 'hem',
  ngõ: 'ngo',
  ngo: 'ngo',
  ngách: 'ngach',
  ngach: 'ngach',
  kiệt: 'kiet',
  kiet: 'kiet',
});

/** Tách tên way hẻm OSM. @param {string | null | undefined} name */
export function parseAlleyName(name) {
  const prepared = (name ?? '').trim().replace(/(\d)(?!Bis(?:[/\s]|$))(?=\p{Lu}\p{Ll})/gu, '$1 ');
  const match = ALLEY_RE.exec(prepared);
  if (!match) return null;
  const parentName =
    prepared
      .slice(match[0].length)
      .replace(/^[\s,.;:/+-]+/, '')
      .trim() || null;
  return {
    keyword: KEYWORD[match[1]?.toLowerCase() ?? ''] ?? 'hem',
    number: (match[2] ?? '').replace(/\s+/g, '').toUpperCase(),
    parentName,
    parentNorm: parentName ? streetNameNorm(parentName) : null,
  };
}

/**
 * Tên đường chuẩn hoá để khớp giữa OSM, parser địa chỉ và mốc: bỏ "đường/phố" đầu
 * trừ khi theo sau là "số …" hoặc mã ngắn (D2, N1).
 * @param {string} name
 */
export function streetNameNorm(name) {
  const normalized = normalizeVi(name);
  return normalized.replace(/^(?:duong|pho)\s+(?!so\b|[a-z]{1,2}\d)/, '');
}
