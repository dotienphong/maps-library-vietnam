# Làm giàu kho POI — nhóm "làm được ngay" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (PHONG chốt 25/09: làm thẳng trên `main`, inline từng task) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tăng số POI tìm được và chất lượng kho POI mà không thêm nguồn mới: siết luật tự duyệt M4, dọn FSQ theo cờ của chính FSQ, khai thác thêm tag tên/liên hệ OSM, mở rộng bộ lọc tag OSM, và có báo cáo độ phủ theo tỉnh.

**Architecture:** Mọi thay đổi dữ liệu nằm trong pipeline POI (`pipelines/poi/src`) và chỉ có hiệu lực ở lần `data:update --poi` kế tiếp trên máy chủ; API chỉ đổi ở luật duyệt M4. Không đổi schema `poi`, không thêm nguồn vào CHECK `source`, không đổi chuỗi ghi nguồn. Migration duy nhất (0025) chỉ thêm cột vào `src_fsq_place` — bảng API không đọc.

**Tech Stack:** Node 22 ESM (`.mjs` + checkJs), Postgres/PostGIS, osmium, DuckDB, vitest, Hono/Workers.

**Nguồn số liệu:** khảo sát 26/09/2026 (memory `lam-giau-nguon-poi-26-09`) và phép đo lại trên
`work/data/sources/vietnam-260925.osm.pbf` (Geofabrik 25/09/2026) + FSQ OS Places 2026-09-15 toàn
quốc — kết quả thô ở scratchpad phiên 26/09 (`do-lai/A..D`), số chính chép vào evidence ở Task 7.

---

## Quyết định (đã chốt khi viết plan)

1. **M4 theo danh sách trắng.** Ngoài tenant `internal` gửi bằng khoá `server`, chỉ update CHỈ đổi
   `hours` (đúng cú pháp opening_hours) bằng khoá `server` mới được tự duyệt (quality ≥ 60 hoặc
   ≥ 2 tenant). Khoá web/mobile, kể cả của `internal`, luôn chờ admin.
2. **FSQ:** lưu `date_created`, `date_refreshed`, `unresolved_flags` vào `src_fsq_place`. Bỏ bản
   ghi có cờ `doesnt_exist`/`delete`/`inappropriate`/`privatevenue` (686 sau lọc ranh giới; mẫu 20
   `privatevenue` có 2 nhà riêng và 4 rác — ưu tiên riêng tư theo Luật 91/2025). Coi cờ `closed` là
   đóng cửa (2.653 POI đang active dù FSQ bị báo đóng). **Chưa** đưa `date_refreshed` vào recency:
   làm vậy hạ 16.557 POI FSQ dưới 60 trong khi OSM vẫn giữ recency giả → lệch thang giữa hai nguồn;
   để việc riêng cùng timestamp OSM.
3. **Tên OSM:** thêm `name:vi`, `short_name`, `loc_name`, `int_name` vào `nameAlt` (+1.556 POI tìm
   được thêm); tách giá trị `;` trong mọi tag tên (56 POI đang bị gộp `A;B`). Tên dự phòng cho POI
   không tên theo thứ tự `name:vi → name:en → brand → operator`, chặn tên chung chung và `name:en`
   dạng mô tả; ATM đặt tên `ATM <ngân hàng>` qua bảng ngân hàng (bỏ ngân hàng đã sáp nhập/rút khỏi/
   chuyển giao bắt buộc, đổi tên ngân hàng đổi thương hiệu, bỏ máy POS và bản không có dấu hiệu ngân
   hàng). Không dùng tên CJK/ngoại ngữ khác làm tên dự phòng.
4. **Email OSM** (`email`, `contact:email`) vào `contact.email[]`, chỉ trả qua place detail (không
   vào tiles). Bỏ email hộp thư miễn phí (gmail/yahoo/hotmail/outlook/icloud…) vì nhiều khả năng là
   hộp thư cá nhân (Luật 91/2025). Đóng góp M4 không sửa được email.
