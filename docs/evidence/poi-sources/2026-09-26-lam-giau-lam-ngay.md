# Làm giàu kho POI — nhóm "làm được ngay" (26/09/2026)

Plan: `docs/superpowers/plans/2026-09-26-lam-giau-poi-lam-ngay.md`. Khảo sát nguồn gốc: memory
`lam-giau-nguon-poi-26-09` (50 cách, 65 nguồn bị loại, mỗi cách đã qua một vòng phản biện).

Mọi số dưới đây đo lại trên **OSM `vietnam-260925.osm.pbf`** (Geofabrik, 25/09/2026, md5
`aaf595aab15cfc061d7d32659f459954`) và **FSQ OS Places release 2026-09-15** (274.416 dòng VN), mỗi
nhánh có một lượt kiểm chéo tái lập độc lập. Không đọc DB production.

## 1. Luật tự duyệt M4 — ĐÃ LÊN PRODUCTION (26/09, `595878d` + `1d5e3ce`)

Lỗ hổng: khoá web/mobile có `edits:write` là khoá công khai (nằm trong HTML/bundle, Origin giả được
ngoài trình duyệt). Trước bản sửa, ai cầm khoá đó tự duyệt được đổi SĐT/website trên POI quality ≥ 60;
gom khoá công khai của hai tenant là tự tạo được "đồng thuận" để đóng, dời, đổi tên POI và sinh mốc
geocode rooftop. `locked_fields` giữ giá trị sai qua mọi lần build.

Luật mới (danh sách trắng, `apps/api/src/edits/rules.ts`): tenant `internal` + khoá `server` → tự duyệt;
ngoài ra chỉ update **chỉ đổi `hours`** (đúng cú pháp opening_hours) bằng khoá `server`, trên POI
quality ≥ 60 hoặc ≥ 2 tenant cùng gửi bằng khoá server còn hiệu lực. Mọi thứ khác chờ admin.

Kiểm chứng: 9 ca tấn công trong `apps/api/test-db/edits.itest.mjs` — đỏ (`auto_approved`) trên mã cũ,
xanh trên mã mới; itest 142/142, unit API 873/873, test gốc 2.215. CI + Deploy API + Deploy Docs xanh
cho `1d5e3ce`; `/dong-gop/` trên production hiện bảng luật mới.

Việc treo (review độc lập): `apply_poi_edit` gắn nhãn `auto:consensus` cho phiếu trùng kể cả khi
duyệt tay; chưa lưu giá trị cũ để hoàn tác; lệnh thu hồi khoá bằng SQL không xoá cache KV auth;
cần rà các edit đã tự duyệt trước 26/09 (mục 6).

## 2. FSQ — cờ chất lượng (`f5a1063`, migration 0025)

| Số đo (FSQ 2026-09-15, sau lọc ranh giới) | Giá trị |
|---|---:|
| Bản ghi còn mở | 266.580 |
| Có cờ `closed` nhưng không có `date_closed` (đang active) | 2.653 |
| `doesnt_exist` / `delete` / `inappropriate` / `privatevenue` (chưa đóng) | 686 |
| Mẫu 20 `privatevenue`: nhà riêng / rác / cơ sở thật | 2 / 4 / 14 |
| `date_refreshed` trước 2020 (còn mở) | 55,3 % |
| POI FSQ ≥ 60 điểm nếu đưa `date_refreshed` vào recency | 27.857 → 11.300 |
| SĐT dạng di động trên số bản ghi có tel | 67,9 % |

Quyết định: bỏ bản ghi 4 cờ trên; cờ `closed` thành `closed_reported` — chỉ đóng cụm khi mọi thành
viên đều đóng/bị báo đóng, để báo cáo chưa xác minh không đóng được POI mà OSM còn thấy mở. Chưa đưa
`date_refreshed` vào recency (lệch thang với OSM, vốn vẫn lấy ngày ingest).

## 3. Tên OSM (`f09d2c3`)

| Số đo (OSM 25/09/2026) | Giá trị |
|---|---:|
| POI bị bỏ vì thiếu tag name (ngoài UNNAMED_OK) | 37.428 |
| Gỡ được bằng tên dự phòng (sau blocklist, bỏ mô tả, trùng tên, ATM nghi vấn) | ~6,7–7,7 nghìn |
| ATM không tên gỡ được / dùng được sau bảng ngân hàng | 1.879 / ~1.301 |
| FSQ toàn quốc: ATM / cây xăng | 111 / 955 |
| POI tìm được thêm nhờ name:vi, short_name, loc_name, int_name | 1.556 |
| POI có `;` trong tag tên bị gộp thành một chuỗi | 56 (+32 trong `name`) |
| POI có email (OSM) | 2.281 |

