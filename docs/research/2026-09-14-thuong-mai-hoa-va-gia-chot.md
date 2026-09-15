# MapsLibVN — giá đã chốt và khoảng thiếu trước thương mại hoá

Ngày: 14/09/2026. PHONG yêu cầu lưu quyết định trong hội thoại.
Mô hình: thuê bao API/SDK cho doanh nghiệp và lập trình viên.
Giá dưới đây thay thế các mức giá đã thảo luận trước đó. Đây là quyết định sản phẩm;
chưa có nghĩa các gói đã được triển khai hoặc mở bán trên production.

## 1. Giá và hạn mức đã chốt

VND quy đổi tham chiếu ở 26.000đ/USD, không phải tỷ giá trực tiếp hoặc quyết định về VAT.

| Gói | USD | VND tham chiếu | Places | Tính tuyến | Thời hạn | Hỗ trợ |
|---|---:|---:|---:|---:|---|---|
| Free dùng thử | 0 | 0 | 2.000 tổng; 200/ngày | 200 tổng; 20/ngày | 30 ngày | Tài liệu, tự phục vụ |
| Starter | 25/tháng | 650.000/tháng | 30.000/tháng | 3.000/tháng | Thuê bao tháng | Không hỗ trợ online |
| Professional | 100/tháng | 2.600.000/tháng | 100.000/tháng | 10.000/tháng | Thuê bao tháng | Hỗ trợ online |
| Business | 400/tháng | 10.400.000/tháng | 400.000/tháng | 40.000/tháng | Thuê bao tháng | Hỗ trợ online |

Free là tổng hạn mức trong 30 ngày, không tự cấp lại 2.000/200 mỗi ngày.
Hạn mức là request API, không phải số người dùng hoặc năng lực truy cập đồng thời.
Ví dụ 18 Places + 3 tuyến/người/tháng: tối đa 66 người cho đợt Free,
1.000 / 3.333 / 13.333 người cho ba gói trả phí, nếu chỉ có loại tiêu thụ giả định này.
Khách dùng 200 Places + 20 tuyến mỗi ngày sẽ dùng hết Free sau 10 ngày.

## 2. Bảng so sánh của hội thoại, tính lại phần trăm

| Places + tuyến/tháng | MapsLibVN USD | Google USD | VIETMAP USD xấp xỉ | Thấp hơn Google | Thấp hơn VIETMAP |
|---|---:|---:|---:|---:|---:|
| 30.000 + 3.000 | 25 | 39,62 | 63,46 | 36,90% | 60,61% |
| 100.000 + 10.000 | 100 | 248,10 | 211,54 | 59,69% | 52,73% |
| 400.000 + 40.000 | 400 | 1.254,10 | 846,15 | 68,10% | 52,73% |

| Workload tương ứng | MapsLibVN VND | Google VND | VIETMAP VND |
|---|---:|---:|---:|
| Starter | 650.000 | 1.030.120 | 1.650.000 |
| Professional | 2.600.000 | 6.450.600 | 5.500.000 |
| Business | 10.400.000 | 32.606.600 | 22.000.000 |

Giả định: Places = 80% Autocomplete per-request + 20% Geocoding, tuyến cơ bản
hai điểm; Google đã trừ free cap theo SKU, áp dụng bậc giá; VIETMAP 50đ/transaction,
1 request = 1 transaction ở workload này, sau giai đoạn dùng thử. Chưa tính tiles,
map loads, Places Details, Matrix, navigation, thuế, ưu đãi hoặc hợp đồng riêng.
Không quảng cáo tỷ lệ này cho mọi workload hay khách còn trong hạn mức miễn phí.
Nguồn đã đối chiếu trong hội thoại ngày 14/09/2026:
- https://developers.google.com/maps/billing-and-pricing/pricing
- https://maps.vietmap.vn/web
- https://maps.vietmap.vn/docs/map-api/console/request-to-transaction/

## 3. Kiểm tra mã nguồn tại HEAD 0b90504

Đây là rà soát tĩnh + hồ sơ trong repo; không phải kiểm chứng CI, registry hay production mới.

