#!/usr/bin/env node
// Báo IndexNow (Bing, Yandex, Naver, Seznam) những URL vừa đổi, quanh mỗi lần deploy:
//   node scripts/indexnow.mjs truoc --dist apps/site/dist --site https://mapslibvn.pages.dev
//   node scripts/indexnow.mjs gui --site https://mapslibvn.pages.dev
// `truoc` chạy SAU build, TRƯỚC deploy: so chữ trong <main> của bản mới với bản ĐANG chạy, ghi
// payload ra tệp tạm (--out, mặc định trong thư mục tạm của máy). `gui` chạy SAU deploy: POST payload
// đó (--list). Google không nhận IndexNow — với Google là sitemap và Search Console (spec SEO-AI
// mục 7–8). KHÔNG BAO GIỜ thoát khác 0: IndexNow hỏng thì deploy vẫn phải xanh, lỗi chỉ in
// ::warning:: để thấy trong log GitHub Actions.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.indexnow.org/indexnow';
const SONG_SONG = 4;
const CHO_MS = 10_000;

/**
 * @typedef {{ host: string, key: string, keyLocation: string, urlList: string[] }} Payload
 * @typedef {(url: string, init?: RequestInit) => Promise<Response>} HamFetch
 */

/**
 * Chữ nhìn thấy trong <main> (thiếu thì <body>), bỏ script/style/thẻ, gộp khoảng trắng. So chữ
 * chứ không so HTML thô: tên tệp asset đổi sau mỗi lần build không được tính là trang đổi.
 * @param {string} html
 * @returns {string}
 */
export function chuTrongMain(html) {
  const khoi =
    /<main[\s>][\s\S]*<\/main>/i.exec(html)?.[0] ??
    /<body[\s>][\s\S]*<\/body>/i.exec(html)?.[0] ??
    html;
  return khoi
    .replace(/<(script|style)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} xml
 * @returns {string[]}
 */
export function urlTrongSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].flatMap((m) => (m[1] ? [m[1].trim()] : []));
}

/**
 * URL → tệp HTML trong dist: `/x/` là `x/index.html`; `/playground` là tệp tĩnh `playground.html`.
 * @param {string} dist
 * @param {string} url
 * @returns {string}
 */
export function tepChoUrl(dist, url) {
  const duong = decodeURIComponent(new URL(url).pathname);
  return duong.endsWith('/') ? join(dist, duong, 'index.html') : join(dist, `${duong}.html`);
}

/**
 * Khoá IndexNow là TÊN và NỘI DUNG của một tệp `<32 hex>.txt` ở gốc dist — tệp là nguồn sự thật
 * duy nhất, không có hằng nào phải giữ khớp.
 * @param {string} dist
 * @returns {string | undefined}
 */
export function timKhoa(dist) {
  for (const ten of readdirSync(dist)) {
    const khop = /^([0-9a-f]{32})\.txt$/.exec(ten);
    if (khop?.[1] && readFileSync(join(dist, ten), 'utf8').trim() === khop[1]) return khop[1];
  }
  return undefined;
}

/**
 * @param {string} dist
 * @returns {string[]}
 */
function urlTrongDist(dist) {
  return readdirSync(dist)
    .filter((ten) => /^sitemap-\d+\.xml$/.test(ten))
    .flatMap((ten) => urlTrongSitemap(readFileSync(join(dist, ten), 'utf8')));
}

/**
 * @param {HamFetch} fetchFn
 * @param {string} url
 * @returns {Promise<string | undefined>} undefined = lỗi mạng hoặc không phải 200
 */
async function taiChu(fetchFn, url) {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(CHO_MS) });
    return res.status === 200 ? await res.text() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * URL trong sitemap đang chạy. Lỗi mạng → [] (coi như mọi URL đều mới).
 * @param {HamFetch} fetchFn
 * @param {string} site
 * @returns {Promise<string[]>}
 */
async function urlDangChay(fetchFn, site) {
  const index = await taiChu(fetchFn, `${site}/sitemap-index.xml`);
  if (!index) return [];
  const con = await Promise.all(urlTrongSitemap(index).map((url) => taiChu(fetchFn, url)));
  return con.flatMap((xml) => (xml ? urlTrongSitemap(xml) : []));
}

/**
 * Chạy `viec` cho từng phần tử, tối đa `n` việc cùng lúc; kết quả giữ đúng thứ tự đầu vào.
 * @template T, R
 * @param {readonly T[]} ds
 * @param {number} n
 * @param {(x: T) => Promise<R>} viec
 * @returns {Promise<R[]>}
 */
