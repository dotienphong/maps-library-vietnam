# Alias đầy đủ cho đơn vị hành chính cũ–mới — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, inline. Chỉ dùng superpowers:subagent-driven-development khi PHONG yêu cầu chạy subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Địa chỉ hành chính trước 01/07/2025 tìm được vùng hiện hành và giữ độ chính xác geocode; autocomplete gợi ý cả vùng cũ lẫn mới, có bằng chứng độ phủ toàn quốc.

**Architecture:** Giữ `admin_area` hiện hành; thêm `admin_area_old`, sinh quan hệ 1–n bằng overlay PostGIS và seed có nguồn. Core sinh cùng bộ khóa cho pipeline/API; bước 0 phân giải scope cho thang geocode; autocomplete thêm `area`. Xây staging và kiểm chứng trước khi phát hành đồng bộ ba bảng hành chính.

**Tech Stack:** Node ≥22, pnpm 9.15, TypeScript, PostgreSQL 16/PostGIS 3.4/pg_trgm, postgres.js, Osmium trong pipeline container, Hono/Cloudflare Workers, Vitest, Playwright.

**Spec:** [Thiết kế đã duyệt](../specs/2026-09-05-tim-kiem-alias-fuzzy-dia-phuong-design.md), mục 4, phần liên quan hạng mục 1 trong mục 7–11 và 13.

**Trạng thái:** Task 0–7 hoàn tất 06/09/2026. Task 8: **8.1–8.2 xong** (evaluator + CLI hai mode, đã smoke-test thật), 8.3–8.7 **chặn bởi việc 3**. Task 9: **9.1 xong**, 9.2 làm một phần — đã áp migration 0008 lên production để **khắc phục sự cố `/v1/autocomplete` 503** (xem DEVLOG 07/09), 9.4–9.7 chặn. Không tick hoàn tất plan. Hạng mục 2 đã có plan riêng và đã đóng. Chưa tuyên bố độ phủ toàn quốc vì ledger nguồn còn khoảng thiếu Khánh Hòa/Jan→Jun.

**Năm việc đã phát hiện — ba đã sửa, hai còn chặn:**

1. **[ĐÃ SỬA]** **Selectivity nhánh alias** — `areaCandidates` chia bậc: bậc 1 chỉ tiền tố, chỉ leo lên `<%` khi bậc 1 rỗng. Đo lại cùng bộ dữ liệu: `Quận 10` 81,9 → **0,269 ms**, `Tân Thành` 100,9 → **1,032 ms**, alias dài 13,8 → **0,120 ms**, `qu` 116,9 → **41,9 ms**. Còn lại: `qu` 41,9 ms vì 7.552 alias thật sự bắt đầu bằng "qu" — đề xuất bỏ nhánh alias khi query < 3 ký tự, chờ PHONG quyết vì là đánh đổi tính năng.
2. **[ĐÃ SỬA]** **`admin-old.mjs` standalone hỏng khi thiếu `osm_admin_raw`** — guard bằng `to_regclass`, bỏ nguồn `osm_tag` kèm cảnh báo và `report.osmTagSource`, không nổ 42P01 và không bỏ lặng lẽ. DB test khoá cả hai nhánh.
3. **[CÒN CHẶN — nguồn]** **Thiếu Khánh Hòa** — OSM **không có** relation `admin_level=4` cho Khánh Hòa, cả ở snapshot 01/2025 (62/63 tỉnh cũ) lẫn OSM hiện tại (Overpass trả rỗng), nên không dựng được kể cả bằng cách hợp Khánh Hòa cũ + Ninh Thuận cũ. `admin_area` còn 33/34 tỉnh, cổng QA alias còn đỏ (70/72 unmatched + `seed_miss=1` đều là Ninh Thuận) nên **không publish được alias toàn quốc**. Ba đường ra đều cần PHONG quyết về nguồn/giấy phép — xem mục 7 hồ sơ 6.5. **Việc này chặn Task 8**: không có bộ dữ liệu qua cổng độ phủ thì không đo được nghiệm thu toàn quốc.
4. **[ĐÃ SỬA]** **Gợi ý `area` gần như không bao giờ hiện với `types` mặc định.** Đo trên API thật (Task 7.6): bảy truy vấn tên quận đều không có item `area` nào trong 10 gợi ý. Nguyên nhân **không** phải `prior` (chỉ nặng 0,05 trong `COEFF`, chênh 0,6 với 1 chỉ đáng 0,02) mà vì `area-candidates.ts` trả `0 AS pop`, nên vùng mất trắng `0,15·pop`: area 0,76 so với POI 0,875. Sửa ở **tầng chọn, không phải tầng điểm** — `withAreaSlot()` dành một suất cuối cho vùng khi truy vấn là **thuần tên hành chính** (`isAdminOnlyQuery`: có phường/quận/tỉnh, không có số nhà/tên đường). Không gán `pop` giả cho vùng vì muốn thắng bằng điểm thì phải đặt ≈ 1, tức khai vùng là thứ phổ biến nhất DB và sẽ cướp chỗ POI ở truy vấn như "Bến Thành"; ngoài ra plan cấm đổi xếp hạng POI/đường. Đo lại: **cả bảy truy vấn giờ đều có vùng ở suất cuối**, `highlands`/`cà phê` không đổi (top vẫn POI 0,93), truy vấn có số nhà không được dành suất. E2E docs quay lại đúng ca "Quận 10" như plan viết ban đầu, 27/27 xanh.

5. **[CÒN CHẶN — ground truth]** **Fixture Task 0 gán sai huyện ở 11 ca.** Phát hiện khi chạy 8.4. `admin-alias-fixtures.test.mjs` chỉ assert `expectedKeys.length > 0` nên không bắt được; `expectedKeys` viết tay cũng lệch khỏi dạng canonical của core (`phuong da kao quan 1 thanh pho ho chi minh` so với `phuong da kao quan 1 ho chi minh`). Đã thêm cổng `fixture_district_mismatch` vào `evaluateCoverage`, và CLI nay tra theo **đơn vị cũ** thay vì theo chuỗi khóa. Nhưng sửa nội dung fixture là **đọc lại nghị quyết gốc** — việc văn bản pháp lý, cần PHONG hoặc người có nguồn làm; tôi không tự điền vì đó đúng là cách fixture hiện tại bị sai.

## Global Constraints

- “Mọi thay đổi hợp đồng API/SDK là **bổ sung** (thêm trường/loại tuỳ chọn), không đổi hay bỏ trường hiện có.”
- “Không sửa dữ liệu hiển thị `poi.ward`/`poi.province` (tên theo nguồn) — chỉ chuyện tìm kiếm.”
- “Không đổi thuật toán conflation, taxonomy, hay điểm `popularity`.”
- “Không đưa công cụ tìm kiếm ngoài (Meilisearch/Typesense) vào”.
- “mọi nhánh WHERE phải có chỉ số”; kiểm EXPLAIN trên dữ liệu đủ lớn, không ép planner dùng index ở fixture nhỏ.
- OSM/Geofabrik là nguồn nạp; nghị quyết là nguồn đối chiếu/seed có trích dẫn. Không nạp dataset cộng đồng khác giấy phép vào bản xuất ODbL.
- Alias `level` là cấp **cũ**; L6 cũ có thể trỏ nhiều L8 mới. `share ≥ 0,05` giữ lại ở overlay L8; phân loại ca tách bằng share **thô** lớn nhất `<0,9`.
- Không đổi `word_similarity_threshold=0.5`, `useSimilarityBranch()` ≤12 ký tự, cách xếp hạng POI/đường đã nghiệm thu. Không làm phonetic, `viKey`, tsvector, `matched_alt` hay migration 0009 trong plan này.
- API unit test không cần DB; DB test chỉ trên `mapslibvn_task8_test`. Không chạy hai runner reset DB cùng lúc.
- Mỗi task cập nhật DEVLOG và ghi bằng chứng trước commit. Không sửa `AGENTS.md`. Viết plan không đồng nghĩa đã chạy migration, tải toàn quốc, publish SDK hay deploy.

