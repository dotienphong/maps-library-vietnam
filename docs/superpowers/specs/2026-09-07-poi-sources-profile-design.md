# Spec — Bật/tắt nguồn POI theo profile (chọn tập nguồn khi khởi tạo SDK)

Ngày: 07/09/2026. Trạng thái: PHONG đã duyệt thiết kế qua đối thoại 07/09/2026.
Tài liệu do Fable 5.1 viết. Plan: `docs/superpowers/plans/2026-09-07-poi-sources-profile.md`.

**Sửa 07/09/2026 sau khi đo production (mục 9 nghiệm thu 1):** OSM chỉ là nguồn chính của **7,0 %**
POI (106.325 / 1.522.416; Overture 77,1 %, FSQ 15,9 % — `docs/evidence/poi-sources/do-truoc-primary-source.md`).
Mặc định `['osm']` sẽ làm bản đồ mất ~93 % POI, nên PHONG quyết **đảo mặc định thành `all`** (cả ba
nguồn, đúng hành vi hiện tại) và vẫn giao profile `osm` như tuỳ chọn cho người tích hợp. Toàn bộ
tài liệu dưới đây đã theo quyết định đó.

---

## 1. Hiện trạng và vấn đề

Bản đồ có ba lớp style POI (`poi`, `poi-label-major`, `poi-label-local` —
`packages/style/src/poi-layers.mjs`) nhưng cả ba đọc chung **một** source-layer `poi` từ một archive
`poi-YYYYMMDD.pmtiles`. Ba lớp là icon + hai lớp nhãn, **không** phải ba nguồn dữ liệu.

Dữ liệu POI đến từ ba nguồn ingest (`pipelines/poi/src/ingest/`): OpenStreetMap (ODbL), Overture Places
(CDLA-Permissive 2.0), Foursquare OS Places (Apache-2.0). Pipeline conflate ba nguồn thành một bản ghi
`poi`; mỗi bản ghi có đúng một `primary_source` (`osm` | `overture` | `fsq`, `db/migrations/0003_core.sql:31`),
các nguồn thành viên nằm ở `poi_source_link`. Các trường `name`/`contact`/`hours` lấy nguyên từ bản ghi
primary (`publish.mjs`), chỉ hình học ưu tiên thành viên OSM (`COALESCE(osm.geom, r.geom)`).

PHONG đánh giá POI có primary Overture/FSQ nhiễu hơn OSM và muốn người tích hợp **chọn được tập
nguồn**, với yêu cầu kèm: khi một nguồn tắt thì **search cũng không trả POI của nguồn đó**.

Giả định "Overture/FSQ nhiễu hơn OSM" **chưa được chứng minh bằng số liệu** và số đo ở đầu tài liệu
cho thấy nó khó đúng theo nghĩa "lọc rác": OSM Việt Nam chỉ có ~106 nghìn POI trong bộ lọc tag hiện
tại. Thêm nữa `multiSourcePct` chỉ 3,3 %, tức conflation hầu như không ghép được POI OSM với bản
sinh đôi ở Overture/FSQ — nên `primary_source` không phải thước đo chất lượng. Vì vậy spec này chỉ
giao **công tắc chọn nguồn**, không hứa cải thiện chất lượng; việc siết chất lượng là phương án C ở
mục 3, để sau và độc lập.

Không thể giải bằng lọc ở client trên archive hiện tại: `display-selector.mjs` chọn tối đa một POI mỗi
ô lưới cho mỗi zoom; POI thua ô bị `select()` trả `null` và `export-tiles.mjs` **không ghi vào archive**.
Nếu một POI Overture thắng ô thì POI OSM cạnh đó không tồn tại trong tile — tắt Overture ở client sẽ để
lại lỗ trống, không phải để OSM hiện lên thay.

## 2. Mục tiêu và ngoài phạm vi

### Mục tiêu

1. Người tích hợp chọn tập nguồn POI **một lần lúc khởi tạo SDK**; bản đồ và Places API dùng cùng tập.
2. Mặc định `all` (cả ba nguồn) ở mọi bề mặt (REST và SDK) — một mặc định duy nhất, giữ đúng
   hành vi hiện tại nên không người tích hợp nào mất dữ liệu khi nâng cấp.
