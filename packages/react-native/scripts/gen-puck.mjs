#!/usr/bin/env node
// Sinh src/navigation/puck-image.ts: PNG mũi tên 66×66 hướng bắc (xanh #2458a6, viền trắng, khuyết
// đuôi), siêu lấy mẫu 4× cho mượt, nhúng base64 để tarball không cần file asset (spec C mục 7).
// Chạy: node packages/react-native/scripts/gen-puck.mjs
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const W = 66;
const H = 66;
const S = 4; // mẫu mỗi chiều trên một điểm ảnh
const BLUE = [0x24, 0x58, 0xa6];
const WHITE = [255, 255, 255];
// Mũi tên = hai tam giác (nửa trái/phải) để có khuyết ở đuôi; ruột nhỏ hơn viền ~4 px.
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

const bytes = [];
for (let y = 0; y < H; y++) {
  bytes.push(0); // filter type của dòng
  for (let x = 0; x < W; x++) {
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
    if (alpha === 0) {
      bytes.push(0, 0, 0, 0);
      continue;
    }
    const t = inner / outer;
    for (let k = 0; k < 3; k++) bytes.push(Math.round(WHITE[k] * (1 - t) + BLUE[k] * t));
    bytes.push(Math.round(255 * alpha));
  }
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
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.from(bytes), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = `// Sinh bởi scripts/gen-puck.mjs — KHÔNG sửa tay; chạy lại script nếu đổi hình.
/** Khoá ảnh đăng ký qua <Images> và dùng trong icon-image của layer puck. */
export const PUCK_IMAGE_KEY = 'mapslibvn-puck';
/** PNG 66×66 mũi tên hướng bắc, xanh #2458a6 viền trắng, nền trong suốt. */
export const PUCK_PNG_DATA_URI =
  'data:image/png;base64,${png.toString('base64')}';
`;
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../src/navigation/puck-image.ts');
writeFileSync(target, out);
console.log(`✓ ${target} (${png.length} byte PNG)`);
