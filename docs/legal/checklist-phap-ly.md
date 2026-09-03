# Checklist pháp lý MapsLibVN — nghiệm thu M5

*Căn cứ: spec `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md` mục 12 và 15; roadmap mục 0.5.*

Ngày lập: 03/09/2026. Người ký: Đỗ Tiến Phong.

Ngày ký: ____/____/2026  ·  Chữ ký: ______________________

---

## A. Đã làm trong M1–M5 — có bằng chứng trong repo

| # | Hạng mục | Bằng chứng | Xác nhận |
|---|---|---|---|
| A1 | Ghi nguồn bắt buộc, không tắt được: SDK luôn hiện attribution, API trả chuỗi chuẩn tại `GET /v1/attribution` | `packages/core/src/attribution.ts`, `apps/api/src/index.ts`; E2E playground kiểm attribution hiện | ☐ |
| A2 | Bản đồ thể hiện chủ quyền Hoàng Sa, Trường Sa: patch dữ liệu trước Planetiler, lớp `sovereignty` trong style, QA chặn publish nếu thiếu | `pipelines/tiles`, `packages/style/src/sovereignty.geojson`; nghiệm thu M1 (DEVLOG mục 6) | ☐ |
| A3 | ODbL: dữ liệu OSM tách bảng riêng, bản ghi POI chỉ liên kết nguồn bằng ID (Collective Database) | `db/migrations/0002_sources.sql`, `0003_core.sql`; spec 12.2 | ☐ |
| A4 | Cung cấp bản xuất ODbL khi có yêu cầu: `pnpm export:odbl` xuất 5 bảng dẫn xuất OSM kèm manifest và README ghi giấy phép | `scripts/export-odbl.mjs`, `db/export-odbl.dbtest.mjs` (CI xanh) | ☐ |
| A5 | `LICENSE` MIT ở gốc repo và `THIRD_PARTY_NOTICES.md` đóng gói cùng 3 gói SDK; CI kiểm bản sao không lệch | `LICENSE`, `THIRD_PARTY_NOTICES.md`, `scripts/notices-sync.mjs`, bước `--check` trong `ci.yml` | ☐ |
| A6 | Điều khoản tenant công bố công khai: cấm cào và xuất hàng loạt, bắt buộc giữ attribution, tenant chịu trách nhiệm xin phép vị trí theo Nghị định 13/2023 | `docs/legal/dieu-khoan-tenant.md`, đăng tại `/dieu-khoan/` | ☐ |
| A7 | Không lưu địa chỉ IP thô: `poi_edit` chỉ có `ip_hash` (băm kèm ngày) và `end_user_hash` (băm từ token do app cấp) | `apps/api/src/edits/hash.ts`, `db/migrations/0003_core.sql` | ☐ |
| A8 | Nominatim và Overpass công cộng chỉ dùng khi phát triển; production chạy hoàn toàn trên dữ liệu tự host | spec 12.5; pipeline không gọi hai dịch vụ này | ☐ |
| A9 | Không có nguồn dữ liệu từ Google, Apple hay Grab | `pipelines/poi/src/ingest/` chỉ có OSM, Overture, Foursquare | ☐ |
| A10 | Trang "Giấy phép & ghi nguồn" và "Độ chính xác geocode" đã công bố | `/giay-phep/`, `/do-chinh-xac/` trên `mapslibvn-docs.pages.dev` | ☐ |

## B. Việc tay còn lại — chặn việc thương mại hoá, không chặn dùng nội bộ

| # | Việc | Căn cứ | Hạn | Trạng thái |
|---|---|---|---|---|
| B1 | Hỏi luật sư: kinh doanh nền tảng bản đồ số có thuộc danh mục cần **giấy phép hoạt động đo đạc và bản đồ** theo Điều 51 Luật Đo đạc và bản đồ 2018 và Nghị định 18/2020 hay không | spec 12.4 | trước khi thu phí | ☐ |
| B2 | Hỏi luật sư xác nhận cách đọc **ODbL Collective Database**: bảng POI chỉ liên kết bằng ID nên không phải Derivative Database, và kết quả API là Produced Work chỉ cần ghi nguồn | spec 12.2 | trước khi thu phí | ☐ |
| B3 | Rà soát **nhãn hiệu** tên "MapsLibVN" với chính sách nhãn hiệu của MapLibre; nếu bị phản đối thì đổi tên gói trước khi publish npm công khai | spec 12.4 và 14 | trước khi publish npm | ☐ |
| B4 | Luật sư rà soát **điều khoản tenant** trước khi ký với tenant bên ngoài | spec 9 | trước tenant ngoài | ☐ |
| B5 | Khi thương mại hoá: chuyển dữ liệu đóng góp lên hạ tầng có kiểm soát vật lý, không giữ ở nhà riêng | spec 12.4 và 11.6 | khi có tenant trả phí | ☐ |
| B6 | Mua **tên miền riêng** cho MapsLibVN, đổi endpoint tiles và API trong docs và cấu hình, mang theo cặp Cache Rule đã ghi ở sự cố SC-1 | DEVLOG mục 3 ngày 27/08 | trước khi mở cho developer ngoài | ☐ |

## C. Việc kỹ thuật còn treo — không thuộc pháp lý, ghi để không quên

| # | Việc | Ghi chú |
|---|---|---|
| C1 | Nghiệm thu `pnpm run setup` trên **Windows** | Treo từ M1, chờ PHONG có máy |
| C2 | Bật lại QA `requireIslands` cho Hoàng Sa | Đang chỉ cảnh báo vì bản extract Geofabrik không phủ; cần chốt nguồn extract bổ sung |
| C3 | Bảng alias phường xã trước và sau sắp xếp 2025 | Thiếu một số alias nên câu địa chỉ dùng tên cũ có thể rơi xuống mức tỉnh |
| C4 | Thêm pepper bí mật cho `ip_hash` | Muối hiện là ngày, không có bí mật phía máy chủ; chỉ cần khi lưu lâu hơn 30 ngày hoặc mở thương mại |
| C5 | Xác nhận đóng góp của M4 còn nguyên sau lần `data:update` production kế tiếp | Cron chạy thứ Hai 02:00 giờ Việt Nam |

---

**Ý nghĩa chữ ký.** Người ký xác nhận mục A đúng với hệ thống đang chạy tại ngày ký, và cam kết hoàn thành các việc ở mục B trước mốc ghi ở cột "Hạn". Tài liệu này chưa được luật sư rà soát và không thay thế ý kiến pháp lý.
