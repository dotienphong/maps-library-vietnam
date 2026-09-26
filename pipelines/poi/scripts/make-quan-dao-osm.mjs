#!/usr/bin/env node
// Dựng data/quan-dao-osm.json — ảnh chụp OSM hai quần đảo đã lọc theo chính sách (lib/quan-dao.mjs), là nguồn
// DUY NHẤT của POI Hoàng Sa/Trường Sa. Extract Geofabrik VN không có Hoàng Sa và thiếu Trường Sa Lớn, Sinh Tồn,
// Nam Yết, Sơn Ca (Geofabrik xếp vào extract Philippines/không extract nào), nên lấy từ Overpass MỘT LẦN rồi
// commit: máy chủ nào (kể cả Windows) cũng dựng ra y hệt, không phụ thuộc mạng lúc data:update.
// Lọc NGAY khi lấy: repo không chứa cơ sở/tên của nước chiếm giữ, chỉ chứa thứ sẽ lên production.
// Chạy tay khi cần làm mới (tên/cơ sở mới trên đảo ta giữ): node pipelines/poi/scripts/make-quan-dao-osm.mjs
// Máy ở VN cần cờ này cho Node (RTT tới Overpass > 250 ms, xem infra/server/compose.yml):
//   NODE_OPTIONS=--network-family-autoselection-attempt-timeout=2000
import { writeFileSync } from 'node:fs';
import { QUAN_DAO_OSM } from '../src/lib/env.mjs';
import { keepSourceFeature } from '../src/lib/osm-extended.mjs';
import { OSM_POI_FILTERS } from '../src/lib/osm-filters.mjs';
import { chinhSach, docDao, docTaGiu, vungQuanDao } from '../src/lib/quan-dao.mjs';

const OVERPASS = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

/** `nwr/key=v1,v2` (cú pháp osmium) → mệnh đề Overpass trong vùng `poly`. @param {string} filter @param {string} poly */
function menhDe(filter, poly) {
  const [, spec = ''] = filter.split('/');
  const [key = '', values] = spec.split('=');
  const k = JSON.stringify(key);
  return values
    ? `nwr(poly:"${poly}")[${k}~"^(${values.split(',').join('|')})$"];`
    : `nwr(poly:"${poly}")[${k}];`;
}

const polys = vungQuanDao().map((v) => v.ring.map(([lon, lat]) => `${lat} ${lon}`).join(' '));
const filters = [...OSM_POI_FILTERS, 'nwr/natural=reef,shoal,bare_rock'];
const query = `[out:json][timeout:300];(${polys
  .flatMap((poly) => filters.map((f) => menhDe(f, poly)))
  .join('')});out center tags;`;

// Overpass trả 406 cho request không có User-Agent (fetch của Node không tự gửi), và 429/504 khi quá tải
// hoặc gọi dồn — thử lại có giãn cách thay vì bắt người chạy tự đoán.
/** @returns {Promise<Response>} */
async function goiOverpass() {
  for (let lan = 1; ; lan++) {
    const r = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'User-Agent': 'mapslibvn-pipeline/quan-dao-osm', Accept: 'application/json' },
      body: new URLSearchParams({ data: query }),
    });
    if (r.ok || ![429, 502, 503, 504].includes(r.status) || lan >= 5) return r;
    const cho = 30_000 * 2 ** (lan - 1);
    console.warn(`! Overpass HTTP ${r.status}, thử lại sau ${cho / 1000} s (lần ${lan}/4)`);
    await new Promise((resolve) => setTimeout(resolve, cho));
  }
}
const res = await goiOverpass();
if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
const data = /** @type {{ osm3s?: { timestamp_osm_base?: string }, elements: any[] }} */ (
  await res.json()
);

const ctx = { dao: docDao(), taGiu: docTaGiu() };
/** @type {Map<string, { osm_type: string, osm_id: string, lon: number, lat: number, tags: Record<string, string> }>} */
const nhan = new Map();
for (const e of data.elements) {
  const lon = e.lon ?? e.center?.lon;
  const lat = e.lat ?? e.center?.lat;
  if (typeof lon !== 'number' || typeof lat !== 'number') continue;
  const osmType = String(e.type)[0] ?? '';
  const osmId = String(e.id);
  const out = chinhSach({ osmType, osmId, lon, lat, tags: e.tags ?? {} }, ctx);
  if (!out || !keepSourceFeature(out.tags)) continue;
  nhan.set(`${osmType}${osmId}`, {
    osm_type: osmType,
    osm_id: osmId,
    lon: Math.round(lon * 1e7) / 1e7,
    lat: Math.round(lat * 1e7) / 1e7,
    tags: out.tags,
  });
}

const thieu = [...ctx.dao.keys()].filter((k) => !nhan.has(k));
if (thieu.length > 0)
  console.warn(
    `! ${thieu.length} đảo trong danh sách duyệt không thấy trên Overpass: ${thieu.join(', ')}`,
  );

const doiTuong = [...nhan.values()].sort((a, b) =>
  a.osm_type === b.osm_type
    ? Number(a.osm_id) - Number(b.osm_id)
    : a.osm_type.localeCompare(b.osm_type),
);
writeFileSync(
  QUAN_DAO_OSM,
  `${JSON.stringify(
    {
      nguon: `Overpass API (${OVERPASS}), OSM tới ${data.osm3s?.timestamp_osm_base ?? '?'}; lọc bằng lib/quan-dao.mjs`,
      ban_quyen: '© OpenStreetMap contributors, ODbL 1.0',
      doi_tuong: doiTuong,
    },
    null,
    1,
  )}\n`,
);
const theoVung = Object.groupBy(doiTuong, (d) => (d.lat > 14 ? 'hoang_sa' : 'truong_sa'));
console.log(
  `✓ ${QUAN_DAO_OSM}: ${doiTuong.length} đối tượng (Hoàng Sa ${theoVung.hoang_sa?.length ?? 0}, Trường Sa ${theoVung.truong_sa?.length ?? 0}) từ ${data.elements.length} phần tử Overpass`,
);