Phát hiện kèm: **1.000 node rác** `office=religion` không tên, cùng changeset, thêm 30/10/2025 ở Quảng
Ngãi (Kon Tum cũ) — pipeline biến thành 1.000 POI "Tôn giáo, cộng đồng khác" vì nhóm
`religion_community` được lấy nhãn loại làm tên. Sửa: POI không tên loại `*_other` bị bỏ.

Sửa khảo sát cũ: POI chỉ có `addr:street` (không số nhà) **không** mất tên đường — `parseAddress`
vẫn tách được 8.584/9.014.

## 4. Mở rộng bộ lọc tag OSM (`c304296`)

| Bước (nhóm không-building, OSM 25/09/2026) | Còn lại |
|---|---:|
| Đối tượng có tên mang khoá ứng viên | 37.586 |
| … trong 34 tỉnh, không CJK, không trùng tên xã/phường mới | 33.854 |
| … trừ trùng xã/phường cũ, trùng FSQ | 31.852 |
| … bỏ tên "tiền tố + số" (Thôn 3, Khu phố 4) | 26.367 |
| … trừ trùng POI OSM đang giữ cùng tên ≤ 1,3 km | 25.907 |
| … gom trùng nội bộ ≤ 1 km (trạm thu phí mỗi làn một node…) | **24.758 (+19,7 % POI OSM)** |

Theo tỉnh (ứng viên / POI OSM đang giữ): Lai Châu 586/347 (+169 %), Đắk Lắk 2.549/2.049 (+124 %),
Lạng Sơn 281/332, Hà Tĩnh 443/584, Gia Lai 1.473/2.051; thấp nhất Đà Nẵng +6,9 %, Cần Thơ +6,3 %.

Loại hẳn: `place=town/suburb` (86 %/76 % là xã/phường mới), `landuse=military`/`military=*` (605),
building (để sau: 31 % là mã ngắn, 25 % nằm trong khuôn viên POI đã có).

## 5. Phát hiện chưa xử lý (bước sau)

1. **`deleteOutsideVn` dùng ranh giới Natural Earth quá thô**: xoá nhầm 556 POI OSM đang giữ và ~929
   bản ghi FSQ trên đất liền/đảo VN (Bãi Cháy–Tuần Châu, Móng Cái, Lý Sơn, Nam Du, Cù Lao Chàm…), đồng
   thời giữ 339 POI nằm ngoài mọi tỉnh. Nên đổi sang 34 tỉnh OSM (polygon tỉnh gồm cả lãnh hải).
2. **POI chết do bỏ cấp huyện (NQ 203/2025)**: OSM 590 + FSQ 421 cơ quan cấp huyện (UBND/Huyện uỷ,
   Công an, Toà án, Chi cục thuế…); chỉ 67 bản OSM được sửa sau 01/07/2025.
3. **Khánh Hòa** vẫn thiếu relation cấp tỉnh dựng được trong extract (16/62 way outer vắng).
4. **Độ phủ chuỗi** so với số cửa hàng công bố (OSM ∪ FSQ, gộp 150 m): Long Châu 3,1 %, An Khang 3,9 %,
   Bách Hoá Xanh 11,7 %, Pharmacity 14,5 %, WinMart 38,8 %.
5. **Tư thế ODbL của bảng `poi`**, SĐT di động trong FSQ (Luật 91/2025): xem memory khảo sát.
6. **Đảo Trường Sa/Hoàng Sa không vào kho** (cần PHONG quyết, liên quan chủ quyền): extract có 24 đảo
   phía đông kinh độ 110,5 (Song Tử Tây, Trường Sa Đông, Đá Tây A…) nhưng `vn-boundary` (Natural
   Earth) dừng ở 109,47 nên `deleteOutsideVn` xoá chúng ngay ở ingest; luật "trong xã/phường hiện
   hành" của khoá mở rộng cũng sẽ chặn. Muốn tìm được thì cần một vùng lãnh hải riêng miễn hai luật.
7. **Biểu tượng trên nền theo nhóm**: núi/thác/hang/hải đăng mang icon của nhóm văn hoá (bảo tàng),
   trạm thu phí/cửa khẩu mang icon giao thông (xe buýt) — trường `icon` của category không vào tiles.

## 6. Dựng thử toàn quốc cục bộ (Task 6)

