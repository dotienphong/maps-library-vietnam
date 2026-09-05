# Spec — Tìm kiếm: alias hành chính cũ–mới, tìm mờ, cách viết địa phương

Ngày: 05/09/2026. Trạng thái: **bản nháp chờ PHONG duyệt**. Tài liệu do Fable 5.1 nghiên cứu và
viết; bước kế tiếp là `writing-plans` rồi implement bằng Opus.

Ba hạng mục trong tài liệu này độc lập về code nhưng dùng chung một khung: chuẩn hoá ở
`@mapslibvn/core`, dữ liệu alias trong Postgres, và truy vấn **theo bậc** (staged) trong API.
Mỗi hạng mục có thể triển khai và nghiệm thu riêng.

---

## 1. Hiện trạng và vấn đề

### 1.1 Alias hành chính

- `admin_alias` (migration 0004) có PK `(alias_norm, level)` → **một** `admin_area_id`. Seed
  `db/seed/admin_alias_2025.csv` chỉ có 33 alias tỉnh cũ → tỉnh mới và **một** ví dụ phường
  (`phuong 6 quan 10 → Phường Diên Hồng`). README pipeline ghi rõ: "Alias phường/xã mới chỉ có ví
  dụ spec Diên Hồng; cần biên soạn đầy đủ".
- Alias chỉ được dùng ở **bước 5** của thang geocode (`stepAdmin`). Câu địa chỉ dạng
  `88/9 Nguyễn Lâm, Phường 6, Quận 10` đi vào bước 1 với `ward_norm = '6'`, trong khi mốc
  `address_anchor.ward_norm` đã được gán theo phường **mới** (`dien hong`) → lọc phường **loại
  đúng mốc**, rơi xuống nội suy hoặc `street`. Alias hiện không cứu được bước 1–4.
- Cấp quận/huyện đã bị bãi bỏ từ 01/07/2025; một quận cũ ứng với **nhiều** phường mới, PK hiện tại
  không biểu diễn được quan hệ 1–n. Một số phường cũ bị **tách** vào hai phường mới cũng không
  biểu diễn được.
- `/v1/autocomplete` không có loại kết quả nào cho đơn vị hành chính: gõ "Quận 10" hay
  "Phường Diên Hồng" trả rỗng.
- `parseAddress` ánh xạ tỉnh cũ → mới qua `provinces.json` (đã đủ 63 → 34), phần này giữ.

### 1.2 Tìm mờ

- Điều kiện khớp hiện là `name_norm % q` (trigram similarity toàn chuỗi, ngưỡng 0,3) **hoặc**
  `name_norm LIKE 'q%'`. Similarity toàn chuỗi giảm nhanh khi tên dài hơn truy vấn: "highlands"
  so với "highlands coffee nguyen hue" chỉ còn ~0,35; có lỗi gõ ("higland") thì LIKE hỏng và
  similarity tụt dưới ngưỡng → mất kết quả.
- Đảo từ ("coffee highlands", "cho ray benh vien") không có tiền tố khớp, similarity toàn chuỗi
  thấp → thường trượt.
- Dính/tách từ ("hochiminh", "nguyenhue") không xử lý.
- `/v1/search` và `stepStreet` (geocode) dùng cùng `%` nên cùng giới hạn.

### 1.3 Cách viết địa phương

- `provinces.json` và `brand_alias.json` chứa một số biến thể (Bắc Cạn, Đắc Lắc, Saigon…), nhưng
  chỉ áp dụng cho **tỉnh** (trong `parseAddress`) và **thương hiệu** (ở đầu chuỗi). Tên phường,
  đường, POI không được hưởng.
- Pipeline đã gom `alt_name`, `old_name`, `official_name`, `name:en` của OSM vào `poi.name_alt`
  (`records.mjs:147`) nhưng **không cột nào trong API đọc `name_alt`**; `street` và `admin_area`
  không giữ tên thay thế nào của OSM (tên đường cũ như "Công Lý" → "Nam Kỳ Khởi Nghĩa" mất).
- Biến thể chính tả địa danh (Quy Nhơn/Qui Nhơn, Pleiku/Plei Ku/Plây Cu, Vũng Tàu/Vũng Tầu,
  Mỹ Tho/Mĩ Tho, Kon Tum/Kontum, Tân Sơn Nhất/Nhứt…) khác nhau **sau khi đã bỏ dấu**, trigram chỉ
  cứu được một phần.

---

## 2. Mục tiêu và ngoài phạm vi

### Mục tiêu

1. Địa chỉ viết theo đơn vị hành chính **trước 01/07/2025** (tỉnh, quận/huyện, phường/xã cũ) geocode
   ra đúng vị trí với `precision` không tệ hơn khi viết theo tên mới.
2. Bảng alias phường/xã **đầy đủ toàn quốc**, sinh tự động từ dữ liệu mở cùng giấy phép ODbL, có
   kiểm chứng bằng fixture đối chiếu với nghị quyết.
3. Autocomplete và search chịu được lỗi gõ 1–2 ký tự, thiếu/thừa khoảng trắng và đảo thứ tự từ,
   với độ trễ p95 không tăng quá 50 ms ở nhánh có kết quả sớm.
4. Nhận diện biến thể chính tả địa danh và tên thay thế (OSM `alt_name`/`old_name`) cho POI,
   đường, đơn vị hành chính.
5. Mọi thay đổi hợp đồng API/SDK là **bổ sung** (thêm trường/loại tuỳ chọn), không đổi hay bỏ
   trường hiện có.

### Ngoài phạm vi

- Không đưa công cụ tìm kiếm ngoài (Meilisearch/Typesense) vào; spec gốc mục 8.3 chỉ mở đường này
  khi Postgres không đủ, và tài liệu này cho thấy chưa cần.