## Quyết định triển khai cần đọc cùng spec

Các điểm dưới đây cụ thể hóa hoặc sửa giả định kỹ thuật trong spec; nếu thực nghiệm buộc đổi hợp đồng/tiêu chí, cập nhật spec và báo PHONG trước phần triển khai phụ thuộc.

1. **Không publish `admin.mjs` rồi mới xây alias.** Hiện `admin.mjs` đánh lại ID bằng `row_number()` và thay cả `admin_alias`. Refactor thành coordinator dựng current → old → alias staging, cuối cùng `publishNew(sql, ['admin_area', 'admin_area_old', 'admin_alias'])`. `admin-old.mjs` chạy lẻ chỉ thay old+alias trên current đã có. Giữ transaction/FK/grant của bảng thật; không đổi `publishNew` thành rename hoặc dùng `TRUNCATE CASCADE`.
2. **Không chuẩn hóa share để che lỗ dữ liệu.** Báo cáo `raw_coverage`, `discarded_share`, phần chồng lấn và geometry không hợp lệ trước khi chuẩn hóa. Hai phường mới cùng chồng lên 100% một phường cũ là lỗi, không phải mapping 50/50 hợp lệ. Không bỏ lọc những vùng thiếu để đạt số 0.
3. **Không chọn ngẫu nhiên địa phương trùng tên.** Khóa có tỉnh đứng trước khóa ngắn. Chỉ giữ khóa không tỉnh khi duy nhất ở đúng cấp, kể cả `phuong W quan D`; tên phường số không sinh khóa trần. PK ba cột trong spec được giữ; khác vùng nhưng cùng khóa/đích được giải quyết bằng khóa có tỉnh, không gộp mất provenance `old_area_id`.
4. **Giữ phần hành chính nguyên gốc.** `parseAddress()` hiện bỏ tiền tố phường/quận và canonicalize tỉnh. Thêm `adminOriginal?` vào `ParsedAddress`; không đổi các trường cũ. Cần biết “xã”/“phường”, “thành phố” cấp huyện, và “Bình Dương” gốc để sinh khóa và `former` đúng.
5. **Scope phải áp dụng cả hẻm và bước nội suy phụ.** Spec liệt kê bước 1/3/4 nhưng bước 2 hiện chưa lọc hành chính; bổ sung ràng buộc qua street cha và kiểm điểm kết quả. Khi có old area, dùng geometry để tránh phường cùng tên ở tỉnh khác hoặc điểm nằm ở phần khác của phường mới bị gộp. Khi không có alias, giữ đường chạy cũ.
6. **Snapshot tháng 1 không chứng minh đầy đủ đến 30/06.** Task 0 kiểm kê các thay đổi giữa snapshot và mốc mục tiêu; thiếu phải được bổ sung bằng OSM có provenance hoặc seed đối chiếu nghị quyết. Không gọi dataset “đầy đủ” khi chỉ đủ những relation có trong snapshot.
7. **Khánh Hòa là khoảng thiếu phải công bố.** Code hiện chỉ giữ nhiều L8 khi có L4 bao chứa. Không giả định cứ overlay L8 là cứu được vùng này. Không tự vẽ L4; nếu chưa có nguồn hợp lệ, báo cáo vùng thiếu và chưa đóng nghiệm thu toàn quốc.
8. **Mức chính xác nghiệm thu:** dùng tiêu chí chặt trong spec mục 9: ≥8/10 địa chỉ cũ đạt `rooftop|alley|interpolated`, đồng thời không kém địa chỉ mới tương ứng. Không dùng `street` để làm đạt ngưỡng 8/10 dù mục 11 viết rộng hơn.
9. **Fixture hai cấp:** Q1 và hình học tổng hợp chạy CI; bộ ≥60 trường hợp/≥6 tỉnh chạy trên dataset đầy đủ. Không bắt fixture Q1 chứng minh cả nước.
10. **Seed thắng theo nhóm khóa**, không chỉ một cạnh `ON CONFLICT`: nếu seed sửa mapping A→B thành A→C, phải loại cạnh overlay A→B của nhóm đó. Nhiều đích seed hợp lệ được giữ nguyên cùng nhau. `osm_tag` không bị gắn mặc định `valid_until=2025-06-30` hay `former` nếu không chứng minh là tên hết hiệu lực.

## Bản đồ file và phụ thuộc

| Nhóm | File | Trách nhiệm |
|---|---|---|
| Nguồn/QA | `pipelines/poi/fixtures/admin-old-source.json`, `packages/core/tests/fixtures/admin-alias-2025.jsonl` (mới) | Manifest snapshot, trường hợp kiểm chứng có nguồn |
| Schema | `db/migrations/0008_admin_old.sql`, `.down.sql`, `db/admin-old.dbtest.mjs` (mới) | Bảng cũ, PK 1–n, chỉ số, up/down |
| Core | `packages/core/src/admin-alias.ts` (mới), `address.ts`, `types.ts`, `index.ts` | Khóa chung, giữ input gốc, hợp đồng thêm |
| Import | `pipelines/poi/src/geocode/admin-old-source.mjs` (mới), `lib/env.mjs`, `scripts/make-fixture.mjs` | Tải/xác minh/import snapshot, fixture offline |
| Overlay | `pipelines/poi/src/geocode/admin-overlay.mjs`, `admin-old.mjs` (mới) | Tỷ lệ diện tích, nhóm alias, báo cáo |
| Publish | `pipelines/poi/src/geocode/admin.mjs`, `raw-tables.mjs`, `osm-roads.mjs`, `scripts/data-update.mjs` | Current staging, tag hành chính, publication nguyên tử |
| Geocode | `apps/api/src/admin-scope.ts` (mới), `geocode.ts` | Resolver và thang 5 bước |
| Autocomplete | `apps/api/src/area-candidates.ts` (mới), `autocomplete-sql.ts`, `params.ts`, `ranking.ts`, `routes/autocomplete.ts` | Loại area, bbox, grouping/ranking/cache |
| QA toàn quốc | `scripts/verify-admin-alias.mjs`, `scripts/fixtures/admin-alias-addresses.jsonl` (mới) | Coverage, nghị quyết, cặp geocode, benchmark |
| SDK/docs | Core/web/React/RN, docs và playground | Type area, sự kiện select, fitBounds, hướng dẫn |
| Vận hành | `scripts/lib/db-permissions.mjs`, `scripts/lib/odbl.mjs`, `scripts/db-fixture.mjs`, `apps/api/test-db/setup.sql` | Restore quyền, export, DB/E2E fixture |

Thứ tự: **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9**. Mỗi task là một cổng review; các bước bên trong làm tuần tự. Commit mô tả cuối task chỉ thực hiện khi bắt đầu triển khai plan.

## Task 0: Chốt nguồn và bộ bằng chứng trước khi viết pipeline

**Files:** tạo `pipelines/poi/fixtures/admin-old-source.json`, `packages/core/tests/fixtures/admin-alias-2025.jsonl`, `scripts/fixtures/admin-alias-addresses.jsonl`, `scripts/admin-alias-fixtures.test.mjs`; sửa phần hạng mục 1 của spec và DEVLOG khi cần ghi rõ quyết định ở trên.

**Interfaces:** manifest có `url`, `md5`, `sha256`, `bytes`, `osmTimestamp`, `downloadedAt`, `targetValidUntil`, `license`. Fixture mỗi dòng có `caseId`, `old`, `expectedKeys`, `expectedTargets: [{ward, province}]`, `split`, `sourceUrl`, `sourceClause`; cặp địa chỉ có `caseId`, `oldQuery`, `newQuery`, `expectedBbox`, `sourceUrl`. Không dùng ID sinh lại theo lần nạp làm ground truth.