Hai DB cô lập trên Postgres **dev** (`mapslibvn_nat_before`, `mapslibvn_nat_after`), cùng OSM
25/09/2026 đã vá chủ quyền và FSQ 2026-09-15, chạy các bước DB của `data:update --poi` vào DB rỗng
(`publish --force`), nhưng đặt osm-roads → admin **trước** records để luật hành chính có dữ liệu
(production chạy records trước, dùng bảng hành chính của lần build trước); không export/upload tiles. "Trước" = mã `7c0889a` qua git worktree; "sau" =
`c304296` (trước hai luật chặn nhỏ của `f92a6d5`, chỉ làm bớt vài chục bản ghi). Cả hai chuỗi xong
trong ~17 phút, **0 bước lỗi**, cổng QA hành chính qua (L4 = 34, gồm Khánh Hòa dựng từ 64 xã).

| | Trước | Sau | Chênh |
|---|---:|---:|---:|
| `src_osm_place` | 231.040 | 257.186 | +26.146 |
| Bản ghi OSM / FSQ (`poi_work_record`) | 125.351 / 273.029 | 154.143 / 272.322 | +28.792 / −707 |
| Cụm (đa nguồn) | 384.113 (2,3 %) | 411.470 (2,4 %) | +27.357 |
| **POI active** | **377.677** | **402.547** | **+24.870 (+6,6 %)** |
| POI active OSM / FSQ | 118.462 / 259.215 | 147.172 / 255.375 | +28.710 / −3.840 |
| POI FSQ đóng | 6.344 | 8.811 | +2.467 (chỉ-FSQ bị báo đóng) |
| Tỷ lệ category other | 15,0 % | 13,8 % | |
| ATM active / cây xăng active | 1.240 / 3.574 | 2.607 / 4.379 | +1.367 / +805 |
| POI rác "Tôn giáo, cộng đồng khác" | 407 | 0 | |
| Mốc địa chỉ | 146.494 | 146.223 | −271 |

Mã mới trên bản "sau": thôn/ấp 8.977, khu phố 3.333, khu dân cư 1.596, hồ 1.529, khu công nghiệp/nhà
máy 1.495, núi 1.019, sông 693, khu thương mại 619, nút giao 612, trạm thu phí 333 (gom từ 818
node), đảo 230, thác 158, quảng trường 133, hang 117, trạm dừng nghỉ 66, hải đăng 37, cửa khẩu 29.
Lai Châu lên 1.095 POI (534 từ mã mới).

**Tìm kiếm** (API dev, `AUTOCOMPLETE_FAST=1` như production, `scripts/perf-autocomplete.mjs`):

| | API cũ + DB trước | API mới (`340cb1f`) + DB trước | API mới + DB sau |
|---|---|---|---|
| Bộ mờ `fuzzy-queries.txt` hit@3 | 37/40 | 37/40 | 37/40 |
| Bộ biến thể `local-variant-queries.txt` hit@3 | 11/19 | 11/19 | 11/19 |
| p95 bộ mờ | 260 ms | 249 ms | 243 ms |

Truy vấn mẫu với `near`, API mới + DB sau: "hồ tây" → Hồ Tây (FSQ) rồi Hồ Tây (OSM); "đảo cát bà" →
Quần đảo Cát Bà, Đảo Cát Bà; "núi bà đen" → Núi Bà Đen; "cửa khẩu hữu nghị" → Cửa khẩu Hữu Nghị
đứng đầu (trước: không có); "ngã tư sở" → nút giao Ngã tư Sở; "trạm thu phí" → trạm có tên riêng
thay cho "Trạm Thu Phí" trống; "atm vietcombank" → 5/5 ATM Vietcombank.

### 6b. Diễn tập lần chuyển production — mã cuối (`be76958`)

DB `mapslibvn_nat_trans` **sao từ `mapslibvn_nat_before`** (dữ liệu dựng bằng mã cũ, như production
hiện tại), chạy mã mới ĐÚNG thứ tự `scripts/data-update.mjs` (records → conflate → publish **không
`--force`** → osm-roads → admin → poi-admin → streets → alleys → anchors → report). ~23 phút, **0 bước
lỗi**, publish qua cổng sanity 10 %.

