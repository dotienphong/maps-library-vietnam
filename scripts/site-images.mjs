#!/usr/bin/env node
// Sinh ảnh cho website: ảnh nền hero (chụp playground thật) và ảnh OG 1200×630 cho từng trang.
//   node scripts/site-images.mjs            — làm cả hai
//   node scripts/site-images.mjs --og       — chỉ ảnh OG (không cần mạng ngoài)
//   node scripts/site-images.mjs --hero     — chỉ ảnh hero
// Ảnh được COMMIT vào repo: build trên Cloudflare Pages không chạy Playwright.
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THU_MUC_OG = resolve(GOC, 'apps/site/public/og');
// JPEG chứ không PNG: đây là ảnh raster nhiều màu như một tấm ảnh chụp, PNG cho ra tệp nặng gấp
// gần mười lần mà mắt không thấy khác. Astro vẫn chuyển sang AVIF/WebP lúc build, tệp này chỉ là
// bản gốc nằm trong repo.
// HAI ảnh chỗ giữ cho khối bản đồ trải ngang: bản tối là mặc định của site, bản sáng cho ai chọn
// sáng. Playground nhận `style=dark|light` qua URL (playground-lib.js `fromSearchParams`).
const ANH_HERO = [
  { tep: resolve(GOC, 'apps/site/src/assets/ban-do-hero.jpg'), style: 'light' },
  { tep: resolve(GOC, 'apps/site/src/assets/ban-do-hero-dark.jpg'), style: 'dark' },
];
// pnpm không nâng dependency lên node_modules gốc, nên font nằm trong node_modules của chính
// apps/site. Nhúng vào HTML dạng base64 để ảnh OG có dấu tiếng Việt vẽ đúng.
// Phải nhúng CẢ hai nét và CẢ hai dải:
//   - thiếu nét 400 thì dòng nhãn và dòng phụ rơi về font hệ thống;
//   - thiếu dải `latin` thì mọi ký tự ASCII ("MapsLibVN", chữ số) rơi về font hệ thống, vì tệp
//     `vietnamese-*` chỉ chứa ký tự riêng của tiếng Việt. Cùng cái bẫy đã gặp ở global.css.
const THU_MUC_FONT = resolve(GOC, 'apps/site/node_modules/@fontsource/be-vietnam-pro/files');
const FONT_NET = [400, 800];
const FONT_DAI = ['latin', 'vietnamese'];

/**
 * `pnpm typecheck` chạy `tsc -p tsconfig.scripts.json` với `checkJs`, nên mọi tham số trong
 * scripts/*.mjs phải có kiểu qua JSDoc. Khai hẹp đúng phần Playwright mà script này dùng, thay vì
 * kéo cả kiểu của @playwright/test vào — gói đó không nằm ở node_modules gốc.
 *
 * @typedef {{ path: string, type?: 'png' | 'jpeg', quality?: number }} TuyChonChup
 * @typedef {{
 *   setContent(html: string, opts?: object): Promise<unknown>,
 *   goto(url: string, opts?: object): Promise<unknown>,
 *   evaluate(fn: Function): Promise<unknown>,
 *   waitForTimeout(ms: number): Promise<unknown>,
 *   screenshot(opts: TuyChonChup): Promise<unknown>,
 * }} Trang
 * @typedef {{ newPage(opts?: object): Promise<Trang>, close(): Promise<unknown> }} TrinhDuyet
 * @typedef {{ launch(opts?: object): Promise<TrinhDuyet> }} Chromium
 * @typedef {{ net: number, b64: string }} NetFont
 */

/** Bốn ảnh OG. `ten` + `-v2` phải KHỚP trường `og` trong apps/site/src/lib/trang.ts. */
const ANH_OG = [
  { ten: 'mac-dinh', tieuDe: 'MapsLibVN', phu: 'API bản đồ và địa điểm Việt Nam' },
  {
    ten: 'trang-chu',
    tieuDe: 'Bản đồ Việt Nam cho ứng dụng của bạn',
    phu: 'Dữ liệu mở · Bốn SDK · Thanh toán bằng VND',
  },
  {
    ten: 'bang-gia',
    tieuDe: 'Giá theo lượt gọi, không theo đầu người',
    phu: 'Dùng thử miễn phí 30 ngày · Gói từ 650.000đ mỗi tháng',
  },
  {
    ten: 'so-sanh',
    tieuDe: 'So sánh chi phí API bản đồ',
    phu: 'MapsLibVN · Google · VIETMAP — kèm giả định và nguồn',
  },
];

/**
 * @param {{ tieuDe: string, phu: string }} noiDung
 * @param {NetFont[]} fontBase64
 * @returns {string}
 */
