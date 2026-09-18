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