- Không dịch nghĩa đồng nghĩa loại địa điểm ("nhà thuốc" ↔ "tiệm thuốc" ↔ category `pharmacy`);
  ghi vào việc cần xem xét sau (mục 12).
- Không sửa dữ liệu hiển thị `poi.ward`/`poi.province` (tên theo nguồn) — chỉ chuyện tìm kiếm.
- Không đổi thuật toán conflation, taxonomy, hay điểm `popularity`.
- Không làm gợi ý "có phải bạn muốn tìm…" phía UI.

---

## 3. Kiến trúc chung

```
                 ┌─ @mapslibvn/core ────────────────────────────────────────┐
 chuỗi người gõ ─┤ normalizeVi → nameCore → viKey (mới) → toponymAlias (mới) │
                 └───────────────────────────────────────────────────────────┘
                                          │ q_norm, q_core, q_key, tokens
                                          ▼
 apps/api ─── bộ lập bậc truy vấn (stage planner, thuần TS, test không cần DB)
   bậc 1  tiền tố + word_similarity trên name_norm / name_alt_norm      (chỉ số GIN trgm có sẵn + mới)
   bậc 2  mọi token đều khớp tiền tố, không kể thứ tự (tsvector 'simple') (GIN tsvector mới)
   bậc 3  khoá ngữ âm name_key                                          (GIN trgm mới)
   dừng ngay khi đủ `limit`; bậc sau chỉ chạy khi bậc trước thiếu
                                          ▼
 Postgres ─── admin_area (hiện hành) · admin_area_old (mới) · admin_alias (mở rộng)
              poi/street/admin_area(+old): thêm name_key, name_alt_norm
```

Nguyên tắc: **mọi nhánh WHERE phải có chỉ số**; không có bậc nào quét bảng. Bậc chỉ chạy khi cần
nên chi phí trung bình gần với hiện tại; cache 10 phút của autocomplete giữ nguyên.

---

## 4. Hạng mục 1 — Alias đầy đủ đơn vị hành chính cũ–mới

### 4.1 Nguồn dữ liệu và quyết định

| Nguồn | Có gì | Giấy phép | Quyết định |
|---|---|---|---|
| OSM snapshot Geofabrik `vietnam-250101.osm.pbf` (02/01/2025, 306 MB) | ranh giới **trước sắp xếp**: 63 tỉnh (L4), ~700 quận/huyện (L6), ~10.500 phường/xã (L8), kèm `alt_name`/`old_name` | ODbL, đúng giấy phép dự án đang dùng | **Nguồn chính.** Suy alias bằng chồng lớp không gian với `admin_area` hiện hành |
| 34 Nghị quyết UBTVQH 1654–1687/NQ-UBTVQH15 (16/06/2025) + bảng 3.321 đơn vị trên chinhphu.vn | văn bản "sắp xếp toàn bộ diện tích… phường A, B, C thành phường D" | văn bản pháp luật, không hạn chế | **Fixture kiểm chứng** (lấy mẫu ≥ 60 phường ở ≥ 6 tỉnh), không phải nguồn nạp |
| GitHub `dvhcvn/data`, `daohoangson/dvhcvn`, `phamhongduc-dev/dvhcvn` (MIT), `zuydd/vn-geo`, `vietmap-company/vietnam_administrative_address` (giấy phép riêng của VietMap) | danh mục cũ/mới, một số có mapping | không đồng nhất, phần lớn không có geometry | **Không nạp** vào DB; chỉ dùng đối chiếu **số lượng** khi QA. Tránh trộn giấy phép vào bảng ODbL xuất qua `export:odbl` |

Lý do chọn chồng lớp không gian thay vì gõ tay từ nghị quyết: (a) 10.000+ dòng gõ tay không kiểm
được; (b) có sẵn **geometry** quận/huyện cũ để trả bbox và lọc mốc theo vùng; (c) tự sinh được
tỷ lệ diện tích khi một phường cũ bị tách; (d) cùng giấy phép nên vào được `export:odbl`.

### 4.2 Mô hình dữ liệu (migration `0008_admin_old.sql` + `.down.sql`)

```sql
-- Đơn vị hành chính đã hết hiệu lực, giữ riêng để không ảnh hưởng mọi truy vấn hiện có trên admin_area
CREATE TABLE admin_area_old (
  id              bigserial PRIMARY KEY,
  level           smallint NOT NULL,          -- 4 tỉnh cũ, 6 quận/huyện cũ, 8 phường/xã cũ
  name            text NOT NULL,              -- "Phường 6", "Quận 10", "Tỉnh Bình Dương"
  name_norm       text NOT NULL,              -- đã bỏ tiền tố cấp: "6", "10", "binh duong"
  parent_norm     text,                       -- name_norm cấp trên trực tiếp (L8 → quận cũ, L6 → tỉnh cũ)
  province_norm   text NOT NULL,              -- tỉnh cũ chứa nó
  osm_relation_id bigint,
  snapshot        date NOT NULL,              -- 2025-01-02
  valid_until     date NOT NULL DEFAULT '2025-06-30',
  geom            geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX ON admin_area_old USING gist (geom);
CREATE INDEX ON admin_area_old (level, name_norm);

-- admin_alias: cho phép 1 alias → n đơn vị mới, ghi tỷ lệ và nguồn
ALTER TABLE admin_alias DROP CONSTRAINT admin_alias_pkey;
ALTER TABLE admin_alias
  ADD COLUMN share      real NOT NULL DEFAULT 1,     -- phần diện tích đơn vị cũ rơi vào đơn vị mới (0–1]
  ADD COLUMN source     text NOT NULL DEFAULT 'seed' -- 'overlay' | 'seed' | 'osm_tag'
                        CHECK (source IN ('overlay','seed','osm_tag')),
  ADD COLUMN old_area_id bigint REFERENCES admin_area_old (id) ON DELETE CASCADE,
  ADD PRIMARY KEY (alias_norm, level, admin_area_id);
CREATE INDEX ON admin_alias (admin_area_id);
CREATE INDEX ON admin_alias USING gin (alias_norm gin_trgm_ops);   -- cho autocomplete loại 'area' và tìm mờ
```