| Thành phần | Bằng chứng hiện có | Khoảng thiếu |
|---|---|---|
| API/SDK | Places, directions; bốn SDK core/web/react/react-native; docs và Playground | Kiểm registry/cài mới và production khớp phiên bản mở bán; benchmark theo use case khách |
| Tenant/key | `db/migrations/0005_tenant.sql`, `apps/api/src/auth.ts`; hash key, scopes, origin, revoke | Plan chỉ internal/free/paid; chưa có ba tier, subscription, trial expiry trong auth/schema đã rà |
| Quota | `apps/api/src/quota.ts`; production config `apps/api/wrangler.toml` bật QUOTA_ENABLED=1 | Mặc định 20.000/2.000 mỗi ngày; KV get rồi put theo key, ngưỡng chặn 2×; chưa có quota tháng/tổng trial/cộng nhiều key theo thuê bao |
| Analytics | `apps/api/src/analytics.ts`, báo cáo tuần | Telemetry không thay thế sổ tiêu thụ bền vững và đối soát thanh toán |
| Console | `apps/admin/src/app.tsx` chỉ duyệt POI; docs `khoa-api.md` hướng dẫn xin key bằng email | Chưa thấy tài khoản khách, dashboard hạn mức, quản lý gói, thanh toán trong các surface đã rà |
| Vận hành | Script load test, health, backup mã hoá, restore, cron, rollback | Nghiệm thu lại trên hạ tầng bán hàng: tải duy trì, backup mới, RTO/RPO, cảnh báo thật, dự phòng |
| Pháp lý | `docs/legal/checklist-phap-ly.md` | B1/B2/B4/B5/B6 còn để mở; B3 đã được PHONG chấp thuận. Checklist có câu kết cũ nói cả sáu chưa làm, cần làm sạch khi rà lại |

KV là eventually consistent, không phù hợp cho read-modify-write nguyên tử:
https://developers.cloudflare.com/kv/concepts/how-kv-works/
Không chỉ sửa hai hằng số Free rồi coi như đã hoàn thành billing.

## 4. Những quy tắc cần đặc tả trước triển khai

- ĐÃ CHỐT 15/09: chỉ trừ request thành công, gồm kết quả rỗng và cache hit;
  không trừ lỗi 4xx/5xx. Chống abuse vẫn kiểm request lỗi.
  Đơn giá giữa các endpoint, retry và tuyến nhiều điểm cần đặc tả; xem spec quota mục 6.
- Một thuê bao cộng hạn mức qua mọi key; xác định tổ chức/project, số project/key được cấp.
- Free một lần mỗi tổ chức là đề xuất; cần cơ chế xác minh/chống tạo lại tài khoản.
- Ngày bắt đầu chu kỳ, múi giờ reset, hết hạn, thanh toán trễ, nâng/hạ/hủy gói và hoàn tiền.
- ĐÃ CHỐT 15/09: hết quota chặn đúng nhóm API, popup gợi ý nâng gói hoặc mua thêm.
  Đề xuất popup đặt ở console chủ thuê bao; API trả lỗi có cấu trúc để app khách tự xử lý.
  Cảnh báo 80/100% vẫn là đề xuất.
- ĐÃ CHỐT 15/09: mua thêm **$1/1.000 Places**, **$3/1.000 tuyến**
  (26.000đ / 78.000đ theo tỷ giá tham chiếu). Thay thế các đề xuất mua thêm cũ.
  Cần đặc tả thời hạn lượt mua thêm, thứ tự trừ và điều kiện mua khi trial/hết thuê bao.
- Tiles/map loads/băng thông/PMTiles: phạm vi bao gồm, fair-use, chi phí và quyền truy cập;
  chưa hứa không giới hạn. Request đọc archive trực tiếp cần được tính trong mô hình chi phí.
- RPS/burst theo gói, độ phức tạp tuyến, thời gian phản hồi, ngày lễ và SLA Business chưa chốt.
- ĐÃ CHỐT 15/09: hỗ trợ online Professional/Business T2–T6 **08:00–20:00**,
  T7/CN **08:00–17:00**, giờ Việt Nam (Asia/Ho_Chi_Minh). Starter không support online.