- [x] **0.1** Chụp Git/DB counts hiện hành, `df -h /`, `docker info`; đọc README pipeline, spec và plan này. Lưu baseline theo release, không chép số production cũ từ DEVLOG làm số hiện tại.
- [x] **0.2** Viết test manifest/fixture trước; nạp JSONL bằng `readFileSync(...).trim().split('\n').map(JSON.parse)`. Ví dụ assertion thực tế:

```js
expect(cases.length).toBeGreaterThanOrEqual(60);
expect(new Set(cases.flatMap(c => c.expectedTargets.map(t => t.province))).size)
  .toBeGreaterThanOrEqual(6);
expect(cases.filter(c => c.split).length).toBeGreaterThanOrEqual(5);
for (const c of cases) {
  expect(c.expectedKeys.length).toBeGreaterThan(0);
  expect(c.sourceUrl).toMatch(/^https:\/\//);
  expect(c.sourceClause.trim().length).toBeGreaterThan(0);
  if (c.split) expect(c.expectedTargets.length).toBeGreaterThanOrEqual(2);
}
expect(addresses).toHaveLength(10);
```

- [x] **0.3** Chạy `pnpm exec vitest run scripts/admin-alias-fixtures.test.mjs`, xác nhận đỏ vì chưa có bằng chứng.
- [x] **0.4** Tải snapshot một lần bằng downloader HTTPS; đọc MD5 phía nguồn nếu có, tính lại MD5 và SHA-256 từ bytes thực, ghi manifest. Nếu nguồn không công bố MD5, ghi rõ checksum tự tính từ lần tải HTTPS, không gọi đó là checksum upstream. Không ghi checksum giả và không dùng `latest` thay snapshot. Lấy `osmTimestamp` từ `osmium fileinfo -e -j`; không coi ngày mtime 02/01 là ngày dữ liệu.
- [x] **0.5** Đọc điều/khoản nghị quyết gốc để biên soạn ≥60 ca ở HCM, Hà Nội, Đà Nẵng, Cần Thơ, ≥1 tỉnh miền núi và ≥1 tỉnh ĐBSCL khác Cần Thơ; ≥5 ca tách ghi **đầy đủ tập đích**. Dùng 10 địa chỉ công khai có vị trí kiểm chứng; kiểm địa chỉ mới có precision đủ tốt trước khi đưa vào acceptance. Không suy ground truth từ chính output overlay.
- [x] **0.6** Kiểm kê mẫu ranh giới/số lượng tháng 1, thay đổi đến 30/06 và coverage của current. Ghi discrepancy ledger vào manifest bằng `issues: [{region, reason, sourceUrl, resolution}]`; vấn đề chưa giải quyết dùng `resolution: null`. Thiếu nguồn là blocker dữ liệu cụ thể, không phải lý do bỏ test hoặc hạ tiêu chí.
- [x] **0.7** Chạy lại test fixture xanh; cập nhật DEVLOG, commit `test(data): chốt nguồn và fixture alias hành chính 2025`.

**Deliverable:** nguồn có checksum thật, ground truth độc lập và danh sách khoảng thiếu. Không yêu cầu download toàn quốc trong unit CI.

## Task 1: Migration 0008, quyền và xuất ODbL

**Files:** tạo hai migration và `db/admin-old.dbtest.mjs`; sửa `scripts/lib/db-permissions.mjs`, `.test.mjs`, `scripts/lib/odbl.mjs`, `.test.mjs`, `db/export-odbl.dbtest.mjs`.

**Interfaces:** schema theo spec 4.2; thêm CHECK `level IN (4,6,8)`, `share > 0 AND share <= 1`, unique `(snapshot, osm_relation_id)`, index `old_area_id`. Thêm GIN trgm `admin_area.name_norm` cho truy vấn vùng mới và B-tree `name_norm text_pattern_ops` trên current/old/alias cho prefix ngắn. Giữ mọi seed cũ.

- [x] **1.1** Viết DB tests: up giữ seed; một alias chèn được hai current IDs; cùng bộ ba bị unique violation; share=0/1.1 và dangling FK bị từ chối; role `api` SELECT được nhưng INSERT bị từ chối. Dùng `SET LOCAL ROLE api` trong transaction rollback.
- [x] **1.2** Xác nhận test đỏ trên schema 0007; dùng harness DB cô lập hiện có, không test schema trên production.
- [x] **1.3** Viết migration bằng schema spec và constraints trên. Phần thay PK:

```sql
ALTER TABLE admin_alias DROP CONSTRAINT admin_alias_pkey;
ALTER TABLE admin_alias
  ADD COLUMN share real NOT NULL DEFAULT 1 CHECK (share > 0 AND share <= 1),
  ADD COLUMN source text NOT NULL DEFAULT 'seed'
    CHECK (source IN ('overlay','seed','osm_tag')),
  ADD COLUMN old_area_id bigint REFERENCES admin_area_old(id) ON DELETE CASCADE,
  ADD PRIMARY KEY (alias_norm, level, admin_area_id);
CREATE INDEX admin_alias_old_area_idx ON admin_alias(old_area_id);
CREATE INDEX admin_alias_trgm_idx ON admin_alias USING gin(alias_norm gin_trgm_ops);
```

- [x] **1.4** Down migration **từ chối mất dữ liệu 1–n**: trước DDL, `IF EXISTS (SELECT 1 FROM admin_alias GROUP BY alias_norm, level HAVING count(*) > 1) THEN RAISE EXCEPTION ...`. Với dataset 1–1, drop FK/cột/index mới, phục hồi PK hai cột và drop old table. Test up→down→up trên dữ liệu 1–1; down trên 1–n phải rollback nguyên vẹn. Rollback release ưu tiên API cũ + giữ schema bổ sung, không tùy tiện xóa cạnh để chạy down.
- [x] **1.5** Bổ sung OWNER bảng/sequence `admin_area_old` cho pipeline, SELECT cho api trong migration và permissions restore. Export toàn bộ cột old (geometry WKT), `share/source/old_area_id` của alias; metadata export phải ghi cả release current và snapshot old.
- [x] **1.6** Chạy unit permissions/ODbL và DB tests; kiểm bản export import được với FK bằng ID đã xuất. Cập nhật DEVLOG, commit `feat(db): thêm schema hành chính cũ và alias một nhiều`.

## Task 2: Core giữ input gốc và sinh khóa chung

**Files:** tạo `packages/core/src/admin-alias.ts`, `packages/core/tests/admin-alias.test.ts`; sửa `address.ts`, `types.ts`, `index.ts`, `packages/core/tests/address.test.ts`.

**Interfaces:**

```ts
// Thêm tùy chọn vào ParsedAddress; các trường cũ và confidence giữ nguyên.
adminOriginal?: { ward?: string; district?: string; province?: string };

export interface AdminAliasKeyInput {
  ward?: string; district?: string; province?: string;
  adminOriginal?: { ward?: string; district?: string; province?: string };
}
export function adminAliasKeys(input: AdminAliasKeyInput): string[];
```

Hàm trả khóa từ cụ thể đến rộng, unique, đã normalize; không tự quyết định “duy nhất toàn quốc”. Pipeline chỉ phát hành khóa ngắn sau kiểm uniqueness; resolver kiểm ngữ cảnh. Input gốc chứa cả tiền tố đầy đủ; viết tắt parser nhận được sẽ canonicalize tiền tố khi tạo khóa.

