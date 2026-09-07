# Chuẩn bị cho các quyết định còn treo của 8.3/8.4 (07/09/2026)

Số liệu: [`8-3-decision-prep.json`](8-3-decision-prep.json). Toàn bộ chạy **chỉ đọc** trên production
qua container pipeline (bảng trung gian TEMP), overlap tái tạo bằng **đúng SQL** của
`admin-overlay.mjs` (26.972 cạnh). Mục tiêu: mỗi quyết định trong mục 6 hồ sơ
[8.3/8.4](8-3-8-4-coverage-production.md) có số cụ thể để quyết, thay vì quyết trên mô tả. Không mục
nào dưới đây đã được sửa vào code hay gate — đó là việc của PHONG.

## A. 60 `raw_coverage_gap` — tất cả là nước, không có lỗ đất liền

Câu hỏi: phần vùng cũ **không được vùng hiện hành phủ** là biển/đầm phá, hay là đất mà dữ liệu hiện
hành bị hở? Thước đo đầu tiên (phần nằm ngoài hợp L4 hiện hành) **không dùng được**: L4 hiện hành cũng
bao lãnh hải, nên 55/60 cho "ngoài đất = 0" kể cả Cô Tô với gap 0,961. Thước đo dùng được là **POI**:
biển không có POI, đất có. Với mỗi vùng: cắt phần không phủ, `ST_Subdivide`, đếm POI, so mật độ với
phần được phủ của chính vùng đó.

| Phân loại | Số vùng | Nghĩa |
|---|---:|---|
| ≤ 0,5 POI/km² trong phần không phủ | **42** | nước trống |
| mật độ < 10 % phần được phủ | **13** | vịnh có cầu tàu/nhà nổi (Hạ Long, Cát Bà, Thuận Hóa) |
| cần nhìn | **5** | Cát Hải, Gia Luận, Việt Hải, Nghĩa Lộ (Hải Phòng), Hương Phong (Huế) |

Năm vùng "cần nhìn" đều có mật độ tuyệt đối **≤ 2,3 POI/km²** (đất đô thị thật là hàng trăm) và đều
là quần đảo Cát Bà–Cát Hải hoặc đầm phá Tam Giang; Gia Luận và Việt Hải nằm trong vườn quốc gia nên
phần được phủ cũng gần rỗng (0,49 và 1,03 POI/km²), tỷ số không nói lên gì. Không vùng nào có dấu
hiệu là đất đô thị bị hở. Riêng L4 Tỉnh Ninh Thuận gap 0,572 với 4.478 km² không phủ và 17 POI: L4
Khánh Hòa hiện hành được `bootstrapMissingProvince` dựng từ hợp các xã nên **không có lãnh hải**, còn
polygon Ninh Thuận cũ thì có — cùng một hiện tượng.

**Hai cách đóng, PHONG chọn một:**

1. *Chấp nhận có luật*: ghi quyết định QA "gap ven biển được chấp nhận khi phần không phủ có
   ≤ N POI/km²" vào report (giống `acceptedQa`), evaluator đọc và không đếm là failure. Không đổi dữ liệu.
2. *Sửa mẫu số*: cắt polygon cũ theo hợp L8 hiện hành cùng tỉnh trước khi tính `rawCoverage`. Đổi
   code overlay, làm 60 vùng này về ≈ 1,0, nhưng cũng che luôn mọi lỗ đất liền thật trong tương lai —
   nên nếu chọn cách này phải giữ một chỉ số phụ đo phần bị cắt.

Tôi nghiêng về cách 1: nó không che thứ gì.

## B. 1.970 cảnh báo `discarded_sliver` — 92 % là nhiễu hình học

Phân bố **cạnh** L8 bị bỏ vì `raw_share < 0,05`:

| `raw_share` | cạnh | vùng cũ | tổng share bị bỏ |
|---|---:|---:|---:|
| [0 ; 0,001) | **11.064** | 3.860 | 0,31 |
| [0,001 ; 0,005) | 570 | 459 | 1,40 |
| [0,005 ; 0,01) | 168 | 159 | 1,20 |
| [0,01 ; 0,02) | 110 | 105 | 1,53 |
| [0,02 ; 0,03) | 47 | 46 | 1,16 |
| [0,03 ; 0,05) | 63 | 58 | 2,43 |