3. Bản đồ chỉ-OSM có mật độ đúng như khi lưới progressive chạy trên riêng tập OSM; không có lỗ trống.
4. POI do người dùng đóng góp (`created_by = 'user'`) không bị loại vì tập nguồn; chúng vẫn chịu
   các điều kiện `active`/category, xếp hạng, limit và thinning như POI khác.
5. Không thêm migration; không đổi conflate, taxonomy, quality, progressive display; không đổi
   `PoiFeature`, `poiClick`, `poiLayer`.
6. Giữ mỗi archive POI ≤ 300 MiB, maxzoom 16.

### Ngoài phạm vi

- Không thêm property nguồn vào vector tile.
- Không cho người dùng cuối đổi nguồn lúc chạy (đổi `poiSources` = tạo lại map, như `poiLayer`).
- Không build profile thứ ba (`osm+overture`, …) trong lần này; cơ chế cho phép thêm sau.
- Không đổi chuỗi attribution: dữ liệu vẫn dẫn xuất từ cả ba nguồn (conflate và geom), chuỗi đầy đủ
  vẫn đúng và bắt buộc.
- Không siết chất lượng lúc conflate (hướng C trong mục 3) — có thể làm sau, độc lập.

## 3. Các phương án đã cân nhắc

### A. Archive riêng theo profile nguồn — **chọn**

Chạy lại lưới progressive trên tập nguồn đã lọc, ra một archive riêng. Không lỗ trống; POI OSM tốt được
lộ ra thay vì bị Overture chiếm ô. Chi phí: thêm một lần `export-tiles` + upload cho mỗi profile (phút,
không phải national build — ingest/conflate/geocode dùng chung) và ≤ 300 MiB R2 mỗi archive. Chỉ hỗ trợ
tổ hợp đã build sẵn.

### B. Property `s` trong tile, filter ở style

Một archive, mọi tổ hợp, đổi được lúc chạy. Nhưng gặp đúng vấn đề lỗ trống ở mục 1; bù bằng nới lưới thì
tile phình, đụng trần 300 MiB. Không chọn.

### C. Không có công tắc, siết chất lượng lúc conflate

Rẻ nhất, không đụng tile/API. Không đáp ứng yêu cầu người tích hợp tự chọn. Không chọn cho lần này;
là nền tốt để làm sau.

## 4. Profile nguồn và quy tắc lọc

| Profile | Tập `primary_source` | Tên archive | Vai trò |
|---|---|---|---|
| `all` | `{osm, overture, fsq}` | `poi-<build-id>.pmtiles` | **mặc định**, archive hiện tại, giữ prefix |
| `osm` | `{osm}` | `poi-osm-<build-id>.pmtiles` | tuỳ chọn (ví dụ khi chỉ muốn dữ liệu ODbL) |

Bảng profile là một hằng dùng chung `POI_SOURCE_PROFILES` đặt ở `packages/core/src/poi-sources.ts`
(`{ osm: ['osm'], all: ['osm','overture','fsq'] }`); API, SDK và pipeline (`pipelines/poi` đã phụ thuộc
`@mapslibvn/core`) cùng import từ đó — không sao chép.
Thêm tổ hợp mới = thêm một dòng + một lần export; không đổi contract.

**Mệnh đề lọc dùng chung** cho export-tiles và mọi endpoint đọc `poi`:

```sql
p.status = 'active'
AND (p.primary_source = ANY($sources) OR p.created_by = 'user')
```

POI người dùng tạo có `primary_source` NULL (`0006_edits.sql:20`); vế `created_by = 'user'` giữ chúng
lại. Mệnh đề được đóng thành một hàm ở mỗi phía (SQL fragment cho porsager ở API; chuỗi SQL ở pipeline)
với test khẳng định hai bản sinh cùng điều kiện.

Khi `sources` là cả ba nguồn, mệnh đề vẫn được sinh (không tắt lọc) để hành vi đồng nhất; chi phí
là một so sánh trên cột đã có index `poi_primary_source_idx`.