`level` trong `admin_alias` giữ nghĩa **cấp của alias** (cấp của đơn vị cũ mà người dùng gõ), không
phải cấp đơn vị mới: alias `quan 10` có `level=6`, trỏ tới ~10 phường mới `level=8`.

### 4.3 Khoá alias sinh ra

Với mỗi phường/xã cũ W thuộc quận/huyện cũ D thuộc tỉnh cũ P (tất cả đã `normalizeVi` và bỏ tiền
tố cấp):

| Khoá | Ví dụ | Khi nào sinh |
|---|---|---|
| `phuong W quan D` / `xa W huyen D` | `phuong 6 quan 10`, `xa tan thong hoi huyen cu chi` | luôn (đúng dạng người dùng gõ sau `normalizeVi`; tiền tố cấp lấy từ tên gốc OSM) |
| `phuong W quan D P` | `phuong 6 quan 10 ho chi minh` | luôn |
| `W` (không kèm quận) | `ben nghe`, `tan thong hoi` | chỉ khi `W` là **duy nhất** trong toàn bộ L8 cũ và không phải số |
| `D` / `quan D` / `huyen D` | `quan 10`, `huyen cu chi`, `thanh pho thu duc` | cho L6 cũ; kèm `P` nếu tên quận/huyện trùng ở nhiều tỉnh (Châu Thành, Tân Phú, Long Thành…) |
| `P` | `binh duong` | L4 cũ (giữ tương thích CSV hiện có; CSV vẫn nạp với `source='seed'`) |

Bên gõ vào (geocode) tạo khoá theo đúng thứ tự ưu tiên trên từ `parsed.ward`, `parsed.district`,
`parsed.province` — nên khoá sinh và khoá tra **cùng một hàm** `adminAliasKeys(parsed)` trong core,
test được không cần DB.

### 4.4 Pipeline: `pipelines/poi/src/geocode/admin-old.mjs`

Chạy **sau** `admin.mjs` trong `data-update` (và chạy được lẻ). Các bước:

1. Tải `https://download.geofabrik.de/asia/vietnam-250101.osm.pbf` vào `work/data/sources/`, ghim
   **MD5** trong `pipelines/poi/src/lib/env.mjs`; tệp bất biến nên chỉ tải một lần. Không cần
   patch chủ quyền (chỉ dùng relation hành chính trong nước).
2. `osmium tags-filter r/boundary=administrative` → geojsonseq → bảng thô `osm_admin_old_raw`
   (tái dùng `raw-tables.mjs`). Nhận `admin_level ∈ {4,6,8}`, tên từ `name:vi` rồi `name`.
3. Xây `admin_area_old_new`: gán `parent_norm`/`province_norm` bằng `ST_Contains` với
   `ST_PointOnSurface` (cùng cách `admin.mjs` gán `parent_id`). Loại relation không nằm trong tỉnh
   cũ nào (ranh giới biển/tranh chấp).
4. **Chồng lớp** L8 cũ × `admin_area` L8 hiện hành:
   `share = ST_Area(ST_Intersection(old, new)::geography) / ST_Area(old::geography)`; giữ các cặp
   `share ≥ 0,05`; chuẩn hoá tổng về 1. Cặp `share ≥ 0,9` coi là "chuyển nguyên"; phường cũ có cặp
   lớn nhất `< 0,9` là **ca tách**, ghi log riêng để QA.
5. L6 cũ → tập L8 mới: hợp các cặp của các L8 cũ con, cộng dồn `share` theo diện tích quận cũ.
6. Sinh alias theo bảng 4.3 vào `admin_alias_new` với `source='overlay'`, `old_area_id`. Sau đó
   nạp CSV seed (`source='seed'`) và alias từ tag `old_name`/`alt_name`/`official_name` của
   `admin_area` hiện hành (`source='osm_tag'`, `old_area_id` NULL, `level` = cấp của chính đơn vị).
   Thứ tự nạp: overlay → osm_tag → seed; `ON CONFLICT DO UPDATE` để **seed thắng** (chỉnh tay có
   ưu tiên cao nhất).
7. `publishNew(['admin_area_old','admin_alias'])`. Báo cáo: số L4/L6/L8 cũ, số alias theo `source`,
   số ca tách, số phường cũ **không** khớp phường mới nào (kỳ vọng 0 trên đất liền).

Khánh Hòa: OSM hiện thiếu relation L4 (README pipeline). Overlay L8 vẫn chạy vì dựa vào L8 mới;
alias tỉnh `ninh thuan → Khánh Hòa` vẫn chờ OSM, giữ dòng CSV, không chặn.

### 4.5 Dùng alias trong geocode (`apps/api/src/geocode.ts`)

Thêm bước **0 — phân giải hành chính** trước bước 1, kết quả đưa vào `GeocodeContext`:

```ts
interface AdminScope {
  wardNorms: string[];        // phường mới ứng với phường/quận cũ (hoặc chính phường mới)
  provinceNorm: string | null;
  former?: { ward?: string; district?: string; province?: string }; // tên cũ đã nhận diện
  oldArea?: { name: string; level: number; bbox: Bbox; lat: number; lng: number };
}
```

- Tra `admin_alias` bằng `alias_norm = ANY(adminAliasKeys(parsed))`, ưu tiên khoá dài hơn; nếu
  không có alias, dùng chính `normalizeVi(parsed.ward)` như hiện nay (`wardNorms = [wardNorm]`).
- Bước 1, 3, 4 đổi `ward_norm = ${wardNorm}` thành `ward_norm = ANY(${wardNorms})` (giữ
  `OR ward_norm IS NULL` ở bước 1/3 như cũ). Bước 4 (`street.ward_norm text[]`) dùng
  `ward_norm && ${wardNorms}`.