Theo vùng cũ: 4.056 vùng có ít nhất một sliver, tổng share bị bỏ **p50 = 0,0000, p90 = 0,0046, max
= 0,1225**; chỉ **11 vùng** bỏ ≥ 5 %. Evaluator cảnh báo khi `discardedShare > 0` nên nhặt cả 1e-9.

**Đề xuất:** cảnh báo chỉ khi `discardedShare ≥ 0,01` → còn **≤ 209 vùng** (số vùng có cạnh trong ba
bucket cuối, có trùng) và 11 vùng ≥ 5 % là nhóm phải có quyết định QA thật. Đây là đổi ngưỡng cảnh
báo của gate, cần PHONG duyệt; không đổi dữ liệu.

## C. Ngưỡng sliver 0,05 — hạ xuống không cứu được `hn-01`

Mô phỏng chọn đích L8 với các ngưỡng khác, so với 0,05 hiện hành:

| ngưỡng | cạnh giữ | ca tách | vùng đổi tập đích | vùng ≥ 4 đích | `hn-01` có thêm |
|---:|---:|---:|---:|---:|---|
| **0,05** | 4.527 | 282 | 0 | 2 | — |
| 0,03 | 4.590 | 331 | 58 | 6 | — |
| 0,02 | 4.637 | 365 | 101 | 7 | Hoàn Kiếm 0,029 |
| 0,01 | 4.747 | 445 | 197 | 12 | Hoàn Kiếm |
| 0,005 | 4.915 | 569 | **337** | **22** | Hoàn Kiếm + Ba Đình 0,0076 |

Muốn cả hai đích nghị quyết nêu (Hoàn Kiếm, Ba Đình) vào thì phải xuống **0,005**: 337 vùng đổi tập
đích, ca tách tăng gấp đôi, 22 vùng có ≥ 4 đích (nhiễu). Và **vẫn không đạt**: Văn Miếu–Quốc Tử Giám
0,130 ở lại ở mọi ngưỡng trong khi nghị quyết không nêu, evaluator so bằng tập hợp nên `hn-01` đỏ.
`ct-01` tương tự: Thới An Đông 0,0751 vượt 0,05 nên có ở mọi ngưỡng; bỏ nó đòi ngưỡng > 0,075, tức bỏ
cả các ca tách nhỏ thật.

**Đề xuất:** **giữ 0,05**. Hai ca này là lệch giữa ranh giới OSM (snapshot 01/2025 so với hiện hành)
và văn bản, không ngưỡng nào sửa được. Muốn `hn-01` xanh phải đối chiếu lại nghị quyết 1656 về phần
đất của Cửa Nam cũ chuyển sang Văn Miếu–Quốc Tử Giám — hoặc chấp nhận `hn-01`/`ct-01` là ca đã biết
và mốc ca tách dừng ở 4/6.

## D. Không đổi so với hồ sơ 8.3/8.4

- **`count_out_of_range`** (4.215 so với 10.000–10.700, Sơn La 1 xã cũ): quyết định nguồn.
- **3 ca `missing_mainland_l8` trùng đích**: chỉ hết khi `old_area_id` vào PK (migration 0009, plan cấm
  ở phạm vi này).

## E. Nếu PHONG duyệt đúng đề xuất A1 + B + C thì cổng còn gì

79 failure hiện tại − 60 `raw_coverage_gap` (A1) = **19**: 1 `count_out_of_range` + 10 `target_missing`
(cùng gốc nguồn) + 5 `missing_mainland_l8` (3 PK + 2 đảo đã duyệt) + 2 `unexpected_target` + 1
`split_target_missing` (`ct-01`/`hn-01`, C). Cảnh báo 1.970 → ≤ 209. Tức sau ba quyết định trên, mọi
thứ còn lại quy về đúng **một** câu hỏi: nguồn dữ liệu cấp xã cũ.

