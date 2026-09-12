import { signedDiffDeg, wrapDeg } from '@mapslibvn/core';

/** Cạnh view puck (dp) — cố định để MarkerView đo được trước khi gắn vào map (Android cần). */
export const PUCK_SIZE = 44;
/** Chấm: bán kính 7 dp, viền trắng 2,5 dp — như `circle-radius`/`circle-stroke-width` bản layer cũ. */
export const DOT_RADIUS = 7;
export const DOT_STROKE = 2.5;
/** Nón: ảnh 66×66 px hiển thị 33 dp — như `icon-size: 0.5` bản layer cũ. */
export const CONE_SIZE = 33;

/**
 * Góc tiếp theo trên trục liên tục (không quấn về [0, 360)): `Animated` nội suy tuyến tính giữa hai số nên
 * 350 → 10 phải thành 350 → 370, không phải quay ngược 340°.
 */
export function unwrapTo(prevUnwrapped: number, heading: number): number {
  return prevUnwrapped + signedDiffDeg(heading, wrapDeg(prevUnwrapped));
}

/**
 * Thời lượng tween = khoảng cách hai lần phát (kẹp 16–250 ms): nội suy tuyến tính vừa chạm đích thì lần
 * phát kế đến → chuyển động liên tục ở mọi nhịp cảm biến, trễ tối đa một nhịp.
 */
export function tweenDuration(dt_ms: number): number {
  if (!Number.isFinite(dt_ms)) return 16;
  return Math.max(16, Math.min(250, dt_ms));
}
