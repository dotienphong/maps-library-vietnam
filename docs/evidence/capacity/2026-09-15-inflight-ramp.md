# Đo lại trần đồng thời mỗi tenant — 15/09/2026

PHONG yêu cầu **bỏ trần cũ và đo lại từ đầu**. Bản này thay thế phần "diễn giải pilot" của
`2026-09-15-capacity.md`. Endpoint: `https://api.ai-solutions.io.vn` (production thật).
Harness: `scripts/load-api.mjs` qua `pnpm load:api`, có test ở `scripts/load-api.test.mjs`.

## Vì sao phải đo lại: trần cũ không phải số đo

Probe cũ (`2026-09-15-probe.mjs`) đặt `const budget = group==='places' ? 50 : 16` và **ném lỗi**
với mọi mức vượt budget (`if(levels.some(n=>...||n>budget)) throw 'Levels exceed guarded budget'`).
Budget đó chọn để không vượt burst 60/phút và 20/phút, tức là **rào chắn của harness**, không phải
trần của origin. Origin chưa bao giờ được đẩy quá 50 Places. Vậy nên "50/16" trước đây là
*mức cao nhất harness cho phép thử*, và đã bị gán nhầm nhãn "mốc đã đo".

## Tiêu chí dừng

Trần in-flight là câu hỏi về **độ trễ chấp nhận được**, không phải "có lỗi hay không". Một wave
0 lỗi nhưng p95 9 giây vẫn là dịch vụ hỏng với người đang gõ phím. `runRamp` nay dừng vì ba lý do:
`errors` (5xx/timeout/4xx), `rate_limited` (429 làm số đo mất nghĩa), `latency` (p95 vượt ngưỡng).
Ngưỡng dùng ở đây: **p95 ≤ 5.000 ms** — giữ đúng tiêu chí mà probe Task 0 đã dùng.

Nghỉ 65 giây giữa các mức để cửa sổ rate limit reset, không bypass rate limit.

## Places — `/v1/autocomplete`, mỗi VU một ô cache riêng

```
pnpm load:api --base=https://api.ai-solutions.io.vn --confirm-production \
  --group=places --levels=10,25,50,75,100,125,150 --max-p95=5000
```

| Đồng thời | ok | 429 | lỗi | p50 ms | p95 ms | p99 ms |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 10/10 | 0 | 0 | 1.655 | 1.870 | 1.870 |
| 25 | 25/25 | 0 | 0 | 2.128 | 2.479 | 2.489 |
| 50 | 50/50 | 0 | 0 | 3.767 | **4.390** | 4.509 |
| 75 | 75/75 | 0 | 0 | 5.307 | **6.046** | 6.167 |

Dừng ở 75 vì độ trễ. **Mức phục vụ được cao nhất theo bar 5 s: 50.** Không có 429 ở bất kỳ mức nào —
burst limiter là permissive/bất đồng bộ nên không chặn một burst tức thời; đừng coi "0 rateLimited"
là bằng chứng rate limit đang hoạt động.

Chọn trần theo mục tiêu UX, không chỉ theo bar 5 s:

| Mục tiêu p95 | Trần Places tương ứng |
|---|---:|
| ≤ 2 s | ~25 |
| ≤ 3 s | ~35 (nội suy giữa 25 và 50) |
| ≤ 5 s | 50 |

## Directions — `/v1/directions` motorbike nội đô

```
pnpm load:api ... --group=directions --levels=4,8,12,16,24,32 --max-p95=5000
pnpm load:api ... --group=directions --levels=48,64,96,128 --max-p95=5000
```

| Đồng thời | ok | 429 | lỗi | p50 ms | p95 ms | p99 ms |
|---:|---:|---:|---:|---:|---:|---:|
| 4 | 4/4 | 0 | 0 | 1.206 | 1.224 | 1.224 |
| 8 | 8/8 | 0 | 0 | 613 | 790 | 790 |
| 12 | 12/12 | 0 | 0 | 676 | 733 | 733 |
| 16 | 16/16 | 0 | 0 | 606 | 719 | 719 |
| 24 | 24/24 | 0 | 0 | 639 | 816 | 824 |
| 32 | 32/32 | 0 | 0 | 1.000 | **1.171** | 1.206 |
| 48 | 44/48 | **4** | 0 | 624 | 840 | 852 |

**Không tìm thấy điểm gãy độ trễ.** Valhalla vẫn dưới 1,2 s ở mức 32 và vẫn 840 ms ở mức 48 —
thứ chặn ở 48 là **rate limit biên** (`DIRECTIONS_RATE_LIMITER` 20/phút theo key+IP), không phải
origin đuối. Vì không được bypass rate limit nên **32 là mức sạch cao nhất đo được**; trần thật của
Valhalla còn cao hơn, chưa biết bao nhiêu.

Mức 4 chậm hơn mức 8/12/16 là do warm-up của wave đầu, không phải đường cong tải.

## Kết luận áp vào code

`MAX_INFLIGHT_DEFAULT = { places: 50, directions: 32 }` trong
`apps/api/src/billing/quota-object.ts`, chỉnh được bằng var `MAX_INFLIGHT_PLACES` /
`MAX_INFLIGHT_DIRECTIONS` mà không cần sửa code.

## Giới hạn của phép đo này — đọc trước khi trích số

- **Chưa có Durable Object trong đường đi.** Quota thương mại chưa deploy, nên đây là sức chịu của
  origin chứ chưa tính overhead DO, và chưa tính việc mọi request của một tenant dồn qua **một** DO —
  đó là điểm nghẽn riêng, phải đo lại sau khi bật commercial.
- **Trần theo TỪNG tenant, origin dùng chung.** Một tenant ở mức 50 đúng bằng mức đã đo; năm tenant
  cùng chạm trần là 250 đồng thời — chưa ai đo. Phải đo lại trước khi có tenant thương mại thứ hai.
- **Mỗi mức một wave, không phải soak/sustained.** Không nói được gì về tải duy trì, bão hoà
  connection pool hay autovacuum.
- Chỉ đo `/v1/autocomplete` và `/v1/directions`; bốn API Places còn lại chưa đo.
- `rps` trong bảng là `requests / elapsed` của một wave, **không phải throughput duy trì**.
- Đo end-to-end từ máy dev qua Cloudflare, gồm cả độ trễ mạng client.
