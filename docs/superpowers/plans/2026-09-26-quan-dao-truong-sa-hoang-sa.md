# Trường Sa / Hoàng Sa vào kho POI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. PHONG chốt 25/09: làm thẳng trên
> `main`, từng task inline, TDD; chỉ push khi đủ cổng kiểm (push = deploy). Steps dùng checkbox (`- [ ]`).

**Goal:** POI trên hai quần đảo tìm được và hiện trên bản đồ, đúng chính sách chủ quyền PHONG chốt 26/09/2026,
sống qua `data:update` và dựng lại y hệt trên máy chủ Windows.

**Quyết định của PHONG (26/09/2026, trả lời 2 lượt hỏi):**
1. Làm ngay. Vùng hai quần đảo miễn luật ranh giới Natural Earth và luật "trong xã/phường"; gán Khánh Hòa
   (Đặc khu Trường Sa) và Đà Nẵng (Đặc khu Hoàng Sa).
2. Hoàng Sa: CHỈ tên đảo/bãi/rạn theo danh sách tuyển có duyệt, tên Việt truyền thống; không cơ sở/công trình.
3. Trường Sa ta giữ: MỌI đảo (cả Trường Sa Lớn, Sinh Tồn, Nam Yết, Sơn Ca mà extract Geofabrik VN không có).
4. Đảo/bãi nước khác chiếm giữ: chỉ tên đảo tiếng Việt, không cơ sở ("Parola Island" → "Đảo Song Tử Đông").
5. Luật patch chủ quyền (bản đồ nền + POI): giữ tên tiếng Việt, bỏ chữ Hán và tên Latin nước ngoài.
FSQ vẫn loại khỏi hai quần đảo (`vn-bbox.mjs`, spec 4.3): FSQ ở đó là CN/Sabah/Palawan và rác toạ độ.

**Architecture:** một file vùng `pipelines/poi/data/quan-dao.geojson` (2 đa giác, Trường Sa khoét Sabah/Palawan)
được đọc lại MỖI lần chạy và truyền vào SQL dạng GeoJSON — không đụng `vn_boundary` (bảng đó chỉ nạp một lần nên
sửa không bao giờ tới production, và `bootstrapMissingProvince` dùng nó để dựng Khánh Hòa). Hai quần đảo lấy từ
MỘT nguồn: ảnh chụp OSM (Overpass) đã lọc theo chính sách, commit ở `pipelines/poi/data/quan-dao-osm.json`,
chèn vào `src_osm_place` SAU `deleteOutsideVn`. Chính sách nằm ở `lib/quan-dao.mjs` + hai file dữ liệu duyệt
được: `quan-dao-dao.csv` (mọi đảo/bãi được nhận, tên Việt ghi đè, nước đang giữ) và `quan-dao-ta-giu.json`
(tâm + bán kính các cụm ta giữ — chỉ trong đó mới nhận cơ sở). Hành chính: 2 hàng L8 tổng hợp trong `admin_area`
("Đặc khu Trường Sa" cha Khánh Hòa, "Đặc khu Hoàng Sa" cha Đà Nẵng), tỉnh của POI/reverse lấy theo cha của L8
khi không L4 nào chứa — không nới hình L4 (bbox "Đà Nẵng" không kéo tới 113°E).

**Số đo nền (4 agent, 26/09):** extract Geofabrik VN: Hoàng Sa 0 POI; Trường Sa 82 ứng viên trên 8 cụm, patch
hiện tại xoá 24 tên tiếng Việt thật. Overpass: Hoàng Sa 387 đối tượng, 100 % tên chữ Hán, `name:vi` phần lớn là
phiên âm tên TQ ("Đảo Triệu Thuật" = Đảo Cây, "Đảo Sâm Hàng" = Đảo Quang Hòa); Trường Sa 2.685 (ta giữ 199 trên
21 cụm; TQ 492; PH 61; TW 13; MY 22; phần còn lại là đất Palawan/Sabah). admin_area L8 3.319 = 3.321 − 2 đặc khu.

---

### Task 1: Vùng quần đảo + luật tên (thuần JS)

