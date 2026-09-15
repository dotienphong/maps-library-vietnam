const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1_000;

function validDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) throw new RangeError('invalid date');
}

function nonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${field} must be a non-negative safe integer`);
}

export function isBillableStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

export function available(limit: number, used: number, reserved: number): number {
  nonNegativeSafeInteger(limit, 'limit');
  nonNegativeSafeInteger(used, 'used');
  nonNegativeSafeInteger(reserved, 'reserved');
  return Math.max(0, limit - used - reserved);
}

export function trialEndsAt(start: Date): Date {
  validDate(start);
  const timestamp = start.getTime() + 30 * DAY_MS;
  if (!Number.isSafeInteger(timestamp))
    throw new RangeError('trial end is outside the safe date range');
  return new Date(timestamp);
}

export function periodBoundary(anchor: Date, monthOffset: number): Date {
  validDate(anchor);
  if (!Number.isSafeInteger(monthOffset))
    throw new RangeError('monthOffset must be a safe integer');
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + monthOffset;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(anchor.getUTCDate(), lastDay),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
  validDate(result);
  return result;
}

export function vnBillingDay(at = new Date()): string {
  validDate(at);
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}
