#!/usr/bin/env node
// Sinh src/navigation/puck-image.ts với HAI ảnh PNG 66×66 nhúng base64 (tarball không cần file asset):
//  1. Mũi tên hướng bắc cho puck dẫn đường (xanh #2458a6, viền trắng, khuyết đuôi — spec C mục 7).
//  2. Nón hướng cho chấm xanh ngoài dẫn đường: hình quạt 70° mở lên trên từ tâm ảnh, alpha 0,45 ở
//     tâm mờ dần về 0 ở mép (spec la bàn mục 7). Tâm ảnh = tâm chấm nên icon-anchor 'center' là đúng.
// Siêu lấy mẫu 4× mỗi chiều. Chạy: node packages/react-native/scripts/gen-puck.mjs
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const W = 66;
const H = 66;
const S = 4; // mẫu mỗi chiều trên một điểm ảnh
const BLUE = [0x24, 0x58, 0xa6];
const WHITE = [255, 255, 255];

// ---------- mũi tên ----------
// Hai tam giác (nửa trái/phải) để có khuyết ở đuôi; ruột nhỏ hơn viền ~4 px.
const OUTER = [
  [
    [33, 3],
    [60, 60],
    [33, 48],
  ],
  [
    [33, 3],
    [6, 60],
    [33, 48],
  ],
];
const INNER = [
  [
    [33, 10],
    [53, 55],
    [33, 44],
  ],
  [
    [33, 10],
    [13, 55],
    [33, 44],
  ],
];

/** @param {number} px @param {number} py @param {number[][]} t */
function insideTri(px, py, t) {
  const [[x1, y1], [x2, y2], [x3, y3]] = t;
  const d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3);
  const d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
/** @param {number} px @param {number} py @param {number[][][]} tris */
const inAny = (px, py, tris) => tris.some((t) => insideTri(px, py, t));

/** RGBA một điểm ảnh mũi tên. @param {number} x @param {number} y @returns {number[]} */
function arrowPixel(x, y) {
  let outer = 0;
  let inner = 0;
  for (let sy = 0; sy < S; sy++) {
    for (let sx = 0; sx < S; sx++) {
      const px = x + (sx + 0.5) / S;
      const py = y + (sy + 0.5) / S;
      if (inAny(px, py, OUTER)) outer += 1;
      if (inAny(px, py, INNER)) inner += 1;
    }
  }
  const alpha = outer / (S * S);
  if (alpha === 0) return [0, 0, 0, 0];
  const t = inner / outer;
  const rgb = [0, 1, 2].map((k) => Math.round(WHITE[k] * (1 - t) + BLUE[k] * t));
  return [...rgb, Math.round(255 * alpha)];
}

// ---------- nón hướng ----------
const CX = 33;
const CY = 33;
const R_IN = 6; // chấm (bán kính 7 px ở icon-size 1) che phần này
const R_OUT = 31;
const HALF_ANGLE_DEG = 35;

/** Alpha 0..0,45 của một mẫu con thuộc quạt; 0 ngoài quạt. @param {number} px @param {number} py */
function coneAlpha(px, py) {
  const dx = px - CX;
  const dy = py - CY;
  const r = Math.hypot(dx, dy);
  if (r < R_IN || r > R_OUT) return 0;
  const angle = Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI); // 0 = hướng lên (bắc)
  if (angle > HALF_ANGLE_DEG) return 0;
  return 0.45 * (1 - (r - R_IN) / (R_OUT - R_IN));
}

/** RGBA một điểm ảnh nón. @param {number} x @param {number} y @returns {number[]} */
function conePixel(x, y) {
  let sum = 0;
  for (let sy = 0; sy < S; sy++) {
    for (let sx = 0; sx < S; sx++) {
      sum += coneAlpha(x + (sx + 0.5) / S, y + (sy + 0.5) / S);
    }
  }
  const alpha = sum / (S * S);
  if (alpha === 0) return [0, 0, 0, 0];
  return [...BLUE, Math.round(255 * alpha)];
}

// ---------- PNG ----------
/** @param {(x: number, y: number) => number[]} pixel */
function render(pixel) {
  const bytes = [];
  for (let y = 0; y < H; y++) {
    bytes.push(0); // filter type của dòng
    for (let x = 0; x < W; x++) bytes.push(...pixel(x, y));
  }
  return Buffer.from(bytes);
}
/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** @param {Buffer} raw */
function encodePng(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const arrow = encodePng(render(arrowPixel));
const cone = encodePng(render(conePixel));

const out = `// Sinh bởi scripts/gen-puck.mjs — KHÔNG sửa tay; chạy lại script nếu đổi hình.
/** Khoá ảnh đăng ký qua <Images> và dùng trong icon-image của layer puck. */
export const PUCK_IMAGE_KEY = 'mapslibvn-puck';
/** PNG 66×66 mũi tên hướng bắc, xanh #2458a6 viền trắng, nền trong suốt. */
export const PUCK_PNG_DATA_URI =
  'data:image/png;base64,${arrow.toString('base64')}';
/** Khoá ảnh nón hướng của chấm xanh ngoài dẫn đường (spec la bàn mục 7). */
export const HEADING_CONE_IMAGE_KEY = 'mapslibvn-heading-cone';
/** PNG 66×66 hình quạt 70° mở lên trên từ tâm, xanh #2458a6 mờ dần ra mép, nền trong suốt. */
export const HEADING_CONE_PNG_DATA_URI =
  'data:image/png;base64,${cone.toString('base64')}';
`;
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../src/navigation/puck-image.ts');
writeFileSync(target, out);
console.log(`✓ ${target} (mũi tên ${arrow.length} byte, nón ${cone.length} byte)`);
