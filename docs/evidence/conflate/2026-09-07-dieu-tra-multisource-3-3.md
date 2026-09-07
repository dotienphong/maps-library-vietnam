# Điều tra `multiSourcePct` 3,3 % — vì sao conflate bỏ sót trùng lặp

Ngày: 07/09/2026. Đo trên **DB production, chỉ đọc**, qua Cloudflare Tunnel.
Bối cảnh: khi làm profile nguồn POI (spec `2026-09-07-poi-sources-profile-design.md`) phát hiện
"Chợ Bến Thành" (osm) và "Ben Thanh Market" (fsq) là cùng một chỗ mà không được ghép. Nếu
`primary_source` không đáng tin thì động cơ "Overture/FSQ nhiễu hơn OSM" chưa có cơ sở.

**Đây là báo cáo điều tra. KHÔNG sửa `conflate.mjs` trong lần này.**

## 1. Conflate có ghép — nhưng ghép ít

| Số POI theo số nguồn | POI |
|---|---:|
| 1 nguồn | 1.471.548 (96,65 %) |
| 2 nguồn | 46.212 |
| 3 nguồn | 4.656 |

`poi_source_link` role `secondary`: osm 18.151, overture 12.509, fsq 30.540 (61.200 link).
Vậy 50.868 cụm đa nguồn = **3,35 %**. Bảng `poi_work_*` đã bị dọn nên không truy được quyết định
của từng cặp; mọi số dưới đây đo trên bảng `poi` đã publish.

## 2. Đo ứng viên trùng lặp bị bỏ sót

Cặp POI **khác `primary_source`, cùng `category`, cách nhau ≤ 30 m** trong 3 lõi đô thị:

| bbox | POI | cặp | `sim ≥ 0,6` | `sim` 0,30–0,60 | `sim < 0,30` |
|---|---:|---:|---:|---:|---:|
| Q1 HCM | 30.444 | 34.037 | 534 | 1.890 | 31.613 |
| Hoàn Kiếm HN | 22.432 | 24.759 | 305 | 1.800 | 22.654 |
| Hải Châu ĐN | 11.173 | 4.930 | 81 | 418 | 4.431 |
| **tổng** | **64.049** | **63.726** | **920** | **4.108** | **58.698** |

Dải `sim < 0,30` phần lớn là địa điểm khác nhau thật (một khu phố dày có nhiều quán cùng loại
trong 30 m), không suy ra được gì. Hai dải kia mới đáng đọc.

### 2.1 Dải 0,30–0,60 — **đây là chỗ trùng lặp dồn lại**

25 cặp cao nhất ở Q1, tất cả đều **0,58–0,59**, tức **sát ngay dưới ngưỡng `sim >= 0,6`** của
`pairAllowed`. Và chúng là trùng lặp hiển nhiên:

```
0.59 16m  Phuc Long Coffee & Tea Express [overture] ↔ Phuc Long Coffee & Tea Express [fsq]
0.59 11m  BrewBliss                      [osm]      ↔ BrewBliss Coffee               [overture]
0.59 18m  BrewBliss Coffee               [fsq]      ↔ BrewBliss                      [osm]
0.58  4m  Ministop                       [overture] ↔ Mini Stop                      [fsq]
0.59  8m  InterContinental Saigon Hotel  [fsq]      ↔ Intercontinental Saigon        [overture]
0.59 17m  A Mà Kitchen Võ Văn Tần        [overture] ↔ A Mà Kitchen                   [fsq]
0.59  9m  Khách sạn Renaissance Riversid [osm]      ↔ Renaissance Riverside Hotel Sa [overture]
```

"BrewBliss" tồn tại **ba lần** (osm, overture, fsq) như ba POI riêng.

### 2.2 Dải `sim ≥ 0,6` — 920 cặp vượt ngưỡng mà vẫn không ghép

| nguyên nhân | cặp |
|---|---:|
| xung đột **số nhà** (`ha`/`hb` khác nhau) | 500 |
| xung đột **tên đường** (`sta`/`stb` khác nhau) | 594 |
| **không giải thích được** (không xung đột nào) | 73 (8 %) |

Hai luật chặn trong `pairAllowed` giải thích ~92 %. Nghĩa là **greedy/thứ tự cặp không phải nguyên
nhân chính** — chỉ 73 cặp có thể do `if (ca && cb) return` (không bắc cầu), `maxSize: 3`, hoặc bị
loại vì đã là `repOf` của cụm cùng nguồn.

