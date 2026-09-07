# Task 8.5 — đo lại chi phí nhánh `area` trên production (07/09/2026)

Thay thế phép đo 8.5 lúc 11:27 cùng ngày (mục 10 hồ sơ `6-5-explain-autocomplete-area.md`), lần đó
**không kết luận được** vì ba khiếm khuyết phương pháp. Số liệu thô: `8-5-paired-benchmark.json`.

## 1. Vì sao lần đo trước không dùng được

| Khiếm khuyết 07/09 lần 1 | Cách xử lý lần này |
|---|---|
| Hai cohort chạy tuần tự nên rơi vào hai colo khác nhau (HKG/SIN) | Đo **xen kẽ**: hai cohort đi liền nhau trên **cùng một query**. Đo thật xác nhận colo đổi HKG↔SIN ngay giữa hai request liên tiếp, nên chạy tuần tự thì không thể ghép cặp được |
| p95 bị cache lạnh chi phối, không tách được | Tách theo header `x-mlv-cache`; thêm bốn lượt `--rounds 1` ở bốn ô lưới `near` mới để có mẫu **100% cold** |
| Mỗi cohort chỉ 80 request | 120 (lượt A) và 102 (lượt B) request/cohort; riêng phần cold gộp 160 request/cohort |
| — (phát hiện khi đo lần này) | Cohort đi **trước** trong mỗi cặp gánh chi phí khởi động worker/Hyperdrive. Bằng chứng: lần chạy chưa sửa có cold p50 684/530 trong khi warm p50 bằng nhau 96/96. Đã **luân phiên thứ tự cohort** từng cặp và đo lại từ đầu |
| — | Bộ query cũ chỉ có 40 truy vấn POI, **gần như không chạm nhánh `area`**. Bổ sung `perf-area-queries.txt` (15 tên huyện cũ + 9 tên tỉnh cũ + 10 địa chỉ cũ) đúng như plan 8.5 yêu cầu |

Cache key của API gồm `typeKey` (`autocomplete.ts:43`), nên hai cohort không dùng chung entry —
điều kiện bắt buộc để đo xen kẽ mà không đầu độc lẫn nhau.

## 2. Phía client — từ máy dev, qua internet công cộng

`default` = types mặc định (`poi,street,address,area`); `legacy` = `types=poi,street,address`.
Cả hai cohort của mỗi lượt đều rơi đúng **cùng một colo**.

| Lượt | Bộ query | colo | n/cohort | | overall p50 | overall p95 | warm p50 | **warm p95** | cold p50 | cold p95 |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|
| A | 40 fuzzy POI | SIN | 120 | default | 80 | 1.312 | 77 | **89** | 584 | 1.915 |
| | | | | legacy | 80 | 958 | 76 | **87** | 533 | 1.776 |
| | | | | **Δ** | 0 | +354 | +1 | **+2** | +51 | +139 |
| B | 34 area + địa chỉ cũ | HKG | 102 | default | 69 | 1.664 | 67 | **71** | 1.124 | 2.316 |
| | | | | legacy | 68 | 1.701 | 67 | **73** | 1.099 | 2.400 |
| | | | | **Δ** | +1 | −37 | 0 | **−2** | +25 | −84 |
| C | 5 tiền tố 2 ký tự | SIN | 20 | default | 99 | 2.143 | 96 | **117** | 1.542 | 2.435 |
| | | | | legacy | 95 | 2.189 | 92 | **155** | 1.436 | 2.430 |
| | | | | **Δ** | +4 | −46 | +4 | **−38** | +106 | +5 |

Warm (n = 80/68/15 mỗi cohort) là phần **có phân bố chặt** và đo được: `default` chênh +2 ms ở bộ
POI, và **nhanh hơn** ở hai bộ còn lại. Lượt C là ca xấu nhất đã biết từ cổng 6.5 (query 2 ký tự),
để riêng, **không trộn vào bộ gate**.

### Bốn lượt cold độc lập (fuzzy 40, `--rounds 1`, ô lưới `near` mới nên 100% cache miss)

| Ô lưới | colo | default p50 | legacy p50 | Δp50 | default p95 | legacy p95 | Δp95 |
|---|---|---:|---:|---:|---:|---:|---:|
| Hà Nội | SIN | 540 | 515 | +25 | 1.807 | 1.769 | +38 |
| Đà Nẵng | HKG | 620 | 607 | +13 | 1.793 | 1.795 | −2 |
| Cần Thơ | SIN | 587 | 527 | +60 | 1.750 | 1.657 | +93 |
| Nha Trang | HKG | 621 | 536 | +85 | 1.771 | 1.824 | −53 |