- [x] **2.1** Viết test trước: P6/Q10, phường/xã/thị trấn, huyện/quận/thị xã/thành phố cấp huyện, tỉnh cũ, Unicode, thiếu tỉnh, số phường và dấu câu. Đọc `expectedKeys` từ fixture Task 0; khóa có tỉnh phải đứng trước khóa không tỉnh.

```ts
const parsed = parseAddress('88/9 Nguyễn Lâm, Phường 6, Quận 10, TP.HCM');
expect(parsed.adminOriginal?.ward).toBe('Phường 6');
expect(adminAliasKeys(parsed)).toContain('phuong 6 quan 10 ho chi minh');
expect(adminAliasKeys(parsed)).not.toContain('6');
const oldProvince = parseAddress('Tỉnh Bình Dương');
expect(oldProvince.province).toBe('Thành phố Hồ Chí Minh');
expect(adminAliasKeys(oldProvince)).toContain('binh duong');
```

- [x] **2.2** Chạy `pnpm exec vitest run packages/core/tests/admin-alias.test.ts packages/core/tests/address.test.ts`, xác nhận đỏ có nguyên nhân đúng.
- [x] **2.3** Ở mỗi nhánh parser nhận admin, lưu phần gốc **trước** strip/canonicalize; không thêm thuộc tính undefined vào kết quả cũ. Hàm chung dùng tiền tố nhận diện từ original, fallback các tổ hợp tiền tố hợp lệ khi caller cũ chỉ cung cấp tên trần; không thay tất cả district thành `quan`.
- [x] **2.4** Thêm `AutocompleteType` giá trị `area`, `AutocompleteItem.bbox?: [number,number,number,number]`, `GeocodePrecision` giá trị `district`, `GeocodeMatched.former?: {ward?:string; district?:string; province?:string}`. Export hàm/type từ core index. Chưa thêm API hạng mục 3.
- [x] **2.5** Chạy tests core và build core; rà các switch exhaustive với precision/type mới. Cập nhật DEVLOG, commit `feat(core): sinh khóa alias và giữ tên hành chính nguyên gốc`.

## Task 3: Import snapshot và fixture ranh giới cũ

**Files:** tạo `pipelines/poi/src/geocode/admin-old-source.mjs`, `pipelines/poi/tests/admin-old-source.test.mjs`; sửa `pipelines/poi/src/lib/env.mjs`, `pipelines/poi/scripts/make-fixture.mjs`; tạo `pipelines/poi/fixtures/admin-old-q1.osm.pbf`.

**Interfaces:** `loadOldAdminRaw(sql, {pbfPath, snapshot}): Promise<{counts: Record<string,number>}>`, bảng staging `osm_admin_old_raw_new` có relation ID, level, name, norm, tags, geom; chỉ công bố raw sau COPY/validate thành công. `--fixture` chỉ đọc file repo. `--snapshot 250101` trong make-fixture chỉ tạo old PBF, không bắt có Overture/FSQ credentials.

- [x] **3.1** Viết test downloader dùng file tạm/mocked fetch: cache đúng hash không tải lại, sai checksum xóa file `.part` và lỗi, lỗi download không ghi đè file tốt; unit không có network.
- [x] **3.2** Chạy `pnpm exec vitest run pipelines/poi/tests/admin-old-source.test.mjs`, xác nhận đỏ.
- [x] **3.3** Import tái dùng `readJsonl`/`copyInto`, không gọi `replaceRawTables()` theo cách xóa raw current. Lọc relation và export polygon theo pattern đang dùng ở `osm-roads.mjs`; đọc `name:vi` trước `name`, chỉ L4/6/8, sửa geometry bằng `ST_Multi(ST_CollectionExtract(ST_MakeValid(geom),3))`; loại geometry rỗng/diện tích 0 vào report, không lặng lẽ bỏ.
- [x] **3.4** Tạo fixture bằng `osmium extract -s smart -S types=any` với Q1_BBOX hiện có và snapshot đã pin. Giữ geometry relation nguyên vẹn; sau extract phải kèm L4/L6 cha cần thiết theo relation IDs từ snapshot. Không lấy diện tích polygon bị cắt bbox làm mẫu share. Ghi manifest fixture với checksum nguồn, bbox và lệnh tạo.
- [x] **3.5** Test fixture có đủ cha L4/L6, relation không trùng, hình học hợp lệ. Với fixture không bao hết quốc gia, uniqueness phải lấy từ inventory toàn quốc đã pin hoặc chỉ sinh khóa đầy đủ; không kết luận tên duy nhất toàn quốc từ Q1.
- [x] **3.6** Chạy unit xanh; chạy import fixture trong pipeline container trên DB cô lập; cập nhật DEVLOG, commit `feat(pipeline): nạp snapshot hành chính cũ có kiểm checksum`.

## Task 4: Overlay, seed và publication nguyên tử

**Files:** tạo `admin-overlay.mjs`, `admin-old.mjs`, `pipelines/poi/tests/admin-overlay.test.mjs`, `pipelines/poi/tests/admin-old.dbtest.mjs`; sửa `admin.mjs`, `osm-roads.mjs`, `raw-tables.mjs`, `scripts/data-update.mjs`, `pipelines/poi/tests/geocode.dbtest.mjs`, `db/seed/admin_alias_2025.csv` khi có sửa được chứng minh.

**Interfaces:** `buildCurrentAdmin(sql): Promise<void>` dựng `admin_area_new`; `buildOldAdmin(sql, {currentTable, fixture}): Promise<AdminAliasReport>` dựng old+alias staging, currentTable chỉ nhận allowlist `admin_area|admin_area_new`. `AdminAliasReport` gồm counts theo cấp/source, unmatched relation IDs, raw coverage, discarded share, split cases, seed misses, ambiguous keys và invalid geometries. Ghi JSON vào `out/admin-alias/report.json` trước publish.

- [x] **4.1** Viết DB tests với polygon tổng hợp: 100%→một đích; 60/40→hai đích; 96/4→bỏ mảnh 4% nhưng report giữ discarded=0.04; thiếu 40% không được biến thành coverage=1; overlap gấp đôi bị report; duplicate tên khác tỉnh không sinh khóa chung. Thêm ca huyện có >20 phường mới, mỗi phường <5% diện tích huyện vẫn phải giữ.
- [x] **4.2** Chạy đỏ trên DB cô lập. Dùng assertions số thực: tổng share chuẩn hóa gần 1 với epsilon `1e-5`; raw coverage kiểm riêng, không dùng lại share chuẩn hóa.
- [x] **4.3** Gán cha bằng geometry, ưu tiên cấp gần nhất, kiểm cả tỉnh khi nhiều cha cùng tên. ID old dùng relation ID làm giá trị ổn định cho snapshot OSM; không tái dùng `row_number` làm identity bền vững. Xây overlay với chỉ số GiST staging và `ANALYZE` trước join:

```sql
SELECT o.id AS old_area_id, n.id AS admin_area_id,
       ST_Area(ST_Intersection(o.geom,n.geom)::geography)
         / NULLIF(ST_Area(o.geom::geography),0) AS raw_share
FROM admin_area_old_new o
JOIN admin_area_new n ON n.level=8 AND o.geom && n.geom
  AND ST_Intersects(o.geom,n.geom)
WHERE o.level=8;
```

