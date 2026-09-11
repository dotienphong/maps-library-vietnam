# Build graph Valhalla Việt Nam trên máy chủ nội bộ

Ngày: 2026-09-11. Máy: MacBook `aavn-macbook042`, macOS 26.5.2, 24 GB RAM.
VM Docker Desktop: **15,6 GB / 12 CPU** (`MemTotal` 16.748.142.592) — trước 14:19Z chỉ **8,2 GB**
(8.217.165.824), xem "Lần 1" bên dưới.
Image `ghcr.io/valhalla/valhalla-scripted:3.8.3`, digest `sha256:24ef7955899dececb94e26c6dfb89d64fabfae875f980432694b0261eb6c251b`,
`valhalla_build_tiles` chạy **4 thread**.
PBF: `vietnam.osm.pbf` md5 `8140c9b07d88478bcd6c68b19a06ffb2`, **328.214.395 B** (313 MB), tải 2026-09-11T13:43:58Z.
Mọi mốc giờ dưới đây là UTC (giờ VN = +7).

## Ba lần build

| Số đo | Lần 1 — VM 8,2 GB | Lần 2 — recovery sau khi nâng RAM | Lần 3 — `prepare --force` (có đo) |
|---|---|---|---|
| Cờ `reload.request` | 13:51:27Z | 14:29:05Z | 14:38:22Z |
| Kết thúc | **13:59:28Z — `Killed`** | 14:31:24Z sẵn sàng | 14:40:21Z sẵn sàng |
| Thời gian | 8 phút 01 giây rồi chết | **1 phút 59 giây** | **1 phút 59 giây** |
| RAM đỉnh container `valhalla` | không đo được (OOM) | không đo (ngoài kế hoạch) | **3,669 GiB** |
| RAM `postgres` cùng lúc | — | — | **195,8 MiB** (phẳng suốt) |
| `valhalla_tiles.tar` | 1.023.313.920 B (hỏng) | 1.158.123.520 B | 1.158.123.520 B |

**Lần 1 chết vì OOM, không phải lỗi dữ liệu.** Log: `configure_valhalla.sh: line 240: 803 Killed
valhalla_build_tiles -c … -s enhance` → `ERROR: valhalla_build_tiles failed; not hashing.` Wrapper
`run.sh` ngủ 600 giây, Docker khởi động lại container lúc 14:09:28Z; entrypoint thấy thư mục tile dở
nên đóng gói thành tar 1.023.313.920 B và phục vụ luôn.

**Cái bẫy: tar đó cho `/status` trả 200 nhưng không định tuyến được.** Mọi truy vấn `/route` — cả
Quận 1 TP.HCM lẫn Hà Nội → Hải Phòng — trả `error_code 171 "No suitable edges near location"`.
`routing-graph.mjs status` cũng báo `buildFailed: false` và `activeGraph` trỏ đúng PBF. Ba tín hiệu
xanh trong khi dịch vụ chết hoàn toàn.

**Lần 3 là build ấm**: thư mục `valhalla_tiles/` từ lần 2 còn nguyên nên `configure_valhalla.sh` bỏ
qua các pha đã khớp `file_hashes.txt`. Con số 1 phút 59 giây **không phải thời gian build lạnh** và
không dùng để ước lượng thời gian dựng máy chủ mới được. Cận dưới cho build lạnh: lần 1 mất 6 phút 38
giây cho `valhalla_build_admins` + `valhalla_build_timezones` trước khi tới pha tile.

## Diễn tập rollback (spec mục 7.5)

| Phép thử | Kết quả |
|---|---|
| `rollback` không cờ identity | In usage, không đụng gì (CLI bắt buộc cặp `--expected-*`) |
| `rollback` lúc đang reload | `reload/build đang chạy — rollback chỉ được phép sau khi wrapper ghi reload.failed` — từ chối đúng |
| `rollback` lúc rảnh, có prev | Cờ 14:41:10Z → `tileset_last_modified` quay về mốc cũ `1789137084` lúc 14:41:52Z = **42 giây**; tuyến Quận 1 vẫn trả 1,148 km |
| Hai lần rollback trước đó | `/status` 200 trở lại sau **78 giây** và **37 giây** |

**Guard identity không phân biệt được hai graph dựng từ cùng một PBF.** Cả `activeGraph.pbfMd5` lẫn
`previousGraph.pbfMd5` đều là `8140c9b0…`, nên `rollback --expected-current-md5 X --expected-target-md5 X`
pass và đảo thật. Đúng 14:34:03Z hôm nay lệnh này đã đưa graph hỏng quay lại phục vụ trong khi graph
tốt bị đẩy xuống `prev/` — phát hiện ra vì kiểm bằng `/route` chứ `/status` vẫn 200. Chỉ graph do
`data:update` dựng mới có `vnRelease` để phân biệt; graph setup/legacy thì md5 là tất cả những gì có.

## Kiểm tuyến trên graph đang phục vụ

`tileset_last_modified` 1789137619 (14:40:19Z), `/status` version 3.8.3.

| Tuyến | costing | Kết quả |
|---|---|---|
| Nhà thờ Đức Bà → Bến Thành | `motor_scooter` | 1,148 km — "Lái về phía đông nam trên Công trường Công xã Paris." → "Rẽ phải vào Nguyễn Du" |
| Hà Nội → Hải Phòng | `auto` | 123,589 km / 103 phút — "Lái về phía tây trên Phố Trần Nguyên Hãn." |
| Đà Nẵng → Huế | `motor_scooter` | 119,415 km / 183 phút |

Chỉ dẫn đúng `language: vi-VN`, tên đường thật, cự ly hợp lý ở cả ba miền.

## Quyết định RAM (spec mục 9)

Đỉnh đo được **3,67 GB** < 6 GB → **không đặt `mem_limit`** cho service `valhalla`, giữ
`PG_SHARED_BUFFERS=6144MB`.

Kèm hai điều kiện, vì 3,67 GB là số của build ấm:
1. VM Docker Desktop phải **≥ 12 GB**. Ở 8,2 GB pha `enhance` bị kernel giết — đó là toàn bộ nguyên
   nhân của lần 1.
2. Lần build lạnh kế tiếp (máy mới, hoặc sau khi xoá `valhalla_tiles/`) phải đo lại đỉnh RAM rồi mới
   chốt `mem_limit`. Con số hiện tại chưa chạm được đỉnh thật của pha `enhance`.

Log `docker stats` 15 giây/mẫu: `build-stats.txt` (cùng thư mục).
