# @mapslibvn/catalog

Nguồn sự thật duy nhất về giá, hạn mức và bảng so sánh của MapsLibVN. Package nội bộ, không
publish, không build: các app import thẳng `src/index.ts`.

- `PLAN_CATALOG` — bốn bậc và hai gói mua thêm, giá USD cent lẫn VND. Giá VND là đồng tiền THU
  thật; USD chỉ để hiện tham chiếu (`USD_REFERENCE_RATE`).
- `quoteOrder()` — tính tiền một đơn từ catalog; máy chủ luôn tính lại, không tin số client gửi.
- `addMonths()` — cộng tháng theo lịch, giờ Việt Nam.
- `COMPARISON` — bảng so sánh Google/VIETMAP đã đối chiếu 14/09/2026 kèm giả định và nguồn.

Đổi giá là đổi file này, một commit, một deploy. Nguồn quyết định:
`docs/research/2026-09-14-thuong-mai-hoa-va-gia-chot.md`.
