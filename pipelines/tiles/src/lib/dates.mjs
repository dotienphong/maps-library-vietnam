/** @param {Date} date */
export function stampVN(date) {
  const vietnamTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vietnamTime.toISOString().slice(0, 10).replace(/-/g, '');
}

/** @param {'vn' | 'poi'} prefix @param {Date} [date] */
export function releaseName(prefix, date = new Date()) {
  return `${prefix}-${stampVN(date)}`;
}