> **SỬA 07/09/2026 (mục 10).** Ở bản đầu tôi suy từ số này rằng "ngưỡng similarity là nguyên nhân
> chi phối". **Kết luận đó SAI.** Đo trên bộ mẫu có nhãn (mục 10) cho thấy ngược lại: luật hiện tại
> đạt recall **4 %**, và chỉ cần bỏ hai luật chặn hn/street thì lên **44 %**. Chính hai luật chặn
> này mới là nguyên nhân chi phối — chúng chặn phần lớn là trùng lặp THẬT, vì hai nguồn thường ghi
> khác nhau cách viết số nhà và nhét tên thành phố vào trường `street`.

> Đáng cân nhắc riêng: hai POI cùng tên cách nhau < 30 m mà số nhà lệch nhau thì khả năng cao là
> **sai dữ liệu ở một nguồn**, không phải hai cửa hàng khác nhau. Luật chặn hiện tại coi đó là
> bằng chứng loại trừ. Đây là quyết định sản phẩm, không phải bug.

## 3. Cơ chế: `nameCore` chỉ bỏ filler ở ĐẦU tên

`packages/core/src/normalize.ts`: `NAME_FILLERS` có **13 từ, đều là từ thương mại tiếng Việt**
(`cong ty`, `cua hang`, `quan`, `cafe`, `coffee`…) và vòng lặp chỉ xử lý **tiền tố**
(`s.startsWith(filler + ' ')`). Không có từ chỉ **loại địa điểm**, không có tiếng Anh, không bỏ
**hậu tố**.

Dữ liệu OSM đặt từ chỉ loại ở **đầu** theo lối tiếng Việt; Overture/FSQ (gốc Meta/Microsoft) đặt ở
**cuối** theo lối tiếng Anh. Nên một bên được chuẩn hoá, bên kia không:

| `name_core` A | `name_core` B | `sim` | kết quả |
|---|---|---:|---|
| `nha hang runam bistro` → `runam bistro` | `runam bistro` | **1,00** | GHÉP — filler ở đầu, có trong danh sách |
| `brewbliss coffee` | `brewbliss` | 0,59 | BỎ SÓT — cùng từ `coffee`, nhưng ở **cuối** |
| `hoang yen buffet` | `hoang yen` | 0,59 | BỎ SÓT — `buffet` không có trong danh sách |
| `cho ben thanh` | `ben thanh market` | 0,48 | BỎ SÓT — `cho`/`market` đều không có |
| `benh vien cho ray` | `cho ray hospital` | 0,30 | BỎ SÓT — `benh vien`/`hospital` đều không có |
| `intercontinental saigon hotel` | `intercontinental saigon` | **0,80** | GHÉP — tên riêng dài nên hậu tố loãng đi |

Quy luật: **tên riêng càng ngắn thì một từ chỉ loại ở cuối càng phá similarity.** Thêm `coffee`
(6 ký tự) vào `brewbliss` (9 ký tự) đổi tỉ lệ trigram nhiều hơn thêm `hotel` vào
`intercontinental saigon`. Đó là lý do dải trùng lặp dồn đúng vào 0,58–0,59.

## 4. Thử ba phương án trên cùng bộ mẫu

8 ca **dương** (trùng lặp thật, phải ghép) + 2 ca **đối chứng âm** (địa điểm khác nhau, phải KHÔNG
ghép): `Amazing Specialty Coffee` ↔ `Shin Specialty Coffee`, `Hà Ký Mì Gia` ↔ `Lưu Ký Mì Gia`.

| phương án | ca dương | ca âm | tổng |
|---|---:|---:|---:|
| hiện tại: `similarity` + filler chỉ ở đầu | 0/8 | 2/2 | **2/10** |
| đổi sang `word_similarity` | 6/8 | **0/2** | 6/10 |
| bỏ từ chỉ loại ở **cả hai đầu**, hai ngôn ngữ | 5/8 | **2/2** | **7/10** |