## 5. Pipeline và phát hành dữ liệu

### 5.1 `export-tiles.mjs`

- Thêm cờ `--sources <osm|all>` (tên profile). Mặc định `all` → hành vi và tên release hiện tại không đổi.
- `WHERE` dùng mệnh đề mục 4. Lưới progressive, `displayFields`, `priorityOrderSql`, tippecanoe giữ nguyên.
- Tên release: `releaseName('poi-osm', buildId)` — build ID dạng
  `YYYYMMDD-HHmmss-<nonce>` được chốt đúng một lần cho cả hai profile; tên date-only lịch sử vẫn đọc được.
- Log JSON cuối vẫn in `activeRead/selected/thinned/byMinZoom`; thêm `sources` để đối chiếu.

### 5.2 `data-update.mjs`

`data:update --poi` đọc các hàng `poi` active đúng một lần vào file trung gian bất biến
`snapshot-<build-id>.jsonl`, công bố atomically kèm SHA-256. Cả hai export xác thực cùng build ID và
checksum, rồi lọc/thinning độc lập từ file đó; thay đổi DB giữa hai export không thể làm lệch dữ liệu.

```
export-tiles --release poi-osm-<build-id> --sources osm --snapshot <snapshot>
qa <file> --skip-islands
upload poi-osm-<build-id>
smoke poi-osm-<build-id> --set poi-osm
```

rồi **một** lần `manifest.mjs set --poi poi-<build-id> --poi-osm poi-osm-<build-id>`. Manifest là
bước commit cuối, chỉ chạy sau export/QA/upload/smoke của cả hai profile. Archive là bất biến: upload
lại cùng bytes được phép, khác bytes bị từ chối; mỗi archive có companion `.sha256`. Nếu bất kỳ bước
nào lỗi thì manifest cũ giữ nguyên.

### 5.3 Manifest KV `release:current`

```json
{ "vn": "vn-…", "poi": "poi-…", "poiProfiles": { "osm": "poi-osm-…" }, "updatedAt": "…" }
```

- `poi` giữ nghĩa = profile `all`, nên `tiles.ts`/`style.ts`/`renderStyle` hiện tại không đổi nghĩa.
- `manifest.mjs set` thêm `--poi-osm <release>`; rollback kiểm cả `.pmtiles` và `.sha256` của từng
  release đích trước khi đổi manifest.
- `apps/api/src/manifest.ts`: `Manifest.poiProfiles?: Partial<Record<'osm', string>>`.

### 5.4 `tiles.ts`, `smoke.mjs`

- `tiles.ts` SETS thêm `poi-osm`; `releaseFor('poi-osm')` đọc `manifest.poiProfiles?.osm`, thiếu →
  404 "chưa phát hành" như set khác.
- `smoke.mjs --set poi-osm`: cùng ngưỡng với `poi` (maxzoom 16, ≥ 15/20 tile có dữ liệu tại 5 thành phố).

## 6. Contract API

### 6.1 Tham số `sources`

`parseSources(raw)` trong `params.ts`, cùng khuôn `parseTypes`:

- Giá trị: `osm`, `overture`, `fsq`, phân cách dấu phẩy; `all` là bí danh cả ba. Trùng lặp bỏ qua;
  kết quả sắp xếp cố định để làm cache key.
- Không truyền / rỗng → cả ba nguồn (`all`). Giá trị lạ → `400 invalid_request`
  "sources chỉ nhận osm,overture,fsq,all".

### 6.2 Từng endpoint

| Endpoint | Áp `sources` | Ghi chú |
|---|---|---|
| `GET /v1/search` | có | thêm mệnh đề mục 4 |
| `GET /v1/nearby` | có | như trên |
| `GET /v1/autocomplete` | có, ở mọi nhánh POI | prefix/alias/tsvector/viKey/Telex đều lọc; `street`/`address`/`area` không có nguồn. Cache key chứa tập nguồn nên không lẫn profile |
| `GET /v1/reverse` | có, cho `nearest_poi` | nhất quán với bản đồ |
| `GET /v1/places/{id}` | **không** | tra theo id; POI đã bấm/đã ghim phải mở được. Response đã có `sources[]` |
| `GET /v1/styles/{theme}.json` | có | xem 6.3 |
| `GET /v1/geocode` | không | không đọc `poi` |