async function chayGioiHan(ds, n, viec) {
  /** @type {R[]} */
  const kq = new Array(ds.length);
  let tiep = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, ds.length) }, async () => {
      while (tiep < ds.length) {
        const i = tiep++;
        kq[i] = await viec(/** @type {T} */ (ds[i]));
      }
    }),
  );
  return kq;
}

/**
 * Danh sách cần báo = URL mới + URL chữ đổi + URL bị bỏ khỏi sitemap. Không so được (mất mạng,
 * bản đang chạy không phải 200) thì coi là đổi: báo thừa còn hơn bỏ sót.
 * @param {{ dist: string, site: string, fetchFn: HamFetch }} vao
 * @returns {Promise<Payload>}
 */
export async function lapPayload({ dist, site, fetchFn }) {
  const key = timKhoa(dist);
  if (!key) throw new Error(`không thấy tệp khoá <32 hex>.txt trong ${dist}`);
  const moi = urlTrongDist(dist);
  const cu = await urlDangChay(fetchFn, site);
  const doi = await chayGioiHan(moi, SONG_SONG, async (url) => {
    const dang = await taiChu(fetchFn, url);
    const tep = tepChoUrl(dist, url);
    if (dang === undefined || !existsSync(tep)) return url;
    return chuTrongMain(dang) === chuTrongMain(readFileSync(tep, 'utf8')) ? undefined : url;
  });
  const boDi = cu.filter((url) => !moi.includes(url));
  const urlList = [...new Set([...doi.filter((url) => url !== undefined), ...boDi])];
  return { host: new URL(site).host, key, keyLocation: `${site}/${key}.txt`, urlList };
}

/**
 * @param {Payload} payload
 * @param {HamFetch} fetchFn
 * @returns {Promise<number>} mã HTTP; 0 nếu lỗi mạng
 */
async function guiPayload(payload, fetchFn) {
  try {
    const res = await fetchFn(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(CHO_MS),
    });
    return res.status;
  } catch {
    return 0;
  }
}

/**
 * @param {string[]} argv
 * @param {string} ten
 * @returns {string | undefined}
 */
function thamSo(argv, ten) {
  const i = argv.indexOf(ten);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** @param {string} tin */
const canhBao = (tin) => console.log(`::warning::IndexNow: ${tin}`);

/**
 * @param {string[]} argv
 * @param {HamFetch} [fetchFn]
 * @returns {Promise<number>} luôn 0
 */
export async function main(argv, fetchFn = fetch) {
  const [lenh] = argv;
  const site = thamSo(argv, '--site')?.replace(/\/+$/, '');
  if (!site || (lenh !== 'truoc' && lenh !== 'gui')) {
    canhBao('dùng: truoc --dist <thư mục> --site <URL> | gui --site <URL>');
    return 0;
  }
  const macDinh = join(tmpdir(), `indexnow-${new URL(site).host}.json`);

  if (lenh === 'truoc') {
    const out = thamSo(argv, '--out') ?? macDinh;
    try {
      const dist = thamSo(argv, '--dist');
      if (!dist) throw new Error('thiếu --dist');
      const payload = await lapPayload({ dist, site, fetchFn });
      writeFileSync(out, JSON.stringify(payload));
      console.log(`IndexNow: ${payload.urlList.length} URL sẽ báo sau deploy`);
      for (const url of payload.urlList) console.log(`  ${url}`);
    } catch (loi) {
      canhBao(
        `không lập được danh sách (${loi instanceof Error ? loi.message : loi}) — bỏ lần này`,
      );
      // Ghi đè bằng null để `gui` không gửi nhầm danh sách cũ còn sót trong thư mục tạm.
      writeFileSync(out, 'null');
    }
    return 0;
  }

  const list = thamSo(argv, '--list') ?? macDinh;
  if (!existsSync(list)) {
    canhBao(`không có ${list} — bước truoc chưa chạy?`);
    return 0;
  }
  const payload = /** @type {Payload | null} */ (JSON.parse(readFileSync(list, 'utf8')));
  if (!payload || payload.urlList.length === 0) {
    console.log('IndexNow: không có URL đổi, không gửi.');
    return 0;
  }
  const ma = await guiPayload(payload, fetchFn);
  if (ma === 200 || ma === 202) {
    console.log(`IndexNow: đã báo ${payload.urlList.length} URL (HTTP ${ma}).`);
  } else {
    canhBao(`HTTP ${ma || 'lỗi mạng'} khi gửi ${payload.urlList.length} URL`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
