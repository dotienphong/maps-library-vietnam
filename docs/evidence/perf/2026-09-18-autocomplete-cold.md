# Gợi ý tìm kiếm chậm — phân rã độ trễ, 18/09/2026

PHONG báo "gõ vào ô search thì gợi ý hiện ra hơi chậm". Bản này là bước **đo**, chưa sửa gì.
Endpoint: `https://mapslibvn-api-production.dotienphong1993.workers.dev` (production thật), đo từ
MacBook của PHONG, colo `SIN`, kết nối đã làm nóng nên **không** tính TLS handshake.

## Sự cố gây ra trong lúc đo — đọc trước khi lặp lại phép đo

Phép đo đầu tiên gọi API bằng `fetch` trần, **không ACK receipt**. Tenant thương mại phát một
receipt mỗi lượt Places; 3 receipt hết hạn không ai xác nhận là `QuotaObject` khoá **cả tenant**
(429 `ack_required`, cửa sổ trượt 24 giờ). Tìm kiếm production chết từ request thứ tư cho tới khi
PHONG bấm "Mở khoá receipt" trên trang Admin.

`scripts/load-api.mjs` ACK từ đầu; `scripts/perf-autocomplete.mjs` thì **không** — cùng cái bẫy nằm
im trong công cụ đo của chính dự án. Đã vá ngày 18/09 (xem `acknowledge()` trong script đó) và có
test khoá hành vi. Mọi công cụ mới gọi Places từ nay phải ACK.

## Phân rã: thời gian nằm ở đâu

| Chặng | p50 | Cộng thêm | Ý nghĩa |
|---|---:|---:|---|
| `/healthz` (không auth, không DB) | 78 ms | — | sàn mạng + Worker |
| `/v1/autocomplete` **trúng cache** | 123 ms | +45 ms | auth + quota DO + đọc Cache API |
| `/healthz/db` (nối DB + 2 truy vấn tầm thường) | ~340 ms¹ | — | đường Hyperdrive → Postgres |
| `/v1/autocomplete` **trượt cache** | **2.849 ms** | **+2.726 ms** | câu SQL thật |

¹ đo bằng curl riêng lẻ nên có cả TLS handshake; con số này chỉ dùng để nói "kết nối DB không phải
thủ phạm", không so trực tiếp với ba dòng kia.

`Server-Timing` của đường cache-hit: `reserve` 14–24 ms, `prepare` 5–8 ms. Quota **không** phải
nguồn chậm.

**Kết luận của bước đo: toàn bộ thời gian nằm trong câu SQL của autocomplete.** Không phải mạng,
không phải Worker, không phải quota, không phải kết nối DB.

## Số đo thô

Bộ truy vấn mặc định của `perf-autocomplete` (n=6, mọi lượt đều `cache=miss`), sau khi mở khoá:

```
n=6 p50=2849ms p95=6114ms   acks={ ok: 6, failed: 0 }
ben thanh 6114 · cafe 3667 · pho co 3338 · truong tieu hoc 2849 · nguyen hue 2764
```

Phiên gõ thật (mỗi tiền tố là một cache key riêng nên luôn lạnh), đo trước khi bị khoá — n=15,
p50 4.424 ms, max 11.346 ms:

| q | ký tự | ms |
|---|---:|---:|
| `qu` | 2 | 6.946 |
| `qua` | 3 | 3.406 |
| `quan` | 4 | 4.795 |
| `quan an` | 7 | 9.151 |
| `quan an ng` | 10 | 11.346 |
| `be` | 2 | 4.424 |
| `ben` | 3 | 1.745 |
| `benh` | 4 | 2.270 |
| `benh v` | 6 | 1.128 |
| `benh vie` | 8 | 2.171 |

**Truy vấn ngắn cũng chậm.** Đây là điều ngược với giả định đang nằm trong `autocomplete-sql.ts`,
vốn chỉ đặt trần `SIMILARITY_MAX_QUERY_LENGTH = 12` để chặn chi phí của truy vấn **dài**. `qu` và
`be` là hai trong số các mẫu chậm nhất — mà đó đúng là lúc người dùng vừa gõ xong ký tự thứ hai.

