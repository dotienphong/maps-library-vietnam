# Dẫn đường trong Playground — phát hành trước thực địa

Ngày: 2026-09-12. Commit: `7f2211bfb391f2a60ec1664829f9e2146b942cb1`. Spec:
`docs/superpowers/specs/2026-09-12-playground-dan-duong-design.md`. Plan:
`docs/superpowers/plans/2026-09-12-playground-dan-duong.md`.

## Cổng local

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | xanh |
| `pnpm typecheck` | xanh, 14/14 package |
| `pnpm test` | gốc (core/web/react/scripts/pipelines/docs-lib): 1175 test / 104 file xanh, 3 skip có sẵn từ trước (playground-lib thêm 12 ca — `pointFromAutocomplete/Poi/LngLat`, `directionsRequest`, `shortDistance`, `routeSummary`, `etaLabel`, `navSnippet`, mở rộng `parseState`/`toSearchParams` cho `tab/tmode/from/to`); apps/api: 253 test / 34 file xanh |
| `playwright test --workers=2` (toàn bộ `apps/docs/e2e`) | 40/43 xanh; 9 ca mới của kế hoạch dẫn đường xanh (vị trí của tôi ×2, vào/ra + chọn điểm ×2, tự tính tuyến/phương tiện ×2, Giả lập/Dừng ×2, Mã nhúng có đoạn ×1); 3 ca `playground.spec.ts` **cũ** về autocomplete (highlands/Quận 10/qui nhon) đỏ do Postgres nghẽn — xác nhận bằng `curl .../healthz/db` → `upstream_unavailable` lặp lại nhiều lần độc lập với tải, không liên quan thay đổi của kế hoạch này |

## Production

- Deploy: `wrangler pages deploy dist --project-name mapslibvn-docs` → `https://fd3abdd8.mapslibvn-docs.pages.dev`, đã lên alias chính `https://mapslibvn-docs.pages.dev/`.
- `https://mapslibvn-docs.pages.dev/dan-duong/` → 200. `https://mapslibvn-docs.pages.dev/playground.html?tab=dan-duong` → 308 tới `/playground?tab=dan-duong` (Cloudflare Pages tự bỏ đuôi `.html`, giữ nguyên query string — hành vi sẵn có của hạ tầng, không phải hồi quy).
- `https://mapslibvn-docs.pages.dev/dan-duong-demo/` vẫn trả 200 ngay sau deploy, nhưng `cf-cache-status: HIT` và `age: ~8245s` (~2,3 giờ) — response tới từ cache edge Singapore có từ **trước** lần deploy này, không phải trang còn tồn tại trong bản build mới (đã xác nhận `find apps/docs/dist -iname "*dan-duong-demo*"` rỗng sau `pnpm --filter @mapslibvn/docs build`). Cache sẽ tự hết theo `s-maxage=604800`; sidebar/docs.spec.ts đã không còn trỏ tới trang này nên người dùng thường sẽ không gặp lại URL cũ.

## Thử tay trên production (`https://mapslibvn-docs.pages.dev/playground.html?tab=dan-duong`)

> Phần này cần GPS thật và di chuyển thật ngoài đời — PHONG tự làm, cập nhật bảng dưới rồi báo lại.

| Việc | Máy tính | Điện thoại |
|---|---|---|
| GPS lúc mở, chấm vị trí | | |
| Tìm tên đường → tuyến | | |
| Đổi 3 phương tiện → tuyến đổi | | |
| Bấm tuyến thay thế | | |
| Giả lập → đến nơi | | |
| Bắt đầu thật (vài chục mét) | | |

Ghi chú/khác biệt thấy được: …