5. **Mở rộng bộ lọc tag OSM:** xem Task 4 (danh sách tag chốt theo số đo nhánh A).
6. **Không làm trong plan này:** lọc rác FSQ `other` không liên hệ (10,8k), bỏ nhãn Event (566),
   cuisine, recency theo timestamp/`date_refreshed`, nguồn mới (ATP, CSDL Du lịch, Bộ Y tế…).

## File Structure

- `apps/api/src/edits/rules.ts`, `apps/api/src/edits/validate.ts`, `apps/api/src/routes/edits.ts` — luật duyệt (Task 1, xong).
- `db/migrations/0025_fsq_quality_columns.sql` (+ `.down.sql`) — cột mới `src_fsq_place`.
- `pipelines/poi/src/ingest/fsq.mjs` — đọc thêm 3 cột.
- `pipelines/poi/src/lib/fsq-flags.mjs` (mới) — quyết định bỏ/đóng theo `unresolved_flags`.
- `pipelines/poi/src/lib/osm-names.mjs` (mới) — tách `;`, dựng `nameAlt`, tên dự phòng, email.
- `pipelines/poi/src/lib/vn-banks.mjs` (mới) — bảng ngân hàng cho tên ATM.
- `pipelines/poi/src/records.mjs` — gọi hai module trên.
- `pipelines/poi/src/ingest/osm.mjs`, `pipelines/poi/src/taxonomy.mjs`, `db/seed/category.json`, `db/seed/category_map_osm.csv`, `pipelines/poi/src/export-tiles.mjs` — Task 4.
- `pipelines/poi/src/report.mjs` — `byProvince`.
- Test: `apps/api/test/edits-*.test.ts`, `apps/api/test-db/edits.itest.mjs`, `pipelines/poi/tests/{fsq-flags,osm-names,records,taxonomy,export-tiles}.test.mjs`, `db/schema.dbtest.mjs`.

---

### Task 1: Siết luật tự duyệt M4 — XONG

- [x] Commit `595878d`: chỉ khoá server; contact/name chờ admin; đồng thuận đếm tenant + khoá server.
- [x] Review độc lập tìm thêm lỗ (đồng thuận vẫn duyệt close/lat-lng/địa chỉ và sinh mốc geocode;
  `hours` chữ tự do; internal miễn kiểm với khoá web; phiếu của khoá đã thu hồi).
- [x] Commit `1d5e3ce`: danh sách trắng + cú pháp opening_hours + lọc khoá đã thu hồi; itest 142/142
  (5 ca mới đỏ trên `595878d`), unit API 873/873, docs `/dong-gop/` + spec 6.5.
- [x] Push hai commit này RIÊNG, trước khi có migration 0025 (cổng `check:migration` chặn Deploy API
  khi repo có migration production chưa áp). Kiểm Deploy API xanh + `/healthz/db`.

Việc treo từ review (không chặn): `apply_poi_edit` gắn nhãn `auto:consensus` cho phiếu trùng kể cả
khi duyệt tay (cần migration hàm); chưa lưu giá trị cũ để hoàn tác; lệnh thu hồi bằng SQL không xoá
cache KV auth (300 s); rà các edit đã tự duyệt trước 26/09 (PHONG chạy truy vấn ở Task 7).

### Task 2: FSQ — cột chất lượng + bỏ/đóng theo cờ

**Files:** Create `db/migrations/0025_fsq_quality_columns.sql`, `db/migrations/0025_fsq_quality_columns.down.sql`, `pipelines/poi/src/lib/fsq-flags.mjs`, `pipelines/poi/tests/fsq-flags.test.mjs`; Modify `pipelines/poi/src/ingest/fsq.mjs`, `pipelines/poi/src/records.mjs`, `db/schema.dbtest.mjs` (nếu kiểm cột).

- [x] **Step 1: test đỏ cho `fsqFlagDecision`**