L8 giữ raw_share≥0.05 rồi chuẩn hóa; split dùng raw max. L6 cộng diện tích giao của các **con thuộc đúng huyện** rồi chia diện tích huyện; không áp ngưỡng 5% của L8 cho từng phường của huyện. L4 đối chiếu `provinces.json`/seed với current L4; thiếu đích ghi seed misses, không tạo ID giả.
- [x] **4.4** Pipeline gọi `adminAliasKeys()` cho từng old area và giữ thứ tự danh sách; bảng staging đếm distinct old IDs theo khóa/cấp để chặn khóa mơ hồ không tỉnh. Province dùng dạng core thống nhất, phân biệt old/current trong provenance. Nạp old_name/alt_name/official_name từ raw current vào alias `source=osm_tag`; giữ tag trong `osm_admin_raw` bằng thay đổi schema raw và rows/COPY cùng commit.
- [x] **4.5** Nạp seed sau overlay/tag; nhóm theo khóa+cấp, tìm đích đúng tỉnh, thay **tập cạnh** của nhóm seed, giữ old_area_id khi xác định được. Mở rộng CSV có cột tùy chọn `share,source_url,source_clause` và parser tương thích bốn cột cũ; phần thiếu đích không xóa nhóm đang đúng. Ghi lỗi/độ phủ vào report, không publish full release khi cổng QA đỏ.
- [x] **4.6** Refactor `admin.mjs` thành coordinator không side effect khi import, dựng ba staging rồi publish một transaction. Entry `admin-old.mjs` dùng current đã published và publish old+alias cùng nhau. `data-update.mjs` gọi coordinator đúng một lần; không gọi admin-old lần hai. Khóa pipeline dùng advisory lock ở cùng connection/transaction hoặc cơ chế lock hiện hành suốt dựng→publish, để standalone và scheduled run không giẫm `_new` của nhau.
- [x] **4.7** Failure injection: lỗi overlay, lỗi seed hoặc lỗi INSERT lúc publish phải để cả ba bảng cũ nguyên vẹn và dọn staging. Chạy update hai lần (có thêm current relation làm đổi current IDs) kiểm alias vẫn trỏ đúng tên/vùng, FK còn, api vẫn SELECT được. Update thường không được quay về chỉ 33 seed. Kiểm concurrent reader: transaction có thể chặn ngắn ở TRUNCATE; đo lock time, không hứa zero downtime.
- [x] **4.8** Chạy unit + DB suite trong container; cập nhật DEVLOG, commit `feat(pipeline): overlay alias và phát hành hành chính nguyên tử`.

## Task 5: Bước 0 geocode và scope xuyên suốt thang tìm kiếm

**Files:** tạo `apps/api/src/admin-scope.ts`, `apps/api/test/admin-scope.test.ts`; sửa `apps/api/src/geocode.ts`, `apps/api/test/geocode.test.ts`, `apps/api/test/geocode-routes.test.ts`, `apps/api/test/helpers/fake-sql.ts`; thêm kiểm DB thật trong `pipelines/poi/tests/admin-old.dbtest.mjs`, `apps/api/test-db/places.itest.mjs`, `apps/api/test-db/setup.sql`.

**Interfaces:**

```ts
export interface AdminScope {
  wardNorms: string[];
  provinceNorm: string | null;
  former?: {ward?: string; district?: string; province?: string};
  oldArea?: {id: string; name: string; level: number;
    bbox: [number,number,number,number]; lat: number; lng: number};
}
// Sql = ReturnType<typeof getSql>, ParsedAddress từ core
export function resolveAdminScope(sql: Sql, parsed: ParsedAddress): Promise<AdminScope>;
```

- [x] **5.1** Thêm test resolver trước: không admin→không query; không alias→scope cũ; phường tách→hai wardNorms; phường trùng khác tỉnh→không trộn; tên tỉnh cũ còn former; seed thiếu old_area_id vẫn phân giải current; tỉnh hiện hành không bị gắn former giả. Nâng fakeSql bằng tùy chọn callback rows theo text, mặc định giữ tương thích `fakeSql(rows, calls)`; không dùng một mảng alias cho mọi SELECT.
- [x] **5.2** Chạy `pnpm --filter @mapslibvn/api test`, xác nhận đỏ có chọn lọc.
- [x] **5.3** Resolver tra `alias_norm = ANY(keys::text[])`, join current/old; xếp theo vị trí khóa `array_position`, cấp cụ thể, nguồn seed trước; lấy **toàn bộ cạnh của nhóm thắng**, không LIMIT trước khi gom. Có tỉnh/huyện phải xác minh old ancestry/canonical province; `near` chỉ xếp hạng các đích hợp lệ, không thay thế điều kiện địa phương. Không match được khóa phường cụ thể thì không coi khóa tỉnh fallback là bằng chứng đã đổi đúng phường.
- [x] **5.4** Truyền scope vào context, chuyển điều kiện ward ở anchors/interpolate sang `= ANY(...::text[])`, street sang `&& ...::text[]`. Giữ OR ward IS NULL ở 1/3 nhưng nếu đã có old area phải kiểm geometry và tỉnh; không cho NULL trở thành đường thoát sang tỉnh khác. Áp scope cho alley qua street cha và kiểm point kết quả; interpolation chỉ ghép hai mốc cùng vùng hợp lệ, query projection street cũng mang scope.

```ts
// Fragment dùng trong truy vấn anchor; oldArea.id là tham số, không nối chuỗi SQL.
sql`AND (ward_norm = ANY(${scope.wardNorms}::text[]) OR ward_norm IS NULL)`;
sql`AND EXISTS (SELECT 1 FROM admin_area_old old
  WHERE old.id = ${scope.oldArea.id} AND old.geom && address_anchor.geom
    AND ST_Covers(old.geom, address_anchor.geom))`;
```

- [x] **5.5** Kết quả đường/địa chỉ ghi matched/former theo alias thực dùng; display dùng tên mới đọc từ vùng đích, không lặp parsed.ward cũ. Với street xuyên nhiều vùng, chọn điểm/đoạn trong scope; không dùng midpoint ngoài vùng rồi báo khớp. `former` không đổi source precision/confidence.
- [x] **5.6** Bước admin tách current exact khỏi historical: current ward exact có ngữ cảnh được ưu tiên; quận cũ đã nhận diện trả một old bbox `district`, confidence 0.2, nhãn `(trước 07/2025)`. Legacy `admin_area.level=6` chưa được chứng minh historical vẫn giữ hành vi hiện tại của test. Phường cũ 1–n không có địa chỉ cụ thể trả vùng cũ `ward`, tránh tùy tiện chọn phường mới lớn nhất. “Thủ Dầu Một” hiện nằm trong alias tỉnh của `provinces.json`, nên resolver phải thử `adminOriginal` với old L6 trước khi chấp nhận tỉnh đã canonicalize; thêm test “Thành phố Thủ Dầu Một” và tên trần. Tên vùng chưa được parser nhận diện cần thử khóa raw query ở fallback admin.
- [x] **5.7** DB acceptance nhỏ: hai anchors cùng số/đường ở hai tỉnh, có anchor ward NULL ngoài old polygon; phải chọn đúng. Test cả rooftop, alley, interpolated, street, district fallback; input mới không alias giữ hành vi. Chạy API unit + API DB; cập nhật DEVLOG, commit `feat(api): phân giải alias hành chính trước geocode`.

## Task 6: Autocomplete area, nhóm quận cũ và bbox

**Files:** tạo `apps/api/src/area-candidates.ts`, `apps/api/test/area-candidates.test.ts`; sửa `autocomplete-sql.ts`, `routes/autocomplete.ts`, `params.ts`, `ranking.ts`, các test tương ứng trong `apps/api/test/`.

**Interfaces:** `areaCandidates(sql, input: CandidateQueryInput): Promise<CandidateRow[]>`; `CandidateRow.bbox?` cùng tuple core. ID area không giả thành POI ULID: giữ `id=null` cho public candidate; nội bộ dedup theo current ID hoặc old_area_id trước map response.

- [x] **6.1** Test đỏ cho `parseTypes('area')`, default gồm area, explicit `poi,street` không query area, prior area=0.6 cả query có/không số; quận có 12 phường mới chỉ một candidate và tối đa 3 tên + “…”; bbox còn sau route mapping/cache.

