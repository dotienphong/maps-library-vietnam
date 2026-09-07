# Task 0 — baseline trước hạng mục 3 (07/09/2026, 21:12–21:30 giờ VN)

Đo trên **production** `https://api.ai-solutions.io.vn`, SHA `c3bfa03`, trước khi thay đổi bất cứ gì.
Công cụ: `scripts/perf-autocomplete.mjs` (đã dùng cho 8.5).

## Bộ 20 truy vấn cách viết địa phương (`scripts/fixtures/local-variant-queries.txt`)

| | |
|---|---:|
| **hit@3** | **3/20** |
| n (2 vòng) | 40 |
| p50 / p95 / p99 phía client | 172 / 1.812 / 2.675 ms |

**Chỉ 3 ca đạt** — và đúng là ba ca **không cần biến đổi gì**: `quinhon` (tiền tố khớp
`quy nhon`? không — khớp nhờ trigram), `dak lak` (viết đúng), `ly thuong kiet` (viết đúng).

17 ca trượt: `qui nhon`, `kontum`, `dac lac`, `ban me thuot`, `bmt`, `tan son nhut`, `mi tho`,
`bin than`, `li thuong kiet`, `bac can`, `plei ku`, `cong ly`, `duong cong ly`, `hien vuong`,
`truong minh giang`, `saigon`, `hoian`.

Bốn ca tên đường cũ (`cong ly`, `duong cong ly`, `hien vuong`, `truong minh giang`) trượt là **đúng
kỳ vọng**: `street` hiện chưa có cột `name_alt` nào, tên cũ của đường không tồn tại trong DB.

## Bộ 40 truy vấn mờ (đối chứng không hồi quy)

| | |
|---|---:|
| **hit@3** | **37/40** (miss: `higland`, `cho rya`, `sieu thi co op`) |
| p50 / p95 / p99 phía client | 230 / 1.621 / 2.044 ms |

Khớp baseline đã biết từ 8.5 — đây là mốc để chứng minh hạng mục 3 không làm tụt tìm mờ.

## Phía Worker (`$workers.wallTimeMs`, `/v1/autocomplete`, 14:12–14:30 UTC)

| | |
|---|---:|
| n | 118 |
| p50 | **39 ms** |
| p95 | **1.699 ms** |
| p99 | 1.972 ms |

p50 39 ms là phần lớn request trúng cache Cloudflare; p95 1.699 ms là nhánh cache lạnh phải xuống DB.
Tiêu chí 11.4 sẽ so **p95 warm phía client** với mốc này ở Task 16, cùng cách đo xen kẽ của 8.5.

## Ghi chú phương pháp

Số phía client gồm cả chặng internet công cộng từ máy dev; số phía Worker thì không. Bài học 8.5:
chỉ so cùng loại số với nhau, và khi so hai cohort thì phải đo **xen kẽ** vì colo đổi giữa hai
request liên tiếp.