| | Giá trị |
|---|---:|
| POI active trước → sau | 377.677 → **402.396** (+24.719) |
| OSM active / FSQ active | 147.029 / 255.367 |
| POI cũ còn active và giữ nguyên ID | 373.946 / 377.677 (**99,0 %**) |
| POI cũ bị đóng (chủ yếu nhà hàng/cà phê chỉ-FSQ bị báo đóng) | 2.506 |
| POI cũ mất ID (407 rác "Tôn giáo, cộng đồng khác", 84 `health_other` không tên, FSQ bị báo không tồn tại/riêng tư…) | 1.225 |
| `poi-admin` ghi (chỉ dòng đổi) | 28.400 / 411.319 |
| Gom trùng cùng tên ≤ 1 km | 887 |

Mã mới: thôn/ấp 8.924, khu phố 3.247, khu dân cư 1.597, khu công nghiệp/nhà máy 1.503, hồ 1.499, núi
1.013, sông 697, nút giao 649, khu thương mại 489, trạm thu phí 332, đảo 231, thác 157, quảng trường
124, hang 115, trạm dừng nghỉ 61, hải đăng 37, cửa khẩu 29. So với lượt 6: nút giao 612 → 649 (không
còn nhường bến xe buýt trùng tên), khu thương mại 619 → 489 (130 viện/trung tâm về lại nhóm cũ).
Tìm kiếm (API `8822f9c`): bộ mờ 37/40, biến thể 11/19 — không đổi; "kcn tan tao" nay có KCN Tân Thới Hiệp.

**Phát hiện khi đo:** bậc nhanh của autocomplete cắt bể 200 ứng viên thuần theo popularity, nên POI
chỉ-OSM (1,0) trùng tên chính xác bị hàng trăm POI chỉ-FSQ (1,5) chứa cùng từ đẩy ra ngoài — "hồ tây"
không ra Hồ Tây. Sửa ở `340cb1f` (ưu tiên tên bắt đầu bằng truy vấn khi cắt bể) và `8822f9c` (cắt 20 dòng cuối theo đúng các vế của rankScore, kể cả khoảng cách — review chỉ ra bản `340cb1f` bỏ qua `near`).

**Còn hạn chế:** địa danh lớn còn **hai bản** (Hồ Tây FSQ cách tâm polygon OSM 394 m, Núi Bà Đen hai
bản cách 2,2 km) vì conflate chỉ ghép trong 150 m — cần luật bán kính theo loại/FSQ nằm trong polygon.
Không có `near` thì "hồ tây" hoà điểm với "Ho Tay Hotel".

## 7. Việc trên máy chủ (PHONG chạy, đúng thứ tự)

0. Chờ CI của SHA vừa push xanh **cả hai job** `test` và `image` (job `image` đẩy
   `ghcr.io/dotienphong/mapslibvn-pipeline:latest`). Deploy API sẽ **đỏ ở `check:migration`** — đúng
   thiết kế, vì repo có 0025 mà production chưa áp; Worker production vẫn chạy bản cũ.
1. Trên máy chủ Ubuntu (xác nhận đang chạy **cáp LAN** — sự cố 25/09: upload qua Wi-Fi RTL8723BE làm
   sập tunnel): `pnpm server:update` — `git pull`, kéo image, `up -d`, áp migration **0025** (chỉ thêm
   cột nullable vào `src_fsq_place`; image cũ vẫn chạy được với nó). Migration chạy TRONG image vừa
   kéo, nên kiểm: `docker compose -f infra/server/compose.yml --env-file infra/server/.env run --rm pipeline ls db/migrations/0025_fsq_quality_columns.sql`.
2. `curl -s https://api.ai-solutions.io.vn/healthz/db` → `schema_migration` là `0025_fsq_quality_columns.sql`.
3. Chạy lại Deploy API bị chặn ở bước 0: `gh run rerun <id> --failed` (hoặc báo tôi chạy).
4. Dựng lại dữ liệu vào giờ vắng (hoặc để cron 02:00 thứ Hai tự chạy bằng image mới):
   `docker compose -f infra/server/compose.yml --env-file infra/server/.env run --rm pipeline node scripts/data-update.mjs --poi --skip-routing`.
   Máy chủ Ubuntu 2 nhân/3,7 GB, cùng máy với Postgres/Valhalla đang phục vụ: ghi lại thời gian, RAM
   đỉnh, swap. `publish` đổi bảng `poi` TRƯỚC khi export/upload tiles, nên nếu upload đứt thì API đã
   có POI mới mà tiles còn cũ tới lần chạy xanh sau (không hỏng dữ liệu). Nếu in "Không có gì mới"
   (md5 OSM/FSQ chưa đổi) thì thêm `--force` — cờ này cũng bỏ cổng sanity 10 % của publish.
