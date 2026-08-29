/** @param {Date} d tên theo giờ VN */
export function backupName(d) {
  const vn = new Date(d.getTime() + 7 * 3600 * 1000).toISOString();
  return `mapslibvn-${vn.slice(0, 10).replace(/-/g, '')}-${vn.slice(11, 16).replace(':', '')}.dump.zst`;
}

/**
 * @param {{ daily: string[], weekly: string[] }} existing tên file trong backups/daily và backups/weekly
 * @param {{ keepDaily: number, keepWeekly: number }} keep
 */
export function retentionPlan(existing, keep) {
  const oldest = (/** @type {string[]} */ names, /** @type {number} */ n) => {
    const sorted = [...names].sort();
    return sorted.slice(0, Math.max(0, sorted.length - n));
  };
  return {
    deleteDaily: oldest(existing.daily, keep.keepDaily),
    deleteWeekly: oldest(existing.weekly, keep.keepWeekly),
  };
}