---

## F. Kết quả thật sau khi PHONG duyệt A + B + C (07/09/2026, 08:20Z)

Đã cài A và B, giữ nguyên C, rồi publish bản sửa alias lên production bằng
`admin-old.mjs --accept-qa` (chỉ thay `admin_area_old` + `admin_alias`, **không** chạm `admin_area`).
`admin_alias` 37.246 → **37.251**; `unmatched=2`, `overlap=0`, `seed_miss=0`.

Cổng chạy lại trên production: **84 → 24 failure**, cảnh báo **1.970 → 286**.

| | trước | sau |
|---|---:|---:|
| `raw_coverage_gap` | 60 | **5** |
| `target_missing` | 10 | 10 |
| `missing_mainland_l8` | 10 | **5** |
| `unexpected_target` | 2 | 2 |
| `count_out_of_range` | 1 | 1 |
| `split_target_missing` | 1 | 1 |
| **failure** | **84** | **24** |
| `discarded_sliver` (cảnh báo) | 1.970 | **229** |
| `coastal_gap_accepted` (cảnh báo mới) | — | **55** |

**Hai chỗ tôi dự đoán lệch, sửa lại cho đúng:**

1. Mục E đoán còn **19** failure vì giả định cả 60 gap được chấp nhận. Thực tế luật máy chấp nhận
   **55**, còn **5** vẫn đỏ. Đây là năm ca tôi đã xếp "cần nhìn" ở mục A, và giữ chúng đỏ là **đúng**:
   luật không được nới để cho một con số đẹp.

   | id | vùng | phần trống | POI | mật độ trống / phủ |
   |---|---|---:|---:|---|
   | 3769311 | Thị trấn Cát Hải (Hải Phòng) | 2,20 km² | 5 | 2,27 / 18,78 = 12 % |
   | 3769312 | Xã Gia Luận (Hải Phòng) | 9,60 km² | 12 | 1,25 / 0,49 = **254 %** |
   | 3769316 | Xã Việt Hải (Hải Phòng) | 38,72 km² | 32 | 0,83 / 1,03 = 80 % |
   | 13396625 | Xã Nghĩa Lộ (Hải Phòng) | 1,79 km² | 1 | 0,56 / 4,58 = 12 % |
   | 15852553 | Phường Hương Phong (Huế) | 3,85 km² | 3 | 0,78 / 2,69 = 29 % |

   Gia Luận và Việt Hải có mật độ POI ở phần **trống cao hơn** phần được phủ — cả hai nằm trong vườn
   quốc gia Cát Bà, nên phần không phủ có thể là **rừng thật sự chưa thuộc xã hiện hành nào**, tức lỗ
   dữ liệu thật chứ không phải biển. Câu ở mục A "không vùng nào là đất bị hở" là **kết luận quá
   mạnh** của tôi; năm ca này chưa chứng minh được là nước. Chúng cần đối chiếu ranh giới xã hiện
   hành của Cát Bà–Cát Hải và đầm phá Tam Giang — việc có nguồn, không phải việc ngưỡng.

2. Mục B đoán cảnh báo sliver còn "≤ 209"; thực tế **229** (con số 209 là ước từ histogram có trùng
   vùng giữa các bucket).

**Còn lại 24 failure, quy về ba nhóm:**

- **21** cùng một gốc là **nguồn dữ liệu cấp xã cũ**: `count_out_of_range` (4.215 so với 10.000–10.700)
  + 10 `target_missing` (toàn bộ Lai Châu, snapshot không có xã nào của Huyện Than Uyên) + 3
  `missing_mainland_l8` do PK ba cột + 2 ca đảo PHONG đã duyệt + 2 `unexpected_target` + 1
  `split_target_missing` (`hn-01`/`ct-01`, lệch niên đại ranh giới).
- **5** `raw_coverage_gap` ở bảng trên — cần nguồn ranh giới Cát Bà/Tam Giang.
- **0** lỗi code.