- Bước 5 mở rộng: nếu không khớp `admin_area`, khớp `admin_area_old` bằng cùng bộ khoá → trả
  `precision: 'ward'` (L8 cũ) hoặc `'district'` **mới** (L6 cũ) hoặc `'province'` (L4 cũ),
  `confidence 0,2`, `bbox` của đơn vị cũ, `display_name` "Quận 10 (trước 07/2025)".
- Mọi item có alias tham gia thì thêm `matched.former` (tuỳ chọn). `display_name` dùng tên
  **mới**. Ví dụ: `88/9 Nguyễn Lâm, Phường 6, Quận 10` → `matched: { housenumber:'88/9',
  street:'Nguyễn Lâm', ward:'dien hong', province:'thanh pho ho chi minh',
  former:{ ward:'6', district:'10' } }`.

Bước 0 là một truy vấn nhỏ có chỉ số; chỉ chạy khi `parsed` có ward/district/province.

### 4.6 Autocomplete loại `area`

- Thêm `types=area` (mặc định **bật** cùng ba loại hiện có; `parseTypes` nhận thêm giá trị).
- Nguồn: `admin_area` (tên mới) ∪ `admin_alias` (tên cũ, `source in ('overlay','seed')`), bậc 1 dùng
  `LIKE 'q%'` và `q <% alias_norm` trên chỉ số GIN mới.
- Item: `{ type:'area', name:'Phường Diên Hồng', secondary:'trước đây: Phường 6, Quận 10 · TP. Hồ
  Chí Minh', lat, lng, bbox:[…] }`. Với alias cấp quận (1–n) trả **một** item tên quận cũ, `bbox`
  của quận cũ, `secondary` liệt kê tối đa 3 phường mới + "…".
- Xếp hạng: `prior` cho `area` = 0,6 (dưới POI, gần đường); `pop` = 0; `prox` theo tâm.
- SDK (`@mapslibvn/core` types, web component, React hook): `AutocompleteItem.type` thêm `'area'`,
  `bbox?: [number,number,number,number]`. Web component khi chọn `area` phát `select` như thường;
  ví dụ docs dùng `fitBounds(bbox)` thay `flyTo`.

### 4.7 Fixture kiểm chứng

`packages/core/tests/fixtures/admin-alias-2025.jsonl`: ≥ 60 dòng
`{ old: "Phường 6, Quận 10, TP.HCM", expectWard: "Diên Hồng", expectProvince: "Thành phố Hồ Chí Minh", source: "NQ 1685/NQ-UBTVQH15 Điều 1 khoản …" }`
trải ≥ 6 tỉnh (HCM, Hà Nội, Đà Nẵng, Cần Thơ, một tỉnh miền núi, một tỉnh ĐBSCL) và gồm ≥ 5 ca tách.
Dùng ở hai nơi: dbtest chạy overlay trên fixture (mục 9) và test `adminAliasKeys` (không DB).

---

## 5. Hạng mục 2 — Tìm mờ cho lỗi chính tả và đảo từ

### 5.1 Lớp lỗi cần chịu

| Lớp | Ví dụ → đích | Cách xử lý |
|---|---|---|
| Thiếu/sai dấu | `nguyen hue` → Nguyễn Huệ | đã có (`normalizeVi`) |
| Gõ sai 1–2 ký tự (thiếu, thừa, đổi chỗ) | `higland cofee`, `nguyne hue` | bậc 1: `word_similarity` |
| Truy vấn là **một phần** tên | `highlands` ⊂ "Highlands Coffee Nguyễn Huệ" | bậc 1: `word_similarity` (thay similarity toàn chuỗi) |
| Đảo thứ tự từ | `coffee highlands`, `cho ray benh vien` | bậc 1 (trigram không phụ thuộc thứ tự) + bậc 2 (token) |
| Đang gõ dở nhiều từ | `ng hue highl` | bậc 2: tsquery tiền tố từng token |
| Dính/tách từ | `hochiminh`, `nguyenhue`, `high lands` | bậc 3: `name_key` bỏ khoảng trắng |
| Telex/VNI sót | `nguyeenx huee`, `nguyen65 hue65` | bậc 3b (tuỳ chọn, mục 5.6) |

### 5.2 Kỹ thuật cốt lõi: `word_similarity` của pg_trgm

`word_similarity(q, name)` = similarity cao nhất giữa tập trigram của `q` và **một đoạn liên tục các
từ** của `name`. Với `q = 'coffee highlands'`, đoạn "highlands coffee" của tên có gần cùng tập trigram
(chỉ khác trigram biên) → ≈ 0,75; với `q = 'highlands'` so với tên dài vẫn ≈ 1. Toán tử `q <% name`
được chỉ số GIN `gin_trgm_ops` hiện có hỗ trợ (cột chỉ số ở **vế phải**), ngưỡng lấy từ GUC
`pg_trgm.word_similarity_threshold`.

- Đặt ngưỡng ở **cấp database** (`ALTER DATABASE <db hiện tại> SET pg_trgm.word_similarity_threshold
  = 0.5`, qua `DO $$ … format(…, current_database()) $$` trong migration) để production (user
  `api`), dev (user `mapslibvn`) và DB dbtest cô lập đều cùng giá trị; GUC áp cho phiên mới, kể cả
  kết nối qua Hyperdrive. `pg_trgm.similarity_threshold` giữ 0,3. (Bản nháp đầu ghi cấp role
  `api`; đổi khi viết plan vì dev không nối bằng role `api`.)
- Ngưỡng 0,5 là điểm khởi đầu; đo bằng bộ truy vấn mục 5.7 và chỉnh trong plan, không đổi ở đây.