```ts
expect(parseTypes()).toEqual(new Set(['poi','street','address','area']));
expect(priorFor('area', false)).toBe(0.6);
expect(priorFor('area', true)).toBe(0.6);
```

- [x] **6.2** Candidate current và alias dùng hai SELECT indexed rồi UNION ALL; không dùng OR qua LEFT JOIN làm quét cả bảng. `name_norm` current là tên bỏ cấp: dùng khóa đã bỏ cấp từ parser cho “Phường Diên Hồng”; giữ khóa nguyên có cấp cho alias “Quận 10”. Full typed prefix phải tìm được khi đang gõ dở. Alias source overlay/seed theo spec; ingest osm_tag ở Task 4 nhưng mở rộng match tên thay thế ngoài phạm vi để hạng mục 3.
- [x] **6.3** Dùng LIKE prefix escape và `<%`; limit 20 **sau grouping/dedup**, thứ tự hòa deterministic. Một L6 old là một item tên/bbox old; L8 đổi nguyên→item current với secondary tên cũ; L8 split→một item old với danh sách đích, tránh phóng vào đích ngẫu nhiên. L4 seed→current province; secondary giữ tên cũ. Match qua nhiều khóa của cùng current area không lặp candidate.
- [x] **6.4** Thêm truy vấn area vào `collectCandidates` cùng Promise.all; route truyền bbox. Không gọi `/places/:id` cho area. Cache giữ TTL 600/stale 3600; thêm version khóa `v=admin1` cho shape mới, để rollback không dùng lẫn cached payload. Test cache hit, lỗi upstream và types filter.
- [x] **6.5** EXPLAIN ANALYZE BUFFERS cho query có cấp, prefix 2 ký tự, query alias dài và query trùng tên trên staging toàn quốc; ghi index/row count/time. Kiểm nhánh current, alias, grouping riêng; không dùng SET enable_seqscan=off làm bằng chứng performance. — Đo 06/09/2026 trên DB dùng-một-lần cùng instance máy chủ (3.288 current, 4.900 old, 36.456 alias): [hồ sơ bằng chứng](../../evidence/admin-alias/6-5-explain-autocomplete-area.md). Index đúng như thiết kế (`admin_alias_trgm_idx` + `admin_alias_prefix_idx` qua BitmapOr, không seq scan trên `admin_alias`), nhưng **query ngắn kém chọn lọc**: `qu` khớp 11.664/36.456 dòng → full 116,9 ms; `Quận 10` 81,9 ms; `Tân Thành` 100,9 ms; alias dài 13,8 ms. **Đây là cận dưới** — bộ đo mới có 4.152 L8 cũ (spec kỳ vọng 10.000–10.700) và cổng QA đỏ vì current thiếu Khánh Hòa. Task 8.5/8.6 vẫn phải đo lại trên bộ đã qua cổng độ phủ; xem rủi ro selectivity ở mục 5 hồ sơ trước khi chốt gate 8.6.
- [x] **6.6** API tests xanh; cập nhật DEVLOG, commit `feat(api): gợi ý vùng hành chính cũ mới trong autocomplete`.

## Task 7: SDK, playground và tài liệu

**Files:** sửa `packages/web/src/autocomplete-element.ts`, tạo `packages/web/src/autocomplete-element.test.ts`; sửa `packages/core/src/client.places.test.ts`, `packages/react/src/use-places.test.ts`, `packages/react-native/src/use-places.test.ts`, `apps/docs/public/playground.js`, `apps/docs/e2e/playground.spec.ts`, `apps/docs/e2e/docs.spec.ts`, `scripts/db-fixture.mjs`, `apps/api/test-db/setup.sql`, `pipelines/poi/README.md`; sửa docs `apps/docs/src/content/docs/{tim-kiem,do-chinh-xac,api,sdk}.md`; bốn package.json core/web/react/react-native và lockfile nếu cần đồng bộ version.

- [x] **7.1** Viết test sự kiện `select` giữ nguyên object area+bbox; bàn phím Enter/click đều hoạt động, icon area khác POI, `secondary` render bằng textContent. React/RN hiện là hook, không dựng component gợi ý mới: test hook trả nguyên item area và không mất bbox/former. — `select` vốn đã phát nguyên item và `secondary` vốn dùng `textContent`; phần RED thật là icon phân biệt loại (`TYPE_ICON` + `data-type` trên mỗi option). Test hook React/RN và core client là chốt hồi quy, xanh ngay vì cả ba tầng truyền nguyên item.
- [x] **7.2** `scripts/db-fixture.mjs` truyền `--fixture` vào coordinator admin để nạp old PBF đã commit. API DB `setup.sql` thêm synthetic old district + current wards + alias cho itest. E2E docs chạy trên DB dev đã nạp qua `pnpm db:fixture`, xác minh có alias Quận 10; nếu Q1 extract không có quận này, bổ sung relation Quận 10 và các đích liên quan vào fixture đã pin ở Task 3. Không nhét SQL vào `apps/api/scripts/seed-local.mjs`: script đó chỉ seed R2/KV. Chạy test đỏ trước khi sửa rendering/fixture. — `db-fixture.mjs` và coordinator đã truyền `--fixture` từ Task 4.6, `setup.sql` đã có old district + alias từ Task 5.7, nên không phải sửa. Fixture Q1 đã pin **có sẵn Quận 10** (alias `quan 10`, 4 đích) nên không cần mở rộng fixture. Dev DB nạp bằng `db-migrate` + `osm-roads.mjs --fixture` + `admin.mjs --fixture` (nhanh hơn cả `pnpm db:fixture`, cùng kết quả cho dữ liệu hành chính): 54 vùng cũ, 297 alias.
- [x] **7.3** Khi select area có bbox dùng `map.fitBounds(item.bbox)` qua API wrapper hiện có; item khác giữ luồng chọn hiện tại. Kiểm thứ tự bbox `[minLng,minLat,maxLng,maxLat]`; marker chỉ là tâm phụ, không dùng POI detail request cho area. — `goToArea()` trong playground gọi `map.fitBounds(item.bbox)`; `MapsLibVNMap.fitBounds` đã nhận đúng `[minLng,minLat,maxLng,maxLat]` nên không phải sửa wrapper. Item khác giữ nguyên `goTo()` + `flyTo`.
- [x] **7.4** Docs giải thích types default mới, `former`, `district`, alias split và example fitBounds. Chỉ bỏ câu “bảng chưa đầy đủ” sau Task 9 đạt coverage; trong giai đoạn trước ghi feature và phạm vi đã kiểm chứng. Update pipeline README lệnh chạy lẻ, source manifest, report, seed override và lỗi coverage. — `tim-kiem.md` (bảng trường + mục "Chọn một vùng hành chính" có ví dụ fitBounds), `api.md` (ví dụ JSON area, types mặc định, `former`, `district`, ghi chú migration), `do-chinh-xac.md` (hàng `district` + mục địa chỉ theo đơn vị cũ), `sdk.md` (mục "Nâng từ 0.1.x lên 0.2.0"), `pipelines/poi/README.md` (manifest nguồn, seed override, trường report, thiếu bảng raw, lỗi coverage). **Giữ** câu "bảng chưa đầy đủ" và ghi rõ phạm vi đã kiểm chứng.
- [x] **7.5** Bump minor từ version đang có của 4 SDK, đồng bộ dependency/ràng buộc tarball đang dùng; build gói và kiểm type mới được export. Thêm migration note: consumer exhaustive switch cần nhận area/district dù không có trường bị xóa; consumer muốn bộ loại cũ đặt `types=poi,street,address`. — bốn gói core/web/react/react-native lên **0.2.0**; deps nội bộ dùng `workspace:*` nên không có ràng buộc version phải đồng bộ, `packedTarballName` lấy version từ package.json. Đã kiểm `dist/index.d.ts`: `AutocompleteType` có `area`, `GeocodePrecision` có `district`, `bbox?`, `former?`.
- [x] **7.6** Chạy unit SDK, `pnpm build`, `pnpm --filter @mapslibvn/docs e2e`; E2E gõ Quận 10 chọn được area, fitBounds và không có lỗi JS; test cũ POI/đường còn xanh. Cập nhật DEVLOG, commit `feat(sdk): hỗ trợ chọn vùng hành chính và tài liệu alias`. — unit 67 file/648 test, API 23 file/119 test, `pnpm build` 8/8, **E2E docs 27/27** gồm test chọn vùng mới. Test E2E dùng `Phường An Lợi Đông` thay `Quận 10` như plan viết, vì area không lọt top 10 với types mặc định (xem việc 4 dưới đây).