```js
import { describe, expect, it } from 'vitest';
import { fsqFlagDecision } from '../src/lib/fsq-flags.mjs';

describe('fsqFlagDecision (unresolved_flags của FSQ OS Places)', () => {
  it('không cờ → giữ, không đóng', () => {
    expect(fsqFlagDecision(null)).toEqual({ drop: false, closed: false });
    expect(fsqFlagDecision([])).toEqual({ drop: false, closed: false });
  });
  it('doesnt_exist / delete / inappropriate / privatevenue → bỏ', () => {
    for (const f of ['doesnt_exist', 'delete', 'inappropriate', 'privatevenue'])
      expect(fsqFlagDecision([f]).drop, f).toBe(true);
  });
  it('closed → đóng; duplicate chỉ là tín hiệu phụ', () => {
    expect(fsqFlagDecision(['closed'])).toEqual({ drop: false, closed: true });
    expect(fsqFlagDecision(['duplicate'])).toEqual({ drop: false, closed: false });
    expect(fsqFlagDecision(['duplicate', 'closed'])).toEqual({ drop: false, closed: true });
  });
  it('nhận cả chuỗi mảng Postgres lẫn mảng JS', () => {
    expect(fsqFlagDecision('{closed,duplicate}')).toEqual({ drop: false, closed: true });
  });
});
```

- [x] **Step 2:** `pnpm exec vitest run pipelines/poi/tests/fsq-flags.test.mjs` → FAIL (module chưa có).
- [x] **Step 3: cài đặt**

```js
// pipelines/poi/src/lib/fsq-flags.mjs
// Cờ `unresolved_flags` của FSQ OS Places: báo cáo cộng đồng chưa được FSQ xử lý (đo 26/09/2026
// trên release 2026-09-15: duplicate 4.234, closed 2.656, privatevenue 657, doesnt_exist 45…).
/** Bỏ hẳn bản ghi. privatevenue: mẫu 20 có 2 nhà riêng + 4 rác — ưu tiên riêng tư. */
const DROP = new Set(['doesnt_exist', 'delete', 'inappropriate', 'privatevenue']);

/** @param {string[] | string | null | undefined} raw @returns {string[]} */
function flagsOf(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.startsWith('{'))
    return raw.slice(1, -1).split(',').filter(Boolean);
  return [];
}

/** @param {string[] | string | null | undefined} raw */
export function fsqFlagDecision(raw) {
  const flags = flagsOf(raw);
  return { drop: flags.some((f) => DROP.has(f)), closed: flags.includes('closed') };
}
```

- [x] **Step 4:** chạy lại test → PASS.
- [x] **Step 5: migration**

```sql
-- 0025_fsq_quality_columns.sql — cột chất lượng FSQ OS Places (plan 2026-09-26). Chỉ pipeline đọc;
-- API không SELECT src_fsq_place nên thứ tự deploy API không phụ thuộc migration này.
ALTER TABLE src_fsq_place ADD COLUMN IF NOT EXISTS date_created     date;
ALTER TABLE src_fsq_place ADD COLUMN IF NOT EXISTS date_refreshed   date;
ALTER TABLE src_fsq_place ADD COLUMN IF NOT EXISTS unresolved_flags text[];
```

```sql
-- 0025_fsq_quality_columns.down.sql
ALTER TABLE src_fsq_place DROP COLUMN IF EXISTS unresolved_flags;
ALTER TABLE src_fsq_place DROP COLUMN IF EXISTS date_refreshed;
ALTER TABLE src_fsq_place DROP COLUMN IF EXISTS date_created;
```