**`word_similarity` phải loại.** Nó khớp theo cụm con nên một cụm chỉ-loại dùng chung đủ để vượt
ngưỡng: `amazing specialty coffee` ↔ `shin specialty coffee` = **0,81**;
`ha ky mi gia` ↔ `luu ky mi gia` = **0,77**. Ghép sai làm mất POI riêng biệt — tệ hơn bỏ sót.
(Ghi lại vì đây là hướng trực giác đầu tiên của tôi và nó **sai**; toán tử này tốt cho search vì ở
đó "khớp rộng" chỉ ảnh hưởng thứ tự gợi ý, không phá dữ liệu.)

Bỏ từ chỉ loại là phương án duy nhất **vừa cứu ca dương vừa giữ ca âm** — vì nó bóc phần dùng
chung và để lại đúng phần phân biệt: `amazing` ↔ `shin` = 0,00; `ha ky` ↔ `luu ky` = 0,30.

Ba ca còn sót và lý do:

- `ministop` ↔ `mini stop` = 0,58 — chỉ khác **khoảng trắng**. Cần thêm một phép so bỏ hết khoảng
  trắng; rẻ.
- `a ma kitchen vo van tan` ↔ `a ma` — `kitchen` nằm **giữa** chuỗi nên không bị bóc, cộng thêm
  hậu tố chi nhánh `vo van tan`. Cần bóc từ chỉ loại ở giữa và xử lý hậu tố tên đường; khó hơn.
- `ngu hai xanh` ↔ `dai ngu` — nhìn lại thì **có thể không phải trùng lặp thật**; tôi gán nhãn
  dương chỉ vì cách 28 m và cùng category, bằng chứng yếu. Không tính là thất bại.

## 5. Rủi ro của phương án được đề xuất — chưa giải quyết

1. **Danh sách từ tôi dùng để thử là quá mạnh.** Nó có `saigon`, `specialty`, `express`. Bóc
   `saigon` làm `Ono Saigon Hotel` → `ono` (đúng ở ca này) nhưng cũng làm `Pizza Saigon` →
   `pizza` và `Pizza Hanoi` → `pizza` → **ghép sai**. Bộ đối chứng âm của tôi không phủ ca này.
   Bản thật cần danh sách được biên tập cẩn thận, tách "từ chỉ loại" khỏi "từ chỉ địa danh".
2. **`nameCore` dùng chung với autocomplete và search.** `apps/api/src/autocomplete-sql.ts` gọi
   `nameCore(query)` cho nhánh core. Đổi nó là đổi hành vi tìm kiếm, nên phải đo lại `hit@3` trên
   `scripts/fixtures/fuzzy-queries.txt` (baseline 38/40) và cổng p95. An toàn hơn: thêm một hàm
   riêng cho conflate (`conflateKey`) và **không** đụng `nameCore`.
3. Đổi conflate là **rebuild toàn bộ `poi`**: `poi.id` sinh từ `hash(primary_source, source_id)`
   nên gộp thêm sẽ **đổi id** của các POI bị hợp nhất. Ảnh hưởng client đã lưu id, và ảnh hưởng
   `poi_edit.poi_id` của đóng góp M4. Cần đường di trú, không chỉ đổi ngưỡng.

## 6. Kết luận cho câu hỏi ban đầu

`primary_source` **không** phải thước đo chất lượng: nó chỉ nói nguồn nào thắng trong một cụm, và
~4.100 cặp chỉ trong 3 lõi đô thị cho thấy nhiều địa điểm còn tồn tại **song song ở nhiều nguồn**
như nhiều POI riêng. Vì vậy quyết định giữ mặc định `all` (07/09) là đúng: lọc theo nguồn là công
tắc chọn dữ liệu, **không** phải công cụ nâng chất lượng.

Muốn thật sự nâng chất lượng thì thứ tự đúng là: (1) **nới hai luật chặn hn/street** và sửa khoá so
tên cho conflate, (2) rebuild và đo lại `multiSourcePct`, (3) khi đó mới bàn tới ngưỡng
`quality_score` theo nguồn. Thứ tự ưu tiên trong (1) đã được đo ở mục 10: nới luật chặn cho hiệu
quả lớn hơn sửa khoá tên.

## 7. Cách tái lập

Mọi số ở trên lấy bằng script đọc-thuần chạy trong container pipeline với
`openDatabaseTunnel()` (`scripts/lib/tunnel.mjs`), `SET statement_timeout = '180s'`, không câu lệnh
ghi nào. Script là tạm, không commit; các truy vấn nằm nguyên văn trong tài liệu này.

