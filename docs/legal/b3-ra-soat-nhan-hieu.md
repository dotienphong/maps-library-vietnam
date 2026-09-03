# B3 — Rà soát nhãn hiệu tên "MapsLibVN"

*Checklist mục B3. Lập 04/09/2026. **Không phải ý kiến pháp lý** — đây là phần chuẩn bị hồ sơ để
PHONG gửi luật sư và gửi MapLibre; kết luận cuối cùng phải do người có thẩm quyền đưa ra.*

## 1. Kết luận ngắn

Rủi ro **thấp đến trung bình**, và điểm yếu **không nằm ở bản thân cái tên** mà ở cách trình bày:
nếu tài liệu để người đọc hiểu MapsLibVN là sản phẩm chính thức hay có liên kết với MapLibre thì
đó mới là chỗ dễ bị phản đối. Hai việc còn lại bắt buộc phải do người làm: **tra cứu cơ sở dữ
liệu nhãn hiệu** và **gửi thư hỏi MapLibre** (mẫu ở mục 5).

## 2. Sự thật đã xác minh (04/09/2026)

| Điều | Kết quả | Nguồn |
|---|---|---|
| MapLibre có chính sách nhãn hiệu công khai không? | **Không.** `maplibre.org/trademark-policy` trả 404; repo quản trị `maplibre/maplibre` có `CHARTER.md`, `INTELLECTUAL_PROPERTY_VIOLATION_POLICY.md`, `AI_POLICY.md`… nhưng **không có** trademark/naming policy | github.com/maplibre/maplibre |
| Ai nắm nhãn hiệu | Open Source Collective (fiscal host của MapLibre); nhãn hiệu "MapLibre" đã đăng ký ở nhiều khu vực tài phán | maplibre.org/news (newsletter 02/2023), maplibre.org/about |
| Điều lệ nói gì về tên | Chỉ một câu định nghĩa: *"MapLibre: As a single word, 'MapLibre' is a brand name used by the front-end map rendering MapLibre projects (i.e. code libraries)."* | `CHARTER.md` |
| Ràng buộc từ giấy phép mã nguồn | `maplibre-gl` là **BSD-3-Clause**, điều khoản 3: *"Neither the name of MapLibre GL JS nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission."* | `THIRD_PARTY_NOTICES.md` mục 4.1 |
| Giấy phép wrapper React Native | `@maplibre/maplibre-react-native` 11.3.8 là **MIT** — không có điều khoản hạn chế tên | `LICENSE.md` của gói |
| Tên gói npm còn trống không? | **Còn trống toàn bộ**: `@mapslibvn/core`, `/web`, `/react`, `/react-native`, `/style` và cả tên trần `mapslibvn` đều trả 404 trên registry | registry.npmjs.org, kiểm 04/09/2026 |

## 3. Đánh giá rủi ro

**Thuận lợi cho MapsLibVN**

- Tên **không chứa chuỗi "MapLibre"**. Phần trùng chỉ là "Map" (từ mô tả, tính phân biệt rất yếu
  trong lĩnh vực bản đồ) và "Lib" (viết tắt phổ thông của *library*).
- Phát âm và hình thái khác rõ: MapLibre kết bằng "libre" (tiếng Pháp/Tây Ban Nha: *tự do*),
  MapsLibVN kết bằng "LibVN" với hậu tố quốc gia.
- Điều khoản 3 của BSD-3 cấm dùng tên *"MapLibre GL JS"* để **endorse/promote** — MapsLibVN chỉ
  nhắc tên để mô tả nguồn gốc kỹ thuật, thuộc phạm vi "reasonable and customary use in describing
  the origin", không phải endorsement.

**Bất lợi**

- **Cùng nhóm hàng hoá/dịch vụ** (thư viện vẽ bản đồ, phần mềm — Nice 9 và 42). Cùng lĩnh vực làm
  ngưỡng "khả năng gây nhầm lẫn" thấp xuống đáng kể so với hai bên khác ngành.
