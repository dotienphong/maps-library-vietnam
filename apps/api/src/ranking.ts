/** Hệ số xếp hạng autocomplete (spec 6.2) — đặt ở đây để chỉnh bằng test. */
export const COEFF = { sim: 0.55, prox: 0.25, pop: 0.15, prior: 0.05 } as const;
export const PREFIX_BONUS = 0.1;
export const PROX_SCALE_M = 5000;
/** Lưới thay H3 res 6 cho khoá cache (~5,5 km) — xem plan M3, quyết định 1. */
export const CACHE_GRID_DEG = 0.05;

export type ItemType = 'poi' | 'street' | 'address';

export function priorFor(type: ItemType, qStartsWithDigit: boolean): number {
  if (qStartsWithDigit) return type === 'address' ? 1 : type === 'poi' ? 0.5 : 0.7;
  return type === 'poi' ? 1 : 0.7;
}

export function proxScore(dMeters: number | null | undefined): number {
  if (dMeters == null) return 0.5;
  return Math.exp(-dMeters / PROX_SCALE_M);
}

export function rankScore(input: {
  sim: number;
  prefix: boolean;
  dMeters: number | null;
  pop: number;
  type: ItemType;
  qStartsWithDigit: boolean;
}): number {
  const sim = input.sim + (input.prefix ? PREFIX_BONUS : 0);
  const pop = Math.max(0, Math.min(1, input.pop));
  return (
    COEFF.sim * sim +
    COEFF.prox * proxScore(input.dMeters) +
    COEFF.pop * pop +
    COEFF.prior * priorFor(input.type, input.qStartsWithDigit)
  );
}

export function gridKey(lat: number, lng: number): string {
  const scale = 1 / CACHE_GRID_DEG;
  const bucket = (value: number) => Math.floor(value * scale + 1e-9) / scale;
  return `${bucket(lat).toFixed(2)},${bucket(lng).toFixed(2)}`;
}