### 5.3 Bậc 1 (thay điều kiện hiện tại, cho `poi`, `street`, `area`)

```sql
WHERE status = 'active' AND (
     name_norm LIKE ${prefixPattern}          -- tiền tố, đã có
  OR ${qNorm} <% name_norm                    -- MỚI: thay name_norm % q
  OR ${qCore} <% name_norm                    -- với POI
  OR ${qNorm} <% name_alt_norm                -- MỚI: tên thay thế (mục 6.3)
)
ORDER BY sim DESC LIMIT 20
```

`sim` trả về = `greatest(word_similarity(qNorm, name_norm), word_similarity(qCore, name_norm),
similarity(name_norm, qNorm))`. Giữ `prefix` như cũ. Với `/v1/search` và `stepStreet` cũng thay
`%` bằng `<%` (fallback không exact).

### 5.4 Bậc 2 — token không kể thứ tự (chỉ khi bậc 1 trả < `limit` và truy vấn có ≥ 2 token)

- Cột sinh: `name_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', name_norm)) STORED` trên
  `poi`, `street`; chỉ số `GIN (name_tsv)`. Cấu hình `'simple'` để không stem/stopword tiếng Anh.
- Truy vấn: `to_tsquery('simple', 'ng:* & hue:* & highl:*')` — mọi token là tiền tố, AND, không
  kể thứ tự. Token < 2 ký tự bị bỏ; token toàn số giữ nguyên.
- `sim` cho bậc 2 = `word_similarity(qNorm, name_norm)` tính trong cùng câu SELECT, để cùng
  thang với bậc 1 (không dùng `ts_rank_cd`, thang khác và không so được với bậc 1).

### 5.5 Bậc 3 — khoá ngữ âm (mô tả ở hạng mục 3, mục 6.2)

Chạy khi bậc 1+2 vẫn < `limit`: `${qKey} <% name_key`. Bao luôn dính/tách từ vì `name_key` không
có khoảng trắng.

### 5.6 Bậc 3b (tuỳ chọn, bật bằng cờ) — Telex/VNI sót

`foldTelex(qNorm)` trong core: `aa→a, ee→e, oo→o, dd→d, aw→a, ow→o, uw→u`, bỏ `s f r x j` đứng cuối
từ sau nguyên âm, bỏ chữ số 1–9 dính cuối từ (VNI). Chỉ chạy khi chuỗi **khớp mẫu telex**
(`/(aa|ee|oo|dd|[aeiouy][sfrxj]\b|[a-z][1-9]\b)/`) và các bậc trước rỗng. Không áp dụng cho dữ
liệu, chỉ cho truy vấn. Mặc định **tắt** ở lần phát hành đầu; bật sau khi có số liệu từ log
truy vấn rỗng (mục 5.7).

### 5.7 Xếp hạng và đo lường

- `ranking.ts`: thêm `STAGE_PENALTY = 0.05` nhân `(stage − 1)`; giữ `COEFF`. Kết quả bậc 1 luôn có
  lợi thế nhẹ so với bậc 2/3 cùng `sim`.
- Ba loại (`poi`, `street`, `area`) truy vấn **song song** bằng `Promise.all` trong cùng bậc (hiện
  tuần tự — quan sát 05/09: đây là phần lớn độ trễ khi cache lạnh).
- Đo bằng `scripts/perf-autocomplete.mjs` với bộ 40 truy vấn mới (`scripts/fixtures/fuzzy-queries.txt`:
  10 đúng, 10 lỗi gõ, 10 đảo từ, 10 dính từ) trên DB dev có fixture Quận 1 và trên production
  qua `wrangler dev --remote`. Tiêu chí: p95 nhánh bậc-1-đủ ≤ hiện tại + 50 ms; nhánh chạy hết
  3 bậc ≤ 600 ms.
- Log (Analytics Engine, đã có) thêm trường `stage_hit` (1/2/3/0=rỗng) để biết bậc nào cứu được
  bao nhiêu truy vấn; là cơ sở chỉnh ngưỡng và quyết định bật 3b.

---

## 6. Hạng mục 3 — Nhận diện cách viết địa phương

Ba lớp bổ trợ nhau, từ rẻ đến đắt:

### 6.1 Từ điển biến thể địa danh `packages/core/src/toponym_alias.json`

Cùng cơ chế `brand_alias.json` (dạng chuẩn → danh sách biến thể, đã `normalizeVi`), nhưng áp dụng
**ở bất kỳ vị trí** trong chuỗi (theo biên từ), cho cả truy vấn và `name_norm` lúc nạp dữ liệu
(kết quả ghi vào `name_key`, không đổi `name_norm` hiển thị). Danh sách khởi đầu (mở rộng dần,
mỗi dòng phải có nguồn: OSM `alt_name`/`old_name` hoặc Wikipedia):

| Chuẩn | Biến thể |
|---|---|
| `quy nhon` | `qui nhon`, `quinhon` |
| `bac kan` | `bac can` |
| `dak lak` | `dac lac`, `daklak`, `dak lac`, `dac lak` |
| `dak nong` | `dac nong` |
| `pleiku` | `plei ku`, `play cu`, `plây cu` (sau bỏ dấu: `play cu`) |
| `buon ma thuot` | `ban me thuot`, `bmt`, `buon me thuot` |
| `kon tum` | `kontum` |
| `my tho` | `mi tho` |
| `sai gon` | `saigon`, `sg` |
| `ha noi` | `hanoi` |
| `da nang` | `danang`, `tourane` |
| `da lat` | `dalat` |
| `nha trang` | `nhatrang` |
| `hue` | `thua thien hue` |
| `sa pa` | `sapa` |
| `phan rang` | `phan rang thap cham` |
| `tan son nhat` | `tan son nhut` |
| `cho lon` | `cholon` |
| `hai phong` | `haiphong` |
| `can tho` | `cantho` |
| `soc trang` | `xoc trang`, `soctrang` |
| `rach gia` | `rachgia` |
| `hoi an` | `faifo` |
| `ly son` | `li son` |
| `ky anh` | `ki anh` |