- [x] **Step 6: ingest** — `fsq.mjs` SELECT thêm `NULLIF(date_created,'')`, `NULLIF(date_refreshed,'')`, `unresolved_flags`; COPY thêm 3 cột (mảng qua `pgArray`).
- [x] **Step 7: records** — `fsqRows` SELECT thêm `unresolved_flags`; `fsqFlagDecision` → `drop` thì `continue`, `closed: r.date_closed !== null || decision.closed`.
- [x] **Step 8:** `pnpm exec vitest run pipelines/poi` + `pnpm typecheck` → xanh; `pnpm test:db` (đầy đủ, memory `dbtest-local-thieu-file`) — ghi rõ `pipeline-fixture` đỏ vì thiếu tippecanoe nếu vẫn đỏ.
- [x] **Step 9:** commit `feat(pipeline): FSQ lưu date_refreshed/unresolved_flags, bỏ bản ghi bị báo không tồn tại/riêng tư, đóng bản ghi bị báo đóng`.

### Task 3: Tên OSM — tên thay thế, tách `;`, tên dự phòng, email

**Files:** Create `pipelines/poi/src/lib/osm-names.mjs`, `pipelines/poi/src/lib/vn-banks.mjs`, `pipelines/poi/tests/osm-names.test.mjs`; Modify `pipelines/poi/src/records.mjs`, `apps/docs/src/content/docs/api.md` (contact.email).

- [x] **Step 1: test đỏ** — các ca (mỗi ca một `it`):
  - `splitNames('A;B; C')` → `['A','B','C']`.
  - `osmNameAlt(tags, name)` gồm `name:en`, `alt_name`, `old_name`, `official_name`, `name:vi`, `short_name`, `loc_name`, `int_name`, đã tách `;`, bỏ phần tử bằng `name`.
  - `osmFallbackName(tags, cat)`: có `name:vi` → dùng; chỉ `name:en` → dùng; `name:en` chung chung (`'atm'`, `'Local food'`, `'mechanic'`) hoặc mô tả (> 40 ký tự / có `!?` / ≥ 7 từ) → `null`; chỉ `name:zh` → `null`.
  - ATM: `{amenity:'atm', operator:'Vietcombank'}` → `'ATM Vietcombank'`; `operator:'MHB'` → `null` (đã sáp nhập); `operator:'Maritime Bank'` → `'ATM MSB'` (đổi tên); `operator:'BIDV - May Pos - ATM'` → `null` (POS); `operator:'comfeed'` → `null` (không phải ngân hàng); có `name` thật thì hàm không được gọi.
  - `osmEmails(tags)`: `email` + `contact:email`, tách `;`, bỏ miền miễn phí (`a@gmail.com` bị bỏ, `info@hotel.vn` giữ), chỉ nhận chuỗi có dạng email.
- [x] **Step 2:** chạy → FAIL.
- [x] **Step 3:** cài đặt `osm-names.mjs` + `vn-banks.mjs` (bảng: tên chuẩn, bí danh chuẩn hoá bằng `normalizeVi`, trạng thái `active` | `renamed:<tên mới>` | `gone`). Nhóm `gone`: Southern Bank, ANZ, MHB, Habubank, TrustBank/Đại Tín, Western Bank, Ficombank, TinNghiaBank, Mekong Development Bank, DongA/EAB, OceanBank, GPBank, CB/Construction Bank (chuyển giao bắt buộc 2024–2025 — thương hiệu ATM không còn chắc chắn). `renamed`: Maritime Bank → MSB, LienVietPostBank → LPBank, Navibank → NCB.
- [x] **Step 4:** chạy → PASS.
- [x] **Step 5: records** — `osmRows`: `name = r.name ?? osmFallbackName(t, cat0)`; nếu vẫn không có → nhánh UNNAMED_OK cũ; POI UNNAMED_OK có `name:vi`/`name:en` thật thì dùng tên đó; `nameAlt: osmNameAlt(t, name)`; `emails: osmEmails(t)` → `contact.email` (chỉ khi mảng không rỗng, để POI khác giữ nguyên JSON cũ).
- [x] **Step 6:** test `records.test.mjs` thêm ca `buildRow` có `emails` → `contact.email`; typecheck; commit `feat(pipeline): tên thay thế/tên dự phòng/email từ tag OSM`.

### Task 4: Mở rộng bộ lọc tag OSM