---

## 8. Thử dựng bộ mẫu có nhãn tự động — **THẤT BẠI, đừng làm lại**

Mục 4 chỉ có 8 ca dương + 2 ca âm do tôi tự chọn, và tôi đã tự nêu là quá nhỏ (không phủ được lớp
lỗi `saigon`). Nên thử dựng bộ mẫu lớn với **nhãn độc lập với tên**: hai POI dùng chung **số điện
thoại** hoặc **tên miền** thì coi là cùng một chỗ.

Điều kiện thuận lợi: phone phủ tốt — trong bbox HCM 0,2°×0,2° có 339.569 POI active thì 225.205
(66 %) có phone, 138.982 (41 %) có website.

**Lần 1 — dùng chung phone/website, không điều kiện gì thêm:** 950 cặp dương trên 3 lõi đô thị.
Nhìn vào thì nhãn **sai hàng loạt**:

```
Atlantic Hotel [fsq]           ↔ Ibiz Hotel [overture]              ← hai khách sạn khác nhau
Vietnam Vespa Adventures [fsq] ↔ Zoom Cafe [overture]               ← hai doanh nghiệp khác nhau
Little Hanoi Diamond [fsq]     ↔ Khach San Lucky Star [overture]     ← khác nhau
```

Nguyên nhân: **số tổng đài đại lý booking** và **domain của chuỗi thương hiệu** (mọi chi nhánh
Highlands Coffee dùng chung `highlandscoffee.com.vn`).

**Lần 2 — thêm điều kiện hiếm, chỉ nhận số/domain xuất hiện ĐÚNG 2 lần trong vùng:** 950 → 393 cặp.
Phân bố tần suất trong 3 lõi: 44.522 giá trị dùng 1 lần, 2.778 dùng 2 lần, 412 dùng 3 lần, 104 dùng
> 5 lần. Nhưng nhãn **vẫn nhiễu khoảng một nửa**:

| đúng | sai |
|---|---|
| `Kichi Kichi Vincom` ↔ `Nha Hang Kichi-Kichi` | `Millennium Boutique Hotel` ↔ `Adora Mira Hotel` |
| `Akatonbo Le Thanh Ton` ↔ `Nhà Hàng Chuồn Chuồn Đỏ` (dịch nghĩa) | `Hanoi Focus Hotel` ↔ `Parklane Hanoi Hotel` |
| `Shelter coffee` ↔ `Shelter Coffee and Tea` | `Royal Saigon Hotel` ↔ `Cicilia Saigon Hotel and Spa` |
| `Le Duy Hotel Ho Chi Minh City` ↔ `Khách Sạn Lê Duy` | `Alagon City Point Hotel & Spa` ↔ `Alagon Plus Hotel and Spa` |
| `矢澤 - Yazawa` ↔ `Yakiniku Yazawa Saigon` | `Khách Sạn Hoàng Ngân` ↔ `Gia Linh Hotel` |

**Kết luận: phone/domain KHÔNG dùng được làm nhãn tự động cho bài này.** Khách sạn và nhà nghỉ nhỏ
ở Việt Nam dùng chung số thật — cùng chủ, chung lễ tân, hoặc qua đại lý. Lọc theo tần suất giảm
nhiễu nhưng không khử được, vì hai khách sạn cùng chủ chỉ dùng số đó đúng 2 lần.

Đáng chú ý: `pairAllowed` **đã** dùng chính tín hiệu này để nới ngưỡng (`sim >= 0.45 && shared`).
Kết quả đo ở đây cho thấy đó là chỗ có thể sinh **ghép sai**, nên nếu sau này nới thêm ngưỡng thì
đừng dựa vào `shared`.

Một ca sạch đáng ghi: `Chả Cá Thăng Long` [fsq] ↔ `Chả cá Thăng Long` [overture], cách 11 m, chỉ
khác chữ hoa/thường nên `name_norm` **giống hệt** (`sim` = 1,00) mà vẫn là hai POI riêng. Nó nằm
trong nhóm 920 cặp ở mục 2.2, tức bị chặn bởi xung đột số nhà hoặc tên đường — bằng chứng cho thấy
hai luật chặn đó có giá thật, không chỉ lý thuyết.