## So với hồ sơ cũ: đã xấu đi

`docs/evidence/capacity/2026-09-15-inflight-ramp.md` đo ngày 15/09 ở **10 request đồng thời** cho
p50 1.655 ms / p95 1.870 ms. Bản đo hôm nay chạy **tuần tự, một request một lúc** — tải nhẹ hơn hẳn
— mà p50 2.849 ms và p95 6.114 ms. Chưa rõ vì dữ liệu lớn thêm, vì máy chủ đang bận (commit gần
nhất `14cd919` khôi phục build định tuyến), hay vì cả hai. Phải loại trừ trước khi kết luận về mã.

## Phía client không phải chỗ đáng sửa trước

Debounce mặc định 300 ms (`packages/react/src/use-places.ts:90`,
`packages/web/src/autocomplete-element.ts:35`) cộng thẳng vào cảm giác chờ, nhưng nó là 300 ms trên
nền 2,8 s của server, và nó đang gánh việc giảm 51 % lượt Places
(`docs/evidence/autocomplete-debounce`). Hạ debounce lúc này chỉ làm tốn lượt mà người dùng vẫn chờ.

## Ba giả thuyết cho bước sau, chưa cái nào được xác nhận

1. **Tiền tố 2 ký tự không dùng được chỉ số.** `name_norm LIKE 'qu%'` chỉ có chỉ số
   `gin_trgm_ops`; pg_trgm cần ≥ 3 ký tự mới sinh trigram dùng được.
2. **`matched_alt` và `ST_DistanceSphere` chạy cho MỌI dòng khớp, không phải 20 dòng cuối.** Cả hai
   nằm trong `SELECT` dưới nút Sort (`ORDER BY sim DESC LIMIT 20`), nên với truy vấn ngắn khớp hàng
   chục nghìn dòng thì subquery `unnest` + `word_similarity` chạy hàng chục nghìn lần.
3. **"Song song nên chỉ tốn max() chứ không phải tổng" sai khi origin nghẽn CPU.**
   `collectCandidates` bắn tới 7 truy vấn nặng cùng lúc trên một Postgres tự dựng; client
   `postgres.js` lại đặt `max: 5` nên 2 truy vấn còn phải xếp hàng.

Công cụ để phân xử: `node scripts/explain-autocomplete.mjs` — chạy EXPLAIN (ANALYZE, BUFFERS) trên
DB máy chủ, bỏ từng thành phần một để **quy** thời gian cho nó thay vì suy diễn từ số tổng.

---

# Vòng 2 — EXPLAIN ANALYZE trên production, 18/09/2026

`pnpm explain:autocomplete -- --repeat 5 --sweep --plan --q qu --q cafe --q "ben thanh"`.
DB `mapslibvn`, migration `0019`, poi active 376.468, PostgreSQL 16.4, phiên đo ép ngưỡng 0,6 cho
khớp production.

## Giả thuyết 2 bị bác bỏ — nhưng chỉ đúng một nửa, xem vòng 3

`matched_alt` **không** chạy cho mọi dòng khớp. Kế hoạch ghi rõ `SubPlan 1 … (actual
time=0.010..0.010 rows=0 loops=20)` — Postgres đánh giá nó **sau** `Limit`, đúng 20 lần, tổng
~0,2 ms. Bảng "quy chi phí" có lúc báo bỏ `matched_alt` tiết kiệm 595 ms (31 %) cho `cafe`: đó là
**nhiễu**, và kế hoạch là thứ chứng minh điều đó. Bài học: bảng A/B chỉ khoanh vùng, kế hoạch mới
kết luận. `ST_DistanceSphere` cũng vậy (0–2 %).

## Thời gian nằm ở đâu: recheck của Bitmap Heap Scan, không phải đĩa

`ben thanh`, câu đầy đủ:

```
Bitmap Heap Scan on poi p (actual time=156.957..3422.332 rows=12817)
  Rows Removed by Index Recheck: 57697
  Heap Blocks: exact=20535     Buffers: shared hit=21093
  BitmapOr (actual time=148.956..148.959)
    name_norm %> 'ben thanh'   → 14.989 dòng   49 ms
    name_norm %  'ben thanh'   → 70.587 dòng   87 ms
    name_alt_norm %> …         →    377 dòng    1 ms
    name_norm ~~ 'ben thanh%'  →    421 dòng   11 ms
```

Chỉ số chạy hết 149 ms. **3.265 ms còn lại là Bitmap Heap Scan**, và `shared hit=21093` / `read=0`
— không đọc đĩa lần nào. Đó là CPU tính lại điều kiện trigram cho từng dòng ứng viên, rồi vứt đi
57.697 dòng.

**Thủ phạm là nhánh `name_norm % q`**: nó một mình nạp 70.587 dòng vào bitmap (19 % cả bảng) trong
khi cả truy vấn chỉ giữ lại 12.817. Bỏ nó đi:

| q | đầy đủ | bỏ `%` | giảm |
|---|---:|---:|---:|
| `ben thanh` (9) | 3.535 ms | 1.446 ms | **59 %** |
| `cafe` (4) | 1.890 ms | 1.124 ms | **41 %** |
| `qu` (2) | 2.582 ms | 2.625 ms | 0 % |

Ước lượng của planner cho nhánh này sai rất xa: `ben thanh` ước 3.765 / thật 70.587 (18×),
`cafe` 14.550 / 44.975 (3×), `qu` 36 / 31.092 (**860×**).

## Quét ngưỡng quét nhầm núm

`--sweep` đổi `word_similarity_threshold` (0,5→0,8) gần như không đổi gì: `cafe` 1.925→1.879 ms,
`qu` không đổi, chỉ `ben thanh` bớt 17 % ở 0,7. Lý do: nút rộng nhất là nhánh **`%`**, mà `%` dùng
`pg_trgm.similarity_threshold` (mặc định 0,3), **không** dùng `word_similarity_threshold`. Muốn thu
nhỏ bitmap 70 nghìn dòng thì phải vặn núm kia — nhưng dư địa hẹp: `cirlce k`↔`circle k` chỉ đạt
0,385, nâng ngưỡng quá mức là mất đúng những ca mà nhánh `%` sinh ra để cứu.

## `qu` (2 ký tự) là bài toán riêng

Bỏ gì cũng không ăn thua (`no_percent` 0 %), vì cả bốn nhánh đều trả ~29–31 nghìn dòng. Đây là ca
duy nhất planner chọn kế hoạch **song song** (Gather Merge, 2 worker), và cũng là ca duy nhất
`jit=off` có tác dụng: 2.582 → 1.387 ms (46 %). Với `cafe`/`ben thanh` thì JIT chỉ 1–2 %. Số của
`qu` dao động mạnh giữa các lần (sweep cho 1.478–1.734 ms so với trung vị 2.582 ms), nên đừng chốt
gì về `qu` nếu chưa đo lại riêng.

## Bậc 2 và 3 không phải vấn đề (vòng 2)

`ben thanh`: bậc 2 (tsvector) 35 ms, bậc 3 (name_key) 50 ms. Với truy vấn ngắn thì bậc 3 đắt hơn —
`qu` 252 ms, `cafe` 433 ms — đáng để ý vì chúng chạy song song và tranh CPU, nhưng không phải khoản
chi chính.

---

# Vòng 3 — giá riêng từng nhánh, street/area, và núm đúng

`pnpm explain:autocomplete -- --repeat 5 --sweep --plan --q qu --q cafe --q "ben thanh"`.

## Giá riêng của từng nhánh (trung vị 5 lần)

