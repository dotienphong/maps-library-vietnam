import type { DirectionsLang, RouteStep } from '../types';
import type { Announcement, NavigationProgress, NavigationThresholds } from './types';

const viNumber = (value: string): string => value.replace('.', ',');

/** "85 mét", "1,2 ki-lô-mét" (viết đủ để giọng đọc phát âm đúng), "12 ki-lô-mét"; en tương ứng. */
export function formatDistance(m: number, lang: DirectionsLang = 'vi'): string {
  const vi = lang === 'vi';
  if (m < 1000) {
    const n = Math.max(0, Math.round(m));
    return vi ? `${n} mét` : `${n} meters`;
  }
  const km = m / 1000;
  if (km < 10) {
    const s = km.toFixed(1);
    return vi ? `${viNumber(s)} ki-lô-mét` : `${s} kilometers`;
  }
  const n = Math.round(km);
  return vi ? `${n} ki-lô-mét` : `${n} kilometers`;
}

/** Bản ngắn cho UI: "85 m", "1,2 km", "12 km". */
export function formatDistanceShort(m: number): string {
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  const km = m / 1000;
  return km < 10 ? `${viNumber(km.toFixed(1))} km` : `${Math.round(km)} km`;
}

/** ≥ 200 m làm tròn 50; dưới 200 m làm tròn 10; tối thiểu 10. */
export function roundForSpeech(m: number): number {
  if (m >= 200) return Math.round(m / 50) * 50;
  return Math.max(10, Math.round(m / 10) * 10);
}

export function lowerFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/** "Trong 190 mét nữa, rẽ phải vào Nguyễn Du." — Valhalla 3.8.3 không tự ghép khoảng cách vào alert. */
export function composeApproach(
  distance_m: number,
  step: RouteStep,
  lang: DirectionsLang,
): string | null {
  const cue = step.verbal_alert ?? step.verbal_pre;
  if (!cue) return null;
  const d = formatDistance(roundForSpeech(distance_m), lang);
  return lang === 'vi' ? `Trong ${d} nữa, ${lowerFirst(cue)}` : `In ${d}, ${lowerFirst(cue)}`;
}

/**
 * Lịch đọc spec B mục 4.5. `announced` giữ khoá `${stepIndex}:${kind}` đã đọc (navigator xoá khi đổi
 * tuyến). `stepChanged` = fix này vừa đổi step (hoặc là fix đầu).
 */
export function planAnnouncements(
  p: NavigationProgress,
  th: NavigationThresholds,
  lang: DirectionsLang,
  announced: Set<string>,
  stepChanged: boolean,
): Announcement[] {
  const out: Announcement[] = [];
  const push = (
    stepIndex: number,
    kind: Announcement['kind'],
    text: string | null,
    priority: Announcement['priority'],
  ): void => {
    if (!text) return;
    const key = `${stepIndex}:${kind}`;
    if (announced.has(key)) return;
    announced.add(key);
    out.push({ text, kind, stepIndex, priority });
  };

  const longEnough = p.step.distance_m > th.approach_m + th.pre_m;
  if (p.step.kind === 'depart') push(p.stepIndex, 'depart', p.step.verbal_pre, 3);
  else if (stepChanged && longEnough) push(p.stepIndex, 'post', p.step.verbal_post, 1);

  const next = p.nextStep;
  if (next) {
    const nextIndex = p.stepIndex + 1;
    const d = p.distanceToStep_m;
    if (d <= th.approach_m && longEnough) {
      push(nextIndex, 'approach', composeApproach(d, next, lang), 2);
    }
    if (d <= th.pre_m)
      push(nextIndex, next.kind === 'arrive' ? 'arrive' : 'pre', next.verbal_pre, 3);
  }
  return out;
}