5. Kiểm bằng **playground trên trình duyệt** (SDK tự ACK receipt), KHÔNG dùng curl trần: tenant
   Phong_Admin là commercial, 3 phản hồi không ACK trong 24 giờ là khoá cả nhóm places, kéo theo
   playground. Truy vấn: "cửa khẩu hữu nghị", "ngã tư sở" (gần Hà Nội), "atm vietcombank". Autocomplete
   cache 10 phút theo truy vấn — chờ ≥ 10 phút sau publish/deploy hoặc đổi truy vấn. Report nằm trong
   volume `pipeline-out` (`/app/out/poi-report-*.json`) và trên R2 `state/reports/`.
6. Rà edit đã tự duyệt mà KHÔNG thoả luật mới (chỉ đọc):
   `SELECT e.id, e.poi_id, e.kind, e.changes, e.reviewer, k.kind AS key_kind, e.created_at
    FROM poi_edit e LEFT JOIN api_key k ON k.key_hash = e.api_key
    WHERE e.status = 'auto_approved' AND e.reviewer LIKE 'auto:%'
      AND NOT (k.kind = 'server' AND e.kind = 'update'
               AND (SELECT array_agg(x) FROM jsonb_object_keys(e.changes) x) <@ ARRAY['hours'])
    ORDER BY e.created_at;`

## 8. Kết quả trên production (26/09/2026, máy chủ MacBook)

Lần chuyển chạy trên **MacBook** chứ không phải Ubuntu: Ubuntu đã tắt, DB MacBook phục hồi từ backup
Ubuntu rồi áp 0025. Deploy API chạy lại (run `36212437389`, lần 2) xanh, Worker `63a65283`,
`/healthz/db` báo `0025_fsq_quality_columns.sql`.

Hai chặn gặp trên đường, đều đã sửa và có test:

| Chặn | Gốc | Sửa |
|---|---|---|
| `records.mjs`: `must be owner of table poi_work_pair` | backup có bảng làm việc tạm của pipeline; restore `--no-owner` để chúng thuộc superuser, `PERMISSIONS_SQL` chỉ trả lại bảng gọi đích danh | `20ec573`: trả `poi_work_*`, `*_new`, `*_keys_stage` + 4 bảng tạm geocode về `pipeline`; `db/permissions.dbtest.mjs` đỏ đúng lỗi trên mã cũ |
| `detectSources`: `fetch failed … ETIMEDOUT` cả 4 IP Geofabrik | Node 22 bỏ từng IP sau 250 ms, bắt tay TCP tới Geofabrik đo 316–372 ms; curl cùng mạng Docker vẫn 200 | `58b8db0`: `--network-family-autoselection-attempt-timeout=2000` trong `NODE_OPTIONS` của container pipeline (cả cron) |

`data-update --poi --skip-routing --force` (md5 OSM/FSQ chưa đổi nên phải `--force`) xanh trong 25 phút:

| Chỉ số | Production | Dựng thử §6b |
|---|---|---|
| POI active | 402.397 | 402.396 |
| Tổng / đóng | 411.320 / 8.923 | — |
| Đa nguồn | 2,4 % | — |
| Snapshot tile | 383.460 dòng, 95.763 feature (26,5 MB) | — |
| Manifest | `poi-20260926-155651-48c875a8` (+ `poi-osm-…`, `poi-fsq-…`), smoke tile đạt | — |

Publish in `trước đó 402396`: `poi` đã có bộ dữ liệu mã mới ngay trước lần chạy này, dù sau restore đo
376.468 — có một lần chạy xen giữa không để lại log mà tôi thấy. Kết quả hai lần lệch 1 POI.

Autocomplete production qua `getAndAck` (ACK từng receipt, không lượt nào `ackFailed`):

| Truy vấn | Top 1 | Kiểm cái gì |
|---|---|---|
| `hồ tây` gần 21.05,105.82 | Hồ Tây (West Lake) | nhóm Địa danh (`natural=water`); "Hồ Tây" thứ 2 là bản trùng — §5 |
| `highlands` | Highlands Coffee | bể ứng viên bậc nhanh không hồi quy |
| `cửa khẩu hữu nghị` | Cửa khẩu Hữu Nghị | tag mở rộng `border_control` |
| `ngã tư sở` gần 21.00,105.82 | Ngã tư Sở | `junction` |
| `atm vietcombank` gần 21.03,105.85 | ATM Vietcombank (cả top 3) | tên dự phòng theo ngân hàng |

Bước 6 (rà edit tự duyệt theo luật cũ): 0 dòng — `poi_edit` production đang trống.