**Files:** Create `pipelines/poi/data/quan-dao.geojson`, `pipelines/poi/src/lib/quan-dao.mjs`,
`pipelines/poi/tests/quan-dao.test.mjs`.

- [ ] Test (RED): `vungCua(lon, lat)` trả `'truong_sa'`/`'hoang_sa'`/`null`. Trong: Song Tử Tây 114.331,11.429;
  Trường Sa Lớn 111.92,8.645; An Bang 112.921,7.892; Hoa Lau 113.821,7.375; Phú Lâm 112.341,16.834; Tri Tôn
  111.203,15.785. NGOÀI: Kudat 116.85,6.88; Balabac 117.05,7.98; Banggi 117.1,7.25; Quezon-Palawan 117.99,9.23;
  Kota Belud 116.43,6.35; Sanya 109.5,18.25; Lý Sơn 109.12,15.38 (đảo ven bờ — việc khác).
- [ ] Test (RED): `laTenViet(s)`: "Đảo Song Tử Tây", "Hải đăng Đá Lát" → true; "Parola Lighthouse", "Pag-asa
  Island", "An Bang" (không dấu), "永兴岛", "Đảo 永兴" → false.
- [ ] Implement: đa giác Hoàng Sa = [111.0,15.7]–[113.0,17.2]; Trường Sa = (111.4,6.5) (116.3,6.5) (116.3,9.8)
  (117.8,9.8) (117.8,12.1) (111.4,12.1). Properties `{region, ten, tinh}`. Point-in-polygon ray casting.
- [ ] GREEN, lint, commit.

### Task 2: Dữ liệu duyệt + ảnh chụp OSM đã lọc

**Files:** Create `pipelines/poi/data/quan-dao-dao.csv`, `pipelines/poi/data/quan-dao-ta-giu.json`,
`pipelines/poi/scripts/make-quan-dao-osm.mjs`, `pipelines/poi/data/quan-dao-osm.json`; extend
`lib/quan-dao.mjs` (`chinhSach(feature)`), tests.

- [ ] Test (RED) chính sách: đảo/bãi (place=island|islet, natural=reef|shoal) chỉ nhận khi có trong CSV, tên =
  cột `ten` (mọi tag `name*`/`alt_name`/`official_name`/`int_name`/`old_name` bị thay bằng `name`+`name:vi`);
  cơ sở chỉ nhận khi nằm trong vòng ta giữ + tên tiếng Việt (`name:vi` hoặc `name` qua `laTenViet`) + không
  `military`/`landuse=military`; ở Hoàng Sa và ngoài vòng ta giữ: không cơ sở nào; không tên → bỏ.
- [ ] Test (RED) dữ liệu duyệt: mỗi vòng ta giữ cách mọi đảo/bãi nước khác trong CSV ≥ bán kính + 2 km; mọi hàng
  CSV nằm trong đúng vùng; `ten` qua `laTenViet`.
- [ ] Test (RED) ảnh chụp commit: mọi đối tượng nằm trong vùng, tên qua `laTenViet`, không CJK, không từ cấm
  (`qa.config.json` forbiddenWords + Sansha, Yongxing, Pag-asa, Kalayaan, Parola), Hoàng Sa chỉ đảo/bãi.
- [ ] Viết CSV (tên Việt truyền thống, chỉ những tên chắc chắn; tên chưa chắc để ngoài và liệt kê cho PHONG),
  JSON vòng ta giữ (21 cụm), script Overpass (poly của hai vùng, cùng bộ khoá `OSM_POI_FILTERS` + đảo/bãi,
  `out center tags`), chạy một lần, commit ảnh chụp.
- [ ] **Chốt duyệt với PHONG**: bảng tên Hoàng Sa + đảo nước khác giữ + cơ sở ta giữ trước khi push.

### Task 3: Nạp ảnh chụp vào `src_osm_place`

**Files:** Modify `pipelines/poi/src/ingest/osm.mjs`; test `pipelines/poi/tests/quan-dao.test.mjs` (hàm dựng
dòng) + dbtest ingest.