Δp95 cold **đổi dấu** giữa các lượt (+38, −2, +93, −53) — nhiễu đuôi của internet công cộng, không
phải tín hiệu. Δp50 cold thì **dương ở cả 4/4 lượt**, nên đó là tín hiệu thật và phải truy tiếp.

## 3. Phía máy chủ — Workers observability, loại hẳn chặng internet

`$workers.wallTimeMs`, `path=/v1/autocomplete`, cửa sổ `05:26:00Z–05:30:30Z` (đúng bốn lượt cold,
100% cache miss). Cohort `default` lọc bằng `$workers.event.search.types is_null`.

| | `default` | `legacy` | Δ |
|---|---:|---:|---:|
| n | 164 | 159 | |
| wall p50 | **581** | **488** | **+93** |
| wall p95 | **1.756** | **1.919** | **−163** |
| wall p99 | 2.958 | 2.950 | +8 |

Đây là phép đo sạch nhất trong hồ sơ: ≥100 mẫu mỗi cohort như 8.5 yêu cầu, cùng khoảng thời gian,
cùng bộ query, không có chặng internet công cộng trong số đo.

## 4. Kết luận

**Cổng p95 của 8.6 (`≤ baseline + 50 ms`): ĐẠT.**

- Warm p95 phía client: **+2 / −2 / −38 ms** trên ba bộ query.
- Cold p95 phía máy chủ, 164 so với 159 mẫu: **−163 ms** — `default` **nhanh hơn** baseline.
- Hai con số cold p95 phía client vượt +50 ms (+139 lượt A, +93 Cần Thơ) bị chính phép đo phía máy
  chủ bác bỏ, và bản thân chúng đổi dấu giữa các lượt. Chúng là nhiễu mạng, không phải chi phí của
  `area`.

**Chi phí thật của nhánh `area`: ~+93 ms ở cold p50** (581 so với 488 ms phía máy chủ), nhất quán
với Δp50 dương 4/4 lượt phía client. Không phải hạng mục của cổng (cổng đo p95), nhưng là số thật
và phải ghi lại.

Chi phí này **không** đến từ một round-trip nối tiếp — `collectCandidates` chạy bốn nhánh bằng
`Promise.all` (`autocomplete-sql.ts:160`). Nó khớp với phân tích bậc ở mục 6.5: bậc 1 chỉ dùng tiền
tố, và với truy vấn POI như `highlands` thì tiền tố trên `admin_alias` **luôn rỗng** nên leo lên bậc
2 `word_similarity` quét 37.246 alias. Chính vì vậy bộ A (POI, luôn leo bậc) tốn +51 ms cold p50
còn bộ B (tên hành chính, trúng bậc 1) chỉ +25 ms.

**Đề xuất cho PHONG, chưa làm:** route đã tính sẵn `isAdminOnlyQuery` cho `withAreaSlot`. Dùng lại
nó để **bỏ hẳn nhánh area khi truy vấn không mang dạng hành chính** sẽ cắt phần lớn +93 ms này mà
không mất tính năng nào — vùng chỉ biến mất ở đúng những truy vấn vốn không trả về vùng. Việc này
đổi hành vi chọn ứng viên nên cần PHONG duyệt, và nằm cùng nhóm với đề xuất còn treo ở mục 6.5 (bỏ
nhánh alias khi query < 3 ký tự).

## 5. Cách chạy lại

```
node scripts/perf-autocomplete.mjs <base> <key> --paired --rounds 3 --queries scripts/fixtures/fuzzy-queries.txt
node scripts/perf-autocomplete.mjs <base> <key> --paired --rounds 3 --queries scripts/fixtures/perf-area-queries.txt
node scripts/perf-autocomplete.mjs <base> <key> --paired --rounds 1 --near 21.028,105.854 --queries scripts/fixtures/fuzzy-queries.txt
```

Mỗi ô lưới `--near` là một cache key khác nhau nên vòng 1 luôn cold. Chờ **hơn 10 phút** (cache tươi
600 s) trước khi lặp lại cùng một ô lưới, nếu không vòng 1 sẽ là cache hit.