- MapsLibVN **được xây trên** MapLibre, nên người đọc lướt dễ suy diễn có quan hệ chính thức —
  đây là loại nhầm lẫn mà luật nhãn hiệu quan tâm nhất (nhầm lẫn về *liên kết/tài trợ*).
- MapLibre **không có** chính sách công khai để đối chiếu, nên không thể tự khẳng định "đã tuân
  thủ"; chỉ có thể hỏi trực tiếp.

## 4. Đã làm để giảm rủi ro (04/09/2026)

- `THIRD_PARTY_NOTICES.md` (và 4 bản sao trong gói SDK) thêm dòng miễn trừ: MapsLibVN **không liên
  kết với, không được tài trợ hay chứng thực bởi** MapLibre; tên MapLibre chỉ dùng để mô tả nguồn
  gốc kỹ thuật.
- Kiểm và ghi nhận: repo **không dùng logo, bộ màu hay nhận diện** của MapLibre ở bất kỳ đâu; mọi
  chỗ nhắc tên đều ở dạng mô tả ("bọc `@maplibre/maplibre-react-native`", "MapLibre Native đọc
  `pmtiles://`").

## 5. Việc tay còn lại — chỉ người làm được

**5.1 Tra cứu nhãn hiệu** (không tự động hoá được, hai cơ sở dữ liệu đều là ứng dụng JS)

- WIPO Global Brand Database — https://branddb.wipo.int — tra "MapsLibVN", "MapsLib", "MapLibre",
  nhóm Nice 9 và 42.
- Cục Sở hữu trí tuệ Việt Nam — http://wipopublish.ipvietnam.gov.vn — tra tương tự cho phần Việt Nam.
- Ghi kết quả (có/không đơn trùng hoặc tương tự) vào bảng mục 2.

**5.2 Gửi thư hỏi MapLibre** — địa chỉ `team@maplibre.org`. Mẫu:

```
Subject: Trademark question — naming an open-source library "MapsLibVN" built on MapLibre

Hello MapLibre team,

I maintain an open-source map library for Vietnam called MapsLibVN. It is built on top of
MapLibre GL JS and @maplibre/maplibre-react-native, and serves Vietnamese basemap tiles and a
places API.

I could not find a published trademark or naming policy on maplibre.org or in the
maplibre/maplibre governance repository, so I would like to ask directly:

1. Do you have any objection to the project name "MapsLibVN" and the npm scope "@mapslibvn",
   given that the project is built on MapLibre but is not affiliated with it?
2. Is the wording we use acceptable — we describe the packages as "wrapping
   @maplibre/maplibre-react-native" and state explicitly that MapsLibVN is not affiliated with,
   sponsored by, or endorsed by MapLibre?
3. Is there a naming or attribution guideline you would prefer downstream projects to follow?

We do not use the MapLibre logo, wordmark styling, or brand colors anywhere.

Thank you,
Đỗ Tiến Phong — MapsLibVN
```

**5.3 Quyết định sau khi có trả lời**

- Không phản đối → đánh dấu B3 xong, publish 4 gói npm.
- Có phản đối → đổi tên **trước khi publish**. Chi phí đổi lúc này còn rẻ: chưa có gói nào trên
  npm, chưa có tên miền riêng (B6 chưa làm), người dùng ngoài chưa có. Việc phải đổi nếu xảy ra:
  scope npm, `package.json` 5 gói, chuỗi attribution, tiêu đề docs, tên biến `MapsLibVN*` trong SDK.

## 6. Cần hỏi luật sư cùng lúc (gộp với B1/B2/B4)

Cái tên có phải đăng ký nhãn hiệu tại Việt Nam trước khi mở thương mại hoá không, và nếu MapLibre
không phản đối thì thư trả lời đó có giá trị đến đâu (thư đồng ý không phải là li-xăng nhãn hiệu).