## Task 8: Bộ kiểm chứng toàn quốc và benchmark so sánh

**Files:** tạo `scripts/verify-admin-alias.mjs`, `scripts/verify-admin-alias.test.mjs`; dùng fixtures Task 0, sửa `scripts/perf-autocomplete.mjs`/test chỉ khi thiếu khả năng chọn types/đọc bộ query; ghi artifacts dưới `out/admin-alias/` (không commit raw data/credential).

**Interfaces:** CLI `node scripts/verify-admin-alias.mjs --mode coverage|geocode --out out/admin-alias`; coverage đọc DATABASE_URL theo helper repo; geocode đọc `MAPSLIBVN_API_BASE`/`MAPSLIBVN_API_KEY` từ `.env`, không log key. Output JSON chứa source hashes, release, commit, counts, cases, failures, timings; exit 1 khi bất kỳ acceptance bắt buộc đỏ.

- [x] **8.1** Viết test thuần cho report evaluator: thiếu 1 L8 đất liền phải fail; normalized share=1 nhưng raw coverage=0.6 phải fail; thiếu một đích split phải fail; 7/10 precision cao phải fail; 8/10 nhưng tệ hơn cặp mới phải fail; API HTTP error không được bỏ khỏi mẫu. — `scripts/verify-admin-alias.test.mjs`, 17 test thuần. Ngoài sáu ca plan yêu cầu còn thêm ba ca cho guard lệch generation (mục 8.2).
- [x] **8.2** Chạy `pnpm exec vitest run scripts/verify-admin-alias.test.mjs`, xác nhận đỏ; triển khai evaluator và CLI với timeout/retry hữu hạn, lưu mọi response lỗi đã loại credential. Không retry đến khi đạt rồi bỏ lần thất bại. — `scripts/verify-admin-alias.mjs`: hai hàm thuần `evaluateCoverage`/`evaluateGeocode` + CLI hai mode, timeout 10 s và **3 lần thử hữu hạn**, lần cuối thất bại giữ nguyên trong kết quả. Smoke-test thật cả hai mode: coverage trên dev DB → exit 1 với 65 failure; geocode qua API local → exit 1, 6/10 chính xác cao. Artifact có commit, checksum nguồn, timings, cases và **0 lần xuất hiện khoá API** (`stripCredentials` chạy trên toàn payload). Smoke test lộ một lỗi thật đã sửa: coverage đọc `out/admin-alias/report.json` có thể **lệch generation** với DB, nên thêm failure `report_generation_mismatch`/`report_missing` — bắt đúng trường hợp report 10 vùng cũ so với DB 54 vùng.
- [~] **8.3** ĐÃ CHẠY, KHÔNG ĐẠT — [tóm tắt](../../evidence/admin-alias/8-3-8-4-coverage-summary.json), phân tích ở mục 8 hồ sơ 6.5. L4 62/63, L6 686 (spec 690–710), L8 **4.152** (spec 10.000–10.700); 72 vùng cũ không có alias (62 là Ninh Thuận, 10 rải rác gồm ca đảo Thanh Lân/Cô Tô — **không** tự xếp là ngoài đất liền vì chưa có bằng chứng nguồn); 122 vùng `rawCoverage < 0,95`. Report coverage: spec L4=63, L6 690–710, L8 10.000–10.700 là cổng so sánh ban đầu; số relation không tương đương số đơn vị pháp lý. Kiểm distinct đơn vị, missing inventory và thay đổi Jan→Jun; lệch khoảng thì điều tra/ghi nguồn và sửa spec có lý do, không padding bằng duplicate relation. Missing L8 đất liền=0; ca đảo/biển tách danh sách có bằng chứng, không suy “ngoài đất liền” chỉ vì không match. — **CHẶN**: cần bộ dữ liệu toàn quốc qua cổng QA, mà cổng đang đỏ vì thiếu Khánh Hòa (việc 3). Evaluator đã sẵn sàng, chạy được ngay khi có dữ liệu.
- [~] **8.4** ĐÃ CHẠY, KHÔNG ĐẠT — **47/60 ca đạt, ca tách 4/6**. Lần chạy này phát hiện **ground truth trong fixture Task 0 sai ở 11 ca** (mọi ca Đà Nẵng ghi "Quận Hải Châu", mọi ca Cần Thơ ghi "Ninh Kiều"; snapshot ODbL nói Hòa Liên thuộc Hòa Vang, Xuân Hà thuộc Thanh Khê, Quán Thánh thuộc Ba Đình). Đã thêm failure `fixture_district_mismatch` để lớp lỗi này không lọt nữa. Phải biên soạn lại fixture từ nghị quyết gốc mới đo lại được. Chạy ≥60 ca với **tập đích chính xác**, lọc đúng tỉnh; >=5 ca tách đúng toàn bộ nhánh. Cảnh báo raw coverage ngoài [0.95,1.05] và mọi sliver bị bỏ; mọi cảnh báo có quyết định QA có nguồn trước release. Tỷ lệ đã chuẩn hóa không thay thế kiểm geometry/raw coverage. — **CHẶN**: cùng lý do 8.3. 60 ca fixture và 10 cặp địa chỉ đã có từ Task 0; CLI đã đọc được cả hai.
- [ ] **8.5** Trước triển khai API mới, lưu baseline 40 fuzzy queries hiện có và thêm queries area/10 cặp địa chỉ. Sau thay đổi đo cùng DB snapshot, location, concurrency, limit, types, số lượt; mỗi cohort ≥100 request, phân biệt cold cache, warm cache, HTTP/DB time. So default mới với default cũ để thấy chi phí area; so explicit types cũ để bắt regression không liên quan. Đừng gắn mục tiêu 600ms của 3-stage chưa triển khai cho task này. — **CHẶN phần đo**; phần công cụ đã làm: `perf-autocomplete.mjs` thêm `--types` (trước chỉ có `--queries`) để so default mới với bộ loại cũ `poi,street,address`, kèm test. Lưu ý: **mốc baseline "trước khi deploy API mới" đã trôi** — API Task 5/6 deploy từ 06/09, nên chỉ còn so được explicit types trên cùng một bản deploy.
- [ ] **8.6** Gate p95 autocomplete nhánh có đủ kết quả sớm ≤baseline+50ms theo spec; hit@3 fuzzy không thấp hơn baseline đo cùng bộ (trạng thái gần nhất DEVLOG là 37/40, phải đo lại). Geocode ≥8/10 `rooftop|alley|interpolated`, mọi cặp không kém precision mới và nằm trong expectedBbox. Nếu trượt, giữ task mở với case cụ thể; không tự chọn lại bộ mẫu. — **CHẶN**: cần 8.5. Cảnh báo sớm từ cổng 6.5: nhánh area sau khi bậc hoá còn 41,9 ms ở query 2 ký tự và sẽ tăng khi độ phủ L8 đủ.
- [ ] **8.7** Unit evaluator xanh; chạy coverage trên staging đầy đủ và lưu kết quả, sửa lỗi dữ liệu/SQL được xác định trước khi qua gate. Cập nhật DEVLOG, commit `test(alias): thêm cổng độ phủ và nghiệm thu địa chỉ cũ`. — **CHẶN**: unit evaluator đã xanh 17/17, nhưng chạy coverage trên staging đầy đủ thì cần dữ liệu của việc 3.