Số đo nhánh A (OSM 25/09/2026): 37.586 đối tượng có tên, không phải building, mang khoá ứng viên →
33.854 sau khi bỏ ngoài 34 tỉnh, CJK, trùng xã/phường → 26.371 sau khi bỏ tên "tiền tố + số" (+21 %
POI OSM). Trùng FSQ thấp (1,3 % trong 150 m). Tăng mạnh nhất: Lai Châu +169 %, Đắk Lắk +124 %.

**Nhận (danh sách trắng giá trị, khoá mới chỉ thành POI khi giá trị có trong `category_map_osm.csv`):**

| Tag | Mã mới | Nhóm |
|---|---|---|
| `place=hamlet,village,isolated_dwelling` | `hamlet` (Thôn, ấp, bản) | `place` (mới) |
| `place=neighbourhood,quarter` | `neighbourhood` (Khu phố) | `place` |
| `place=locality` | `locality` (Địa danh) | `place` |
| `landuse=residential` | `residential_area` (Khu dân cư) | `place` |
| `landuse=industrial` | `industrial_zone` (Khu công nghiệp, nhà máy) | `place` |
| `landuse=commercial,retail` | `commercial_area` (Khu thương mại) | `place` |
| `place=square` | `square` (Quảng trường) | `culture_tourism` |
| `place=island,islet` | `island` (Đảo) | `culture_tourism` |
| `natural=peak,volcano` | `mountain` (Núi) | `culture_tourism` |
| `natural=water` (`/river,canal,stream` → `river`) | `lake` (Hồ) / `river` (Sông) | `culture_tourism` |
| `natural=beach` | `beach` (có sẵn) | `culture_tourism` |
| `natural=cave_entrance` | `cave` (Hang động) | `culture_tourism` |
| `waterway=waterfall` | `waterfall` (Thác) | `culture_tourism` |
| `natural=bay,cape,spring,hot_spring,wetland` | `culture_tourism_other` | `culture_tourism` |
| `man_made=lighthouse` | `lighthouse` (Hải đăng) | `culture_tourism` |
| `landuse=cemetery` | `cemetery` (có sẵn) | `public_admin` |
| `landuse=religious` | `religion_community_other` | `religion_community` |
| `barrier=toll_booth` | `toll_booth` (có sẵn) | `transport` |
| `barrier=border_control` | `border_gate` (Cửa khẩu) | `transport` |
| `highway=services,rest_area` | `rest_area` (Trạm dừng nghỉ) | `transport` |
| `junction=yes,roundabout` (chỉ khi tên khớp Ngã…/Vòng xoay/Bùng binh/Nút giao/Công trường) | `junction` (Nút giao) | `transport` |

**Không nhận:** `place=town,suburb,city,state` (86 %/76 % là xã/phường mới); building (để sau);
`landuse=military`, `military=*` (Luật Đo đạc và Bản đồ); `natural=reef,strait` (ngoài khơi); đường hở.

**Luật chặn trong records:** tên CJK ở mã mới; tên "tiền tố + số" (Thôn 3, Khu phố 4, Ấp 2, Tổ dân phố
5…) ở nhóm `place`; `place=*` trùng tên xã/phường chứa nó (admin_area + admin_area_old, bỏ tiền tố)
khi bảng hành chính có sẵn; `junction` không khớp mẫu tên. Sau COPY: gom bản ghi OSM cùng
`name_norm` + cùng mã trong 1 km cho `toll_booth`, `border_gate`, `rest_area`, `lake`, `river`,
`island`, `mountain`, `junction` (trạm thu phí mỗi làn một node).

**Tiles:** loại nhóm `place` và mã `lake`, `river`, `island`, `junction` khỏi POI tiles (bản đồ nền đã
vẽ nhãn nơi chốn/mặt nước; nút giao chỉ để tìm kiếm) — áp ở cả `export-tiles` lẫn `export-snapshot`.