Ghi chú: các cặp chỉ khác **dấu** (Vũng Tàu/Vũng Tầu, Sóc Trăng/Sốc Trăng, Rạch Giá/Rạch Gía) đã
trùng nhau sau `normalizeVi` nên **không** đưa vào từ điển. Một test tự động bắt điều này: mỗi
biến thể phải khác dạng chuẩn sau `normalizeVi`, nếu không test đỏ để người biên soạn xoá dòng.
Các cặp chỉ khác `i/y` (`li son`, `ki anh`, `mi tho`) cũng đã được luật `viKey` (6.2) xử lý; giữ
trong từ điển để bậc 1 (chưa qua `viKey`) cũng khớp được cho địa danh hay gặp.

### 6.2 Khoá ngữ âm `viKey()` (core) và cột `name_key`

Áp dụng **sau** `normalizeVi` và từ điển 6.1, theo từng từ, rồi nối **không khoảng trắng**:

| Luật | Ví dụ | Lý do |
|---|---|---|
| `y` cuối từ sau phụ âm → `i`; `quy` → `qui`; `ky/ly/my/ty/hy` → `ki/li/mi/ti/hi` | `my tho`→`mi tho`, `ly thuong kiet`→`li thuong kiet` | i/y là biến thể chính tả phổ biến nhất |
| `k` đầu từ trước `a o u` → `c` | `kan`→`can`, `kon`→`con` | Bắc Kạn/Cạn, Kon/Con |
| `ph` đầu từ ↔ `f` | `fo`→`pho` | gõ kiểu điện thoại |
| `d`, `gi`, `r` đầu từ → `d`; `tr`, `ch` → `c`; `s`, `x` → `s`; `l`, `n` đầu từ **giữ** | `gia lai`→`da lai`, `tran`→`can` | phát âm vùng; chỉ dùng ở bậc 3 nên va chạm chỉ ảnh hưởng thứ tự trong nhóm mờ |
| `-ng`/`-n`, `-c`/`-t` cuối từ → `-n`, `-c` | `binh thanh`→`bin than`, `viet`→`viec` | âm cuối miền Nam (Nhứt/Nhất khác nguyên âm, do từ điển 6.1 lo) |
| bỏ `h` trong `gh`, `ngh` | `nghe`→`nge` | chính tả |
| nguyên âm đôi `ie/ye`, `uo`, `ua` giữ; `ae/oe` không có trong tiếng Việt → giữ | | tránh gộp quá tay |

Không áp dụng `l/n` (Hà Nội ↔ Hà Lội) vì tạo va chạm với tên riêng thật quá nhiều. Bảng luật nằm
trong code dưới dạng dữ liệu (`vi_key_rules.json`) để chỉnh mà không sửa logic.

Cột: `name_key text` trên `poi`, `street`, `admin_area`, `admin_area_old`, và `alias_key` trên
`admin_alias`; tính trong pipeline (`records.mjs`, `streets.mjs`, `admin.mjs`, `admin-old.mjs`)
bằng cùng hàm `viKey` của core; chỉ số `GIN (name_key gin_trgm_ops)`. Không dùng generated column
vì hàm ở TS, không ở SQL; **test đối chiếu**: dbtest chọn 1.000 dòng ngẫu nhiên, tính lại `viKey`
trong Node và so bằng cột đã lưu.

Fixture `packages/core/tests/fixtures/vi-key.csv` ≥ 100 dòng `input|key`, gồm mọi luật và các cặp
**không được** gộp (Hà Nội/Hà Lội, Tân/Tần).

### 6.3 Tên thay thế từ OSM (`name_alt_norm`)

- `poi.name_alt` đã có (`alt_name`, `old_name`, `official_name`, `name:en`). Thêm cột
  `name_alt_norm text` = các phần tử đã `normalizeVi`, nối bằng `' | '` (giữ biên từ cho
  `word_similarity`); chỉ số GIN trgm. Nạp trong `publish.mjs`.
- `street`: `osm-roads.mjs` đọc thêm `old_name`, `alt_name`, `short_name`, `name:vi`, `official_name`
  → `osm_road_raw.name_alt text[]`; `streets.mjs` hợp các mảng của các way cùng tuyến → `street.name_alt
  text[]`, `name_alt_norm text`. Đường đổi tên nhiều lần ("Công Lý" → "Nam Kỳ Khởi Nghĩa") nhờ vậy
  tìm được.
- `admin_area`: tag `old_name`/`alt_name`/`official_name`/`short_name` → dòng `admin_alias` với
  `source='osm_tag'` (mục 4.4 bước 6).
- Bậc 1 thêm nhánh `${qNorm} <% name_alt_norm` (5.3). Kết quả khớp qua tên thay thế mang thêm
  `matched_alt: "Công Lý"` (tuỳ chọn) để UI hiển thị "Nam Kỳ Khởi Nghĩa (tên cũ: Công Lý)".

### 6.4 Biến thể chữ viết cho từ chỉ loại (nhỏ, cùng cơ chế 6.1)

Chỉ những cặp là **cách viết** khác nhau của cùng một từ, không phải đồng nghĩa: `banh mi/banh my`,
`hu tieu/hu tiu`, `ca phe/cafe/caphe/coffee` (đã trong `NAME_FILLERS`, giữ), `com tam/com tam`,
`bun bo hue/bun bo`, `nha thuoc/nha thuoc tay`. Đồng nghĩa theo loại (`tiem thuoc`, `hieu thuoc`,
`quay thuoc` → `pharmacy`) là việc **ánh xạ sang category**, ghi ở mục 12.

---

## 7. Thay đổi hợp đồng API và SDK (chỉ bổ sung)