- Đồng tiền thu cố định, VAT, chứng từ, chính sách hoàn tiền; rà cùng đơn vị chuyên môn.

Lưu ý cơ cấu giá (giữ nguyên giá PHONG chốt): 4 Starter = $100, tổng 120.000/12.000,
nhiều lượt hơn Professional $100 (100.000/10.000). Professional cần giá trị hỗ trợ/quản trị
rõ ràng. 4 Professional = Business cả về giá và quota; Business cần quyền lợi rõ ràng
nếu định vị cao hơn. Không tự hứa SLA hoặc support 24/7.

## 5. Thứ tự thực hiện đề xuất

1. Đặc tả entitlement, metering và vòng đời thuê bao; đóng các quy tắc mục 4.
2. Xây sổ tiêu thụ bền vững + quota nguyên tử theo thuê bao, trial 30 ngày, reset chu kỳ;
   kiểm đồng thời, nhiều key, đổi ngày/tháng, retry, lỗi và thu hồi quyền.
3. Xây console tối thiểu: đăng ký/xác minh/đăng nhập, tổ chức, key, usage, ngày hết hạn,
   gói hiện tại. Có admin khách hàng, lịch sử thay đổi và điều chỉnh có lý do.
4. Thu tiền: pilot có thể chuyển khoản + đối soát/kích hoạt thủ công có audit; mở tự phục vụ
   cần payment integration, webhook xác thực và idempotent, gia hạn/hết hạn, lịch sử giao dịch.
5. Song song: hoàn tất checklist trước thu phí; hạ tầng phù hợp, backup/restore drill,
   cảnh báo, đo tải và chi phí với khách dùng hết quota; hoàn thiện tài liệu/support/trang giá.
6. Pilot đề xuất 3–5 doanh nghiệp có workload thật: tích hợp → trả tiền → dùng quota → gia hạn.
   Đo thời gian tới request đầu tiên, tỷ lệ trial→paid, latency/error, chi phí và giờ support.
7. Mở rộng tự phục vụ khi toàn luồng có bằng chứng production và ngân sách phục vụ.

Không cần xây Matrix, tối ưu đội xe, traffic live hoặc thêm SDK mới chỉ để bắt đầu pilot;
chọn bổ sung theo nhu cầu trả tiền đã xác nhận. Chưa có hoá đơn/cost benchmark để kết luận có lãi.
Lợi nhuận = doanh thu trừ hạ tầng, cập nhật dữ liệu, thanh toán, hỗ trợ, vận hành và chi phí chung.

## 6. Điểm tiếp tục

Việc tiếp theo đề xuất: viết spec thương mại hoá cho mục 1–2, dùng bảng giá mục 1 làm nguồn chuẩn.
Phiên này chỉ lưu quyết định và rà soát khoảng thiếu, chưa triển khai billing/console/quota mới.

## 7. Cập nhật quyết định 15/09/2026

PHONG xác nhận B1/B2/B4 OK, B5 pass giai đoạn đầu với hạ tầng tại nhà, B6 mua tên miền sau.
Mục 3 là snapshot rà soát ngày 14/09; trạng thái checklist mới theo cập nhật này và file pháp lý.
Tiles/lượt mở bản đồ/băng thông phải được thiết kế để nằm trong gói; chưa chốt số lượng.
Đề xuất đo bytes CDN thực giao (kể cả cache hit), định nghĩa phiên mở bản đồ, đo workload SDK
pan/zoom trước khi ấn định trần; không quy đổi 1 tile thành 1 lần mở bản đồ hoặc hứa vô hạn.
Ngày reset, nâng/hạ gói, đồng tiền thanh toán vẫn chưa có lựa chọn cụ thể từ PHONG.
Đề xuất: chu kỳ theo ngày kích hoạt hàng tháng; quota Free theo ngày reset 00:00 VN,
trial hết sau 30 ngày và không reset tổng; nâng gói tính chênh lệch/giữ usage, hạ gói kỳ sau.
Chưa triển khai các đề xuất hoặc sửa runtime quota trong phiên giải thích này.