- [ ] RED: `dongQuanDao(snapshot)` ra đúng cột COPY của `rows()`; chạy lại `chinhSach` (phòng thủ).
- [ ] Chèn SAU `deleteOutsideVn` (ảnh chụp không bị ranh giới NE xoá); log số dòng quần đảo.
- [ ] GREEN, commit.

### Task 4: Miễn luật "trong xã/phường" cho vùng quần đảo

**Files:** Modify `pipelines/poi/src/records.mjs` (`loadExtendedAdmin`); test dbtest.

- [ ] RED (dbtest): admin_area có L8 nhưng không chứa điểm Song Tử Tây → đảo khoá mở rộng vẫn `inCommune: true`.
- [ ] `in_commune = EXISTS(L8 covers) OR ST_Covers(vùng quần đảo, geom)` (GeoJSON tham số, đọc file mỗi lần).
- [ ] GREEN, commit.

### Task 5: Đặc khu Trường Sa / Hoàng Sa trong `admin_area`; tỉnh theo cha

**Files:** Modify `pipelines/poi/src/geocode/admin.mjs`, `pipelines/poi/src/geocode/poi-admin.mjs`,
`apps/api/src/routes/reverse.ts`; tests geocode dbtest + API test.

- [ ] RED: sau `buildCurrentAdmin`, có 2 hàng L8 tên "Đặc khu Trường Sa"/"Đặc khu Hoàng Sa", `name_norm` "dac khu
  …", cha là L4 Khánh Hòa/Đà Nẵng, id nối sau (không xê dịch id L8 khác), `osm_relation_id` −9001/−9002 (−8001/−8002 đã là id tổng hợp của db/admin-old.dbtest.mjs); hàng
  raw L6/L8 có điểm nằm trong vùng quần đảo bị loại (chặn relation TQ "Quận Nam Sa"/"Tam Sa").
- [ ] RED: `fillPoiAdmin` cho POI trên Song Tử Tây → ward "Đặc khu Trường Sa", province "Khánh Hòa".
- [ ] RED (API): reverse trên Song Tử Tây trả ward + province qua cha.
- [ ] Implement, GREEN, commit.

### Task 6: Luật tên của patch chủ quyền + patch lại PBF khi luật đổi

**Files:** Modify `pipelines/tiles/python/patch_sovereignty.py`, `test_patch_sovereignty.py`,
`scripts/data-update.mjs` (+ hàm thuần trong `scripts/lib/update-plan.mjs` và test).

- [ ] RED (pytest): trong bbox, `name` tiếng Việt không có `name:vi` được GIỮ; tên Latin nước ngoài bị xoá;
  CJK bị xoá; mọi `name:*` trừ `name:vi` bị xoá.
- [ ] RED: `canPatchLai({ coFile, osmDoi, dauCu, dauMoi })` → true khi dấu (sha256 của patch_sovereignty.py)
  khác; `ensurePatchedPbf` ghi dấu cạnh file PBF.
- [ ] GREEN, commit.

### Task 7: Tài liệu, dựng thử toàn quốc, rà soát, phát hành

- [ ] `apps/docs` api.md (dòng phụ lấy theo cha với hai đặc khu), tinh-nang (một gạch về hai quần đảo),
  `docs/legal/checklist-phap-ly.md` A2, evidence `docs/evidence/poi-sources/2026-09-26-quan-dao.md`, DEVLOG.
- [ ] Dựng thử trên Postgres dev (DB cô lập, PBF toàn quốc): chuỗi ingest → … → poi-admin; đếm POI hai quần
  đảo, tên, tỉnh; QA tiles POI đạt.
- [ ] Workflow rà soát đối kháng (chính sách tên, hành chính, ops) — sửa phát hiện.
- [ ] Gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, pytest; PHONG đã duyệt bảng tên → push.
- [ ] Production (PHONG chạy): `pnpm image:build`, `pnpm server:update`, `data-update --poi --skip-routing
  --force`; bản đồ nền nhận luật tên mới ở lần dựng tiles kế tiếp (cron thứ Hai).