## 9. Việc tiếp theo cần người quyết

Bước kế tiếp bắt buộc là **bộ mẫu gán nhãn tay** — không có đường tự động nào đáng tin. Đề nghị:
lấy mẫu phân tầng theo dải `sim` (ví dụ 40 cặp mỗi dải 0,3–0,4 / 0,4–0,5 / 0,5–0,6 / ≥0,6), gán
nhãn tay, PHONG soát lại. Chỉ khi có bộ đó mới đo được một khoá so tên mới cho tử tế; nếu không thì
mọi con số "7/10" như mục 4 chỉ là mẫu 10 cặp, không đủ để chốt danh sách từ chỉ loại.

Không viết spec sửa conflate trước khi có bộ mẫu này, vì rủi ro #3 (đổi `poi.id`) khiến việc này
chỉ nên làm một lần cho đúng.

---

## 10. Bộ mẫu 160 cặp gán nhãn tay — và một kết luận của tôi bị đảo

Fixture: `pipelines/poi/fixtures/conflate-pairs.json`.

### 10.1 Cách lấy mẫu

7 vùng (Q1-HCM, Hoàn Kiếm-HN, Hải Châu-ĐN, Ninh Kiều-CT, Nha Trang, Biên Hoà, Thủ Đức ngoại vi) →
94.013 POI active → 153.263 ứng viên (khác nguồn, cùng `category`, ≤ 50 m). Tính `sim` **đúng như
conflate**: `similarity(name_core, name_core)` do Postgres tính. Chia 4 dải, mỗi dải lấy 40 cặp
theo thứ tự `md5(tên A|tên B)` — **tất định, tái lập được**, không phụ thuộc thứ tự đọc DB.

### 10.2 Nhãn

Nhãn do Claude gán, ba giá trị. **PHONG cần soát lại**, nhất là 27 ca `khong_ro`.

| dải `sim` | cùng | khác | không rõ |
|---|---:|---:|---:|
| 0,30–0,40 | 5 | 27 | 8 |
| 0,40–0,50 | 16 | 18 | 6 |
| 0,50–0,60 | 23 | 7 | 10 |
| ≥ 0,60 | 35 | 2 | 3 |
| **tổng** | **79** | **54** | **27** |

Hai ca `khác` ở dải ≥ 0,60 là dương tính giả cần nhớ: `Ủy Ban Nhân Dân Phường Bến Thành` ↔
`Uy Ban Nhan Dan Phuong Ben Nghe` (sim 0,62 — **hai phường khác nhau**) và `P’Tea&coffee` ↔
`Haué Coffee & Tea` (0,61). Loại `khong_ro` gồm: một bên là **một phòng** trong khách sạn
(`Room B601`), một bên là **đơn vị trong** tổ chức (`Khoa Hóa` trong trường đại học), tên chung
(`Nhà thuốc`), và chuỗi có hai cơ sở cách nhau vài chục mét.

### 10.3 Đo các luật trên 133 cặp đã quyết (79 cùng / 54 khác)

| luật | TP | FN | FP | TN | precision | recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| **A. hiện tại (nguyên trạng)** | 3 | 76 | 0 | 54 | 100 % | **4 %** | 0,07 |
| B. bóc từ chỉ loại + `sim ≥ 0,6`, giữ chặn nguyên trạng | 14 | 65 | 0 | 54 | 100 % | 18 % | 0,30 |
| **C. bóc từ chỉ loại + `sim ≥ 0,6`, BỎ hết chặn** | 47 | 32 | 1 | 53 | 98 % | **59 %** | **0,74** |
| D. bóc + `sim ≥ 0,6`, chặn "khôn" | 36 | 43 | 1 | 53 | 97 % | 46 % | 0,62 |
| E. bóc + `sim ≥ 0,5`, chặn "khôn" | 46 | 33 | 4 | 50 | 92 % | 58 % | 0,71 |
| F. bóc + `sim ≥ 0,45`, chặn "khôn" | 48 | 31 | 4 | 50 | 92 % | 61 % | 0,73 |
| `word_similarity` trên core `≥ 0,6`, giữ chặn | 30 | 49 | 11 | 43 | 73 % | 38 % | 0,50 |