| biến thể | `qu` (2) | `cafe` (4) | `ben thanh` (9) |
|---|---:|---:|---:|
| `full` | 1.300 ms | 1.811 ms | 3.540 ms |
| `chi_wordsim` (chỉ `<%`) | 1.733 ms · 29.107 dòng | 925 ms · 18.763 | 1.176 ms · 14.989 |
| `chi_percent` (chỉ `%`) | 415 ms · 31.092 | 1.053 ms · 44.975 | 1.476 ms · 70.587 |
| **`chi_like` (chỉ `LIKE 'q%'`)** | 509 ms · 29.107 | 426 ms · 18.277 | **18 ms · 421** |
| `street` | 260 ms | 184 ms | 351 ms |
| `area_prefix` | 351 ms | 0 ms | 1 ms |
| `area_fuzzy` | 932 ms | 1 ms | 813 ms |
| bậc 2 / bậc 3 | – / 247 ms | – / 427 ms | 27 / 53 ms |

**POI bậc 1 là nút thắt, đã xác nhận.** Mọi thứ chạy song song với nó đều ≤ 509 ms, nên thời gian
tường của route (= max) chính là nó. `street` không phải vấn đề. `area` cũng không: khuôn hai pha
của nó hoạt động đúng — `ben thanh` dừng ở pha tiền tố sau 1 ms, `cafe` không khớp vùng nào nên cả
hai pha cộng lại chỉ 1 ms. Chỉ `qu` phải trả 351 ms cho pha tiền tố.

**Cảnh báo phương pháp: tổng các phần ≠ tổng thể, và bỏ bớt có thể làm CHẬM hơn.** `qu` có
`chi_wordsim` (1.733 ms) **chậm hơn** `full` (1.300 ms), vì bỏ nhánh làm planner đổi hẳn hình dạng:
`full` được Parallel Bitmap Heap Scan 2 worker, `chi_wordsim` thì không. Với `ben thanh` thì ngược
lại — tổng ba nhánh riêng (2.670 ms) **nhỏ hơn** `full` (3.540 ms), vì mệnh đề OR gộp bitmap lại
làm heap scan phải nạp 20.535 block rồi recheck toàn bộ biểu thức OR trên từng dòng. Nên đừng cộng
trừ các con số này như thể chúng độc lập.

## Quét đúng núm: `similarity_threshold` là đòn bẩy thật

| ngưỡng `%` | `cafe` | `ben thanh` |
|---|---:|---:|
| 0,30 (hiện tại) | 1.905 ms · 44.975 dòng | 3.390 ms · 70.587 dòng |
| 0,35 | 1.927 ms · 44.975 | 2.410 ms · 37.463 |
| 0,40 | 1.841 ms · 44.975 | 2.367 ms · 37.463 |
| 0,45 | **1.099 ms · 18.763** | **1.820 ms · 21.849** |

Núm `word_similarity_threshold` (0,5→0,7) gần như không đổi gì — xác nhận vòng 2 quét nhầm núm.

Dư địa bị chặn bởi chất lượng, **phải đo hit@3 trước khi đổi**: JSDoc trong `autocomplete-sql.ts`
ghi `cirlce k`↔`circle k` đạt similarity 0,385 và `higland`↔`highlands` 0,455. Vậy 0,45 làm hỏng
`cirlce k`, còn 0,35 giữ được cả hai mà `ben thanh` vẫn bớt 29 %.

## Hai điều phải rút lại

**JIT không phải vấn đề.** Vòng 3 cho `full_jit_off` ngang `full` ở cả ba truy vấn (−6 %, −5 %,
+1 %). Con số "46 %" của vòng 2 là nhiễu.

**`matched_alt` chưa kết luận được, trái với điều đã viết ở vòng 2.** Với `ben thanh` nó đúng là vô
can (0 %, hai kế hoạch giống hệt nhau, SubPlan 20 vòng × 0,016 ms). Nhưng với `cafe` nó cho
**553 ms (31 %)** ở vòng 3 và 595 ms ở vòng 2 — hai lần đo độc lập cùng ra ~30 % thì khó gọi là
nhiễu. Chưa có kế hoạch của `no_matched_alt` cho `cafe` nên chưa giải thích được. Đây là đầu dây
duy nhất còn bỏ ngỏ.

## Biến động giữa các lần chạy là lớn

`qu` cho `full` = 2.582 ms ở vòng 2 và 1.300 ms ở vòng 3, cùng ngày, cùng câu. Hệ quả vận hành: mọi
so sánh trước/sau **phải đo trong cùng một phiên**, không được so số của hai lần chạy khác nhau.