### 6.3 Style theo profile

`renderStyle(theme, manifest, tilesBase, profile)`:

- Ánh xạ tập nguồn → profile bằng bảng mục 4. Tập không có profile (vd `osm,overture`) →
  `400 invalid_request` kèm danh sách profile hiện có.
- Profile có trong bảng nhưng **manifest chưa có** archive (khoảng giữa deploy code và publish dữ liệu)
  → dùng `manifest.poi` (profile `all`), thêm header `x-poi-profile: all;fallback`, `console.warn`.
  Không 5xx.
- Header `x-poi-profile: <profile>` trong mọi trường hợp để kiểm chứng.
- `cache-control` giữ `public, max-age=3600`; URL khác theo `sources` nên cache tách tự nhiên.

## 7. Contract SDK

| Nơi | Thêm | Ghi chú |
|---|---|---|
| `@mapslibvn/core` | `type PoiSource = 'osm' \| 'overture' \| 'fsq'`; `ClientOptions.poiSources?: PoiSource[]` (mặc định cả ba nguồn); `POI_SOURCE_PROFILES` | `autocomplete/search/nearby/reverse` tự gắn `sources=`; `styleUrl(theme)` thêm `&sources=` |
| `@mapslibvn/web` | `CreateMapOptions.poiSources?: PoiSource[]` | truyền xuống `createClient`; kiểm tra sớm: tập không có profile → `throw new Error` rõ nghĩa lúc `createMap` |
| `@mapslibvn/react` | prop `poiSources` | vào deps của effect → đổi là tạo lại map, như `poiLayer` |
| `@mapslibvn/react-native` | prop `poiSources` | truyền `createClient`; `useResolvedStyle` không đổi vì URL lấy từ `places.styleUrl` |
| `<mapslibvn-autocomplete>` | không đổi | dùng client của map |

`poiLayer`, `PoiFeature`, `poiClick`, `POI_LAYER_ID`, `hidePoiLayer` giữ nguyên. Bump minor cho 4 gói
(chỉ thêm API; mặc định `all` nên hành vi không đổi với code đang chạy).

## 8. Lỗi và tính an toàn

- `sources` sai → 400, không chạm DB.
- Style yêu cầu profile chưa publish → fallback `all` (6.3), không chặn bản đồ.
- Export profile `osm` thất bại → không set manifest; archive `all` mới cũng không lên → trạng thái cũ
  nguyên vẹn, không lệch ngày giữa hai profile.
- Rollback: `manifest.mjs rollback` về object cũ (không có `poiProfiles`) → style tự fallback `all`;
  API vẫn chạy. Không có migration nên không có rollback schema.
- Quota/xác thực không đổi; `sources` không mở thêm dữ liệu nào ngoài tập đã công khai.

## 9. Kiểm thử

### Unit (không cần Postgres — test đỏ chặn deploy)

- `parseSources`: mặc định, `all`, trùng lặp, sắp xếp, giá trị lạ → 400.
- Mệnh đề lọc: hai bản (API/pipeline) sinh cùng điều kiện; có vế `created_by = 'user'`.
- Ánh xạ tập → profile; `renderStyle` fallback + header `x-poi-profile`.
- Client dựng URL đúng `sources=` cho 4 endpoint và `styleUrl`; mặc định cả ba nguồn.
- `createMap` ném lỗi với tập không có profile.
- `manifest.mjs set --poi-osm`; `releaseName('poi-osm')`.
- `autocompleteCacheUrl` có `s=` và `v=src1`.

### dbtest

- `pipeline-fixture.dbtest.mjs`: tập đầu vào `osm` là tập con của DB đủ điều kiện, nhưng archive sau
  thinning độc lập không bắt buộc là tập con/nhỏ hơn `all`. Fixture cùng ô khóa Overture thắng `all`,
  OSM được phục hồi ở `osm`, bằng ID thật trong GeoJSONSeq và tile giải mã.