"Chặn khôn" = chỉ chặn theo số nhà khi **cả hai** là số đơn giản (`^\d{1,4}$`) và khác nhau; bỏ qua
xung đột `street` khi một bên là giá trị rác (chứa `ho chi minh`, `ha noi`, `district`, `ward`…).

### 10.4 Kết luận — ngược với bản đầu của tài liệu này

**Luật hiện tại bắt được 3 trong 79 cặp trùng lặp thật: recall 4 %.** Precision 100 %, nên nó không
ghép sai — nó chỉ gần như không ghép gì.

**Nguyên nhân chi phối là hai luật chặn `housenumber`/`street`, không phải ngưỡng similarity.** Chỉ
bỏ hai luật chặn (không đổi gì khác) đã đưa recall từ 4 % lên 44 %; thêm việc bóc từ chỉ loại thì
lên 59 % với precision 98 %. Ở mục 2.2 tôi có sẵn con số "92 % bị chặn bởi hn/street" nhưng suy ra
kết luận ngược — đã sửa tại chỗ.

Vì sao hai luật chặn phản tác dụng: hai nguồn ghi **cùng một địa chỉ theo cách khác nhau**
(`171`/`71`, `48`/`44-46`, `8-10`/`8`, `3`/`3A`), và Overture/FSQ **nhét tên thành phố vào trường
`street`** (`st:Đồng Khởi/Ho Chi Minh C`). Luật hiện tại coi mọi khác biệt đó là bằng chứng "hai
địa điểm khác nhau".

Đáng chú ý: "chặn khôn" của tôi vẫn làm mất recall (59 % → 46 %), tức heuristic đó **vẫn chặn oan
13 cặp thật**. Nên phương án C (bỏ hết chặn) đang là tốt nhất đo được — nhưng bỏ hoàn toàn một luật
an toàn là quyết định cần cân nhắc, không nên chốt từ 133 cặp.

### 10.5 Lớp nhiễu thứ hai, chưa xử lý: hậu tố chi nhánh và mô tả

31–32 ca vẫn bỏ sót ở phương án tốt nhất, và chúng có dạng rất đều:

```
sim_bóc 0.41  ibis Styles Hotels             ↔ ibis Styles Nha Trang
sim_bóc 0.22  Punto Hostel Ho Chi Minh City  ↔ punto hostel
sim_bóc 0.48  Khách sạn Lotus Central Saigon ↔ Lotus Central Hotel
sim_bóc 0.41  Phở 24 - Đồng Khởi             ↔ Phở 24
sim_bóc 0.36  Tenement Coffee and Wine Bar   ↔ Tenement Coffee Shop
sim_bóc 0.32  Royal Norwegian Consulate      ↔ Consulate of the Kingdom of Norway
```

Hai nhóm: **hậu tố địa danh/chi nhánh** (`Nha Trang`, `Ho Chi Minh City`, `Saigon`, `Đồng Khởi`) và
**hậu tố mô tả** (`and Wine Bar`, `Craft beer & Viet Nam Cuisine`).

Bóc hậu tố địa danh là chỗ tôi đã cảnh báo ở mục 5 rủi ro #1 (`Pizza Saigon` ↔ `Pizza Hanoi`). Cách
gỡ có nguyên tắc, **chưa đo**: chỉ bóc từ chỉ địa danh khi nó **trùng với `ward`/`province`/`street`
của chính POI đó** — tức là thông tin vị trí lặp lại, không phải phần của thương hiệu. `ibis Styles
Nha Trang` nằm ở Nha Trang → bóc; `Pizza Saigon` nằm ở Hà Nội → giữ.

Ca `Royal Norwegian Consulate` ↔ `Consulate of the Kingdom of Norway` thì trigram không giải được —
cần so theo **tập token**, việc riêng.

### 10.6 Giới hạn của bộ mẫu này

- 160 cặp, nhãn do Claude gán, **chưa được người soát**. Mọi con số ở 10.3 phải đọc kèm điều đó.
- Chỉ lấy cặp ≤ 50 m **cùng `category`**. Cặp bị lệch category ở hai nguồn không có trong mẫu, nên
  không nói được gì về `pairAllowed` ở phần group.
- 7 vùng, phần lớn là lõi đô thị. Không suy ra tỉ lệ toàn quốc từ đây.
- Không đo `maxSize`/thứ tự greedy vì fixture là từng cặp rời, không phải cụm.