## Đường tới ~100 ms

`chi_like` của `ben thanh` — **18 ms, 421 dòng** — cho thấy nhánh tiền tố khi chọn lọc tốt thì gần
như miễn phí. Nó chậm với `qu`/`cafe` (509/426 ms) vì đang đi qua chỉ số **trigram**, thứ trả về
mọi tên *chứa* trigram của truy vấn (18.277 dòng cho `cafe`) chứ không phải mọi tên *bắt đầu bằng*
nó. Chỉ số btree `text_pattern_ops` cho đúng range scan.

Còn một nửa nữa: dù bitmap nhỏ, câu hiện tại vẫn tính `greatest(...)` gồm 4 hàm trigram cho **mọi**
dòng, vì `sim` nằm trong `ORDER BY`. Một bậc tiền tố đúng nghĩa phải xếp theo `popularity` rồi mới
tính `sim` trên 20–200 dòng đã cắt. Bằng chứng khuôn này chạy được: `area_prefix` = **1 ms**.

---

# Baseline trước khi đổi — 18/09/2026, 09:08

```
pnpm exec node scripts/perf-autocomplete.mjs <base> <key> \
  --queries scripts/fixtures/fuzzy-queries.txt --count 40 --near 10.776,106.700

n=40 p50=996ms p95=3249ms p99=4663ms
hit@3=38/40  miss: higland, sieu thi co op
ack=40 ok, 0 hỏng
chậm nhất: ben thanh 4663 · highlands 3445 · ben than 3249 · nguyen hue 2528 · tch 2427
```

`--count 40` = một lượt TOÀN LẠNH (mặc định cũ ép `queries.length * 2` nên nửa số mẫu là cache hit
và p95 thấp giả tạo). Hai ca trượt là **lỗi fixture đã biết**, không phải lỗi API — DEVLOG 05/09 ghi
production có POI tên đúng chữ "Higland" nên nó xếp trên "Highlands", và `sieu thi co op` trượt từ
baseline.

**Lần đo "sau" phải đổi `--near`** (ví dụ `21.03,105.85`), nếu không nó đo cache 10 phút chứ không
đo DB. `--near` trước 18/09 bị nhánh không-paired của CLI nhận rồi vứt đi — đã vá kèm test.

## Ứng viên "bậc nhanh" — và một thiết kế đã bị loại trước khi viết mã

Ý tưởng "bậc tiền tố thuần" (`name_norm LIKE 'q%'`) **sai ngữ nghĩa với tên tiếng Việt**: `ben thanh`
sẽ KHÔNG khớp "Chợ Bến Thành", vì tên đó bắt đầu bằng "cho". Tên POI Việt Nam thường mở đầu bằng từ
loại — Chợ, Trường, Bệnh viện, Quán, Cà phê — nên khớp theo tiền tố của **cả chuỗi** là hỏng recall.
Đó chính là việc mà `<%` (word_similarity) đang làm: khớp một cụm từ nằm **giữa** tên.

Cấu trúc nhanh tương đương về ngữ nghĩa đã có sẵn và đang chạy: **`name_tsv @@ to_tsquery('simple',
'ben:* & thanh:*')`** — mọi token là tiền tố của một từ bất kỳ trong tên, không kể vị trí. Vòng 3 đo
nó ở **27 ms / 429 dòng** cho `ben thanh`. Hai việc phải kiểm trước khi dựa vào nó:

1. `tsQueryFor` hiện trả null khi < 2 token, nên `cafe` và `qu` không dùng được — phải đo xem một
   token thì nó còn nhanh không.
2. Phải cắt 200 dòng theo `popularity` **trước** rồi mới tính `sim`; để `sim` trong ORDER BY của
   bước quét là vẫn tính 4 hàm trigram cho mọi dòng khớp, tức không nhanh hơn gì.

Hai biến thể `nhanh_tsv` và `nhanh_like` trong `explain-autocomplete.mjs` đo đúng hai điều đó.