- POI user không bị lọc nguồn nhưng vẫn chịu thinning; fixture không cạnh tranh có trong cả hai archive,
  fixture cạnh tranh có thể bị loại ở cả hai.
- API DB khóa ID OSM/Overture/FSQ/user cho search, nearby, reverse và mọi nhánh autocomplete; cache
  được thử cả `osm→all` và `all→osm` trên Wrangler + PostgreSQL thật.

### Nghiệm thu production

1. **Đo trước khi chốt mặc định — ĐÃ CHẠY 07/09/2026, KHÔNG ĐẠT ngưỡng 40 %:** OSM 7,0 %,
   Overture 77,1 %, FSQ 15,9 % (`docs/evidence/poi-sources/do-truoc-primary-source.md`). PHONG quyết
   đảo mặc định thành `all`. Vẫn cần ghi `selected`/`thinned` của export `--sources osm` khi publish.
2. `perf-autocomplete.mjs --paired-sources`: cohort `sources=osm` vs `sources=all`; cổng p95 của
   Task 8.6 phải giữ.
3. `smoke --set poi-osm` xanh; `x-poi-profile: osm` trên `/v1/styles/light.json`.
4. Kiểm tay bản đồ tại 5 thành phố ở z12/z14/z16 so với archive `all`: không lỗ trống bất thường.

## 10. Rollout

1. Deploy API + code pipeline. Mặc định `all` nên **không có khoảng lệch** cho người tích hợp hiện
   tại: bản đồ và search giữ nguyên kết quả. Người nào chủ động đặt `poiSources: ['osm']` trước khi
   archive `poi-osm` được publish sẽ thấy search đã lọc còn bản đồ còn đầy (style fallback `all`,
   header `x-poi-profile: all;fallback`) — nên vẫn nên chạy bước 1 và 2 gần nhau.
2. `data:update --poi` build cả hai archive, `manifest set` một lần → `sources=osm` bắt đầu có archive
   riêng, mặc định `all` không đổi gì.
3. Publish SDK chỉ sau khi hoàn tất kiểm tra nhãn hiệu/pháp lý; version trong source không chứng minh
   package đã có trên npm. Cập nhật docs: `api.md` (tham số `sources`, header `x-poi-profile`, mặc định `all`),
   `ban-do-web.md`, `react.md`, `react-native.md` (prop `poiSources`), `sdk.md`, `tim-kiem.md`
   (search theo tập nguồn), `tinh-nang.md`; DEVLOG.

## 11. Tiêu chí nghiệm thu

- Với `sources` mặc định (`all`): kết quả bản đồ và 4 endpoint **như trước thay đổi** (ngoại trừ
  cache key autocomplete lên `v=src1`).
- Với `sources=osm`: bản đồ và 4 endpoint chỉ trả POI `primary_source='osm'` hoặc `created_by='user'`.
- Archive `poi-osm-*` ≤ 300 MiB, maxzoom 16, smoke xanh.
- p95 autocomplete không xấu hơn cổng Task 8.6.
- Toàn bộ unit test xanh không cần Postgres; dbtest mục 9 xanh trên staging.

## 12. Việc để sau

- Profile thứ ba (`osm+overture`) nếu có nhu cầu.
- Siết chất lượng lúc conflate (phương án C) để cải thiện chính profile `all`.
- Cân nhắc đưa `primary_source` vào `Place` của Places API nếu app cần hiển thị nguồn mà không gọi
  `/v1/places/{id}`.

## 13. Tham chiếu

- `packages/style/src/poi-layers.mjs`, `pipelines/poi/src/export-tiles.mjs`,
  `pipelines/poi/src/display-selector.mjs`, `pipelines/poi/src/publish.mjs`
- `apps/api/src/{params,style,manifest,cache}.ts`, `apps/api/src/routes/{search,nearby,autocomplete,reverse,styles,tiles}.ts`
- `pipelines/tiles/src/{manifest,smoke}.mjs`, `pipelines/tiles/src/lib/dates.mjs`, `scripts/data-update.mjs`
- Spec liên quan: `2026-09-04-progressive-poi-display-design.md` (contract tile, lưới thinning)