function trangOg({ tieuDe, phu }, fontBase64) {
  const faces = fontBase64
    .map(
      /** @param {NetFont} net64 */
      ({ net, b64 }) =>
        `@font-face{font-family:'Be Vietnam Pro';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:${net};font-style:normal;}`,
    )
    .join('\n  ');
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8" />
<style>
  ${faces}
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    justify-content: space-between; padding: 72px;
    /* Nền PHẲNG chứ không chuyển màu: PNG nén dải chuyển màu rất kém, một tấm gradient nặng gấp
       gần mười lần cùng nội dung trên nền phẳng. */
    background: #0a0a0a;
    color: #fafafa; font-family: 'Be Vietnam Pro', sans-serif; font-weight: 400;
  }
  .nhan { font-size: 28px; letter-spacing: .04em; color: #a1a1aa; font-weight: 800; }
  /* Gạch nhấn là chỗ DUY NHẤT dùng xanh chanh trên ảnh này — cùng quy tắc một màu nhấn cho một
     việc như trên website. */
  .gach { width: 120px; height: 8px; background: #a3e635; border-radius: 4px; }
  h1 {
    margin-top: 28px; font-size: 62px; line-height: 1.06; max-width: 17ch;
    font-weight: 800; letter-spacing: -.03em;
  }
  .phu { font-size: 29px; color: #a1a1aa; }
</style></head>
<body>
  <div class="nhan">MapsLibVN</div>
  <div><div class="gach"></div><h1>${tieuDe}</h1></div>
  <div class="phu">${phu}</div>
</body></html>`;
}

/** @param {Chromium} chromium */
async function sinhAnhOg(chromium) {
  await mkdir(THU_MUC_OG, { recursive: true });
  const fontBase64 = await Promise.all(
    FONT_NET.flatMap((net) =>
      FONT_DAI.map(async (dai) => ({
        net,
        b64: (
          await readFile(resolve(THU_MUC_FONT, `be-vietnam-pro-${dai}-${net}-normal.woff2`))
        ).toString('base64'),
      })),
    ),
  );
  const trinhDuyet = await chromium.launch();
  try {
    const trang = await trinhDuyet.newPage({ viewport: { width: 1200, height: 630 } });
    for (const anh of ANH_OG) {
      await trang.setContent(trangOg(anh, fontBase64), { waitUntil: 'load' });
      // Chờ font nạp xong, nếu không chữ có dấu bị vẽ bằng font dự phòng rồi mới đổi.
      await trang.evaluate(() => document.fonts.ready);
      // Tên có hậu tố phiên bản: mạng xã hội cache ảnh OG theo URL, giữ tên cũ thì bản navy còn
      // sống trong bộ nhớ đệm của Facebook/Zalo rất lâu sau khi đã đổi.
      const duong = resolve(THU_MUC_OG, `${anh.ten}-v2.png`);
      await trang.screenshot({ path: duong });
      const { size } = await stat(duong);
      console.log(`  og/${anh.ten}-v2.png — ${Math.round(size / 1024)} KB`);
    }
  } finally {
    await trinhDuyet.close();
  }
}

/** @param {Chromium} chromium */
async function chupHero(chromium) {
  const { DOCS_URL } = await import('../apps/site/site.config.mjs');
  const trinhDuyet = await chromium.launch();
  try {
    for (const { tep, style } of ANH_HERO) {
      await mkdir(dirname(tep), { recursive: true });
      // 1600×700: khối bản đồ trải ngang cao 520 px trong khung 1200, ảnh gốc rộng hơn một bậc là
      // đủ cho màn hình mật độ cao mà không phình tệp.
      const trang = await trinhDuyet.newPage({ viewport: { width: 1600, height: 700 } });
      // `load` + chờ cố định chứ KHÔNG `networkidle`: playground có nhịp hỏi lại nhẹ nên networkidle
      // có thể không bao giờ tới. Dùng `/playground` chứ không `/playground.html` (đích 308).
      await trang.goto(`${DOCS_URL}/playground?embed=1&style=${style}`, {
        waitUntil: 'load',
        timeout: 60_000,
      });
      // Tile vẽ xong sau khi tải: chờ thêm để bản đồ không bị chụp lúc còn loang lổ.
      await trang.waitForTimeout(6_000);
      await trang.screenshot({ path: tep, type: 'jpeg', quality: 82 });
      const { size } = await stat(tep);
      console.log(`  ${basename(tep)} (${style}) — ${Math.round(size / 1024)} KB`);
    }
  } finally {
    await trinhDuyet.close();
  }
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const chiOg = argv.includes('--og');
  const chiHero = argv.includes('--hero');
  // pnpm không nâng dependency lên gốc, và Node phân giải tên gói theo thư mục của CHÍNH file
  // này (scripts/), nơi không có node_modules. Phân giải từ apps/site — nơi thật sự khai
  // @playwright/test — rồi import bằng đường dẫn tuyệt đối.
  const timTu = createRequire(pathToFileURL(resolve(GOC, 'apps/site/package.json')));
  const mo = await import(pathToFileURL(timTu.resolve('@playwright/test')).href);
  // @playwright/test là gói CommonJS, nên import động gói nó vào `default`; lấy cả hai dạng để
  // script không vỡ nếu gói chuyển sang ESM ở bản sau.
  const chromium = mo.chromium ?? mo.default?.chromium;
  if (!chromium) throw new Error('Không lấy được chromium từ @playwright/test');

  if (!chiHero) {
    console.log('Sinh ảnh OG…');
    await sinhAnhOg(chromium);
  }

  if (!chiOg) {
    console.log('Chụp bản đồ cho hero…');
    try {
      await chupHero(chromium);
    } catch (loi) {
      // KHÔNG chặn: website dựng được mà không có ảnh hero, lúc đó hero hiện nền màu.
      // Chặn ở đây nghĩa là mất mạng thì không build được website, đổi lấy một tấm ảnh.
      console.warn(`  BỎ QUA ảnh hero: ${loi instanceof Error ? loi.message : loi}`);
      console.warn('  Website vẫn dựng được; khối bản đồ sẽ hiện nền màu thay vì ảnh.');
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(await main(process.argv.slice(2)));
}