**Chưa làm (ghi evidence):** thay ranh giới Natural Earth của `deleteOutsideVn` bằng 34 tỉnh OSM —
đang xoá nhầm 556 POI OSM + ~929 FSQ trên đảo/bờ biển (Bãi Cháy, Cù Lao Chàm, Lý Sơn…) và giữ 339 POI
ngoài mọi tỉnh; conflate cho vật thể lớn (bán kính theo loại, FSQ trong polygon).

- [x] Step 1: test taxonomy (khoá mới, thứ tự ưu tiên natural trước place, giá trị lạ/military → null).
- [x] Step 2: test `osm-extended.mjs` (CJK, tên số, mẫu junction, khớp tên hành chính).
- [x] Step 3: dbtest gom trùng cùng tên 1 km.
- [x] Step 4: cài đặt `category.json`, `category_map_osm.csv`, `taxonomy.mjs`, `ingest/osm.mjs`, `records.mjs`, `poi-filter.mjs` (tiles).
- [x] Step 5: unit + `test:db` đầy đủ + typecheck; commit `feat(pipeline): mở rộng bộ lọc tag OSM — thôn/ấp, núi, hồ, đảo, thác, hang, trạm thu phí, cửa khẩu, nút giao`.

### Task 5: Báo cáo độ phủ tỉnh × nhóm × nguồn

**Files:** Modify `pipelines/poi/src/report.mjs`; Create `pipelines/poi/src/lib/coverage.mjs`, `pipelines/poi/tests/coverage.test.mjs`.

- [x] **Step 1: test đỏ** — `nestCoverage(rows)` nhận `[{province, group_code, source, n}]` → `{ [province]: { total, bySource: {osm, fsq, user}, byGroup: {[group]: n} } }`, tỉnh `null` gom vào `'(không rõ)'`, sắp theo `total` giảm dần khi `Object.keys`.
- [x] **Step 2:** FAIL → **Step 3:** cài đặt → **Step 4:** PASS.
- [x] **Step 5:** `report.mjs` thêm truy vấn `SELECT p.admin_province AS province, c.group_code, coalesce(p.primary_source, 'user') AS source, count(*)::int AS n FROM poi p JOIN category c ON c.code = p.category WHERE p.status = 'active' GROUP BY 1,2,3` và trường `byProvince` trong JSON; console in 10 tỉnh ít POI nhất.
- [x] **Step 6:** commit `feat(pipeline): báo cáo POI theo tỉnh × nhóm × nguồn`.

### Task 6: Dựng thử toàn quốc cục bộ + đo

- [x] DB dev cô lập (không phải production): chạy `ingest/osm.mjs` trên `vietnam-260925`, `ingest/fsq.mjs` release 2026-09-15, `taxonomy.mjs load`, `records.mjs`, `conflate.mjs`, `publish.mjs`, `report.mjs` — trước và sau thay đổi (checkout `7c0889a` cho "trước").
- [x] So `bySource`, `byGroup`, `byProvince`, số POI đóng; mẫu tay 50 POI mới mỗi loại (tên dự phòng, ATM, place/natural).
- [x] Bộ mờ `scripts/fixtures/fuzzy-queries.txt` + bộ 20 biến thể qua API dev trỏ DB đó: hit@3 không được giảm.

### Task 7: Tài liệu, evidence, lệnh cho PHONG

- [x] `pipelines/poi/README.md` (bộ lọc mới, cờ FSQ, tên dự phòng), `docs/evidence/poi-sources/2026-09-26-lam-giau-lam-ngay.md` (số đo trước/sau), DEVLOG.
- [ ] (PHONG) Trên máy chủ: `pnpm server:update` (git pull + image GHCR mới + migration 0025) → kiểm `/healthz/db` → rerun Deploy API đang bị `check:migration` chặn → `data:update --poi --skip-routing` → kiểm autocomplete — lệnh đầy đủ ở evidence mục 7.
- [ ] (PHONG) Truy vấn chỉ đọc rà edit đã tự duyệt trước 26/09 — câu SQL ở evidence mục 7.