| Nơi | Thêm | Ghi chú |
|---|---|---|
| `GET /v1/autocomplete` | `types` nhận `area`; item `type:'area'` có `bbox`; item bất kỳ có `matched_alt?` | mặc định `types` gồm cả `area` |
| `GET /v1/geocode` | `matched.former?: { ward?, district?, province? }`; `precision` thêm giá trị `district` (chỉ khi khớp quận/huyện cũ ở bước 5) | `do-chinh-xac.md` bảng precision thêm dòng |
| `GET /v1/search` | không đổi hợp đồng; khớp mờ hơn | |
| `@mapslibvn/core` types | `AutocompleteItem.type` thêm `'area'`, `bbox?`, `matched_alt?`; `GeocodeItem.matched.former?`; export `viKey`, `adminAliasKeys`, `applyToponymAlias` | không breaking |
| `<mapslibvn-autocomplete>` / React / RN | hiển thị item `area` (icon khác, dòng phụ); `select` như cũ | ví dụ docs dùng `bbox` |
| Docs | `tim-kiem.md` (loại `area`, tìm mờ), `do-chinh-xac.md` (mục 72: bỏ câu "bảng này chưa đầy đủ", thêm `former`, `district`), `api.md` | |

Phiên bản SDK: bump minor cho 4 gói (thêm API, không phá).

---

## 8. Migration và triển khai

- Migration tách theo plan: `0007_word_similarity_threshold.sql` (GUC cấp database, plan hạng
  mục 2); `0008_admin_old.sql` (bảng `admin_area_old`; đổi PK + cột mới `admin_alias`; plan hạng
  mục 1); `0009_search_keys.sql` (cột `name_key`, `name_alt_norm`, `name_tsv` và chỉ số trên
  `poi`, `street`, `admin_area`; plan hạng mục 3). Mỗi bản có `.down.sql`; GRANT SELECT bảng mới
  cho `api`, OWNER `pipeline`. `scripts/lib/db-permissions.mjs` và `scripts/lib/odbl.mjs` (export ODbL) thêm bảng
  `admin_area_old` và cột mới của `admin_alias`.
- Chỉ số trên `poi` 1,5–2,5 triệu dòng dựng vài phút; giai đoạn nội bộ chấp nhận chạy trong
  `server:update` như migration thường (không `CONCURRENTLY` để giữ migration trong transaction).
  Dung lượng ước tính: +1 GIN tsvector ≈ 150 MB, +2 GIN trgm ≈ 250 MB.
- Cột `name_key`/`name_alt_norm` **NULL cho tới lần chạy pipeline kế tiếp**; API phải coi NULL là
  "không khớp" (toán tử trên NULL trả NULL → tự nhiên không khớp), nên deploy API trước hay sau
  pipeline đều an toàn. `admin_area_old` rỗng cho tới khi `admin-old.mjs` chạy; bước 0 geocode trả
  scope rỗng → hành vi y như hiện nay.
- Thứ tự phát hành gợi ý: migration → deploy API (bậc 1 với `<%` có hiệu lực ngay trên chỉ số cũ)
  → chạy `admin-old.mjs` + pipeline đầy đủ (điền `name_key`, `name_alt_norm`, alias) → deploy
  SDK/docs.

---

## 9. Kiểm thử

| Tầng | Nội dung | Không cần DB? |
|---|---|---|
| Unit core | `viKey` (fixture ≥ 100), `applyToponymAlias`, `adminAliasKeys` (fixture 4.7), `foldTelex`, test "biến thể phải khác chuẩn sau normalizeVi" | có |
| Unit API | `planStages(q, tokens)` trả đúng danh sách bậc; SQL builder từng bậc là hàm thuần trả `{ text, values }` để so chuỗi; ranking với `STAGE_PENALTY`; `parseTypes('area')`; geocode với `sql` giả trả alias → `former` và `ward_norm = ANY` | có (giữ quy tắc test `apps/api` không cần Postgres) |
| dbtest | overlay trên fixture: cần **fixture cũ** `pipelines/poi/fixtures/admin-old-q1.osm.pbf` cắt từ `vietnam-250101.osm.pbf` cùng bbox Quận 1 (`make-fixture.mjs --snapshot 250101`); kỳ vọng: mọi L8 cũ trong bbox khớp ≥ 1 L8 mới, tổng `share` ≈ 1; alias `phuong ben nghe quan 1` → `Phường Sài Gòn`; đối chiếu `name_key` 1.000 dòng | không |
| Perf | `perf-autocomplete.mjs` với `fuzzy-queries.txt`; ngưỡng mục 5.7 | không |
| E2E docs playground | gõ "Quận 10" → có item `area`; "coffee highlands" và "higlands" → có Highlands; "qui nhon" → kết quả Quy Nhơn | không (local API + fixture) |
| Production smoke | 10 địa chỉ cũ thật (fixture 4.7) qua `/v1/geocode` → `precision ∈ {rooftop, alley, interpolated}` ≥ 8/10 | không |

---

## 10. Rủi ro

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Ranh giới OSM 01/2025 chưa khớp thực tế hoặc thiếu relation ở vài huyện | thiếu alias vùng đó | báo cáo "L8 cũ không khớp" và "ca tách"; CSV seed vá tay, `source='seed'` thắng |
| Phường cũ tách đôi → alias trỏ 2 phường mới, mốc ở phường "kia" | bước 1 vẫn đúng vì `ANY(wardNorms)` | `share` để xếp thứ tự khi phải chọn 1 |
| `word_similarity` ngưỡng 0,5 quá lỏng → nhiều kết quả nhiễu | gợi ý kém | ngưỡng là GUC theo role, đổi không cần deploy; `STAGE_PENALTY`; đo bằng bộ 40 truy vấn |
| Bậc 2/3 làm p95 tăng khi cache lạnh | chậm | chỉ chạy khi thiếu; song song hoá 3 loại; log `stage_hit` để cắt bậc ít ích |
| `viKey` gộp quá tay (Gia/Da, Tr/Ch) | kết quả lạ lọt vào | chỉ ở bậc 3, sau các bậc chính xác; fixture "không được gộp" |
| Kích cỡ DB +~400 MB chỉ số | ổ máy chủ | vẫn dưới ước tính 2–3 GB của spec gốc; theo dõi `pg_database_size` trong báo cáo tuần |
| Trộn dữ liệu giấy phép khác vào bảng ODbL | vi phạm ODbL khi `export:odbl` | không nạp dataset GitHub; chỉ OSM + văn bản pháp luật + biên soạn tay |