## Task 9: Full gate, triển khai và điểm tiếp tục

**Files:** cập nhật plan này, spec trạng thái hạng mục 1 và `docs/DEVLOG.md`; `.github/workflows/dbtest.yml`, `apitest.yml`, `ci.yml` chỉ sửa nếu fixture/build mới thực sự cần.

- [x] **9.1** Review diff theo spec 4.1–4.7/7–11; chạy đầy đủ một lần sau thay đổi cuối: — chạy đủ danh sách: core+style build, lint, typecheck, unit 68 file/666 test, API unit 23 file/119 test, `pnpm build` 8/8, `test:db` trong container, `test:api-db` 3 file/31 test, `db:fixture` (đã nạp dev DB bằng các bước tương đương), E2E docs 27/27, `git diff --check` sạch.

```bash
pnpm --filter @mapslibvn/core build
pnpm --filter @mapslibvn/style build
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline pnpm test:db
pnpm test:api-db
pnpm db:fixture
pnpm --filter @mapslibvn/docs e2e
git diff --check
```

Container dùng source/fixtures mới; nếu sửa file root không bind mount hoặc dependency/config image thay đổi, rebuild bằng `pnpm image:build` trước khi test. Không nhận kết quả test từ image cũ. Hai DB runner chạy tuần tự; xem số tests thật, không coi `--passWithNoTests` là evidence.
- [~] **9.2** Chụp backup DB và versions API/SDK hiện hành, test restore quyền với old table trên DB cô lập. Thực hiện release khi được yêu cầu triển khai: migration 0008 → dựng staging full/QA → publish data → API → SDK/docs. Nếu deploy API trước data, bảng old rỗng phải fallback đúng như Task 5; kiểm điều đó bằng test. — **LÀM MỘT PHẦN, vì phải xử lý sự cố production.** Đã xong: backup `mapslibvn-20260907-0518.dump.zst` lên R2; test restore + quyền `api` với old table trên `mapslibvn_restore_test` dựng từ schema/dữ liệu production thật; **áp migration 0008 lên production** trong một transaction; kiểm hậu deploy sáu endpoint. Đã thêm chốt: `/healthz/db` công bố `schema_migration` + hai itest (healthz có trường đó, autocomplete mặc định không 5xx khi bảng old rỗng). **Còn lại**: publish data → chặn bởi việc 3; SDK/docs chưa phát hành npm (giai đoạn nội bộ).
- [ ] **9.3** Khi commit/push được yêu cầu, dùng đúng remote repo; chờ các workflow thực tế CI, Deploy API, Deploy Docs, DB tests, API DB tests theo SHA. Ghi run URL + conclusion thật, không suy deploy thành công từ local build.
- [ ] **9.4** Production chạy lại coverage, ≥60 ca, 10 cặp geocode và benchmark cùng cách đo; smoke area “Quận 10”, “Bình Dương”, “Thủ Dầu Một”, tên hiện hành, types loại trừ area. Kiểm API role đọc old table, export ODbL có old+alias mới, playground tải SDK mới. — **CHẶN**: cần dữ liệu alias toàn quốc. Smoke đã chạy được phần không cần dữ liệu: autocomplete mặc định, `types=area`, `types=poi`, geocode có/không đơn vị hành chính, `/healthz/db` — tất cả 200 sau khi áp 0008.
- [ ] **9.5** Thử một lần cập nhật dữ liệu thường trên staging sau phát hành: full alias không bị mất; standalone admin-old idempotent. Lưu report update lần hai và checksum mapping theo relation ID/tên đích, không so raw current IDs. — **CHẶN**: cần một lần publish dữ liệu thật mới thử được update lần hai.
- [ ] **9.6** Rollback khi có regression: trả API/SDK/docs về artifact trước, giữ migration bổ sung. Với data sai, khôi phục **cùng một generation** current+old+alias từ backup đã kiểm chứng bằng workflow restore repo; không chạy riêng admin.mjs cũ để xóa alias hay trộn IDs. Không hạ schema 0008 khi còn 1–n; down chỉ sau quy trình restore dữ liệu tương thích có chủ đích. — artifact rollback đã sẵn: backup R2 `mapslibvn-20260907-0518.dump.zst` và Worker trước đó. Chưa cần dùng.
- [ ] **9.7** Chỉ tick hoàn tất khi toàn bộ gate xanh. DEVLOG ghi counts thực, coverage exceptions (phải giải quyết để gọi đầy đủ), checksum nguồn, fixture pass, precision, p50/p95/p99, commit, deploy/workflow URLs, rollback artifact. Điểm tiếp theo sau hạng mục 1 là **viết plan hạng mục 3**, không tự implement phonetic. — **KHÔNG tick**: còn 8.3–8.7, 9.4, 9.5 mở. Không tuyên bố đầy đủ khi ledger nguồn còn Khánh Hòa.

## Ma trận nghiệm thu và resume

| Yêu cầu | Task | Bằng chứng bắt buộc |
|---|---|---|
| Nguồn ODbL, snapshot pinned, nghị quyết độc lập | 0, 3 | Manifest checksum + nguồn điều/khoản |
| Quan hệ 1–n, FK/quyền, down an toàn, export | 1 | DB/restore/export tests |
| Khóa cùng hàm, prefix chính xác, tỉnh cũ không mất | 2, 5 | Core fixture + resolver tests |
| L4/L6/L8 đủ, zero unmatched đất liền, splits | 4, 8, 9 | National report + inventory discrepancies đã giải quyết |
| Pipeline lần hai không xóa alias; lỗi không mất dữ liệu | 4, 9 | Failure injection + rerun evidence |
| Địa chỉ cũ không kém mới, district/former | 5, 8, 9 | Unit/DB + 10 cặp thật ≥8 precision cao |
| Area default, bbox, một item/quận, select | 6, 7, 9 | API/SDK tests + browser E2E |
| Không regression fuzzy/p95 | 8, 9 | Baseline và after cùng điều kiện |
| CI/production/docs/export hoàn tất | 9 | Test output + run URLs + production report |

**Bước bắt đầu phiên triển khai:** Task 0.1, sau đó Task 0.2–0.6 để có nguồn và fixture thật; không bắt đầu bằng migration trên production. Nếu bị thiếu nguồn, tiếp tục các phần unit/schema độc lập, ghi rõ task dữ liệu đang mở; không tuyên bố “đầy đủ” để đóng plan.

## Nguồn đã kiểm tra khi viết plan

- [Geofabrik Vietnam](https://download.geofabrik.de/asia/vietnam.html): có `vietnam-250101.osm.pbf`, 306.547.939 bytes, mtime 02/01/2025. Chưa tải/xác minh checksum trong phiên viết plan.
- [Toàn văn 34 nghị quyết trên Cổng Chính phủ](https://xaydungchinhsach.chinhphu.vn/toan-van-34-nghi-quyet-cua-ubtvqh-ve-sap-xep-cac-don-vi-hanh-chinh-cap-xa-119250616215143373.htm): điểm vào nguồn để biên soạn fixture; phiên lập plan chưa đối chiếu đủ 60 ca.
- [PostgreSQL 16 CREATE TABLE](https://www.postgresql.org/docs/16/sql-createtable.html): đối chiếu `LIKE` khi đọc helper staging. Source `pg.mjs` hiện giữ identity bảng thật bằng transaction TRUNCATE+INSERT; test publication phải kiểm FK/grant/locking thực tế.