---

## 11. Tiêu chí nghiệm thu

1. `admin_area_old` có L4 = 63, L6 trong khoảng 690–710, L8 trong khoảng 10.000–10.700; số L8 cũ
   trên đất liền không khớp phường mới nào = 0; báo cáo ca tách kèm danh sách.
2. Fixture 4.7 (≥ 60 dòng, ≥ 6 tỉnh): 100 % alias đúng phường mới; 10 địa chỉ cũ thật trên
   production ≥ 8/10 giữ `precision` mức đường trở lên.
3. Bộ 40 truy vấn mờ: ≥ 36/40 có kết quả đích trong top 3 của autocomplete (trước thay đổi đo
   baseline để so; kỳ vọng baseline < 20/40).
4. p95 autocomplete nhánh bậc 1 ≤ baseline + 50 ms; nhánh 3 bậc ≤ 600 ms (đo `perf-autocomplete`).
5. Gõ "Quận 10", "Bình Dương", "Thủ Dầu Một" trong playground trả item `area` với `secondary` nêu
   đơn vị mới.
6. "qui nhon", "kontum", "dak lak", "tan son nhut", "cong ly" (đường) đều trả đúng đích trong top 3.
7. CI xanh 4 gói; test `apps/api` vẫn chạy không cần Postgres; `export:odbl` có `admin_area_old`;
   docs 3 trang cập nhật và link check xanh.

---

## 12. Việc để sau (không thuộc spec này)

- Đồng nghĩa loại địa điểm → `category` (tiệm thuốc/hiệu thuốc/quầy thuốc → `pharmacy`; cây xăng/
  trạm xăng → `fuel`), khai thác `category.name_vi` và bảng alias loại.
- Gợi ý sửa lỗi phía UI ("Có phải bạn muốn tìm…") từ từ điển token có tần suất.
- Alias khu vực không chính thức có ranh giới mờ (Chợ Lớn, Hàng Xanh, Bảy Hiền) dưới dạng điểm/
  vùng do người dùng đóng góp qua `poi_edit`.
- Bật bậc 3b (Telex/VNI) sau khi log `stage_hit` cho thấy tỷ lệ truy vấn rỗng khớp mẫu telex đáng kể.

---

## 13. Thứ tự triển khai gợi ý cho plan

1. **Hạng mục 2 trước** (nhỏ nhất, hiệu quả ngay, không cần pipeline): migration GUC + `<%` ở bậc 1
   + song song hoá + perf baseline. Một ngày.
2. **Hạng mục 1**: migration 0008 (admin), `adminAliasKeys`, `admin-old.mjs`, bước 0 geocode,
   loại `area`, SDK/docs. Ba đến bốn ngày, gồm một lần chạy pipeline đầy đủ trên máy chủ.
3. **Hạng mục 3**: `viKey`, `toponym_alias.json`, `name_alt_norm` cho street, bậc 2–3. Hai ngày.

Mỗi hạng mục một implementation plan riêng dưới `docs/superpowers/plans/`, mỗi plan kết thúc bằng
cổng CI đầy đủ (lint, typecheck, vitest, api test, build, e2e) theo quy trình đã dùng cho M7.

---

## 14. Nguồn tham khảo

- Geofabrik, trang tải Việt Nam (có snapshot theo ngày, gồm `vietnam-250101.osm.pbf` 306,5 MB):
  https://download.geofabrik.de/asia/vietnam.html
- Toàn văn 34 Nghị quyết UBTVQH về sắp xếp ĐVHC cấp xã (1654–1687/NQ-UBTVQH15, hiệu lực
  16/06/2025): https://xaydungchinhsach.chinhphu.vn/toan-van-34-nghi-quyet-cua-ubtvqh-ve-sap-xep-cac-don-vi-hanh-chinh-cap-xa-119250616215143373.htm
- Danh sách 3.321 ĐVHC cấp xã tại 34 tỉnh, thành: https://xaydungchinhsach.chinhphu.vn/danh-sach-3321-don-vi-hanh-chinh-cap-xa-tai-34-tinh-thanh-sau-sap-xep-sap-nhap-119250710102358656.htm
- Bảng danh mục và mã số 34 tỉnh, 3.321 xã: https://baochinhphu.vn/bang-danh-muc-va-ma-so-cua-34-tinh-thanh-moi-3321-don-vi-hanh-chinh-cap-xa-moi-102250704153652947.htm
- Wikipedia, 2025 Vietnamese administrative reforms: https://en.wikipedia.org/wiki/2025_Vietnamese_administrative_reforms
- Bộ dữ liệu cộng đồng chỉ dùng đối chiếu số lượng: https://github.com/dvhcvn/data ·
  https://github.com/daohoangson/dvhcvn · https://github.com/phamhongduc-dev/dvhcvn ·
  https://github.com/zuydd/vn-geo · https://github.com/vietmap-company/vietnam_administrative_address
- PostgreSQL `pg_trgm`: `word_similarity`, toán tử `<%`, GUC `pg_trgm.word_similarity_threshold`,
  hỗ trợ chỉ số GIN: https://www.postgresql.org/docs/16/pgtrgm.html
