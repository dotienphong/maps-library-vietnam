# Trang Admin MapsLibVN — Pha 3 (Gói cước & hạn mức)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cấp gói, cộng credit, bật dùng thử, tạm dừng/mở lại và mở khoá `ack_required` ngay trên trang Admin, kèm mức dùng thật của kỳ hiện tại, lịch sử kỳ và mức dùng hôm nay của tenant chưa vào sổ thương mại — để không còn phải gõ `curl` cho việc billing.

**Architecture:** Bốn lệnh tiền bạc dùng lại `POST /v1/admin/billing/:id/commands` đã chạy từ M5 (Durable Object `QuotaObject` giữ sổ, idempotent theo `operationId`, khoá lạc quan theo `expectedRevision`). Pha này thêm **ba route đọc** — `GET /v1/admin/plan-catalog`, `GET /v1/admin/billing/:id/periods`, `GET /v1/admin/billing/:id/legacy-usage` — một RPC đọc mới `QuotaObject.readPeriods()`, và vá hai lỗ hổng vận hành phát hiện khi khảo sát: nhóm `/v1/admin/billing/*` **chưa** có cổng chống CSRF, và hai route ghi (`commands`, `missing-acks/unlock`) **chưa** ghi `admin_audit`. Giao diện thêm mảng `apps/admin/src/features/billing/*` theo đúng khuôn mảng `tenants` của pha 2.

**Tech Stack:** Hono + postgres.js (Hyperdrive) + Durable Object SQL, KV (`META`), React 19 + TanStack Query v5 + React Router v7 + Radix Dialog + Tailwind v4, vitest (unit Workers / itest DB thật / dbtest quyền), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-trang-admin-react-design.md` (mục 5, 8, 11.4, 12, 17 — hàng "Pha 3", 18)

**Plan trước:** `docs/superpowers/plans/2026-09-16-trang-admin-pha-0-1.md`, `docs/superpowers/plans/2026-09-16-trang-admin-pha-2.md` (pha 0–2 đã deploy và nghiệm thu production 16/09/2026)

---

## Ghi chú bắt buộc đọc trước khi bắt đầu

Mười bốn điểm dưới đây đều đã **kiểm chứng bằng cách chạy thật** trên cây mã ngày 16/09/2026, không phải suy đoán. Bỏ qua bất kỳ điểm nào là lặp lại một sự cố đã có tiền lệ.

1. **Nhóm `/v1/admin/billing/*` hiện KHÔNG đi qua cổng chống CSRF.** Cổng đó khai trong app `admin` (`apps/api/src/routes/admin.ts:18`) với path `/v1/admin/*`, nhưng `index.ts:70-71` mount nhóm billing **trước** `app.route('/', admin)` ở dòng 121, nên handler billing trả phản hồi xong xuôi trước khi middleware CSRF kịp chạy. Đo thật: `POST /v1/admin/billing/<uuid>/commands` kèm `Sec-Fetch-Site: cross-site` trả **401** (`missing_access_jwt`) chứ không phải 403 `cross_site_request` — tức không có lớp chặn nào ngoài JWT, mà JWT thì đi kèm cookie Access. Pha 3 chính là pha đưa **mọi lệnh tiền bạc** lên trình duyệt, nên Task 1 phải vá trước khi viết một dòng giao diện nào.

2. **Sổ Durable Object SỐNG QUA CÁC LẦN CHẠY TEST.** `scripts/api-db-test.mjs:73` chỉ xoá `apps/api/.wrangler/state/v3/cache`, còn `apps/api/.wrangler/state/v3/do/mapslibvn-api-QuotaObject` (hiện 532 KB trên máy này) thì giữ nguyên, trong khi Postgres bị `DROP DATABASE`/`CREATE DATABASE` mỗi lượt. Hệ quả cụ thể: một test "kích hoạt dùng thử cho tenant seed" xanh lần đầu rồi **đỏ vĩnh viễn** từ lần thứ hai với `trial_already_used`, và mọi test gửi lệnh sẽ nhận `revision_conflict` vì `expectedRevision` tính từ một sổ đã có lịch sử. Task 3 xoá thư mục đó trong harness; Task 7 vẫn dựng tenant với UUID ngẫu nhiên mỗi lần chạy — hai lớp, vì sổ DO là nơi giữ tiền và không có bài test nào đáng để một lần chạy lẫn dữ liệu cũ.

3. **`validateCommand` dùng allowlist đóng cả hai chiều** (`apps/api/src/billing/commands.ts:34-37`): thừa **một** trường lạ trong thân JSON là `invalid_command` 400, thiếu một trường bắt buộc cũng vậy. Route `commands` lại `{...input, tenantId, actor}` (`billing-admin.ts:147-151`), nên giao diện phải gửi **đúng** tập trường của từng `kind`, không kèm `note`, `label` hay bất cứ thứ gì để hiển thị.

4. **`reason` bắt buộc cho MỌI lệnh, không riêng lệnh mở khoá.** `commands.ts:42` đòi `isText(input.reason, 4_096)`. Spec 11.4 chỉ nhắc "mở khoá `ack_required` (bắt buộc nhập lý do)" nên rất dễ làm form cấp gói mà quên ô lý do rồi nhận 400 ở production. Mọi form trong pha này đều có ô **Lý do** bắt buộc.

5. **`expectedRevision` là khoá lạc quan.** `quota-object.ts:148` so đúng bằng: lệch một đơn vị là `revision_conflict` 409. Mỗi lệnh thành công tăng revision, nên sau mỗi lệnh phải `invalidate` query `usage` rồi mới cho gửi lệnh kế. Hai tab mở song song chắc chắn đụng lỗi này — thông điệp tiếng Việt phải nói thẳng "bấm Tải lại rồi thử lại", đừng để người vận hành đoán.

6. **`operationId` sinh MỘT lần cho mỗi lần bấm** và giữ nguyên khi thử lại: gửi lại cùng `operationId` với payload **giống hệt** trả lại biên lai cũ (không tạo lệnh thứ hai), còn payload **khác** là `operation_conflict` 409. Giao diện không được sinh lại id lúc gửi — đúng bài học đã ghi trong `features/tenants/detail.tsx:30-37`.

7. **Cặp `paymentReference` + `lineItemId` là khoá định danh nghiệp vụ** (`quota-object.ts:125-137`, bảng `business_identity`). Gửi lại cặp đó với nội dung khác là `business_identity_conflict` 409; gửi lại **y nguyên** thì máy chủ trả biên lai cũ và **không cộng tiền lần hai**. Giao diện tuyệt đối không được hiểu phản hồi 200 đó là "vừa cấp thêm một kỳ nữa": phải hiện `operationId` trong biên lai để người vận hành thấy đây là biên lai cũ.

8. **`periodId` là PRIMARY KEY của bảng `period` trong sổ DO.** Trùng `periodId` không rơi vào nhánh lỗi nào của `ADMIN_COMMAND_STATUS`, nó ném ràng buộc SQLite và lọt xuống `503 upstream_unavailable` — một mã không nói gì cho người vận hành. Giao diện luôn sinh `periodId` bằng `crypto.randomUUID()` và hiện nó ra để đối chiếu.

9. **Múi giờ.** Kỳ tính theo mốc UTC trong sổ, còn người vận hành nghĩ theo ngày Việt Nam. Dùng `<input type="date">` rồi dựng ISO bằng `new Date(ngay + "T00:00:00+07:00").toISOString()`. **Không** dùng `datetime-local` rồi `new Date(value).toISOString()`: chuỗi đó không mang offset và kết quả lệch 7 giờ — cấp kỳ bắt đầu "01/10" sẽ thành 30/09 17:00 UTC.

10. **Kỳ tương lai không đổi trạng thái.** `quota-object.ts:216-221`: `grantPeriod` chỉ đặt `status='active'` khi `startsAt <= now < endsAt`. Cấp một kỳ bắt đầu ngày mai là lệnh **thành công** nhưng màn hình vẫn hiện "hết hạn"/"chưa có quyền". Giao diện phải nói rõ "kỳ sẽ bắt đầu ngày …" thay vì để người vận hành tưởng lệnh trượt rồi gửi lại lần nữa (và lần đó mới thật sự `period_overlap`).

11. **Đọc `usage` của một tenant chưa có sổ sẽ TẠO sổ.** `quotaObject()` gọi `idFromName().get()`, và lần `get()` đầu tiên là lúc Cloudflare chọn vị trí object (`billing/object.ts:8-14`, bài học 15/09/2026: object tạo bởi lệnh quản trị chứ không phải traffic thật). Vì vậy màn hình **chỉ** gọi `usage`/`periods` khi `tenant.quota_mode === 'commercial'`; tenant `legacy` đi nhánh `legacy-usage` (đọc KV, không chạm DO). Mở màn hình xem thông tin không được phép tạo sổ.

12. **`delayed-action` không bắt lỗi của `run()`** (`components/delayed-action.tsx:65`: `void current.run()`). Ở pha 2 điều đó chưa đau vì thu hồi khoá hiếm khi 409; ở pha 3 thì `revision_conflict`/`period_overlap` là chuyện thường ngày, và một lệnh cấp gói **thất bại im lặng** là kịch bản tệ nhất của cả pha: người vận hành đóng máy, tin rằng khách đã có gói. Mọi `run()` trong pha này phải `try/catch` và đẩy kết quả (biên lai hoặc lỗi) lên state của trang.

13. **Bộ đếm legacy nằm trong KV, khác hoàn toàn sổ thương mại.** Khoá `quota:<key_hash>:<ngày VN>:<group>`, TTL 2 ngày, **chỉ ghi khi `QUOTA_ENABLED === '1'`** và bỏ qua tenant `plan='internal'` (`quota.ts:91-103`). Trần chặn thật là **2× hạn mức** (đếm xấp xỉ, cố ý), nên màn hình phải ghi rõ con số đó chứ không vẽ một thanh 100 % gây hiểu nhầm. Trên máy dev `wrangler.toml` đặt `QUOTA_ENABLED = "0"` → mọi số legacy là 0; đó là đúng, không phải lỗi.

14. **Nhắc lại các bẫy đã ghi từ pha trước:** `tsconfig.base.json` bật `exactOptionalPropertyTypes` (không truyền `{foo: undefined}` cho `foo?: T`) và `noUncheckedIndexedAccess`; `apps/api/test/**` không được cần Postgres; chạy mọi lệnh `wrangler` từ `apps/api` và gọi `pnpm run deploy` chứ không `pnpm deploy`; lỗi ném qua RPC của Durable Object mất class nên **khớp theo message**, không `instanceof`; sau mỗi task `pnpm lint` và `pnpm typecheck` phải xanh trước khi commit.

---

## Ba chỗ spec 11.4 không khớp dữ liệu có thật

Đọc kỹ trước khi làm, vì hai chỗ đầu đã được PHONG chốt hướng xử lý ngày 16/09/2026.

| Spec 11.4 viết | Thực tế trong mã | Xử lý ở pha 3 |
|---|---|---|
| "mức dùng **theo endpoint**" | Sổ chỉ đếm theo **hai nhóm quota** `places` và `directions` (`counter.group_name`). Không có chiều endpoint ở bất kỳ tầng nào. | Hiện theo nhóm. Tách theo endpoint là số liệu Analytics — thuộc **pha 5**, ghi rõ trên màn hình bằng một dòng "số theo từng endpoint nằm ở Sức khoẻ hệ thống". |
| "mức dùng **theo kỳ**" | `readUsage()` chỉ trả kỳ **đang chạy**. Kỳ cũ và các gói credit đã cộng không có đường đọc. | **PHONG chốt: thêm** `QuotaObject.readPeriods()` + `GET …/periods` (Task 5), hiện bảng kỳ và bảng credit. |
| Không nhắc tới tenant `legacy` | Tenant chưa bật `commercial` **không** ghi vào sổ DO, nên màn hình sẽ toàn số 0. | **PHONG chốt: thêm** `GET …/legacy-usage` đọc bộ đếm KV theo từng khoá (Task 6), kèm băng nói rõ đây là số xấp xỉ trong ngày. |

---

## Cấu trúc file sau khi xong plan này

**Tạo mới trong `apps/api/`:**

| File | Trách nhiệm |
|---|---|
| `src/routes/admin-catalog.ts` | `GET /v1/admin/plan-catalog` — bảng giá và hạn mức từng bậc, để giao diện không chép số |
| `src/routes/billing-read.ts` | `GET …/periods` và `GET …/legacy-usage` (hai route đọc, tách khỏi file lệnh 417 dòng) |
| `test/admin-catalog.test.ts` | Hình dạng catalog + cổng Access |
| `test/billing-csrf.test.ts` | Cổng chống CSRF cho nhóm billing (Task 1) |
| `test/billing-read.test.ts` | Validate tham số, `cache-control`, nhánh không có binding |
| `test/billing-periods-object.test.ts` | `readPeriods()` chạy trên Durable Object thật |
| `test-db/admin-billing.itest.mjs` | Luồng thật qua Postgres + DO: catalog, trial, cấp kỳ, credit, usage, periods, legacy-usage, audit |

**Tạo mới trong `apps/admin/src/features/billing/`:**

| File | Trách nhiệm |
|---|---|
| `api.ts` | Kiểu dữ liệu + hàm gọi HTTP của cả mảng |
| `error-vi.ts` | Mã lỗi máy chủ → câu tiếng Việt hành động được (nguồn duy nhất) |
| `command-builder.ts` | Hàm thuần: đổi ngày VN sang ISO, kiểm form, dựng đúng tập trường của từng lệnh |
| `hooks.ts` | `useUsage`, `usePeriods`, `useLegacyUsage`, `useCatalog`, `useSendCommand`, `useUnlockAcks` |
| `page.tsx` | Màn `/admin/billing`: chọn tenant (`?tenant=`) rồi ghép các khối |
| `usage-panel.tsx` | Trạng thái, kỳ hiện tại, hai thanh hạn mức, ngưỡng 80 %/100 % |
| `legacy-panel.tsx` | Mức dùng hôm nay theo từng khoá cho tenant `legacy` |
| `periods-panel.tsx` | Bảng các kỳ đã cấp và các gói credit |
| `command-dialog.tsx` | Hộp thoại nhập của năm lệnh, validate tại chỗ trước khi gửi |
| `receipt.tsx` | Khối biên lai / khối lỗi sau khi lệnh đã gửi thật |
| `*.test.ts(x)` | Test tương ứng cho từng file trên |

**Sửa:** `apps/api/src/index.ts` (thứ tự middleware), `apps/api/src/routes/billing-admin.ts` (audit + mount route đọc), `apps/api/src/billing/quota-object.ts` (`readPeriods`), `apps/api/src/billing/types.ts` (ba kiểu mới), `apps/api/src/routes/admin.ts` (mount catalog), `scripts/api-db-test.mjs` (xoá state DO), `apps/admin/src/routes.tsx`, `apps/admin/e2e/admin.spec.ts`.

**Không có migration nào trong pha này.** Không thêm bảng, không thêm cột; `admin_audit` đã có `GRANT INSERT` cho role `api` từ `0017` và đang chạy thật từ pha 2. Vì vậy **không** phải qua cổng `pnpm check:migration` và không có bước "migrate trước rồi mới deploy" — nhưng Task 16 vẫn đối chiếu `/healthz/db` để chắc chắn máy chủ đang ở `0019` như hiện tại.

---

## Bảng mã lỗi → câu tiếng Việt (nguồn duy nhất, Task 8 sẽ ghi thành mã)

Mỗi mã 409 ứng với một cổng chặn khác nhau; spec 11.4 đòi hiện đúng mã kèm giải thích, vì người vận hành cần biết **cổng nào** đã chặn để biết phải sửa gì.

| Mã | HTTP | Câu tiếng Việt hiện trên màn hình |
|---|---|---|
| `invalid_command` | 400 | Lệnh không hợp lệ — thiếu trường bắt buộc hoặc có trường lạ. Đây là lỗi của trang Admin, không phải của dữ liệu khách hàng. |
| `payload_too_large` | 413 | Nội dung lệnh vượt 16 KB. Rút gọn ô Lý do. |
| `operation_conflict` | 409 | Mã thao tác này đã dùng cho một lệnh khác nội dung. Đóng hộp thoại rồi mở lại để sinh mã mới. |
| `revision_conflict` | 409 | Sổ đã thay đổi kể từ lúc mở màn hình (một lệnh khác vừa chạy). Bấm Tải lại rồi gửi lại. |
| `business_identity_conflict` | 409 | Cặp mã thanh toán + dòng hoá đơn này đã dùng cho một lệnh khác nội dung. Đổi dòng hoá đơn, hoặc kiểm lại bậc/ngày đã nhập. |
| `tenant_conflict` | 409 | Sổ quota này đang thuộc về một tenant khác. Không gửi tiếp; báo lại để kiểm tra dữ liệu. |
| `period_overlap` | 409 | Kỳ mới chồng lên một kỳ đã có. Chọn ngày bắt đầu từ sau ngày kết thúc của kỳ hiện tại. |
| `period_not_active` | 409 | Kỳ ghi trên lệnh không phải kỳ đang chạy. Chỉ cộng credit được cho kỳ hiện tại. |
| `trial_already_used` | 409 | Tenant này đã dùng bản dùng thử một lần rồi; không bật lại được. Cấp một kỳ trả phí. |
| `credits_require_paid_active` | 409 | Chỉ cộng credit cho thuê bao trả phí đang hoạt động — bản dùng thử và thuê bao hết hạn thì không. |
| `no_entitlement` | 409 | Tenant chưa có quyền thương mại nào để tạm dừng hoặc mở lại. |
| `invalid_unlock` | 400 | Thiếu mã thao tác hoặc lý do khi mở khoá. |
| `tenant_not_found` | 404 | Không có tenant này. |
| `invalid_tenant` | 400 | Mã tenant không phải UUID. |
| `billing_admin_forbidden` | 403 | Tài khoản đăng nhập không nằm trong `BILLING_ADMIN_EMAILS`, nên không gửi được lệnh billing. |
| `cross_site_request` | 403 | Yêu cầu bị chặn vì không xuất phát từ chính trang Admin. |
| `upstream_unavailable` | 503 | Sổ quota hoặc cơ sở dữ liệu không phản hồi. Chưa chắc lệnh đã chạy hay chưa — mở lại màn hình, đối chiếu rồi mới gửi lại **bằng đúng mã thao tác cũ**. |

Dòng cuối là dòng quan trọng nhất: `upstream_unavailable` là trạng thái **không biết**, và cách duy nhất an toàn để thử lại là dùng lại `operationId` cũ (idempotent), chứ không phải bấm nút lần nữa để sinh mã mới.

---

# TASK 0 — XÁC NHẬN ĐIỀU KIỆN TRƯỚC KHI VIẾT MÃ

**Files:** không sửa file nào.

Auto mode chặn máy đọc production, nên PHONG chạy hai lệnh dưới đây trong phiên Claude Code bằng tiền tố `!`.

- [ ] **Step 1: Xác nhận `BILLING_ADMIN_EMAILS` còn đúng**

```bash
cd apps/api && pnpm exec wrangler secret list --env production
```

Mong đợi: có `BILLING_ADMIN_EMAILS`. Pha 2 đã xác minh email Access của PHONG nằm trong đó (thu hồi khoá chạy thật trên production 16/09). Nếu danh sách đã bị đặt lại vì lý do nào khác, mọi nút trong pha này trả 403 `billing_admin_forbidden`. Đặt lại bằng `wrangler secret put BILLING_ADMIN_EMAILS --env production` — lệnh này **ghi đè**, phải dán lại toàn bộ danh sách.

- [ ] **Step 2: Xác nhận `BILLING_ADMIN_ORIGIN`**

```bash
cd apps/api && pnpm exec wrangler secret list --env production | grep -i BILLING_ADMIN_ORIGIN || echo "không đặt"
```

Sau Task 1, cổng chống CSRF chung sẽ phủ nhóm billing nên biến này không còn là lớp bảo vệ duy nhất. Nhưng **nếu** nó có đặt và giá trị khác `https://api.ai-solutions.io.vn`, mọi POST từ trang Admin sẽ nhận 403 `invalid_admin_origin`. Đặt đúng hoặc gỡ hẳn.

- [ ] **Step 3: Ghi kết quả vào chính plan này**

```
BILLING_ADMIN_EMAILS chứa email Access của PHONG: (có / không → đã thêm ngày …)
BILLING_ADMIN_ORIGIN: (không đặt / = https://api.ai-solutions.io.vn / khác → đã xử lý …)
```

---

# TASK 1 — CỔNG CHỐNG CSRF PHỦ CẢ NHÓM BILLING

Lỗ hổng đã đo ở ghi chú 1. Vá trước khi giao diện bắt đầu gửi lệnh tiền bạc từ trình duyệt.

**Files:**
- Create: `apps/api/test/billing-csrf.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Viết bài kiểm (đỏ trước)**

Tạo `apps/api/test/billing-csrf.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

/**
 * Nhóm billing nằm NGOÀI app `admin` (nó mount ở index.ts trước), nên cổng chống CSRF khai trong
 * app đó không chạy cho nhóm này: đo ngày 16/09/2026 thấy POST cross-site trả 401 chứ không 403,
 * tức lớp duy nhất còn lại là cookie Access — thứ mà chính CSRF lợi dụng. Pha 3 đưa lệnh cấp gói
 * và cộng credit lên trình duyệt nên khoảng hở này phải đóng.
 */
describe('chống CSRF cho POST /v1/admin/billing/*', () => {
  it('Sec-Fetch-Site: cross-site → 403 cross_site_request, chặn TRƯỚC cả bước kiểm JWT', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/billing/${TENANT}/commands`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('cross_site_request');
  });

  it('Origin lạ → 403 cross_site_request', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/billing/${TENANT}/mode`, {
      method: 'POST',
      headers: { Origin: 'https://evil.test' },
      body: '{"mode":"legacy"}',
    });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('cross_site_request');
  });

  it('same-origin nhưng thiếu JWT → vẫn 401: cổng CSRF không thay thế Access', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/billing/${TENANT}/commands`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://api' },
      body: '{}',
    });
    expect(response.status).toBe(401);
    expect(await code(response)).toBe('missing_access_jwt');
  });

  it('GET không bị cổng CSRF chặn (chỉ POST) — thiếu JWT → 401', async () => {
    const response = await SELF.fetch(`https://api/v1/admin/billing/${TENANT}/usage`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(response.status).toBe(401);
  });

  it('công cụ dòng lệnh không gửi Origin/Sec-Fetch-Site vẫn qua cổng (quota-audit.mjs)', async () => {
    // pnpm audit:quota gọi các route backup từ Node, không có hai header đó. Cổng chỉ chặn khi
    // trình duyệt TỰ KHAI là cross-site; vắng mặt không bị coi là vi phạm.
    const response = await SELF.fetch(`https://api/v1/admin/billing/${TENANT}/backup/journal`);
    expect(response.status).toBe(401); // dừng ở Access, không phải ở CSRF
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ đúng chỗ**

```bash
cd apps/api && pnpm exec vitest run test/billing-csrf.test.ts
```

Mong đợi: hai ca đầu ĐỎ với `expected 401 to be 403`. Ba ca sau xanh ngay từ đầu — chúng là lưới an toàn cho bước sửa.

- [ ] **Step 3: Tách cổng CSRF thành middleware dùng chung**

Trong `apps/api/src/routes/admin.ts`, thay khối `admin.use('/v1/admin/*', …)` ở đầu file bằng một hàm xuất khẩu, giữ nguyên hành vi:

```ts
/**
 * Chống CSRF cho POST (audit 09/09/2026): Access chèn JWT từ cookie, nên một trang lạ có thể ép
 * trình duyệt của người duyệt gửi POST nếu cookie đi cross-site. Chặn khi trình duyệt khai
 * `Sec-Fetch-Site: cross-site` hoặc `Origin` không khớp origin của API. Đứng TRƯỚC requireAccess.
 *
 * Xuất khẩu vì nhóm billing mount ở index.ts NGOÀI app này (nó phải nằm trước để giữ
 * requireBillingAccess), nên nó phải gắn lại cổng bằng chính hàm này — không chép lại logic.
 */
export function requireSameSitePost() {
  return async (c: Context<AppEnv>, next: Next) => {
    if (c.req.method === 'POST') {
      const site = c.req.header('Sec-Fetch-Site');
      const origin = c.req.header('Origin');
      const self = new URL(c.req.url).origin;
      if (site === 'cross-site' || (origin && origin !== self)) {
        throw new ApiError(
          403,
          'cross_site_request',
          'POST admin phải xuất phát từ chính trang admin',
        );
      }
    }
    await next();
  };
}

admin.use('/v1/admin/*', requireSameSitePost());
```

Thêm `import type { Context, Next } from 'hono';` vào đầu file (hiện chỉ import `Hono`).

- [ ] **Step 4: Gắn cổng cho nhóm billing ở `index.ts`**

Sửa `apps/api/src/index.ts`, dòng 70 hiện là `app.use('/v1/admin/billing/*', requireBillingAccess());`. Chèn **trước** nó:

```ts
// Cổng chống CSRF phải đứng trước requireBillingAccess: một POST cross-site không được đi xa tới
// mức chạm vào danh sách email, và người gửi phải nhận đúng 403 cross_site_request. Nhóm này
// mount ở đây chứ không trong app `admin`, nên phải gắn lại cổng bằng tay — xem billing-csrf.test.ts.
app.use('/v1/admin/billing/*', requireSameSitePost());
app.use('/v1/admin/billing/*', requireBillingAccess());
```

Và bổ sung `requireSameSitePost` vào dòng import `import { admin } from './routes/admin';`:

```ts
import { admin, requireSameSitePost } from './routes/admin';
```

- [ ] **Step 5: Chạy lại — phải xanh cả năm ca**

```bash
cd apps/api && pnpm exec vitest run test/billing-csrf.test.ts test/admin-csrf.test.ts
```

Mong đợi: 9 test PASS (5 mới + 4 cũ). Test cũ phải còn xanh: nó chứng minh việc tách hàm không làm đổi hành vi của nhóm `/v1/admin/*`.

- [ ] **Step 6: Chạy cả bộ unit của API**

```bash
cd apps/api && pnpm exec vitest run
```

Mong đợi: toàn bộ PASS. Nếu `billing-admin.test.ts` đỏ vì thiếu header, đó là test dựng app riêng bằng `billingAdmin()` chứ không qua `index.ts` — nó không đi qua middleware mới, nên đỏ ở đó nghĩa là bạn đã sửa nhầm chỗ.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/routes/admin.ts apps/api/test/billing-csrf.test.ts
git commit -m "$(cat <<'EOF'
fix(api): cổng chống CSRF phủ cả nhóm /v1/admin/billing

Nhóm billing mount trước app admin nên middleware chống CSRF của app đó
không bao giờ chạy: POST cross-site chỉ dừng ở Access, tức lớp duy nhất
còn lại đúng là cookie mà CSRF lợi dụng.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 2 — NHẬT KÝ KIỂM TOÁN CHO LỆNH BILLING VÀ LỆNH MỞ KHOÁ

Tiêu chí nghiệm thu số 4 của spec: "Mọi thao tác ghi để lại đúng một dòng trong `admin_audit` với đúng `actor`". Pha 2 đã làm cho thu hồi khoá và đổi chế độ; `commands` và `missing-acks/unlock` vẫn chưa ghi gì. Đến pha 4 (màn Nhật ký) mà thiếu thì mọi lệnh cấp gói của pha 3 không có vết nào.

**Files:**
- Modify: `apps/api/src/routes/billing-admin.ts`
- Modify: `apps/api/test/billing-admin.test.ts`

- [ ] **Step 1: Viết bài kiểm (đỏ trước)**

Thêm vào cuối `apps/api/test/billing-admin.test.ts`:

```ts
describe('nhật ký kiểm toán cho lệnh billing', () => {
  it('lệnh thành công ghi đúng một dòng audit, có actor và KHÔNG có mã thanh toán', async () => {
    const ghi: { action: string; target?: string; detail?: Record<string, unknown> }[] = [];
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('reviewer', 'phong@test.local');
      await next();
    });
    app.route(
      '/',
      billingAdmin({
        tenantExists: async () => true,
        applyCommand: async () => ({
          operationId: 'op-1',
          revision: 4,
          status: 'active',
          tier: 'starter',
          appliedAt: new Date().toISOString(),
        }),
        // audit() mở client Postgres riêng trong waitUntil; ở tầng này không có DB nên tiêm cổng ghi.
        writeAuditEntry: (entry) => ghi.push(entry),
      }),
    );

    const response = await app.request(
      `https://api/v1/admin/billing/${TENANT}/commands`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'grantPeriod',
          operationId: 'op-1',
          reason: 'khách chuyển khoản CK-8821',
          expectedRevision: 3,
          periodId: 'p-1',
          tier: 'starter',
          startsAt: '2026-10-01T00:00:00.000Z',
          endsAt: '2026-11-01T00:00:00.000Z',
          paymentReference: 'CK-8821',
          lineItemId: 'period-1',
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(ghi).toHaveLength(1);
    expect(ghi[0]?.action).toBe('billing.command');
    expect(ghi[0]?.target).toBe(TENANT);
    expect(ghi[0]?.detail).toMatchObject({
      kind: 'grantPeriod',
      operation_id: 'op-1',
      revision: 4,
      tier: 'starter',
    });
    // Mã thanh toán là dữ liệu tài chính của khách; nhật ký kiểm toán chỉ cần biết ai làm gì.
    expect(JSON.stringify(ghi[0]?.detail)).not.toContain('CK-8821');
  });

  it('lệnh thất bại KHÔNG ghi audit — nhật ký là vết của việc đã xảy ra', async () => {
    const ghi: unknown[] = [];
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('reviewer', 'phong@test.local');
      await next();
    });
    app.route(
      '/',
      billingAdmin({
        tenantExists: async () => true,
        applyCommand: async () => {
          throw new Error('revision_conflict');
        },
        writeAuditEntry: (entry) => ghi.push(entry),
      }),
    );
    const response = await app.request(
      `https://api/v1/admin/billing/${TENANT}/commands`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"suspend"}' },
      env,
    );
    expect(response.status).toBe(409);
    expect(ghi).toHaveLength(0);
  });
});
```

Đọc đầu file `billing-admin.test.ts` để lấy đúng tên hằng `TENANT` và cách nó dựng app; nếu tên khác thì dùng tên sẵn có thay vì thêm hằng mới.

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
cd apps/api && pnpm exec vitest run test/billing-admin.test.ts
```

Mong đợi: đỏ ở `writeAuditEntry` không tồn tại trong `BillingAdminDependencies` (lỗi kiểu) — đúng như mong muốn.

- [ ] **Step 3: Thêm cổng ghi audit tiêm được vào `billingAdmin()`**

Trong `apps/api/src/routes/billing-admin.ts`, mở rộng interface phụ thuộc và thêm một hàm trợ giúp:

```ts
interface BillingAdminDependencies {
  tenantExists?: (tenantId: string, env: Env) => Promise<boolean>;
  applyCommand?: (tenantId: string, command: EntitlementCommand, env: Env) => Promise<unknown>;
  quotaBackup?: (tenantId: string, env: Env) => QuotaBackupPort;
  /**
   * Cổng ghi nhật ký, tiêm được để test kiểm nội dung dòng audit mà không cần Postgres.
   * Mặc định là `audit()` thật (chạy trong waitUntil, tự mở và đóng client riêng).
   */
  writeAuditEntry?: (entry: {
    action: string;
    target?: string;
    detail?: Record<string, string | number | boolean | null>;
  }) => void;
}
```

Trong thân `billingAdmin()`, ngay sau `const routes = new Hono<AppEnv>();`:

```ts
  const ghiAudit = (
    c: Context<AppEnv>,
    action: string,
    target: string,
    detail: Record<string, string | number | boolean | null>,
  ) => {
    if (dependencies.writeAuditEntry) {
      dependencies.writeAuditEntry({ action, target, detail });
      return;
    }
    audit(c, action, target, detail);
  };
```

- [ ] **Step 4: Ghi audit cho lệnh thành công**

Trong handler `POST /v1/admin/billing/:tenantId/commands`, thay khối trả biên lai:

```ts
      const receipt = dependencies.applyCommand
        ? await dependencies.applyCommand(tenantId, command, c.env)
        : await quotaObject(c.env, tenantId).applyCommand(command);
      // Vết kiểm toán ghi SAU khi sổ đã nhận lệnh: nhật ký là bằng chứng việc đã xảy ra, không
      // phải dự định. Chỉ những trường đủ để tra lại, không chép mã thanh toán của khách vào đây.
      const thanhPhan = receipt as { revision?: number; status?: string; tier?: string | null };
      ghiAudit(c, 'billing.command', tenantId, {
        kind: String(input.kind ?? ''),
        operation_id: String(input.operationId ?? ''),
        revision: thanhPhan.revision ?? null,
        status: thanhPhan.status ?? null,
        tier: thanhPhan.tier ?? null,
      });
      return c.json(receipt, 200, { 'cache-control': 'private, no-store' });
```

- [ ] **Step 5: Ghi audit cho lệnh mở khoá**

Trong handler `POST …/missing-acks/unlock`, sau khi có `receipt`:

```ts
      ghiAudit(c, 'billing.unlock_acks', tenantId, {
        operation_id: body.operationId,
        reason: body.reason,
        unlocked: receipt.unlocked,
      });
      return c.json(receipt, 200, { 'cache-control': 'private, no-store' });
```

Lưu ý: handler này đang lấy `tenantId` qua `c.req.param('tenantId') as string` ở dòng khai báo `const tenantId`; dùng lại biến đó, không gọi `c.req.param` lần nữa.

Khác với lệnh billing, ở đây **giữ** `reason` trong `detail`: lý do mở khoá sớm là chính nội dung cần kiểm toán (spec mục 10 cho phép — đây là lý do vận hành do người quản trị tự gõ, không phải dữ liệu tài chính của khách).

- [ ] **Step 6: Chạy lại**

```bash
cd apps/api && pnpm exec vitest run test/billing-admin.test.ts
```

Mong đợi: PASS toàn bộ, gồm hai ca mới.

- [ ] **Step 7: `pnpm lint` và `pnpm typecheck`, rồi commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/routes/billing-admin.ts apps/api/test/billing-admin.test.ts
git commit -m "$(cat <<'EOF'
feat(api): audit cho lệnh billing và lệnh mở khoá ack

Tiêu chí nghiệm thu đòi mọi thao tác ghi để lại đúng một dòng admin_audit;
hai route này là chỗ còn sót từ M5. Không chép mã thanh toán vào nhật ký.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 3 — HARNESS XOÁ SỔ DURABLE OBJECT GIỮA CÁC LẦN CHẠY

Không có bước này thì mọi test billing viết ở Task 7 và Task 15 chỉ đúng **một lần**, sau đó đỏ vì sổ còn dữ liệu của lượt trước (ghi chú 2).

**Files:**
- Modify: `scripts/api-db-test.mjs`

- [ ] **Step 1: Chứng minh vấn đề tồn tại thật**

```bash
ls -la apps/api/.wrangler/state/v3/do/
du -sh apps/api/.wrangler/state/v3/do
```

Mong đợi: thấy `mapslibvn-api-QuotaObject` với kích thước khác 0. Nếu máy vừa xoá sạch `.wrangler` thì chưa thấy — vẫn làm tiếp, đây là thư mục wrangler tạo lại ngay lần chạy đầu.

- [ ] **Step 2: Sửa harness**

Trong `scripts/api-db-test.mjs`, ngay dưới dòng `rmSync('apps/api/.wrangler/state/v3/cache', …)` hiện có:

```js
// Sổ quota của Durable Object cũng sống qua nhiều phiên, trong khi Postgres thì được dựng lại
// sạch mỗi lượt. Lệch nhau như vậy làm bộ test billing chỉ đúng lần chạy đầu: lần sau
// activateTrial nhận `trial_already_used`, còn mọi lệnh khác nhận `revision_conflict` vì
// expectedRevision tính từ một sổ đã có lịch sử. Xoá để bộ test tự chứa — cùng lý do với cache.
rmSync('apps/api/.wrangler/state/v3/do', { recursive: true, force: true });
```

- [ ] **Step 3: Ghi chú hệ quả cho người chạy `pnpm dev`**

Thêm ngay trên dòng vừa chèn:

```js
// Hệ quả đã cân nhắc: ai đang dùng `pnpm dev` với sổ quota local sẽ mất dữ liệu quota local sau
// mỗi lần chạy bộ itest. Đó là dữ liệu thử, còn một bộ test đỏ ngẫu nhiên thì tốn hàng giờ.
```

- [ ] **Step 4: Kiểm chứng bằng cách chạy harness hai lần liên tiếp**

```bash
pnpm test:api-db 2>&1 | tail -20
pnpm test:api-db 2>&1 | tail -20
```

Mong đợi: cả hai lượt cùng kết quả. (Lúc này chưa có test billing nào, nên đây mới chỉ là kiểm chứng harness không hỏng vì thiếu thư mục `do`.) Ghi lại số test của cả hai lượt để đối chiếu — chúng phải bằng nhau.

- [ ] **Step 5: Commit**

```bash
git add scripts/api-db-test.mjs
git commit -m "$(cat <<'EOF'
test(api): harness xoá luôn sổ Durable Object, không chỉ cache

Postgres được dựng lại sạch mỗi lượt còn sổ quota thì sống qua nhiều phiên;
lệch nhau làm test billing chỉ đúng lần chạy đầu.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 4 — `GET /v1/admin/plan-catalog`

Bảng giá và hạn mức từng bậc để form cấp gói không chép số vào giao diện. Chép số nghĩa là ngày đổi giá sẽ có hai sự thật khác nhau, và bên sai lại là bên người vận hành nhìn thấy.

**Files:**
- Create: `apps/api/src/routes/admin-catalog.ts`
- Create: `apps/api/test/admin-catalog.test.ts`
- Modify: `apps/api/src/routes/admin.ts`

- [ ] **Step 1: Viết bài kiểm (đỏ trước)**

Tạo `apps/api/test/admin-catalog.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/env';
import { adminCatalog } from '../src/routes/admin-catalog';

interface Catalog {
  tiers: {
    tier: string;
    priceCents: number;
    places: number;
    directions: number;
    dailyPlaces: number | null;
    dailyDirections: number | null;
    onlineSupport: boolean;
  }[];
  addOns: { group: string; units: number; priceCents: number }[];
  legacyDefaults: { places: number; directions: number; blockAtMultiple: number };
}

describe('GET /v1/admin/plan-catalog', () => {
  it('trả đủ bốn bậc theo đúng thứ tự tăng dần và hai gói cộng thêm', async () => {
    const app = new Hono<AppEnv>();
    app.route('/', adminCatalog);
    const response = await app.request('https://api/v1/admin/plan-catalog');
    expect(response.status).toBe(200);
    // Biên lai và hạn mức là dữ liệu riêng của từng tenant — không được vào cache dùng chung.
    expect(response.headers.get('cache-control')).toBe('private, no-store');

    const body = (await response.json()) as Catalog;
    expect(body.tiers.map((item) => item.tier)).toEqual([
      'trial',
      'starter',
      'professional',
      'business',
    ]);
    // Số phải khớp PLAN_CATALOG chứ không phải một bản chép tay trong route.
    expect(body.tiers[0]).toMatchObject({ tier: 'trial', places: 2_000, dailyPlaces: 200 });
    expect(body.tiers[1]).toMatchObject({ tier: 'starter', places: 30_000, dailyPlaces: null });
    expect(body.addOns).toEqual([
      { group: 'places', units: 1_000, priceCents: 100 },
      { group: 'directions', units: 1_000, priceCents: 300 },
    ]);
    // Hạn mức mặc định của tenant chưa vào sổ thương mại, và bội số mà bộ đếm KV mới chặn thật.
    expect(body.legacyDefaults).toEqual({
      places: 20_000,
      directions: 2_000,
      blockAtMultiple: 2,
    });
  });

  it('không có JWT Access → 401, y như mọi route /v1/admin khác', async () => {
    const response = await SELF.fetch('https://api/v1/admin/plan-catalog');
    expect(response.status).toBe(401);
  });

  it('KHÔNG nằm dưới /v1/admin/billing/: đường dẫn đó bị middleware :tenantId/* nuốt', async () => {
    // Đo ngày 16/09/2026: Hono khớp `/v1/admin/billing/:tenantId/*` với cả
    // `/v1/admin/billing/catalog` (tenantId = "catalog", phần * rỗng), nên bảng giá đặt ở đó sẽ
    // nhận 400 invalid_tenant trước khi tới handler. Ca này khoá lại quyết định đường dẫn.
    const response = await SELF.fetch('https://api/v1/admin/billing/catalog');
    expect(response.status).not.toBe(200);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
cd apps/api && pnpm exec vitest run test/admin-catalog.test.ts
```

Mong đợi: đỏ vì `../src/routes/admin-catalog` chưa tồn tại.

- [ ] **Step 3: Viết route**

Tạo `apps/api/src/routes/admin-catalog.ts`:

```ts
import { Hono } from 'hono';
import { PLAN_CATALOG } from '../billing/catalog';
import type { AppEnv } from '../env';
import { FREE_DIRECTIONS_PER_DAY, FREE_PLACES_PER_DAY } from '../quota';

/**
 * Bảng giá và hạn mức, phục vụ form cấp gói của trang Admin. Đặt ở `/v1/admin/plan-catalog` chứ
 * KHÔNG phải `/v1/admin/billing/catalog`: middleware `/v1/admin/billing/:tenantId/*` của nhóm
 * billing khớp luôn đường dẫn đó với `tenantId = "catalog"` và trả 400 invalid_tenant.
 *
 * Mount vào app `admin` nên đã có sẵn cổng chống CSRF + requireAccess. Không đòi quyền billing:
 * đây là bảng giá công khai trong tài liệu bán hàng, không phải dữ liệu của một khách nào.
 */
export const adminCatalog = new Hono<AppEnv>();

const TIERS = ['trial', 'starter', 'professional', 'business'] as const;
const GROUPS = ['places', 'directions'] as const;

adminCatalog.get('/v1/admin/plan-catalog', (c) =>
  c.json(
    {
      tiers: TIERS.map((tier) => ({ tier, ...PLAN_CATALOG[tier] })),
      addOns: GROUPS.map((group) => ({ group, ...PLAN_CATALOG.addOns[group] })),
      legacyDefaults: {
        places: FREE_PLACES_PER_DAY,
        directions: FREE_DIRECTIONS_PER_DAY,
        // Bộ đếm KV là số xấp xỉ nên chỉ chặn ở 2× hạn mức (quota.ts). Giao diện phải nói đúng
        // con số này, nếu không người vận hành sẽ tưởng khách bị chặn ngay khi chạm 100 %.
        blockAtMultiple: 2,
      },
    },
    200,
    { 'cache-control': 'private, no-store' },
  ),
);
```

- [ ] **Step 4: Mount vào app `admin`**

Trong `apps/api/src/routes/admin.ts`, cạnh dòng `admin.route('/', adminTenants);`:

```ts
admin.route('/', adminCatalog);
```

và thêm import `import { adminCatalog } from './admin-catalog';`.

- [ ] **Step 5: Chạy lại**

```bash
cd apps/api && pnpm exec vitest run test/admin-catalog.test.ts
```

Mong đợi: 3 PASS.

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/routes/admin-catalog.ts apps/api/src/routes/admin.ts apps/api/test/admin-catalog.test.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /v1/admin/plan-catalog cho form cấp gói

Giao diện đọc hạn mức và giá từ PLAN_CATALOG thay vì chép số; đặt ngoài
tiền tố billing vì middleware :tenantId/* khớp luôn /billing/catalog.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 5 — `readPeriods()` TRÊN SỔ QUOTA + `GET …/periods`

**Files:**
- Modify: `apps/api/src/billing/types.ts`
- Modify: `apps/api/src/billing/quota-object.ts`
- Create: `apps/api/src/routes/billing-read.ts`
- Modify: `apps/api/src/routes/billing-admin.ts`
- Create: `apps/api/test/billing-periods-object.test.ts`

- [ ] **Step 1: Viết bài kiểm trên Durable Object thật (đỏ trước)**

Tạo `apps/api/test/billing-periods-object.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { EntitlementCommand, PeriodHistory } from '../src/billing/types';

const NGAY = 86_400_000;

const so = () => env.QUOTA.get(env.QUOTA.idFromName(crypto.randomUUID()));

const capKy = (
  tenantId: string,
  expectedRevision: number,
  startsAt: number,
  endsAt: number,
  tier: 'starter' | 'professional' = 'starter',
): EntitlementCommand => ({
  kind: 'grantPeriod',
  operationId: crypto.randomUUID(),
  tenantId,
  actor: 'test',
  reason: 'test cấp kỳ',
  expectedRevision,
  periodId: crypto.randomUUID(),
  tier,
  startsAt: new Date(startsAt).toISOString(),
  endsAt: new Date(endsAt).toISOString(),
  paymentReference: crypto.randomUUID(),
  lineItemId: 'period',
});

describe('QuotaObject.readPeriods', () => {
  it('sổ trắng → hai danh sách rỗng, không ném', async () => {
    const history = (await so().readPeriods()) as PeriodHistory;
    expect(history).toEqual({ periods: [], credits: [] });
  });

  it('trả các kỳ mới nhất trước, kèm hạn mức và số đã dùng của từng nhóm', async () => {
    const object = so();
    const tenantId = crypto.randomUUID();
    const now = Date.now();
    await object.applyCommand(capKy(tenantId, 0, now - 40 * NGAY, now - 10 * NGAY));
    await object.applyCommand(capKy(tenantId, 1, now - 1000, now + 30 * NGAY, 'professional'));

    // Tiêu một lượt places trong kỳ đang chạy để `used` khác 0 một cách có thật.
    const reserve = await object.reserve('req-1', 'places');
    expect(reserve.allowed).toBe(true);
    await object.prepare('req-1', 'a'.repeat(64));

    const history = (await object.readPeriods()) as PeriodHistory;
    expect(history.periods).toHaveLength(2);
    expect(history.periods[0]?.tier).toBe('professional');
    expect(history.periods[0]?.places).toMatchObject({ limit: 100_000, reserved: 1, used: 0 });
    expect(history.periods[0]?.directions.limit).toBe(10_000);
    // Kỳ cũ vẫn còn trong sổ và không lẫn số của kỳ mới.
    expect(history.periods[1]?.tier).toBe('starter');
    expect(history.periods[1]?.places).toMatchObject({ limit: 30_000, used: 0, reserved: 0 });
    // Mốc thời gian trả về dạng ISO để giao diện không phải đoán đơn vị.
    expect(Number.isFinite(Date.parse(String(history.periods[0]?.startsAt)))).toBe(true);
  });

  it('liệt kê gói credit đã cộng, kèm số còn lại của từng gói', async () => {
    const object = so();
    const tenantId = crypto.randomUUID();
    const now = Date.now();
    const period = capKy(tenantId, 0, now - 1000, now + 30 * NGAY);
    await object.applyCommand(period);
    await object.applyCommand({
      kind: 'addCredits',
      operationId: crypto.randomUUID(),
      tenantId,
      actor: 'test',
      reason: 'khách mua thêm',
      expectedRevision: 1,
      periodId: (period as { periodId: string }).periodId,
      group: 'places',
      packs: 3,
      paymentReference: 'CK-1',
      lineItemId: 'credits-1',
    });

    const history = (await object.readPeriods()) as PeriodHistory;
    expect(history.credits).toHaveLength(1);
    expect(history.credits[0]).toMatchObject({
      group: 'places',
      units: 3_000,
      used: 0,
      reserved: 0,
      paymentReference: 'CK-1',
      lineItemId: 'credits-1',
    });
  });

  it('chỉ đọc: gọi hai lần không đổi revision của sổ', async () => {
    const object = so();
    const tenantId = crypto.randomUUID();
    await object.applyCommand(capKy(tenantId, 0, Date.now() - 1000, Date.now() + NGAY));
    const truoc = (await object.readUsage()).revision;
    await object.readPeriods();
    await object.readPeriods();
    expect((await object.readUsage()).revision).toBe(truoc);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
cd apps/api && pnpm exec vitest run test/billing-periods-object.test.ts
```

Mong đợi: đỏ vì `readPeriods` chưa tồn tại (lỗi kiểu) và `PeriodHistory` chưa export.

- [ ] **Step 3: Thêm ba kiểu vào `billing/types.ts`**

Chèn ngay sau `export interface CommandReceipt { … }`:

```ts
/** Số của một nhóm quota trong MỘT kỳ. Khác `GroupUsage`: không có credit, vì credit đứng riêng. */
export interface PeriodGroupUsage {
  limit: number;
  used: number;
  reserved: number;
}

export interface PeriodSummary {
  periodId: string;
  tier: Tier;
  startsAt: string;
  endsAt: string;
  /** null với kỳ dùng thử — nó không đi kèm giao dịch nào. */
  paymentReference: string | null;
  lineItemId: string | null;
  places: PeriodGroupUsage;
  directions: PeriodGroupUsage;
}

export interface CreditSummary {
  grantId: string;
  periodId: string;
  group: QuotaGroup;
  units: number;
  used: number;
  reserved: number;
  expiresAt: string;
  paymentReference: string;
  lineItemId: string;
}

/** Lịch sử chỉ-đọc của một sổ quota: các kỳ đã cấp và các gói credit đã cộng. */
export interface PeriodHistory {
  periods: PeriodSummary[];
  credits: CreditSummary[];
}
```

- [ ] **Step 4: Viết `readPeriods()`**

Trong `apps/api/src/billing/quota-object.ts`, thêm phương thức **ngay sau `readUsage()`** (giữ hai hàm đọc cạnh nhau):

```ts
  /**
   * Lịch sử kỳ và credit cho màn Gói cước & hạn mức. CHỈ ĐỌC: không mở transaction, không ghi
   * journal, không đụng alarm — gọi bao nhiêu lần cũng không đổi revision.
   *
   * Không gộp vào `readUsage()`: đường nóng của mỗi request thương mại gọi hàm đó, và quét cả
   * bảng `period`/`credit_grant` ở đấy là trả giá bằng độ trễ của khách để phục vụ một màn quản trị.
   */
  async readPeriods(limit = 24): Promise<PeriodHistory> {
    const gioiHan = Math.min(Math.max(Math.trunc(Number(limit)) || 24, 1), 60);
    const sql = this.ctx.storage.sql;

    const periods = sql
      .exec(
        `SELECT period_id, tier, starts_at, ends_at, places_limit, directions_limit,
                payment_reference, line_item_id
           FROM period ORDER BY starts_at DESC LIMIT ?`,
        gioiHan,
      )
      .toArray() as {
      period_id: string;
      tier: Tier;
      starts_at: number;
      ends_at: number;
      places_limit: number;
      directions_limit: number;
      payment_reference: string | null;
      line_item_id: string | null;
    }[];

    // Gộp một lần cho cả bảng rồi ghép trong bộ nhớ: `counter` có thêm chiều ngày cho kỳ dùng thử
    // (day_key), nên phải SUM chứ không đọc thẳng một dòng — đọc thẳng sẽ chỉ ra số của một ngày.
    const dem = sql
      .exec(
        `SELECT source_id, group_name, coalesce(sum(used),0) AS used,
                coalesce(sum(reserved),0) AS reserved
           FROM counter GROUP BY source_id, group_name`,
      )
      .toArray() as { source_id: string; group_name: string; used: number; reserved: number }[];

    const tra = (periodId: string, group: QuotaGroup, limitValue: number): PeriodGroupUsage => {
      const row = dem.find((item) => item.source_id === periodId && item.group_name === group);
      return { limit: limitValue, used: row?.used ?? 0, reserved: row?.reserved ?? 0 };
    };

    const credits = sql
      .exec(
        `SELECT grant_id, period_id, group_name, units, used, reserved, expires_at,
                payment_reference, line_item_id
           FROM credit_grant ORDER BY expires_at DESC LIMIT ?`,
        gioiHan * 4,
      )
      .toArray() as {
      grant_id: string;
      period_id: string;
      group_name: QuotaGroup;
      units: number;
      used: number;
      reserved: number;
      expires_at: number;
      payment_reference: string;
      line_item_id: string;
    }[];

    return {
      periods: periods.map((row) => ({
        periodId: row.period_id,
        tier: row.tier,
        startsAt: new Date(row.starts_at).toISOString(),
        endsAt: new Date(row.ends_at).toISOString(),
        paymentReference: row.payment_reference,
        lineItemId: row.line_item_id,
        places: tra(row.period_id, 'places', row.places_limit),
        directions: tra(row.period_id, 'directions', row.directions_limit),
      })),
      credits: credits.map((row) => ({
        grantId: row.grant_id,
        periodId: row.period_id,
        group: row.group_name,
        units: row.units,
        used: row.used,
        reserved: row.reserved,
        expiresAt: new Date(row.expires_at).toISOString(),
        paymentReference: row.payment_reference,
        lineItemId: row.line_item_id,
      })),
    };
  }
```

Bổ sung `PeriodGroupUsage`, `PeriodHistory` vào dòng `import type { … } from './types';` ở đầu file.

- [ ] **Step 5: Chạy lại test DO**

```bash
cd apps/api && pnpm exec vitest run test/billing-periods-object.test.ts
```

Mong đợi: 4 PASS. Nếu thấy lỗi "Cannot perform I/O on behalf of a different request" hoặc isolated storage kêu ca, kiểm lại rằng mỗi `it` dùng `so()` riêng — đó là bẫy đã biết của `vitest-pool-workers`.

- [ ] **Step 6: Viết route đọc**

Tạo `apps/api/src/routes/billing-read.ts`:

```ts
import { Hono } from 'hono';
import { quotaObject } from '../billing/object';
import type { AppEnv } from '../env';

/**
 * Hai route CHỈ ĐỌC của nhóm billing. Tách khỏi `billing-admin.ts` (nơi giữ các lệnh ghi) để file
 * đó không phình thêm, nhưng vẫn được mount BÊN TRONG `billingAdmin()`: chúng phải hưởng đúng
 * middleware kiểm tenant tồn tại đã khai ở đó, và ở index.ts cả tiền tố đã nằm sau
 * requireSameSitePost() + requireBillingAccess().
 */
export const billingRead = new Hono<AppEnv>();

const NO_STORE = { 'cache-control': 'private, no-store' } as const;

billingRead.get('/v1/admin/billing/:tenantId/periods', async (c) => {
  const limit = Number(c.req.query('limit') ?? '24');
  const history = await quotaObject(c.env, c.req.param('tenantId')).readPeriods(limit);
  return c.json(history, 200, NO_STORE);
});
```

(Route `legacy-usage` thêm vào chính file này ở Task 6.)

- [ ] **Step 7: Mount vào `billingAdmin()`**

Trong `apps/api/src/routes/billing-admin.ts`, ngay **sau** handler `routes.get('/v1/admin/billing/:tenantId/usage', …)`:

```ts
  // Mount SAU hai middleware ở trên để nhóm đọc cũng qua cổng kiểm tenant tồn tại; mount trước
  // chúng thì `/periods` của một uuid không có thật sẽ trả 200 với sổ rỗng thay vì 404.
  routes.route('/', billingRead);
```

và thêm `import { billingRead } from './billing-read';`.

- [ ] **Step 8: Chạy cả bộ unit**

```bash
cd apps/api && pnpm exec vitest run
```

Mong đợi: xanh toàn bộ.

- [ ] **Step 9: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/billing/types.ts apps/api/src/billing/quota-object.ts apps/api/src/routes/billing-read.ts apps/api/src/routes/billing-admin.ts apps/api/test/billing-periods-object.test.ts
git commit -m "$(cat <<'EOF'
feat(api): readPeriods trên sổ quota + GET /v1/admin/billing/:id/periods

Màn Gói cước cần lịch sử kỳ và các gói credit; readUsage chỉ trả kỳ đang
chạy. Hàm mới chỉ đọc, không đụng journal và không nằm trên đường nóng.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 6 — `GET …/legacy-usage` (MỨC DÙNG HÔM NAY CỦA TENANT CHƯA VÀO SỔ)

PHONG chốt 16/09/2026: tenant `legacy` phải thấy số thật, không để màn hình trống. Nguồn duy nhất có sẵn là bộ đếm KV theo ngày.

**Files:**
- Modify: `apps/api/src/routes/billing-read.ts`
- Create: `apps/api/test/billing-read.test.ts`

- [ ] **Step 1: Viết bài kiểm (đỏ trước)**

Tạo `apps/api/test/billing-read.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/env';
import { vnDay } from '../src/quota';
import { billingReadWith } from '../src/routes/billing-read';

const TENANT = '00000000-0000-4000-8000-0000000000cc';

interface LegacyUsage {
  day: string;
  quotaEnabled: boolean;
  plan: string;
  counted: boolean;
  blockAtMultiple: number;
  keys: {
    keyPrefix: string;
    label: string | null;
    places: { used: number; limit: number };
    directions: { used: number; limit: number };
  }[];
  total: { places: { used: number; limit: number }; directions: { used: number; limit: number } };
}

/**
 * Tầng này KHÔNG có Postgres (binding Hyperdrive của apps/api/test trỏ cổng đóng), nên route nhận
 * hai phụ thuộc tiêm được: danh sách khoá và thông tin tenant. Bài kiểm SQL thật nằm ở
 * apps/api/test-db/admin-billing.itest.mjs.
 */
describe('GET /v1/admin/billing/:tenantId/legacy-usage', () => {
  it('cộng bộ đếm KV của từng khoá thành tổng của tenant', async () => {
    const day = vnDay();
    await env.META.put(`quota:${'a'.repeat(64)}:${day}:places`, '1284');
    await env.META.put(`quota:${'a'.repeat(64)}:${day}:directions`, '37');
    await env.META.put(`quota:${'b'.repeat(64)}:${day}:places`, '16');

    const app = new Hono<AppEnv>();
    app.route(
      '/',
      billingReadWith({
        tenantInfo: async () => ({ plan: 'free' }),
        tenantKeys: async () => [
          {
            key_hash: 'a'.repeat(64),
            key_prefix: 'mlv_live_aaaaaaaa',
            label: 'khoá web',
            quota_places_per_day: null,
            quota_directions_per_day: null,
          },
          {
            key_hash: 'b'.repeat(64),
            key_prefix: 'mlv_live_bbbbbbbb',
            label: null,
            quota_places_per_day: 5_000,
            quota_directions_per_day: null,
          },
        ],
      }),
    );

    const response = await app.request(`https://api/v1/admin/billing/${TENANT}/legacy-usage`, {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');

    const body = (await response.json()) as LegacyUsage;
    expect(body.day).toBe(day);
    expect(body.keys).toHaveLength(2);
    expect(body.keys[0]).toMatchObject({
      keyPrefix: 'mlv_live_aaaaaaaa',
      label: 'khoá web',
      places: { used: 1_284, limit: 20_000 },
      directions: { used: 37, limit: 2_000 },
    });
    // Hạn mức riêng của khoá thắng mặc định plan free.
    expect(body.keys[1]?.places).toMatchObject({ used: 16, limit: 5_000 });
    expect(body.total.places).toEqual({ used: 1_300, limit: 25_000 });
    expect(body.total.directions).toEqual({ used: 37, limit: 4_000 });
    // Giao diện phải nói đúng ngưỡng chặn thật, không phải 100 %.
    expect(body.blockAtMultiple).toBe(2);
  });

  it('khoá chưa gọi lần nào → 0, không phải thiếu trường', async () => {
    const app = new Hono<AppEnv>();
    app.route(
      '/',
      billingReadWith({
        tenantInfo: async () => ({ plan: 'free' }),
        tenantKeys: async () => [
          {
            key_hash: 'c'.repeat(64),
            key_prefix: 'mlv_live_cccccccc',
            label: null,
            quota_places_per_day: null,
            quota_directions_per_day: null,
          },
        ],
      }),
    );
    const body = (await (
      await app.request(`https://api/v1/admin/billing/${TENANT}/legacy-usage`, {}, env)
    ).json()) as LegacyUsage;
    expect(body.keys[0]?.places.used).toBe(0);
    expect(body.keys[0]?.directions.used).toBe(0);
  });

  it('tenant internal: counted=false — bộ đếm KV cố ý không chạy cho nhóm này', async () => {
    const app = new Hono<AppEnv>();
    app.route(
      '/',
      billingReadWith({
        tenantInfo: async () => ({ plan: 'internal' }),
        tenantKeys: async () => [],
      }),
    );
    const body = (await (
      await app.request(`https://api/v1/admin/billing/${TENANT}/legacy-usage`, {}, env)
    ).json()) as LegacyUsage;
    expect(body.plan).toBe('internal');
    expect(body.counted).toBe(false);
  });

  it('QUOTA_ENABLED khác "1": quotaEnabled=false để màn hình giải thích vì sao mọi số là 0', async () => {
    const app = new Hono<AppEnv>();
    app.route(
      '/',
      billingReadWith({
        tenantInfo: async () => ({ plan: 'free' }),
        tenantKeys: async () => [],
      }),
    );
    const body = (await (
      await app.request(
        `https://api/v1/admin/billing/${TENANT}/legacy-usage`,
        {},
        { ...env, QUOTA_ENABLED: '0' },
      )
    ).json()) as LegacyUsage;
    expect(body.quotaEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
cd apps/api && pnpm exec vitest run test/billing-read.test.ts
```

Mong đợi: đỏ vì `billingReadWith` chưa tồn tại.

- [ ] **Step 3: Đổi `billing-read.ts` sang dạng nhà máy có cổng tiêm**

Viết lại toàn bộ `apps/api/src/routes/billing-read.ts`:

```ts
import { Hono } from 'hono';
import { quotaObject } from '../billing/object';
import { endSql, getSql } from '../db';
import type { AppEnv, Env } from '../env';
import { FREE_DIRECTIONS_PER_DAY, FREE_PLACES_PER_DAY, vnDay } from '../quota';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;

/** Trần số khoá đọc trong một lần: mỗi khoá tốn hai lượt đọc KV, đừng để một tenant lạ làm nổ. */
const MAX_KEYS = 50;

interface KeyRow {
  key_hash: string;
  key_prefix: string;
  label: string | null;
  quota_places_per_day: number | null;
  quota_directions_per_day: number | null;
}

interface BillingReadDependencies {
  tenantInfo?: (tenantId: string, env: Env) => Promise<{ plan: string } | null>;
  tenantKeys?: (tenantId: string, env: Env) => Promise<KeyRow[]>;
}

async function tenantInfoTuDb(
  tenantId: string,
  env: Env,
  executionCtx: { waitUntil(promise: Promise<unknown>): void },
) {
  const sql = getSql(env);
  try {
    const rows = await sql<{ plan: string }[]>`SELECT plan FROM tenant WHERE id = ${tenantId}::uuid`;
    return rows[0] ?? null;
  } finally {
    endSql(executionCtx, sql);
  }
}

async function tenantKeysTuDb(
  tenantId: string,
  env: Env,
  executionCtx: { waitUntil(promise: Promise<unknown>): void },
) {
  const sql = getSql(env);
  try {
    // `quota_directions_per_day` đọc qua to_jsonb thay vì tham chiếu cột: Postgres phân giải cột
    // ngay lúc parse, nên Worker deploy trước migration thêm cột sẽ làm hỏng CẢ câu (sự cố 06/09).
    return await sql<KeyRow[]>`
      SELECT k.key_hash, k.key_prefix, k.label, k.quota_places_per_day,
             (to_jsonb(k) ->> 'quota_directions_per_day')::int AS quota_directions_per_day
      FROM api_key k
      WHERE k.tenant_id = ${tenantId}::uuid AND k.active AND k.revoked_at IS NULL
      ORDER BY k.created_at
      LIMIT ${MAX_KEYS}`;
  } finally {
    endSql(executionCtx, sql);
  }
}

/**
 * Hai route CHỈ ĐỌC của nhóm billing, dạng nhà máy để test tiêm được cổng đọc Postgres
 * (apps/api/test/** không có DB). Mount BÊN TRONG `billingAdmin()` nên hưởng đúng middleware kiểm
 * tenant tồn tại, và ở index.ts cả tiền tố đã nằm sau requireSameSitePost() + requireBillingAccess().
 */
export function billingReadWith(dependencies: BillingReadDependencies = {}) {
  const routes = new Hono<AppEnv>();

  routes.get('/v1/admin/billing/:tenantId/periods', async (c) => {
    const limit = Number(c.req.query('limit') ?? '24');
    const history = await quotaObject(c.env, c.req.param('tenantId')).readPeriods(limit);
    return c.json(history, 200, NO_STORE);
  });

  /**
   * Mức dùng HÔM NAY của tenant chưa bật chế độ thương mại. Nguồn là bộ đếm xấp xỉ trong KV
   * (`quota:<key_hash>:<ngày VN>:<nhóm>`, TTL hai ngày) — thứ duy nhất tồn tại cho nhóm này, vì
   * sổ Durable Object chỉ ghi cho tenant `commercial`. Đọc route này KHÔNG tạo sổ quota.
   */
  routes.get('/v1/admin/billing/:tenantId/legacy-usage', async (c) => {
    const tenantId = c.req.param('tenantId');
    try {
      const tenant = dependencies.tenantInfo
        ? await dependencies.tenantInfo(tenantId, c.env)
        : await tenantInfoTuDb(tenantId, c.env, c.executionCtx);
      const keys = dependencies.tenantKeys
        ? await dependencies.tenantKeys(tenantId, c.env)
        : await tenantKeysTuDb(tenantId, c.env, c.executionCtx);

      const day = vnDay();
      const items = await Promise.all(
        keys.map(async (key) => {
          const [places, directions] = await Promise.all([
            c.env.META.get(`quota:${key.key_hash}:${day}:places`),
            c.env.META.get(`quota:${key.key_hash}:${day}:directions`),
          ]);
          return {
            keyPrefix: key.key_prefix,
            label: key.label,
            places: {
              used: Number(places ?? 0),
              limit: key.quota_places_per_day ?? FREE_PLACES_PER_DAY,
            },
            directions: {
              used: Number(directions ?? 0),
              limit: key.quota_directions_per_day ?? FREE_DIRECTIONS_PER_DAY,
            },
          };
        }),
      );

      const cong = (group: 'places' | 'directions') => ({
        used: items.reduce((tong, item) => tong + item[group].used, 0),
        limit: items.reduce((tong, item) => tong + item[group].limit, 0),
      });

      return c.json(
        {
          day,
          quotaEnabled: c.env.QUOTA_ENABLED === '1',
          plan: tenant?.plan ?? 'free',
          // Tenant internal cố ý không tốn lượt ghi KV (Workers Free giới hạn 1.000 ghi/ngày),
          // nên số 0 ở đây là thiết kế chứ không phải khách không dùng.
          counted: (tenant?.plan ?? 'free') !== 'internal',
          blockAtMultiple: 2,
          keys: items,
          total: { places: cong('places'), directions: cong('directions') },
        },
        200,
        NO_STORE,
      );
    } catch (error) {
      console.error('billing legacy-usage', error);
      return c.json({ error: { code: 'upstream_unavailable' } }, 503);
    }
  });

  return routes;
}

/** Bản dùng ở production, không tiêm gì. */
export const billingRead = billingReadWith();
```

- [ ] **Step 4: Chạy lại**

```bash
cd apps/api && pnpm exec vitest run test/billing-read.test.ts
```

Mong đợi: 4 PASS. Nếu ca đầu lệch số, đối chiếu lại: `total.limit` cộng hạn mức của từng khoá — đó là cách legacy thật sự hoạt động (hạn mức tính theo **khoá**, không phải theo tenant), và màn hình phải nói rõ điều đó.

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/routes/billing-read.ts apps/api/test/billing-read.test.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /v1/admin/billing/:id/legacy-usage

Tenant chưa bật chế độ thương mại không có gì trong sổ Durable Object;
màn Gói cước đọc bộ đếm KV theo từng khoá để không hiện một trang toàn 0.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 7 — ITEST TRÊN POSTGRES + SỔ THẬT CHO CẢ NHÓM BILLING

Đây là tầng duy nhất thấy được những lỗi mà unit test không thấy: SQL thật qua Hyperdrive, sổ Durable Object thật, `admin_audit` thật, và cổng CSRF thật.

**Files:**
- Create: `apps/api/test-db/admin-billing.itest.mjs`
- Modify: `scripts/api-db-test.mjs`

- [ ] **Step 1: Bật bộ đếm legacy trong harness**

`wrangler.toml` đặt `QUOTA_ENABLED = "0"` cho môi trường mặc định, nên nếu không bật thì `legacy-usage` không bao giờ có số khác 0 và bài kiểm ở Step 3 chỉ kiểm được cấu trúc rỗng. Trong `scripts/api-db-test.mjs`, thêm vào mảng `--var` của `wrangler dev` (cạnh `AUTOCOMPLETE_TELEX:1`):

```js
    // Bộ đếm quota legacy trong KV chỉ ghi khi bật cờ này. Không bật thì itest của
    // /legacy-usage chỉ kiểm được một bảng rỗng — tức không kiểm gì. Ngưỡng chặn là 2× hạn mức
    // ngày (20.000 places), xa hơn mọi bộ test, nên bật cờ không làm test khác đỏ.
    '--var',
    'QUOTA_ENABLED:1',
```

- [ ] **Step 2: Chạy bộ itest hiện có để chắc chắn cờ mới không làm đỏ gì**

```bash
pnpm test:api-db 2>&1 | tail -25
```

Mong đợi: đúng số test như trước Task 7, tất cả xanh.

- [ ] **Step 3: Viết itest**

Tạo `apps/api/test-db/admin-billing.itest.mjs`:

```js
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const POI_ID = '01M3TEST0000000000000CAF01';

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      'Sec-Fetch-Site': 'same-origin',
      ...(init.headers ?? {}),
    },
  });

/**
 * Mỗi bài dùng một tenant MỚI. Sổ quota là một Durable Object định danh theo uuid tenant, và sổ
 * đó sống trong .wrangler/state qua nhiều phiên; dùng lại tenant seed sẽ khiến bài kiểm chỉ đúng
 * lần chạy đầu (activateTrial nhận trial_already_used, mọi lệnh khác nhận revision_conflict).
 */
const taoTenant = async (name, plan = 'free') => {
  const id = crypto.randomUUID();
  await sql`INSERT INTO tenant (id, name, plan) VALUES (${id}::uuid, ${name}, ${plan})`;
  return id;
};

const capKhoa = async (tenantId, label) =>
  (
    await adminFetch(`/v1/admin/tenants/${tenantId}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, kind: 'server', scopes: ['places:read'] }),
    })
  ).json();

const guiLenh = (tenantId, body) =>
  adminFetch(`/v1/admin/billing/${tenantId}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const doc = async (tenantId, duong) => (await adminFetch(`/v1/admin/billing/${tenantId}/${duong}`)).json();
const ma = async (response) => (await response.json()).error?.code;

/** admin_audit ghi trong waitUntil nên có thể tới sau phản hồi. */
const doiAudit = async (action, target, soDong) => {
  let rows = [];
  for (let i = 0; i < 20 && rows.length < soDong; i += 1) {
    rows = await sql`SELECT actor, action, target, detail FROM admin_audit
      WHERE action = ${action} AND target = ${target} ORDER BY id`;
    if (rows.length < soDong) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return rows;
};

describe('GET /v1/admin/plan-catalog', () => {
  it('trả bảng giá khớp PLAN_CATALOG', async () => {
    const body = await (await adminFetch('/v1/admin/plan-catalog')).json();
    expect(body.tiers.map((item) => item.tier)).toEqual([
      'trial',
      'starter',
      'professional',
      'business',
    ]);
    expect(body.legacyDefaults.blockAtMultiple).toBe(2);
  });
});

describe('bản dùng thử', () => {
  it('kích hoạt trial rồi đọc lại usage: hạn mức đúng bậc trial, revision tăng 1', async () => {
    const tenantId = await taoTenant('itest trial');
    const truoc = await doc(tenantId, 'usage');
    expect(truoc.status).toBe('none');
    expect(truoc.revision).toBe(0);

    const response = await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'itest bật dùng thử',
      expectedRevision: 0,
      startsAt: new Date().toISOString(),
    });
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ revision: 1, status: 'active', tier: 'trial' });

    const sau = await doc(tenantId, 'usage');
    expect(sau.status).toBe('active');
    expect(sau.tier).toBe('trial');
    expect(sau.places.limit).toBe(2_000);
    expect(sau.directions.limit).toBe(200);
    expect(sau.trialUsedOnce).toBe(true);
  });

  it('bật lần thứ hai → 409 trial_already_used, không phải 503', async () => {
    const tenantId = await taoTenant('itest trial hai lần');
    await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'lần một',
      expectedRevision: 0,
      startsAt: new Date().toISOString(),
    });
    const lai = await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'lần hai',
      expectedRevision: 1,
      startsAt: new Date().toISOString(),
    });
    expect(lai.status).toBe(409);
    expect(await ma(lai)).toBe('trial_already_used');
  });
});

describe('cấp kỳ trả phí, cộng credit và các cổng chặn', () => {
  it('luồng đầy đủ: cấp kỳ → cộng credit → usage và periods khớp nhau', async () => {
    const tenantId = await taoTenant('itest cấp kỳ');
    const periodId = crypto.randomUUID();
    const paymentReference = `CK-${Date.now()}`;

    const cap = await guiLenh(tenantId, {
      kind: 'grantPeriod',
      operationId: crypto.randomUUID(),
      reason: 'itest cấp kỳ starter',
      expectedRevision: 0,
      periodId,
      tier: 'starter',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      paymentReference,
      lineItemId: 'period-1',
    });
    expect(cap.status).toBe(200);
    expect(await cap.json()).toMatchObject({ revision: 1, status: 'active', tier: 'starter' });

    const themCredit = await guiLenh(tenantId, {
      kind: 'addCredits',
      operationId: crypto.randomUUID(),
      reason: 'itest mua thêm',
      expectedRevision: 1,
      periodId,
      group: 'places',
      packs: 2,
      paymentReference,
      lineItemId: 'credits-1',
    });
    expect(themCredit.status).toBe(200);

    const usage = await doc(tenantId, 'usage');
    expect(usage.tier).toBe('starter');
    expect(usage.places.limit).toBe(30_000);
    expect(usage.places.credits).toBe(2_000);
    expect(usage.places.available).toBe(32_000);
    expect(usage.periodId).toBe(periodId);

    const history = await doc(tenantId, 'periods');
    expect(history.periods).toHaveLength(1);
    expect(history.periods[0]).toMatchObject({ periodId, tier: 'starter', lineItemId: 'period-1' });
    expect(history.credits).toHaveLength(1);
    expect(history.credits[0]).toMatchObject({ group: 'places', units: 2_000, lineItemId: 'credits-1' });
  });

  it('gửi lại y nguyên một lệnh (cùng operationId) KHÔNG cộng tiền lần hai', async () => {
    const tenantId = await taoTenant('itest idempotent');
    const periodId = crypto.randomUUID();
    const lenh = {
      kind: 'grantPeriod',
      operationId: crypto.randomUUID(),
      reason: 'itest gửi lại',
      expectedRevision: 0,
      periodId,
      tier: 'starter',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      paymentReference: `CK-${Date.now()}-idem`,
      lineItemId: 'period-1',
    };
    const lan1 = await (await guiLenh(tenantId, lenh)).json();
    const lan2 = await (await guiLenh(tenantId, lenh)).json();
    // Cùng biên lai, cùng revision: đây chính là cách duy nhất an toàn để thử lại sau một 503.
    expect(lan2).toEqual(lan1);
    expect((await doc(tenantId, 'periods')).periods).toHaveLength(1);
  });

  it('revision cũ → 409 revision_conflict', async () => {
    const tenantId = await taoTenant('itest revision');
    await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'itest',
      expectedRevision: 0,
      startsAt: new Date().toISOString(),
    });
    const cu = await guiLenh(tenantId, {
      kind: 'suspend',
      operationId: crypto.randomUUID(),
      reason: 'itest revision cũ',
      expectedRevision: 0,
    });
    expect(cu.status).toBe(409);
    expect(await ma(cu)).toBe('revision_conflict');
  });

  it('cùng mã thanh toán + dòng hoá đơn nhưng khác nội dung → 409 business_identity_conflict', async () => {
    const tenantId = await taoTenant('itest business identity');
    const paymentReference = `CK-${Date.now()}-bi`;
    const chung = {
      reason: 'itest',
      periodId: crypto.randomUUID(),
      tier: 'starter',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      paymentReference,
      lineItemId: 'period-1',
    };
    await guiLenh(tenantId, {
      kind: 'grantPeriod',
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
      ...chung,
    });
    const khac = await guiLenh(tenantId, {
      kind: 'grantPeriod',
      operationId: crypto.randomUUID(),
      expectedRevision: 1,
      ...chung,
      periodId: crypto.randomUUID(),
      tier: 'professional',
    });
    expect(khac.status).toBe(409);
    expect(await ma(khac)).toBe('business_identity_conflict');
  });

  it('cộng credit cho tenant chưa có thuê bao trả phí → 409 credits_require_paid_active', async () => {
    const tenantId = await taoTenant('itest credit sai chỗ');
    const response = await guiLenh(tenantId, {
      kind: 'addCredits',
      operationId: crypto.randomUUID(),
      reason: 'itest',
      expectedRevision: 0,
      periodId: crypto.randomUUID(),
      group: 'places',
      packs: 1,
      paymentReference: `CK-${Date.now()}-x`,
      lineItemId: 'credits-1',
    });
    expect(response.status).toBe(409);
    expect(await ma(response)).toBe('credits_require_paid_active');
  });

  it('tạm dừng khi chưa có quyền nào → 409 no_entitlement', async () => {
    const tenantId = await taoTenant('itest no entitlement');
    const response = await guiLenh(tenantId, {
      kind: 'suspend',
      operationId: crypto.randomUUID(),
      reason: 'itest',
      expectedRevision: 0,
    });
    expect(response.status).toBe(409);
    expect(await ma(response)).toBe('no_entitlement');
  });

  it('thân lệnh có trường lạ → 400 invalid_command (allowlist đóng cả hai chiều)', async () => {
    const tenantId = await taoTenant('itest trường lạ');
    const response = await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'itest',
      expectedRevision: 0,
      startsAt: new Date().toISOString(),
      ghiChu: 'trường này không tồn tại trong hợp đồng',
    });
    expect(response.status).toBe(400);
    expect(await ma(response)).toBe('invalid_command');
  });
});

describe('nhật ký kiểm toán và cổng bảo vệ', () => {
  it('mỗi lệnh thành công để lại đúng một dòng admin_audit với đúng actor', async () => {
    const tenantId = await taoTenant('itest audit');
    await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'itest audit',
      expectedRevision: 0,
      startsAt: new Date().toISOString(),
    });
    const rows = await doiAudit('billing.command', tenantId, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe('phong@access-fake.local');
    expect(rows[0].detail.kind).toBe('activateTrial');
    expect(rows[0].detail.revision).toBe(1);
  });

  it('mở khoá ack ghi audit kèm lý do', async () => {
    const tenantId = await taoTenant('itest unlock');
    const response = await adminFetch(`/v1/admin/billing/${tenantId}/missing-acks/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: crypto.randomUUID(), reason: 'công cụ khách quên ACK' }),
    });
    expect(response.status).toBe(200);
    const rows = await doiAudit('billing.unlock_acks', tenantId, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.reason).toBe('công cụ khách quên ACK');
  });

  it('POST từ trang lạ → 403 cross_site_request, không chạm tới sổ', async () => {
    const tenantId = await taoTenant('itest csrf');
    const response = await fetch(`${base}/v1/admin/billing/${tenantId}/commands`, {
      method: 'POST',
      headers: {
        'Cf-Access-Jwt-Assertion': jwt,
        'Sec-Fetch-Site': 'cross-site',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'activateTrial',
        operationId: crypto.randomUUID(),
        reason: 'kẻ lạ',
        expectedRevision: 0,
        startsAt: new Date().toISOString(),
      }),
    });
    expect(response.status).toBe(403);
    expect(await ma(response)).toBe('cross_site_request');
    expect((await doc(tenantId, 'usage')).status).toBe('none');
  });

  it('email ngoài BILLING_ADMIN_EMAILS → 403 billing_admin_forbidden', async () => {
    const tenantId = await taoTenant('itest quyền');
    const response = await fetch(`${base}/v1/admin/billing/${tenantId}/usage`, {
      headers: { 'Cf-Access-Jwt-Assertion': signAccessJwt({ email: 'nguoila@access-fake.local' }) },
    });
    expect(response.status).toBe(403);
    expect(await ma(response)).toBe('billing_admin_forbidden');
  });

  it('tenant không tồn tại → 404 ở cả hai route đọc mới', async () => {
    const ma404 = '11111111-1111-4111-8111-111111111111';
    expect((await adminFetch(`/v1/admin/billing/${ma404}/periods`)).status).toBe(404);
    expect((await adminFetch(`/v1/admin/billing/${ma404}/legacy-usage`)).status).toBe(404);
  });
});

describe('GET /v1/admin/billing/:id/legacy-usage', () => {
  it('đếm lượt gọi thật của từng khoá trong ngày', async () => {
    const tenantId = await taoTenant('itest legacy');
    const khoa = await capKhoa(tenantId, `itest legacy ${Date.now()}`);

    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(`${base}/v1/places/${POI_ID}`, {
        headers: { 'X-Api-Key': khoa.key },
      });
      expect(response.status).toBe(200);
    }

    // Bộ đếm ghi trong waitUntil nên tới sau phản hồi.
    let body = null;
    for (let i = 0; i < 20; i += 1) {
      body = await doc(tenantId, 'legacy-usage');
      if (body.total.places.used >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(body.quotaEnabled).toBe(true);
    expect(body.counted).toBe(true);
    expect(body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].keyPrefix).toBe(khoa.key_prefix);
    expect(body.keys[0].places.used).toBe(3);
    expect(body.keys[0].places.limit).toBe(20_000);
    expect(body.total.places.used).toBe(3);
  });

  it('KHÔNG tạo sổ quota: đọc legacy-usage xong, usage vẫn là sổ trắng', async () => {
    // Đọc usage sau cùng là lần ĐẦU tiên chạm Durable Object của tenant này. Nếu legacy-usage lỡ
    // chạm sổ thì bài này vẫn xanh — điều nó thật sự khoá là legacy-usage không ghi gì vào sổ.
    const tenantId = await taoTenant('itest không tạo sổ');
    await doc(tenantId, 'legacy-usage');
    const usage = await doc(tenantId, 'usage');
    expect(usage).toMatchObject({ status: 'none', revision: 0, tier: null });
  });
});
```

- [ ] **Step 4: Chạy**

```bash
pnpm test:api-db 2>&1 | tail -30
```

Mong đợi: toàn bộ xanh, gồm 17 bài mới.

- [ ] **Step 5: Chạy LẦN HAI — đây là bài kiểm thật sự của Task 3**

```bash
pnpm test:api-db 2>&1 | tail -30
```

Mong đợi: **kết quả giống hệt lượt một**. Nếu lượt hai đỏ ở `trial_already_used` hoặc `revision_conflict`, nghĩa là harness chưa xoá `.wrangler/state/v3/do` — quay lại Task 3.

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/test-db/admin-billing.itest.mjs scripts/api-db-test.mjs
git commit -m "$(cat <<'EOF'
test(api): itest DB thật cho nhóm billing

Tenant mới mỗi bài (sổ Durable Object định danh theo uuid tenant), phủ cả
sáu cổng 409, audit, CSRF, quyền billing và bộ đếm legacy trong KV.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 8 — LỚP GỌI API VÀ BẢNG DỊCH LỖI CỦA GIAO DIỆN

**Files:**
- Create: `apps/admin/src/features/billing/api.ts`
- Create: `apps/admin/src/features/billing/error-vi.ts`
- Create: `apps/admin/src/features/billing/api.test.ts`
- Create: `apps/admin/src/features/billing/error-vi.test.ts`

- [ ] **Step 1: Viết bài kiểm cho lớp gọi (đỏ trước)**

Tạo `apps/admin/src/features/billing/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCatalog, getLegacyUsage, getPeriods, getUsage, sendCommand, unlockAcks } from './api';

const TENANT = '00000000-0000-4000-8000-0000000000cc';

const batFetch = (body: unknown = {}) => {
  const mock = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
};

afterEach(() => vi.unstubAllGlobals());

describe('lớp gọi API của mảng billing', () => {
  it('đọc đúng bốn đường dẫn', async () => {
    const mock = batFetch({ tiers: [], addOns: [], legacyDefaults: {} });
    await getUsage(TENANT);
    await getPeriods(TENANT);
    await getLegacyUsage(TENANT);
    await getCatalog();
    expect(mock.mock.calls.map(([path]) => String(path))).toEqual([
      `/v1/admin/billing/${TENANT}/usage`,
      `/v1/admin/billing/${TENANT}/periods`,
      `/v1/admin/billing/${TENANT}/legacy-usage`,
      '/v1/admin/plan-catalog',
    ]);
  });

  it('gửi lệnh với ĐÚNG tập trường của kind, không thừa một trường nào', async () => {
    // Máy chủ dùng allowlist đóng cả hai chiều: thừa `tenantId`, `actor` hay bất kỳ trường phụ nào
    // để hiển thị đều làm cả lệnh hỏng với invalid_command. Bài này khoá lại điều đó.
    const mock = batFetch({ operationId: 'op', revision: 1, status: 'active', tier: 'trial' });
    await sendCommand(TENANT, {
      kind: 'activateTrial',
      operationId: 'op-1',
      reason: 'khách xin dùng thử',
      expectedRevision: 0,
      startsAt: '2026-09-16T17:00:00.000Z',
    });

    const [path, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/admin/billing/${TENANT}/commands`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'activateTrial',
      operationId: 'op-1',
      reason: 'khách xin dùng thử',
      expectedRevision: 0,
      startsAt: '2026-09-16T17:00:00.000Z',
    });
  });

  it('lệnh mở khoá đi đường riêng, không qua /commands', async () => {
    const mock = batFetch({ unlocked: 2 });
    await unlockAcks(TENANT, 'op-2', 'công cụ khách quên ACK');
    const [path, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/admin/billing/${TENANT}/missing-acks/unlock`);
    expect(JSON.parse(String(init.body))).toEqual({
      operationId: 'op-2',
      reason: 'công cụ khách quên ACK',
    });
  });
});
```

- [ ] **Step 2: Viết bài kiểm cho bảng dịch lỗi**

Tạo `apps/admin/src/features/billing/error-vi.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AdminApiError } from '@/lib/fetcher';
import { loiVi, MA_LOI_BILLING } from './error-vi';

describe('dịch mã lỗi billing sang tiếng Việt', () => {
  it('mỗi mã 409 của máy chủ đều có câu riêng — chúng ứng với các cổng chặn khác nhau', () => {
    for (const ma of [
      'operation_conflict',
      'revision_conflict',
      'business_identity_conflict',
      'tenant_conflict',
      'period_overlap',
      'period_not_active',
      'trial_already_used',
      'credits_require_paid_active',
      'no_entitlement',
    ]) {
      expect(MA_LOI_BILLING[ma], `thiếu câu cho ${ma}`).toBeTruthy();
    }
    // Không có hai mã nào dùng chung một câu: dùng chung là mất đúng thứ người vận hành cần biết.
    const cau = Object.values(MA_LOI_BILLING);
    expect(new Set(cau).size).toBe(cau.length);
  });

  it('trả cả mã lẫn câu, vì spec đòi hiện mã thật', () => {
    const ket = loiVi(new AdminApiError(409, 'period_overlap', 'trùng kỳ'));
    expect(ket.ma).toBe('period_overlap');
    expect(ket.cau).toContain('chồng lên một kỳ đã có');
  });

  it('mã lạ → giữ nguyên thông điệp máy chủ, không nuốt thành "có lỗi xảy ra"', () => {
    const ket = loiVi(new AdminApiError(500, 'mot_ma_moi_nao_do', 'máy chủ nói câu này'));
    expect(ket.ma).toBe('mot_ma_moi_nao_do');
    expect(ket.cau).toBe('máy chủ nói câu này');
  });

  it('lỗi không phải AdminApiError (mất mạng) vẫn ra câu đọc được', () => {
    const ket = loiVi(new TypeError('Failed to fetch'));
    expect(ket.ma).toBe('khong_goi_duoc');
    expect(ket.cau).toContain('Không gọi được máy chủ');
  });
});
```

- [ ] **Step 3: Chạy để thấy đỏ**

```bash
pnpm exec vitest run apps/admin/src/features/billing
```

Mong đợi: đỏ vì hai module chưa tồn tại.

- [ ] **Step 4: Viết `api.ts`**

```ts
import { apiFetch } from '@/lib/fetcher';

export type QuotaGroup = 'places' | 'directions';
export type Tier = 'trial' | 'starter' | 'professional' | 'business';
export type PaidTier = Exclude<Tier, 'trial'>;
export type EntitlementStatus = 'none' | 'active' | 'suspended' | 'expired';

export interface GroupUsage {
  limit: number;
  used: number;
  reserved: number;
  credits: number;
  /** = max(0, limit - used - reserved) + credits. Máy chủ tính, giao diện không tính lại. */
  available: number;
}

export interface UsageSnapshot {
  tenantId: string;
  status: EntitlementStatus;
  tier: Tier | null;
  revision: number;
  periodId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  trialUsedOnce: boolean;
  /** Sổ đang bị đóng để phục hồi: mọi request của khách bị từ chối, không phải vì hết lượt. */
  maintenance: boolean;
  places: GroupUsage;
  directions: GroupUsage;
}

export interface PeriodGroupUsage {
  limit: number;
  used: number;
  reserved: number;
}

export interface PeriodSummary {
  periodId: string;
  tier: Tier;
  startsAt: string;
  endsAt: string;
  paymentReference: string | null;
  lineItemId: string | null;
  places: PeriodGroupUsage;
  directions: PeriodGroupUsage;
}

export interface CreditSummary {
  grantId: string;
  periodId: string;
  group: QuotaGroup;
  units: number;
  used: number;
  reserved: number;
  expiresAt: string;
  paymentReference: string;
  lineItemId: string;
}

export interface PeriodHistory {
  periods: PeriodSummary[];
  credits: CreditSummary[];
}

export interface LegacyKeyUsage {
  keyPrefix: string;
  label: string | null;
  places: { used: number; limit: number };
  directions: { used: number; limit: number };
}

export interface LegacyUsage {
  /** Ngày theo giờ VN mà bộ đếm đang tính. */
  day: string;
  quotaEnabled: boolean;
  plan: string;
  /** false với tenant internal: bộ đếm cố ý không chạy, số 0 là thiết kế. */
  counted: boolean;
  /** Bộ đếm là xấp xỉ nên chỉ chặn ở bội số này của hạn mức. */
  blockAtMultiple: number;
  keys: LegacyKeyUsage[];
  total: { places: { used: number; limit: number }; directions: { used: number; limit: number } };
}

export interface PlanCatalog {
  tiers: {
    tier: Tier;
    priceCents: number;
    places: number;
    directions: number;
    dailyPlaces: number | null;
    dailyDirections: number | null;
    onlineSupport: boolean;
  }[];
  addOns: { group: QuotaGroup; units: number; priceCents: number }[];
  legacyDefaults: { places: number; directions: number; blockAtMultiple: number };
}

export interface CommandReceipt {
  operationId: string;
  revision: number;
  status: EntitlementStatus;
  tier: Tier | null;
  appliedAt: string;
}

interface Chung {
  operationId: string;
  reason: string;
  expectedRevision: number;
}

/**
 * Hợp đồng lệnh. Máy chủ kiểm bằng allowlist ĐÓNG: thừa một trường là `invalid_command` 400, nên
 * kiểu ở đây cố tình không có chỗ cho trường phụ. `tenantId` và `actor` do máy chủ tự điền — gửi
 * kèm cũng vô ích và dễ gây hiểu nhầm là giao diện được phép chọn người thực hiện.
 */
export type Command =
  | (Chung & { kind: 'activateTrial'; startsAt: string })
  | (Chung & {
      kind: 'grantPeriod';
      periodId: string;
      tier: PaidTier;
      startsAt: string;
      endsAt: string;
      paymentReference: string;
      lineItemId: string;
    })
  | (Chung & {
      kind: 'addCredits';
      periodId: string;
      group: QuotaGroup;
      packs: number;
      paymentReference: string;
      lineItemId: string;
    })
  | (Chung & { kind: 'suspend' | 'resume' });

export const getUsage = (tenantId: string): Promise<UsageSnapshot> =>
  apiFetch<UsageSnapshot>(`/v1/admin/billing/${tenantId}/usage`);

export const getPeriods = (tenantId: string): Promise<PeriodHistory> =>
  apiFetch<PeriodHistory>(`/v1/admin/billing/${tenantId}/periods`);

export const getLegacyUsage = (tenantId: string): Promise<LegacyUsage> =>
  apiFetch<LegacyUsage>(`/v1/admin/billing/${tenantId}/legacy-usage`);

export const getCatalog = (): Promise<PlanCatalog> => apiFetch<PlanCatalog>('/v1/admin/plan-catalog');

const postJson = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const sendCommand = (tenantId: string, command: Command): Promise<CommandReceipt> =>
  postJson<CommandReceipt>(`/v1/admin/billing/${tenantId}/commands`, command);

export const unlockAcks = (
  tenantId: string,
  operationId: string,
  reason: string,
): Promise<{ unlocked: number }> =>
  postJson<{ unlocked: number }>(`/v1/admin/billing/${tenantId}/missing-acks/unlock`, {
    operationId,
    reason,
  });
```

- [ ] **Step 5: Viết `error-vi.ts`**

```ts
import { AdminApiError } from '@/lib/fetcher';

/**
 * Mỗi mã ứng với một cổng chặn khác nhau trong sổ quota, nên mỗi mã phải có một câu riêng nói rõ
 * PHẢI LÀM GÌ. Gộp chúng thành "có lỗi xảy ra" là lấy mất đúng thứ người vận hành cần.
 */
export const MA_LOI_BILLING: Record<string, string> = {
  invalid_command:
    'Lệnh không hợp lệ — thiếu trường bắt buộc hoặc có trường lạ. Đây là lỗi của trang Admin, không phải của dữ liệu khách hàng.',
  payload_too_large: 'Nội dung lệnh vượt 16 KB. Rút gọn ô Lý do rồi gửi lại.',
  operation_conflict:
    'Mã thao tác này đã dùng cho một lệnh khác nội dung. Đóng hộp thoại rồi mở lại để sinh mã mới.',
  revision_conflict:
    'Sổ đã thay đổi kể từ lúc mở màn hình (một lệnh khác vừa chạy). Bấm Tải lại rồi gửi lại.',
  business_identity_conflict:
    'Cặp mã thanh toán + dòng hoá đơn này đã dùng cho một lệnh khác nội dung. Đổi dòng hoá đơn, hoặc kiểm lại bậc và ngày đã nhập.',
  tenant_conflict:
    'Sổ quota này đang thuộc về một tenant khác. Dừng lại và kiểm tra dữ liệu trước khi gửi tiếp.',
  period_overlap:
    'Kỳ mới chồng lên một kỳ đã có. Chọn ngày bắt đầu từ sau ngày kết thúc của kỳ hiện tại.',
  period_not_active:
    'Kỳ ghi trên lệnh không phải kỳ đang chạy. Chỉ cộng credit được cho kỳ hiện tại.',
  trial_already_used:
    'Tenant này đã dùng bản dùng thử một lần rồi, không bật lại được. Cấp một kỳ trả phí nếu khách muốn dùng tiếp.',
  credits_require_paid_active:
    'Chỉ cộng credit cho thuê bao trả phí đang hoạt động — bản dùng thử và thuê bao hết hạn thì không.',
  no_entitlement: 'Tenant chưa có quyền thương mại nào để tạm dừng hoặc mở lại.',
  invalid_unlock: 'Thiếu mã thao tác hoặc lý do khi mở khoá.',
  tenant_not_found: 'Không có tenant này.',
  invalid_tenant: 'Mã tenant không phải UUID.',
  billing_admin_forbidden:
    'Tài khoản đang đăng nhập không nằm trong BILLING_ADMIN_EMAILS nên không gửi được lệnh billing.',
  cross_site_request: 'Yêu cầu bị chặn vì không xuất phát từ chính trang Admin.',
  session_expired: 'Phiên đăng nhập đã hết hạn. Tải lại trang để đăng nhập lại.',
  upstream_unavailable:
    'Sổ quota hoặc cơ sở dữ liệu không phản hồi. CHƯA chắc lệnh đã chạy hay chưa — mở lại màn hình để đối chiếu, và nếu gửi lại thì phải dùng đúng mã thao tác cũ.',
  khong_goi_duoc: 'Không gọi được máy chủ. Kiểm tra mạng rồi thử lại.',
};

export interface LoiHienThi {
  ma: string;
  cau: string;
}

/** Spec 11.4 đòi hiện đúng MÃ kèm giải thích, nên hàm này luôn trả cả hai. */
export function loiVi(error: unknown): LoiHienThi {
  if (error instanceof AdminApiError) {
    return { ma: error.code, cau: MA_LOI_BILLING[error.code] ?? error.message };
  }
  return { ma: 'khong_goi_duoc', cau: MA_LOI_BILLING.khong_goi_duoc as string };
}
```

- [ ] **Step 6: Chạy lại**

```bash
pnpm exec vitest run apps/admin/src/features/billing
```

Mong đợi: 7 PASS.

- [ ] **Step 7: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/admin/src/features/billing
git commit -m "$(cat <<'EOF'
feat(admin): lớp gọi API và bảng dịch lỗi cho mảng Gói cước

Kiểu lệnh cố tình không có chỗ cho trường phụ (máy chủ dùng allowlist
đóng), và mỗi mã 409 có một câu riêng nói rõ phải làm gì.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 9 — HOOKS DỮ LIỆU

**Files:**
- Create: `apps/admin/src/features/billing/hooks.ts`

- [ ] **Step 1: Viết hooks**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Command,
  getCatalog,
  getLegacyUsage,
  getPeriods,
  getUsage,
  sendCommand,
  unlockAcks,
} from './api';

export const billingKeys = {
  usage: (id: string) => ['billing', 'usage', id] as const,
  periods: (id: string) => ['billing', 'periods', id] as const,
  legacy: (id: string) => ['billing', 'legacy', id] as const,
  catalog: () => ['billing', 'catalog'] as const,
};

/**
 * `enabled` là cổng an toàn chứ không phải tối ưu: gọi `usage`/`periods` sẽ TẠO sổ Durable Object
 * cho tenant chưa có, và lần get() đầu tiên là lúc Cloudflare chốt vị trí object (bài học
 * 15/09/2026). Mở màn hình xem thông tin không được phép tạo sổ cho một tenant legacy.
 */
export function useUsage(tenantId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: billingKeys.usage(tenantId ?? ''),
    queryFn: () => getUsage(tenantId as string),
    enabled: tenantId !== null && enabled,
  });
}

export function usePeriods(tenantId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: billingKeys.periods(tenantId ?? ''),
    queryFn: () => getPeriods(tenantId as string),
    enabled: tenantId !== null && enabled,
  });
}

export function useLegacyUsage(tenantId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: billingKeys.legacy(tenantId ?? ''),
    queryFn: () => getLegacyUsage(tenantId as string),
    enabled: tenantId !== null && enabled,
  });
}

/** Bảng giá đổi vài lần một năm; giữ lâu để form mở tức thì. */
export function useCatalog() {
  return useQuery({
    queryKey: billingKeys.catalog(),
    queryFn: getCatalog,
    staleTime: 30 * 60_000,
  });
}

function useLamMoiBilling() {
  const client = useQueryClient();
  return () => {
    // Làm mới CẢ nhóm: mỗi lệnh thành công tăng revision, và gửi lệnh kế bằng revision cũ sẽ nhận
    // revision_conflict. Danh sách tenant cũng đổi (chế độ hạn mức) nên làm mới luôn.
    void client.invalidateQueries({ queryKey: ['billing'] });
    void client.invalidateQueries({ queryKey: ['tenants'] });
  };
}

export function useSendCommand() {
  const lamMoi = useLamMoiBilling();
  return useMutation({
    mutationFn: ({ tenantId, command }: { tenantId: string; command: Command }) =>
      sendCommand(tenantId, command),
    onSettled: lamMoi,
  });
}

export function useUnlockAcks() {
  const lamMoi = useLamMoiBilling();
  return useMutation({
    mutationFn: ({
      tenantId,
      operationId,
      reason,
    }: {
      tenantId: string;
      operationId: string;
      reason: string;
    }) => unlockAcks(tenantId, operationId, reason),
    onSettled: lamMoi,
  });
}
```

- [ ] **Step 2: Kiểm kiểu và lint**

```bash
pnpm lint && pnpm typecheck
```

Mong đợi: xanh. (Hooks được kiểm hành vi gián tiếp qua test của `page.tsx` ở Task 14 — không viết test riêng cho lớp mỏng chỉ nối hàm.)

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/features/billing/hooks.ts
git commit -m "$(cat <<'EOF'
feat(admin): hooks dữ liệu cho mảng Gói cước & hạn mức

Cổng enabled giữ cho màn hình không tạo sổ Durable Object của tenant chưa
bật chế độ thương mại.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 10 — KHỐI MỨC DÙNG CỦA KỲ HIỆN TẠI

**Files:**
- Create: `apps/admin/src/features/billing/usage-panel.tsx`
- Create: `apps/admin/src/features/billing/usage-panel.test.tsx`

- [ ] **Step 1: Viết bài kiểm (đỏ trước)**

Tạo `apps/admin/src/features/billing/usage-panel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GroupUsage, UsageSnapshot } from './api';
import { mucCanhBao, phanTram, UsagePanel } from './usage-panel';

const nhom = (extra: Partial<GroupUsage> = {}): GroupUsage => ({
  limit: 1_000,
  used: 0,
  reserved: 0,
  credits: 0,
  available: 1_000,
  ...extra,
});

const usage = (extra: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  tenantId: '00000000-0000-4000-8000-0000000000cc',
  status: 'active',
  tier: 'starter',
  revision: 3,
  periodId: 'p-1',
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-10-01T00:00:00.000Z',
  trialUsedOnce: false,
  maintenance: false,
  places: nhom(),
  directions: nhom(),
  ...extra,
});

describe('ngưỡng cảnh báo', () => {
  it('dưới 80 % là bình thường, đúng 80 % đã là hổ phách', () => {
    expect(mucCanhBao(nhom({ used: 799 }))).toBe('ok');
    expect(mucCanhBao(nhom({ used: 800 }))).toBe('sap-het');
  });

  it('phần đang giữ chỗ (reserved) tính là đã tiêu — khách không dùng lại được nó', () => {
    expect(mucCanhBao(nhom({ used: 700, reserved: 100 }))).toBe('sap-het');
  });

  it('chạm hoặc vượt hạn mức là đỏ', () => {
    expect(mucCanhBao(nhom({ used: 1_000 }))).toBe('het');
    expect(mucCanhBao(nhom({ used: 1_200 }))).toBe('het');
  });

  it('credit đã mua thêm cộng vào mẫu số, nếu không màn hình báo đỏ oan', () => {
    // Cùng một mức tiêu 1.000: hết sạch khi chỉ có hạn mức gốc, nhưng mới nửa đường sau khi khách
    // mua thêm 1.000 lượt. Bỏ credit khỏi mẫu số là báo đỏ cho một tenant vẫn còn quota.
    expect(mucCanhBao(nhom({ used: 1_000 }))).toBe('het');
    expect(mucCanhBao(nhom({ used: 1_000, credits: 1_000 }))).toBe('ok');
    expect(phanTram(nhom({ used: 1_000, credits: 1_000 }))).toBe(50);
  });

  it('không có kỳ nào → không tô màu, vì 0/0 không phải là "đã hết"', () => {
    expect(mucCanhBao(nhom({ limit: 0, available: 0 }))).toBe('khong-co');
    expect(phanTram(nhom({ limit: 0 }))).toBe(0);
  });
});

describe('UsagePanel', () => {
  it('hiện trạng thái bằng tiếng Việt kèm bậc và khoảng thời gian của kỳ', () => {
    render(<UsagePanel usage={usage()} />);
    expect(screen.getByText('Đang hoạt động')).toBeVisible();
    expect(screen.getByText('starter')).toBeVisible();
    expect(screen.getByText(/01\/09\/2026/)).toBeVisible();
    expect(screen.getByText(/01\/10\/2026/)).toBeVisible();
  });

  it('cảnh báo kèm CHỮ, không chỉ bằng màu', () => {
    render(<UsagePanel usage={usage({ places: nhom({ used: 900 }) })} />);
    expect(screen.getByText(/Sắp hết hạn mức/)).toBeVisible();
  });

  it('kỳ bắt đầu trong tương lai được nói rõ, không để người dùng tưởng lệnh trượt', () => {
    const mai = new Date(Date.now() + 86_400_000).toISOString();
    render(
      <UsagePanel usage={usage({ status: 'expired', tier: null, startsAt: mai, endsAt: mai })} />,
    );
    expect(screen.getByText(/Kỳ bắt đầu ngày/)).toBeVisible();
  });

  it('sổ đang bảo trì: nói rõ khách bị từ chối vì bảo trì, không phải vì hết lượt', () => {
    render(<UsagePanel usage={usage({ maintenance: true })} />);
    expect(screen.getByText(/đang bảo trì/i)).toBeVisible();
  });

  it('chưa có quyền thương mại → không vẽ thanh hạn mức rỗng gây hiểu nhầm', () => {
    render(
      <UsagePanel
        usage={usage({
          status: 'none',
          tier: null,
          periodId: null,
          startsAt: null,
          endsAt: null,
          places: nhom({ limit: 0, available: 0 }),
          directions: nhom({ limit: 0, available: 0 }),
        })}
      />,
    );
    expect(screen.getByText('Chưa có quyền thương mại')).toBeVisible();
    expect(screen.queryByTestId('thanh-places')).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

```bash
pnpm exec vitest run apps/admin/src/features/billing/usage-panel.test.tsx
```

- [ ] **Step 3: Viết `usage-panel.tsx`**

```tsx
import { Badge } from '@/components/ui/badge';
import type { GroupUsage, UsageSnapshot } from './api';

export type Muc = 'khong-co' | 'ok' | 'sap-het' | 'het';

/**
 * Ngưỡng theo spec 11.4: hổ phách từ 80 %, đỏ từ 100 %.
 *
 * Mẫu số là `limit + credits` chứ không phải `limit`: credit đã mua thêm là hạn mức thật của kỳ,
 * bỏ ra ngoài thì một khách vừa mua thêm 3.000 lượt vẫn bị báo đỏ. Tử số cộng cả `reserved` vì
 * phần đang giữ chỗ không dùng lại được.
 */
export function mucCanhBao(group: GroupUsage): Muc {
  const tong = group.limit + group.credits;
  if (tong <= 0) return 'khong-co';
  const daTieu = group.used + group.reserved;
  if (daTieu >= tong) return 'het';
  return daTieu / tong >= 0.8 ? 'sap-het' : 'ok';
}

export function phanTram(group: GroupUsage): number {
  const tong = group.limit + group.credits;
  if (tong <= 0) return 0;
  return Math.min(100, Math.round(((group.used + group.reserved) / tong) * 100));
}

const TRANG_THAI_VI: Record<UsageSnapshot['status'], string> = {
  none: 'Chưa có quyền thương mại',
  active: 'Đang hoạt động',
  suspended: 'Đang tạm dừng',
  expired: 'Đã hết hạn',
};

const TONE: Record<UsageSnapshot['status'], 'neutral' | 'success' | 'warning' | 'danger'> = {
  none: 'neutral',
  active: 'success',
  suspended: 'warning',
  expired: 'danger',
};

export const ngayVn = (iso: string): string =>
  new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const so = (value: number): string => value.toLocaleString('vi-VN');

const MAU: Record<Muc, string> = {
  'khong-co': 'bg-black/20 dark:bg-white/20',
  ok: 'bg-brand-600',
  'sap-het': 'bg-amber-500',
  het: 'bg-red-600',
};

const CHU: Record<Muc, string> = {
  'khong-co': '',
  ok: '',
  'sap-het': 'Sắp hết hạn mức',
  het: 'Đã hết hạn mức',
};

function Thanh({ nhan, group }: { nhan: string; group: GroupUsage }) {
  const muc = mucCanhBao(group);
  const pct = phanTram(group);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-semibold">{nhan}</span>
        <span className="text-[var(--text-muted)]">
          {so(group.used + group.reserved)} / {so(group.limit + group.credits)}
          {group.credits > 0 && ` (gồm ${so(group.credits)} credit đã mua thêm)`}
        </span>
        {/* Cảnh báo luôn kèm chữ: spec mục 5 cấm truyền đạt trạng thái chỉ bằng màu. */}
        {CHU[muc] && (
          <span className={muc === 'het' ? 'font-semibold text-red-700 dark:text-red-300' : 'font-semibold text-amber-700 dark:text-amber-300'}>
            · {CHU[muc]}
          </span>
        )}
      </div>
      {/* Thanh là ĐỒ HOẠ thuần: dòng chữ ngay trên đã nói đủ, và biome chặn role="meter" trên div. */}
      <div
        aria-hidden="true"
        data-testid={`thanh-${nhan.toLowerCase()}`}
        className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
      >
        <div className={`h-full ${MAU[muc]}`} style={{ width: `${pct}%` }} />
      </div>
      {group.reserved > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          Đang giữ chỗ {so(group.reserved)} lượt (request chưa xác nhận xong).
        </p>
      )}
    </div>
  );
}

export function UsagePanel({ usage }: { usage: UsageSnapshot }) {
  const coKy = usage.periodId !== null;
  const batDau = usage.startsAt ? new Date(usage.startsAt) : null;
  const trongTuongLai = batDau !== null && batDau.getTime() > Date.now();

  return (
    <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Kỳ hiện tại</h2>
        <Badge tone={TONE[usage.status]}>{TRANG_THAI_VI[usage.status]}</Badge>
        {usage.tier && <Badge tone="brand">{usage.tier}</Badge>}
        <span className="ml-auto text-xs text-[var(--text-muted)]">Bản sổ số {usage.revision}</span>
      </div>

      {usage.maintenance && (
        <p role="alert" className="rounded-[var(--radius-btn)] bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          Sổ quota đang bảo trì: mọi request của tenant này bị từ chối, không phải vì hết lượt.
        </p>
      )}

      {coKy && batDau && usage.endsAt ? (
        <>
          <p className="text-sm text-[var(--text-muted)]">
            {trongTuongLai
              ? `Kỳ bắt đầu ngày ${ngayVn(usage.startsAt as string)} và chạy tới ${ngayVn(usage.endsAt)} — hạn mức chưa có hiệu lực.`
              : `${ngayVn(usage.startsAt as string)} → ${ngayVn(usage.endsAt)}`}
          </p>
          <Thanh nhan="Places" group={usage.places} />
          <Thanh nhan="Directions" group={usage.directions} />
          <p className="text-xs text-[var(--text-muted)]">
            Số theo từng endpoint nằm ở màn Sức khoẻ hệ thống; sổ quota chỉ đếm theo hai nhóm này.
          </p>
        </>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Chưa có kỳ nào đang chạy. Dùng các nút bên dưới để bật bản dùng thử hoặc cấp một kỳ trả phí.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Chạy lại**

```bash
pnpm exec vitest run apps/admin/src/features/billing/usage-panel.test.tsx
```

Mong đợi: 10 PASS.

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/admin/src/features/billing/usage-panel.tsx apps/admin/src/features/billing/usage-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(admin): khối mức dùng kỳ hiện tại với ngưỡng 80/100

Mẫu số gồm cả credit đã mua thêm, tử số gồm cả phần đang giữ chỗ; cảnh báo
luôn kèm chữ chứ không chỉ đổi màu.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 11 — KHỐI MỨC DÙNG HÔM NAY CHO TENANT CHƯA VÀO SỔ

**Files:**
- Create: `apps/admin/src/features/billing/legacy-panel.tsx`
- Create: `apps/admin/src/features/billing/legacy-panel.test.tsx`

- [ ] **Step 1: Viết bài kiểm (đỏ trước)**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LegacyUsage } from './api';
import { LegacyPanel } from './legacy-panel';

const legacy = (extra: Partial<LegacyUsage> = {}): LegacyUsage => ({
  day: '2026-09-16',
  quotaEnabled: true,
  plan: 'free',
  counted: true,
  blockAtMultiple: 2,
  keys: [
    {
      keyPrefix: 'mlv_live_aaaaaaaa',
      label: 'khoá web',
      places: { used: 1_284, limit: 20_000 },
      directions: { used: 37, limit: 2_000 },
    },
  ],
  total: { places: { used: 1_284, limit: 20_000 }, directions: { used: 37, limit: 2_000 } },
  ...extra,
});

describe('LegacyPanel', () => {
  it('hiện số hôm nay theo từng khoá và nói rõ đây là số xấp xỉ trong ngày', () => {
    render(<LegacyPanel legacy={legacy()} />);
    expect(screen.getByText('mlv_live_aaaaaaaa')).toBeVisible();
    // Con số xuất hiện đúng hai chỗ: dòng của khoá đó và dòng tổng của tenant.
    expect(screen.getAllByText(/1\.284/)).toHaveLength(2);
    expect(screen.getByText(/xấp xỉ/i)).toBeVisible();
  });

  it('nói đúng ngưỡng chặn thật là 2× hạn mức, không phải 100 %', () => {
    render(<LegacyPanel legacy={legacy()} />);
    expect(screen.getByText(/chặn khi vượt 2×/i)).toBeVisible();
  });

  it('QUOTA_ENABLED tắt → giải thích vì sao mọi số là 0, thay vì để người dùng đoán', () => {
    render(<LegacyPanel legacy={legacy({ quotaEnabled: false })} />);
    expect(screen.getByText(/bộ đếm đang tắt/i)).toBeVisible();
  });

  it('tenant internal → nói rõ nhóm này cố ý không được đếm', () => {
    render(<LegacyPanel legacy={legacy({ plan: 'internal', counted: false })} />);
    expect(screen.getByText(/không đếm lượt cho tenant internal/i)).toBeVisible();
  });

  it('tenant chưa có khoá nào → trạng thái rỗng có lối ra, không phải bảng trống', () => {
    render(<LegacyPanel legacy={legacy({ keys: [] })} />);
    expect(screen.getByText(/chưa có khoá nào đang hoạt động/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ, rồi viết `legacy-panel.tsx`**

```tsx
import { EmptyState } from '@/components/states';
import type { LegacyUsage } from './api';
import { ngayVn, so } from './usage-panel';

/**
 * Tenant chưa bật chế độ thương mại không có gì trong sổ Durable Object. Nguồn duy nhất là bộ đếm
 * xấp xỉ trong KV, theo NGÀY và theo TỪNG KHOÁ — hạn mức legacy vốn tính theo khoá chứ không theo
 * tenant, nên bảng này giữ đúng chiều đó thay vì gộp lại cho đẹp mắt.
 */
export function LegacyPanel({ legacy }: { legacy: LegacyUsage }) {
  return (
    <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Hôm nay ({ngayVn(`${legacy.day}T00:00:00+07:00`)})</h2>
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          Số xấp xỉ, đếm theo giờ Việt Nam · chặn khi vượt {legacy.blockAtMultiple}× hạn mức ngày
        </span>
      </div>

      {!legacy.quotaEnabled && (
        <p role="alert" className="rounded-[var(--radius-btn)] bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          Bộ đếm đang tắt trên môi trường này (QUOTA_ENABLED khác 1), nên mọi số dưới đây là 0.
        </p>
      )}
      {!legacy.counted && (
        <p role="alert" className="rounded-[var(--radius-btn)] bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          Hệ thống không đếm lượt cho tenant internal (tiết kiệm lượt ghi KV), nên số 0 ở đây là
          thiết kế chứ không phải khách không dùng.
        </p>
      )}

      {legacy.keys.length === 0 ? (
        <EmptyState
          title="Tenant này chưa có khoá nào đang hoạt động"
          hint="Cấp khoá ở màn Tenant & khoá API, hoặc khôi phục khoá đã thu hồi."
        />
      ) : (
        <ul className="space-y-2">
          {legacy.keys.map((key) => (
            <li
              key={key.keyPrefix}
              className="rounded-[var(--radius-btn)] border border-[var(--border)] p-3 text-sm"
            >
              <p className="font-mono text-sm">{key.keyPrefix}</p>
              {key.label && <p className="text-xs text-[var(--text-muted)]">{key.label}</p>}
              <p className="mt-1">
                Places {so(key.places.used)} / {so(key.places.limit)} · Directions{' '}
                {so(key.directions.used)} / {so(key.directions.limit)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm">
        Tổng hôm nay: Places <strong>{so(legacy.total.places.used)}</strong> / {so(legacy.total.places.limit)} · Directions{' '}
        <strong>{so(legacy.total.directions.used)}</strong> / {so(legacy.total.directions.limit)}
      </p>
    </section>
  );
}
```

- [ ] **Step 3: Chạy, lint, typecheck, commit**

```bash
pnpm exec vitest run apps/admin/src/features/billing/legacy-panel.test.tsx
pnpm lint && pnpm typecheck
git add apps/admin/src/features/billing/legacy-panel.tsx apps/admin/src/features/billing/legacy-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(admin): khối mức dùng hôm nay cho tenant chưa vào sổ thương mại

Đếm theo khoá đúng như hạn mức legacy vốn hoạt động, kèm giải thích vì sao
số có thể bằng 0 và ngưỡng chặn thật là 2× hạn mức.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 12 — BẢNG LỊCH SỬ KỲ VÀ CREDIT

**Files:**
- Create: `apps/admin/src/features/billing/periods-panel.tsx`
- Create: `apps/admin/src/features/billing/periods-panel.test.tsx`

- [ ] **Step 1: Viết bài kiểm (đỏ trước)**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PeriodHistory } from './api';
import { PeriodsPanel } from './periods-panel';

const history: PeriodHistory = {
  periods: [
    {
      periodId: 'p-2',
      tier: 'starter',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-10-01T00:00:00.000Z',
      paymentReference: 'CK-8821',
      lineItemId: 'period-1',
      places: { limit: 30_000, used: 12_400, reserved: 0 },
      directions: { limit: 3_000, used: 2_850, reserved: 0 },
    },
    {
      periodId: 'p-1',
      tier: 'trial',
      startsAt: '2026-07-02T00:00:00.000Z',
      endsAt: '2026-08-01T00:00:00.000Z',
      paymentReference: null,
      lineItemId: null,
      places: { limit: 2_000, used: 1_950, reserved: 0 },
      directions: { limit: 200, used: 120, reserved: 0 },
    },
  ],
  credits: [
    {
      grantId: 'credit:op-9',
      periodId: 'p-2',
      group: 'places',
      units: 3_000,
      used: 1_000,
      reserved: 0,
      expiresAt: '2026-10-01T00:00:00.000Z',
      paymentReference: 'CK-8821',
      lineItemId: 'credits-1',
    },
  ],
};

describe('PeriodsPanel', () => {
  it('liệt kê các kỳ theo thứ tự máy chủ trả về, kỳ mới nhất trước', () => {
    render(<PeriodsPanel history={history} />);
    const chu = screen.getByText(/01\/09\/2026/);
    expect(chu).toBeVisible();
    expect(screen.getByText(/02\/07\/2026/)).toBeVisible();
  });

  it('hiện số đã dùng của từng kỳ, không phải chỉ hạn mức', () => {
    render(<PeriodsPanel history={history} />);
    expect(screen.getByText(/12\.400/)).toBeVisible();
    expect(screen.getByText(/2\.850/)).toBeVisible();
  });

  it('hiện credit đã cộng kèm số còn lại và mã thanh toán', () => {
    render(<PeriodsPanel history={history} />);
    // Truy vấn phải hẹp: "3.000" cũng là hạn mức directions của kỳ starter, còn "CK-8821" xuất
    // hiện ở cả thẻ kỳ lẫn dòng credit — getByText rộng sẽ đỏ vì khớp nhiều phần tử.
    expect(screen.getByText(/places \+3\.000/)).toBeVisible();
    expect(screen.getByText(/còn 2\.000/)).toBeVisible();
    expect(screen.getAllByText(/CK-8821/).length).toBeGreaterThan(0);
  });

  it('sổ trắng → trạng thái rỗng có giải thích', () => {
    render(<PeriodsPanel history={{ periods: [], credits: [] }} />);
    expect(screen.getByText(/Chưa có kỳ nào/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Viết `periods-panel.tsx`**

```tsx
import { RecordView } from '@/components/data-view';
import { EmptyState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardMuted, CardTitle } from '@/components/ui/card';
import type { PeriodHistory, PeriodSummary } from './api';
import { ngayVn, so } from './usage-panel';

const khoang = (period: PeriodSummary) => `${ngayVn(period.startsAt)} → ${ngayVn(period.endsAt)}`;
const doiNhom = (nhan: string, group: { limit: number; used: number }) =>
  `${nhan} ${so(group.used)} / ${so(group.limit)}`;

export function PeriodsPanel({ history }: { history: PeriodHistory }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Các kỳ đã cấp</h2>

      {history.periods.length === 0 ? (
        <EmptyState
          title="Chưa có kỳ nào trong sổ"
          hint="Bật bản dùng thử hoặc cấp một kỳ trả phí bằng các nút ở trên."
        />
      ) : (
        <RecordView
          items={history.periods}
          rowKey={(period) => period.periodId}
          renderCard={(period) => (
            <Card>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <CardTitle>{khoang(period)}</CardTitle>
                  <CardMuted>
                    {doiNhom('Places', period.places)} · {doiNhom('Directions', period.directions)}
                  </CardMuted>
                </div>
                <Badge tone={period.tier === 'trial' ? 'neutral' : 'brand'}>{period.tier}</Badge>
              </div>
              {period.paymentReference && (
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  {period.paymentReference} · {period.lineItemId}
                </p>
              )}
            </Card>
          )}
          columns={[
            { key: 'ky', header: 'Kỳ', render: khoang },
            {
              key: 'bac',
              header: 'Bậc',
              render: (period) => (
                <Badge tone={period.tier === 'trial' ? 'neutral' : 'brand'}>{period.tier}</Badge>
              ),
            },
            { key: 'places', header: 'Places', render: (period) => doiNhom('', period.places).trim() },
            {
              key: 'directions',
              header: 'Directions',
              render: (period) => doiNhom('', period.directions).trim(),
            },
            {
              key: 'thanhtoan',
              header: 'Thanh toán',
              render: (period) => period.paymentReference ?? '—',
            },
          ]}
        />
      )}

      {history.credits.length > 0 && (
        <>
          <h2 className="text-base font-semibold">Credit đã cộng</h2>
          <ul className="space-y-2">
            {history.credits.map((credit) => (
              <li
                key={credit.grantId}
                className="rounded-[var(--radius-btn)] border border-[var(--border)] p-3 text-sm"
              >
                <p>
                  <strong>
                    {credit.group} +{so(credit.units)}
                  </strong>{' '}
                  · còn {so(credit.units - credit.used - credit.reserved)} · hết hạn{' '}
                  {ngayVn(credit.expiresAt)}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {credit.paymentReference} · {credit.lineItemId}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Chạy, lint, typecheck, commit**

```bash
pnpm exec vitest run apps/admin/src/features/billing/periods-panel.test.tsx
pnpm lint && pnpm typecheck
git add apps/admin/src/features/billing/periods-panel.tsx apps/admin/src/features/billing/periods-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(admin): bảng lịch sử kỳ và credit đã cộng

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 13 — DỰNG LỆNH: HÀM THUẦN TRƯỚC, HỘP THOẠI SAU

Tách phần dễ sai nhất (múi giờ, tập trường, điều kiện chặn) ra khỏi React để nó có bài test chạy trong mili-giây và không phụ thuộc DOM.

**Files:**
- Create: `apps/admin/src/features/billing/command-builder.ts`
- Create: `apps/admin/src/features/billing/command-builder.test.ts`

- [ ] **Step 1: Viết bài kiểm (đỏ trước)**

```ts
import { describe, expect, it } from 'vitest';
import type { UsageSnapshot } from './api';
import { dungLenh, homNayVn, kiemForm, type FormLenh, mocVn, thangSau } from './command-builder';

const form = (extra: Partial<FormLenh> = {}): FormLenh => ({
  reason: 'khách chuyển khoản',
  ngayBatDau: '2026-10-01',
  ngayKetThuc: '2026-11-01',
  tier: 'starter',
  paymentReference: 'CK-8821',
  lineItemId: 'period-1',
  group: 'places',
  packs: 2,
  ...extra,
});

const usage = (extra: Partial<UsageSnapshot> = {}): UsageSnapshot =>
  ({
    tenantId: 't',
    status: 'active',
    tier: 'starter',
    revision: 5,
    periodId: 'p-1',
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2026-10-01T00:00:00.000Z',
    trialUsedOnce: false,
    maintenance: false,
    places: { limit: 1, used: 0, reserved: 0, credits: 0, available: 1 },
    directions: { limit: 1, used: 0, reserved: 0, credits: 0, available: 1 },
    ...extra,
  }) as UsageSnapshot;

describe('mốc thời gian', () => {
  it('ngày VN thành 00:00 giờ Việt Nam, tức 17:00 UTC hôm trước', () => {
    // Bẫy kinh điển: new Date('2026-10-01T00:00:00') theo giờ máy sẽ ra 01/10 17:00 UTC nếu máy
    // chạy UTC, và lệch hẳn một ngày nếu máy chạy múi khác. Chuỗi phải mang offset +07:00.
    expect(mocVn('2026-10-01')).toBe('2026-09-30T17:00:00.000Z');
  });

  it('hôm nay theo giờ VN, không theo giờ máy', () => {
    // 16/09/2026 lúc 23:30 UTC đã là 17/09 ở Việt Nam.
    expect(homNayVn(new Date('2026-09-16T23:30:00.000Z'))).toBe('2026-09-17');
  });

  it('tháng sau giữ đúng ngày, và lùi về ngày cuối tháng khi tháng đó ngắn hơn', () => {
    expect(thangSau('2026-10-01')).toBe('2026-11-01');
    expect(thangSau('2026-01-31')).toBe('2026-02-28');
    expect(thangSau('2026-12-15')).toBe('2027-01-15');
  });
});

describe('kiemForm', () => {
  it('lý do bắt buộc cho MỌI lệnh — máy chủ từ chối nếu thiếu', () => {
    expect(kiemForm('trial', form({ reason: '   ' }), usage())).toMatch(/Lý do/);
    expect(kiemForm('suspend', form({ reason: '' }), usage())).toMatch(/Lý do/);
    expect(kiemForm('unlock', form({ reason: '' }), usage())).toMatch(/Lý do/);
  });

  it('cấp kỳ: bắt buộc mã thanh toán, dòng hoá đơn và ngày kết thúc sau ngày bắt đầu', () => {
    expect(kiemForm('grant', form({ paymentReference: '' }), usage())).toMatch(/mã thanh toán/i);
    expect(kiemForm('grant', form({ lineItemId: '' }), usage())).toMatch(/dòng hoá đơn/i);
    expect(kiemForm('grant', form({ ngayKetThuc: '2026-10-01' }), usage())).toMatch(/sau ngày bắt đầu/);
    expect(kiemForm('grant', form(), usage())).toBeNull();
  });

  it('cộng credit: chặn tại chỗ khi không có kỳ đang chạy, thay vì để máy chủ trả 409', () => {
    expect(kiemForm('credits', form(), usage({ periodId: null }))).toMatch(/kỳ nào đang chạy/);
    expect(kiemForm('credits', form(), usage({ tier: 'trial' }))).toMatch(/dùng thử/);
    expect(kiemForm('credits', form(), usage({ status: 'expired' }))).toMatch(/đang hoạt động/);
    expect(kiemForm('credits', form({ packs: 0 }), usage())).toMatch(/ít nhất 1/);
    expect(kiemForm('credits', form(), usage())).toBeNull();
  });

  it('bật dùng thử: chặn khi tenant đã dùng thử một lần', () => {
    expect(kiemForm('trial', form(), usage({ trialUsedOnce: true }))).toMatch(/đã dùng thử/);
  });
});

describe('dungLenh', () => {
  it('cấp kỳ: đúng tập trường, revision lấy từ sổ, ngày đi kèm offset VN', () => {
    const lenh = dungLenh('grant', form(), usage(), 'op-1', 'period-uuid');
    expect(lenh).toEqual({
      kind: 'grantPeriod',
      operationId: 'op-1',
      reason: 'khách chuyển khoản',
      expectedRevision: 5,
      periodId: 'period-uuid',
      tier: 'starter',
      startsAt: '2026-09-30T17:00:00.000Z',
      endsAt: '2026-10-31T17:00:00.000Z',
      paymentReference: 'CK-8821',
      lineItemId: 'period-1',
    });
  });

  it('cộng credit: periodId lấy từ KỲ ĐANG CHẠY, không phải từ ô nhập', () => {
    const lenh = dungLenh('credits', form(), usage(), 'op-2', 'khong-dung-toi');
    expect(lenh).toEqual({
      kind: 'addCredits',
      operationId: 'op-2',
      reason: 'khách chuyển khoản',
      expectedRevision: 5,
      periodId: 'p-1',
      group: 'places',
      packs: 2,
      paymentReference: 'CK-8821',
      lineItemId: 'period-1',
    });
  });

  it('dùng thử và tạm dừng chỉ mang đúng những trường của chúng', () => {
    expect(dungLenh('trial', form(), usage(), 'op-3', 'x')).toEqual({
      kind: 'activateTrial',
      operationId: 'op-3',
      reason: 'khách chuyển khoản',
      expectedRevision: 5,
      startsAt: '2026-09-30T17:00:00.000Z',
    });
    expect(dungLenh('suspend', form(), usage(), 'op-4', 'x')).toEqual({
      kind: 'suspend',
      operationId: 'op-4',
      reason: 'khách chuyển khoản',
      expectedRevision: 5,
    });
    expect(dungLenh('resume', form(), usage(), 'op-5', 'x')).toEqual({
      kind: 'resume',
      operationId: 'op-5',
      reason: 'khách chuyển khoản',
      expectedRevision: 5,
    });
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ, rồi viết `command-builder.ts`**

```ts
import type { Command, PaidTier, QuotaGroup, UsageSnapshot } from './api';

export type LoaiLenh = 'trial' | 'grant' | 'credits' | 'suspend' | 'resume' | 'unlock';

export interface FormLenh {
  reason: string;
  /** YYYY-MM-DD theo giờ VN, đúng dạng của <input type="date">. */
  ngayBatDau: string;
  ngayKetThuc: string;
  tier: PaidTier;
  paymentReference: string;
  lineItemId: string;
  group: QuotaGroup;
  packs: number;
}

/**
 * Ngày VN → mốc ISO UTC của 00:00 giờ Việt Nam. Chuỗi PHẢI mang offset `+07:00`: `new Date('…T00:00:00')`
 * đọc theo múi giờ của máy, nên cùng một thao tác cho ra hai kết quả lệch bảy giờ giữa máy dev và
 * máy chủ, và một kỳ "bắt đầu 01/10" hoá ra bắt đầu 30/09.
 */
export function mocVn(ngay: string): string {
  const moc = new Date(`${ngay}T00:00:00+07:00`);
  if (Number.isNaN(moc.getTime())) throw new Error(`ngày không hợp lệ: ${ngay}`);
  return moc.toISOString();
}

/** Hôm nay theo giờ VN, dạng YYYY-MM-DD — giá trị mặc định cho ô ngày. */
export function homNayVn(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Cùng ngày của tháng kế tiếp; tháng ngắn hơn thì lùi về ngày cuối tháng (31/01 → 28/02). */
export function thangSau(ngay: string): string {
  const [nam, thang, ngayTrongThang] = ngay.split('-').map(Number) as [number, number, number];
  // `thang` đã là chỉ số 0-based của THÁNG SAU (tháng 1 nhập vào → index 1 = tháng 2), nên ngày 0
  // của tháng kế tiếp nữa chính là ngày cuối cùng của tháng sau.
  const soNgayThangSau = new Date(Date.UTC(nam, thang + 1, 0)).getUTCDate();
  const moc = new Date(Date.UTC(nam, thang, Math.min(ngayTrongThang, soNgayThangSau)));
  return moc.toISOString().slice(0, 10);
}

/**
 * Chặn tại chỗ những gì máy chủ cũng chặn. Không phải để "tin vào client" — máy chủ vẫn là nơi
 * quyết định — mà để người vận hành không phải đợi một vòng mạng chỉ để biết mình quên một ô.
 * Trả về câu tiếng Việt, hoặc null nếu hợp lệ.
 */
export function kiemForm(loai: LoaiLenh, form: FormLenh, usage: UsageSnapshot): string | null {
  if (form.reason.trim().length === 0) return 'Lý do là bắt buộc cho mọi lệnh billing.';

  if (loai === 'trial') {
    if (usage.trialUsedOnce) return 'Tenant này đã dùng thử một lần rồi, không bật lại được.';
    return null;
  }

  if (loai === 'grant') {
    if (form.paymentReference.trim().length === 0) return 'Thiếu mã thanh toán của giao dịch.';
    if (form.lineItemId.trim().length === 0) return 'Thiếu dòng hoá đơn.';
    if (Date.parse(mocVn(form.ngayKetThuc)) <= Date.parse(mocVn(form.ngayBatDau))) {
      return 'Ngày kết thúc phải sau ngày bắt đầu.';
    }
    return null;
  }

  if (loai === 'credits') {
    if (usage.periodId === null) return 'Không có kỳ nào đang chạy để cộng credit vào.';
    if (usage.status !== 'active') return 'Chỉ cộng credit khi thuê bao đang hoạt động.';
    if (usage.tier === 'trial') return 'Không cộng credit cho bản dùng thử.';
    if (form.paymentReference.trim().length === 0) return 'Thiếu mã thanh toán của giao dịch.';
    if (form.lineItemId.trim().length === 0) return 'Thiếu dòng hoá đơn.';
    if (!Number.isInteger(form.packs) || form.packs < 1) return 'Số gói phải là số nguyên ít nhất 1.';
    return null;
  }

  return null; // suspend / resume / unlock: chỉ cần lý do
}

/**
 * Dựng đúng tập trường của từng `kind`. Máy chủ kiểm bằng allowlist đóng nên KHÔNG được thêm gì,
 * kể cả `tenantId`/`actor` (máy chủ tự điền) hay một trường ghi chú để hiển thị.
 */
export function dungLenh(
  loai: Exclude<LoaiLenh, 'unlock'>,
  form: FormLenh,
  usage: UsageSnapshot,
  operationId: string,
  periodId: string,
): Command {
  const chung = { operationId, reason: form.reason.trim(), expectedRevision: usage.revision };
  if (loai === 'trial') {
    return { ...chung, kind: 'activateTrial', startsAt: mocVn(form.ngayBatDau) };
  }
  if (loai === 'grant') {
    return {
      ...chung,
      kind: 'grantPeriod',
      periodId,
      tier: form.tier,
      startsAt: mocVn(form.ngayBatDau),
      endsAt: mocVn(form.ngayKetThuc),
      paymentReference: form.paymentReference.trim(),
      lineItemId: form.lineItemId.trim(),
    };
  }
  if (loai === 'credits') {
    return {
      ...chung,
      kind: 'addCredits',
      // Kỳ để cộng credit LUÔN là kỳ đang chạy do máy chủ báo về: máy chủ so đúng bằng và trả
      // period_not_active nếu lệch, nên để người dùng gõ tay chỉ tạo ra một cách sai mới.
      periodId: usage.periodId as string,
      group: form.group,
      packs: form.packs,
      paymentReference: form.paymentReference.trim(),
      lineItemId: form.lineItemId.trim(),
    };
  }
  return { ...chung, kind: loai };
}
```

- [ ] **Step 3: Chạy lại**

```bash
pnpm exec vitest run apps/admin/src/features/billing/command-builder.test.ts
```

Mong đợi: 10 PASS.

- [ ] **Step 4: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/admin/src/features/billing/command-builder.ts apps/admin/src/features/billing/command-builder.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): hàm thuần dựng lệnh billing (múi giờ + tập trường + cổng chặn)

Ngày nhập theo giờ VN được đổi bằng chuỗi có offset +07:00; tập trường
khớp allowlist đóng của máy chủ; kỳ cộng credit lấy từ sổ chứ không từ ô nhập.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 14 — HỘP THOẠI LỆNH VÀ KHỐI BIÊN LAI

**Files:**
- Create: `apps/admin/src/features/billing/receipt.tsx`
- Create: `apps/admin/src/features/billing/command-dialog.tsx`
- Create: `apps/admin/src/features/billing/command-dialog.test.tsx`

- [ ] **Step 1: Viết `receipt.tsx`**

```tsx
import { Button } from '@/components/ui/button';
import type { CommandReceipt } from './api';

export type KetQuaLenh =
  | { loai: 'bien-lai'; nhan: string; receipt: CommandReceipt }
  | { loai: 'mo-khoa'; nhan: string; unlocked: number }
  | { loai: 'thong-bao'; nhan: string; cau: string }
  | { loai: 'loi'; nhan: string; ma: string; cau: string };

/**
 * Biên lai hiện Ở TRANG chứ không trong hộp thoại: hộp thoại phải đóng ngay khi xếp lịch gửi, nếu
 * không toast đếm ngược nằm ngoài nó sẽ bị aria-hidden và pointer-events:none, tức mất luôn nút Huỷ.
 */
export function ReceiptPanel({ ketQua, onDong }: { ketQua: KetQuaLenh; onDong: () => void }) {
  const loi = ketQua.loai === 'loi';
  return (
    <section
      role={loi ? 'alert' : 'status'}
      className={
        loi
          ? 'rounded-[var(--radius-card)] border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950'
          : 'rounded-[var(--radius-card)] border border-green-300 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950'
      }
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {loi ? `Không gửi được: ${ketQua.nhan}` : `Đã gửi: ${ketQua.nhan}`}
          </p>

          {ketQua.loai === 'loi' && (
            <p className="mt-1 text-sm">
              <span className="font-mono">{ketQua.ma}</span> — {ketQua.cau}
            </p>
          )}

          {ketQua.loai === 'bien-lai' && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-[var(--text-muted)]">Mã thao tác</dt>
              <dd className="break-all font-mono">{ketQua.receipt.operationId}</dd>
              <dt className="text-[var(--text-muted)]">Bản sổ</dt>
              <dd>{ketQua.receipt.revision}</dd>
              <dt className="text-[var(--text-muted)]">Trạng thái sau lệnh</dt>
              <dd>
                {ketQua.receipt.status}
                {ketQua.receipt.tier ? ` · ${ketQua.receipt.tier}` : ''}
              </dd>
              <dt className="text-[var(--text-muted)]">Lúc</dt>
              {/* Có cả giờ: dòng admin_audit tương ứng được tra theo thời điểm, ngày không đủ. */}
              <dd>{new Date(ketQua.receipt.appliedAt).toLocaleString('vi-VN')}</dd>
            </dl>
          )}

          {ketQua.loai === 'mo-khoa' && (
            <p className="mt-1 text-sm">Đã mở {ketQua.unlocked} receipt đang bị giữ.</p>
          )}

          {ketQua.loai === 'thong-bao' && <p className="mt-1 text-sm">{ketQua.cau}</p>}
        </div>
        <Button variant="ghost" aria-label="Đóng biên lai" onClick={onDong}>
          ✕
        </Button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Viết bài kiểm cho hộp thoại (đỏ trước)**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlanCatalog, UsageSnapshot } from './api';
import { CommandDialog } from './command-dialog';

const catalog: PlanCatalog = {
  tiers: [
    { tier: 'trial', priceCents: 0, places: 2_000, directions: 200, dailyPlaces: 200, dailyDirections: 20, onlineSupport: false },
    { tier: 'starter', priceCents: 2_500, places: 30_000, directions: 3_000, dailyPlaces: null, dailyDirections: null, onlineSupport: false },
    { tier: 'professional', priceCents: 10_000, places: 100_000, directions: 10_000, dailyPlaces: null, dailyDirections: null, onlineSupport: true },
    { tier: 'business', priceCents: 40_000, places: 400_000, directions: 40_000, dailyPlaces: null, dailyDirections: null, onlineSupport: true },
  ],
  addOns: [
    { group: 'places', units: 1_000, priceCents: 100 },
    { group: 'directions', units: 1_000, priceCents: 300 },
  ],
  legacyDefaults: { places: 20_000, directions: 2_000, blockAtMultiple: 2 },
};

const usage: UsageSnapshot = {
  tenantId: 't',
  status: 'active',
  tier: 'starter',
  revision: 5,
  periodId: 'p-1',
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-10-01T00:00:00.000Z',
  trialUsedOnce: false,
  maintenance: false,
  places: { limit: 30_000, used: 0, reserved: 0, credits: 0, available: 30_000 },
  directions: { limit: 3_000, used: 0, reserved: 0, credits: 0, available: 3_000 },
};

const dung = (loai: 'grant' | 'credits' | 'trial', onGui = vi.fn()) => {
  render(
    <CommandDialog
      loai={loai}
      usage={usage}
      catalog={catalog}
      onGui={onGui}
      onDong={vi.fn()}
    />,
  );
  return onGui;
};

describe('CommandDialog', () => {
  it('cấp kỳ: hiện hạn mức của bậc đang chọn, lấy từ bảng giá chứ không chép số', () => {
    dung('grant');
    expect(screen.getByText(/30\.000 places/)).toBeVisible();
    expect(screen.getByText(/3\.000 directions/)).toBeVisible();
  });

  it('thiếu lý do → chặn tại chỗ, KHÔNG gọi hàm gửi', async () => {
    const onGui = dung('grant');
    await userEvent.clear(screen.getByLabelText(/Mã thanh toán/));
    await userEvent.type(screen.getByLabelText(/Mã thanh toán/), 'CK-1');
    await userEvent.click(screen.getByRole('button', { name: /Gửi lệnh/ }));
    expect(screen.getByText(/Lý do là bắt buộc/)).toBeVisible();
    expect(onGui).not.toHaveBeenCalled();
  });

  it('đủ dữ liệu → gọi onGui đúng một lần với lệnh đã dựng và nhãn tiếng Việt', async () => {
    const onGui = dung('grant');
    await userEvent.type(screen.getByLabelText(/Lý do/), 'khách chuyển khoản');
    await userEvent.type(screen.getByLabelText(/Mã thanh toán/), 'CK-8821');
    await userEvent.click(screen.getByRole('button', { name: /Gửi lệnh/ }));

    expect(onGui).toHaveBeenCalledTimes(1);
    const [lenh, nhan] = onGui.mock.calls[0] as [Record<string, unknown>, string];
    expect(lenh.kind).toBe('grantPeriod');
    expect(lenh.expectedRevision).toBe(5);
    expect(lenh.paymentReference).toBe('CK-8821');
    // periodId do giao diện sinh: trùng periodId ném ràng buộc SQLite và lọt xuống 503 vô nghĩa.
    expect(String(lenh.periodId)).toHaveLength(36);
    expect(nhan).toMatch(/Cấp kỳ/);
  });

  it('mã thao tác sinh MỘT lần cho mỗi lần mở hộp thoại, không sinh lại lúc bấm', async () => {
    const onGui = dung('trial');
    await userEvent.type(screen.getByLabelText(/Lý do/), 'khách xin dùng thử');
    const hienTren = screen.getByTestId('ma-thao-tac').textContent;
    await userEvent.click(screen.getByRole('button', { name: /Gửi lệnh/ }));
    const [lenh] = onGui.mock.calls[0] as [Record<string, unknown>];
    expect(lenh.operationId).toBe(hienTren);
  });

  it('cộng credit: hiện số lượt sẽ cộng và kỳ nhận credit', async () => {
    dung('credits');
    // Số gói mặc định là 1, và một gói places = 1.000 lượt theo bảng giá.
    expect(screen.getByText(/1\.000 lượt/)).toBeVisible();
    expect(screen.getByText(/p-1/)).toBeVisible();
  });
});
```

- [ ] **Step 3: Viết `command-dialog.tsx`**

```tsx
import * as Dialog from '@radix-ui/react-dialog';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Command, PaidTier, PlanCatalog, QuotaGroup, UsageSnapshot } from './api';
import {
  dungLenh,
  type FormLenh,
  homNayVn,
  kiemForm,
  type LoaiLenh,
  thangSau,
} from './command-builder';
import { so } from './usage-panel';

const TIEU_DE: Record<LoaiLenh, string> = {
  trial: 'Bật bản dùng thử',
  grant: 'Cấp kỳ trả phí',
  credits: 'Cộng credit',
  suspend: 'Tạm dừng thuê bao',
  resume: 'Mở lại thuê bao',
  unlock: 'Mở khoá receipt chưa xác nhận',
};

const NHAN_GUI: Record<LoaiLenh, string> = {
  trial: 'Bật dùng thử',
  grant: 'Cấp kỳ',
  credits: 'Cộng credit',
  suspend: 'Tạm dừng',
  resume: 'Mở lại',
  unlock: 'Mở khoá receipt',
};

const field =
  'min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm';

interface Props {
  loai: LoaiLenh;
  usage: UsageSnapshot;
  catalog: PlanCatalog | undefined;
  /** Lệnh đã dựng + nhãn tiếng Việt cho toast đếm ngược. `unlock` đi qua `onMoKhoa`. */
  onGui: (command: Command, nhan: string) => void;
  onMoKhoa?: (operationId: string, reason: string, nhan: string) => void;
  onDong: () => void;
}

export function CommandDialog({ loai, usage, catalog, onGui, onMoKhoa, onDong }: Props) {
  const homNay = homNayVn();
  const [form, setForm] = useState<FormLenh>({
    reason: '',
    ngayBatDau: homNay,
    ngayKetThuc: thangSau(homNay),
    tier: 'starter',
    paymentReference: '',
    lineItemId: 'period-1',
    group: 'places',
    packs: 1,
  });
  const [loi, setLoi] = useState<string | null>(null);
  /**
   * Sinh MỘT lần cho mỗi lần mở hộp thoại và giữ nguyên tới lúc gửi: máy chủ dùng nó để lệnh lặp
   * không thành hai lệnh, và để thử lại sau một 503 mà không cộng tiền hai lần. Sinh lại lúc bấm
   * là vứt bỏ đúng tính chất đó.
   */
  const [operationId] = useState(() => crypto.randomUUID());
  const [periodId] = useState(() => crypto.randomUUID());

  const bac = catalog?.tiers.find((item) => item.tier === form.tier);
  const addOn = catalog?.addOns.find((item) => item.group === form.group);
  const dat = (thayDoi: Partial<FormLenh>) => setForm((truoc) => ({ ...truoc, ...thayDoi }));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const sai = kiemForm(loai, form, usage);
    if (sai) {
      setLoi(sai);
      return;
    }
    const nhan = `${NHAN_GUI[loai]} cho tenant`;
    if (loai === 'unlock') {
      onMoKhoa?.(operationId, form.reason.trim(), nhan);
    } else {
      onGui(dungLenh(loai, form, usage, operationId, periodId), nhan);
    }
    onDong();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDong()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/55" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-[70] max-h-[90vh] overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--bg)] p-4 lg:inset-0 lg:m-auto lg:h-fit lg:max-w-lg lg:rounded-[var(--radius-card)]">
          <Dialog.Title className="text-base font-semibold">{TIEU_DE[loai]}</Dialog.Title>

          <form className="mt-3 space-y-3" onSubmit={onSubmit}>
            {(loai === 'trial' || loai === 'grant') && (
              <label className="block text-sm">
                Ngày bắt đầu
                <input
                  type="date"
                  className={field}
                  value={form.ngayBatDau}
                  onChange={(event) => dat({ ngayBatDau: event.target.value })}
                />
              </label>
            )}

            {loai === 'grant' && (
              <>
                <label className="block text-sm">
                  Ngày kết thúc
                  <input
                    type="date"
                    className={field}
                    value={form.ngayKetThuc}
                    onChange={(event) => dat({ ngayKetThuc: event.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Bậc
                  <select
                    className={field}
                    value={form.tier}
                    onChange={(event) => dat({ tier: event.target.value as PaidTier })}
                  >
                    <option value="starter">starter</option>
                    <option value="professional">professional</option>
                    <option value="business">business</option>
                  </select>
                </label>
                {bac && (
                  <p className="text-xs text-[var(--text-muted)]">
                    Bậc này cho {so(bac.places)} places và {so(bac.directions)} directions mỗi kỳ.
                  </p>
                )}
              </>
            )}

            {loai === 'credits' && (
              <>
                <label className="block text-sm">
                  Nhóm
                  <select
                    className={field}
                    value={form.group}
                    onChange={(event) => dat({ group: event.target.value as QuotaGroup })}
                  >
                    <option value="places">places</option>
                    <option value="directions">directions</option>
                  </select>
                </label>
                <label className="block text-sm">
                  Số gói
                  <input
                    type="number"
                    min={1}
                    className={field}
                    value={form.packs}
                    onChange={(event) => dat({ packs: Number(event.target.value) })}
                  />
                </label>
                {addOn && (
                  <p className="text-xs text-[var(--text-muted)]">
                    Cộng {so(addOn.units * form.packs)} lượt vào kỳ {usage.periodId ?? '—'}.
                  </p>
                )}
              </>
            )}

            {(loai === 'grant' || loai === 'credits') && (
              <>
                <label className="block text-sm">
                  Mã thanh toán
                  <input
                    className={field}
                    value={form.paymentReference}
                    onChange={(event) => dat({ paymentReference: event.target.value })}
                    placeholder="ví dụ CK-8821"
                  />
                </label>
                <label className="block text-sm">
                  Dòng hoá đơn
                  <input
                    className={field}
                    value={form.lineItemId}
                    onChange={(event) => dat({ lineItemId: event.target.value })}
                  />
                </label>
                <p className="text-xs text-[var(--text-muted)]">
                  Cặp mã thanh toán + dòng hoá đơn là định danh giao dịch: gửi lại y hệt sẽ trả về
                  biên lai cũ chứ không cộng tiền lần nữa.
                </p>
              </>
            )}

            <label className="block text-sm">
              Lý do
              <textarea
                className={`${field} min-h-20 py-2`}
                value={form.reason}
                onChange={(event) => dat({ reason: event.target.value })}
                placeholder="Ghi đủ để sáu tháng sau đọc lại vẫn hiểu"
              />
            </label>

            <p className="text-xs text-[var(--text-muted)]">
              Mã thao tác: <span data-testid="ma-thao-tac" className="font-mono">{operationId}</span>
            </p>

            {loi && (
              <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">
                {loi}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" block>
                Gửi lệnh
              </Button>
              <Button type="button" variant="secondary" onClick={onDong}>
                Đóng
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Chạy lại**

```bash
pnpm exec vitest run apps/admin/src/features/billing/command-dialog.test.tsx
```

Mong đợi: 5 PASS.

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/admin/src/features/billing/command-dialog.tsx apps/admin/src/features/billing/command-dialog.test.tsx apps/admin/src/features/billing/receipt.tsx
git commit -m "$(cat <<'EOF'
feat(admin): hộp thoại lệnh billing và khối biên lai

Mã thao tác sinh một lần cho mỗi lần mở hộp thoại; biên lai hiện ở trang
chứ không trong hộp thoại, để toast đếm ngược vẫn bấm Huỷ được.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 15 — MÀN HÌNH `/admin/billing`

**Files:**
- Create: `apps/admin/src/features/billing/page.tsx`
- Create: `apps/admin/src/features/billing/page.test.tsx`
- Modify: `apps/admin/src/routes.tsx`

- [ ] **Step 1: Viết bài kiểm (đỏ trước)**

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedActionProvider } from '@/components/delayed-action';
import { BillingPage } from './page';

const TENANT = '00000000-0000-4000-8000-0000000000cc';

const tenant = (quotaMode: 'legacy' | 'commercial') => ({
  tenant: {
    id: TENANT,
    name: 'Công ty Thử Nghiệm',
    plan: 'paid',
    quota_mode: quotaMode,
    created_at: '2026-09-01T00:00:00.000Z',
    active_keys: 1,
  },
  keys: [],
});

const usage = {
  tenantId: TENANT,
  status: 'active',
  tier: 'starter',
  revision: 5,
  periodId: 'p-1',
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-10-01T00:00:00.000Z',
  trialUsedOnce: false,
  maintenance: false,
  places: { limit: 30_000, used: 100, reserved: 0, credits: 0, available: 29_900 },
  directions: { limit: 3_000, used: 0, reserved: 0, credits: 0, available: 3_000 },
};

const legacyUsage = {
  day: '2026-09-16',
  quotaEnabled: true,
  plan: 'paid',
  counted: true,
  blockAtMultiple: 2,
  keys: [],
  total: { places: { used: 0, limit: 0 }, directions: { used: 0, limit: 0 } },
};

/** Trả JSON theo đường dẫn, và ghi lại mọi lời gọi để khẳng định cái gì KHÔNG được gọi. */
const batFetch = (quotaMode: 'legacy' | 'commercial', ghiDe: Record<string, unknown> = {}) => {
  const mock = vi.fn().mockImplementation(async (path: string, init?: RequestInit) => {
    const duong = String(path);
    const tra = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (duong in ghiDe) return tra(ghiDe[duong], duong.includes('commands') ? 409 : 200);
    if (duong.includes('/v1/admin/tenants/')) return tra(tenant(quotaMode));
    if (duong.includes('/usage')) return tra(usage);
    if (duong.includes('/legacy-usage')) return tra(legacyUsage);
    if (duong.includes('/periods')) return tra({ periods: [], credits: [] });
    if (duong.includes('/plan-catalog')) {
      return tra({ tiers: [], addOns: [], legacyDefaults: { places: 0, directions: 0, blockAtMultiple: 2 } });
    }
    if (init?.method === 'POST') {
      return tra({ operationId: 'op', revision: 6, status: 'active', tier: 'trial', appliedAt: '2026-09-16T10:00:00.000Z' });
    }
    return tra({ items: [], nextCursor: null });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

const dungTrang = () =>
  render(
    <MemoryRouter initialEntries={[`/billing?tenant=${TENANT}`]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DelayedActionProvider>
          <BillingPage />
        </DelayedActionProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BillingPage', () => {
  it('tenant thương mại: đọc sổ quota, KHÔNG đọc bộ đếm legacy', async () => {
    const mock = batFetch('commercial');
    dungTrang();
    expect(await screen.findByText('Đang hoạt động')).toBeVisible();
    const duong = mock.mock.calls.map(([path]) => String(path));
    expect(duong.some((path) => path.includes('/usage'))).toBe(true);
    expect(duong.some((path) => path.includes('/legacy-usage'))).toBe(false);
  });

  it('tenant legacy: đọc bộ đếm KV và KHÔNG chạm /usage — gọi nó sẽ tạo sổ Durable Object', async () => {
    const mock = batFetch('legacy');
    dungTrang();
    expect(await screen.findByText(/Hôm nay/)).toBeVisible();
    const duong = mock.mock.calls.map(([path]) => String(path));
    expect(duong.some((path) => path.includes('/legacy-usage'))).toBe(true);
    expect(duong.some((path) => /\/usage$/.test(path))).toBe(false);
  });

  it('huỷ trong 5 giây → KHÔNG có POST nào rời trình duyệt', async () => {
    const mock = batFetch('commercial');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    dungTrang();
    await user.click(await screen.findByRole('button', { name: /Bật dùng thử/ }));
    await user.type(screen.getByLabelText(/Lý do/), 'khách xin dùng thử');
    await user.click(screen.getByRole('button', { name: /Gửi lệnh/ }));
    await user.click(await screen.findByRole('button', { name: 'Huỷ' }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
  });

  it('hết 5 giây → gửi thật và hiện biên lai kèm mã thao tác', async () => {
    const mock = batFetch('commercial');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    dungTrang();
    await user.click(await screen.findByRole('button', { name: /Bật dùng thử/ }));
    await user.type(screen.getByLabelText(/Lý do/), 'khách xin dùng thử');
    await user.click(screen.getByRole('button', { name: /Gửi lệnh/ }));
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(mock.mock.calls.some(([path, init]) =>
      String(path).includes('/commands') && (init as RequestInit).method === 'POST',
    )).toBe(true);
    expect(await screen.findByText(/Đã gửi/)).toBeVisible();
  });

  it('tenant legacy có nút chuyển sang thương mại, gọi đúng route đổi chế độ', async () => {
    const mock = batFetch('legacy');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    dungTrang();
    await user.click(await screen.findByRole('button', { name: 'Chuyển sang thương mại' }));
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(
      mock.mock.calls.some(
        ([path, init]) =>
          String(path).endsWith('/mode') && (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('lệnh trượt sau khi hộp thoại đã đóng: hiện mã lỗi và câu tiếng Việt, KHÔNG im lặng', async () => {
    // Đây là kịch bản tệ nhất của cả pha: delayed-action gọi run() bằng `void`, nên không bắt lỗi
    // thì người vận hành đóng máy với niềm tin là khách đã có gói.
    batFetch('commercial', {
      [`/v1/admin/billing/${TENANT}/commands`]: { error: { code: 'revision_conflict', message: 'x' } },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    dungTrang();
    await user.click(await screen.findByRole('button', { name: /Bật dùng thử/ }));
    await user.type(screen.getByLabelText(/Lý do/), 'khách xin dùng thử');
    await user.click(screen.getByRole('button', { name: /Gửi lệnh/ }));
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(await screen.findByText(/revision_conflict/)).toBeVisible();
    expect(screen.getByText(/Bấm Tải lại rồi gửi lại/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ, rồi viết `page.tsx`**

```tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useDelayedAction } from '@/components/delayed-action';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSetQuotaMode, useTenantDetail, useTenantList } from '@/features/tenants/hooks';
import { MODE_VI } from '@/features/tenants/tenant-card';
import type { Command } from './api';
import { CommandDialog } from './command-dialog';
import type { LoaiLenh } from './command-builder';
import { loiVi } from './error-vi';
import { useCatalog, useLegacyUsage, usePeriods, useSendCommand, useUnlockAcks, useUsage } from './hooks';
import { LegacyPanel } from './legacy-panel';
import { PeriodsPanel } from './periods-panel';
import { type KetQuaLenh, ReceiptPanel } from './receipt';
import { UsagePanel } from './usage-panel';

/** Chọn tenant trước, rồi mọi thứ khác nằm trong `?tenant=` — tải lại trang không mất chỗ đang xem. */
function ChonTenant({ onChon }: { onChon: (id: string) => void }) {
  const [q, setQ] = useState('');
  const list = useTenantList(q);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-4">
      <input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Tìm tenant để xem gói cước"
        aria-label="Tìm tenant để xem gói cước"
        className="min-h-11 w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
      />
      {list.isPending && <LoadingSkeleton rows={3} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && (
        <EmptyState title="Không có tenant nào khớp" hint="Xoá ô tìm để xem tất cả." />
      )}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <Button variant="secondary" block onClick={() => onChon(item.id)}>
              <span className="flex-1 text-left">{item.name}</span>
              <Badge tone={item.quota_mode === 'commercial' ? 'brand' : 'neutral'}>
                {MODE_VI[item.quota_mode]}
              </Badge>
            </Button>
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <Button variant="secondary" block onClick={() => void list.fetchNextPage()}>
          Tải thêm
        </Button>
      )}
    </div>
  );
}

function BillingTenant({ tenantId, onDoiTenant }: { tenantId: string; onDoiTenant: () => void }) {
  const detail = useTenantDetail(tenantId);
  const thuongMai = detail.data?.tenant.quota_mode === 'commercial';
  const usage = useUsage(tenantId, thuongMai);
  const periods = usePeriods(tenantId, thuongMai);
  const legacy = useLegacyUsage(tenantId, detail.data !== undefined && !thuongMai);
  const catalog = useCatalog();
  const guiLenh = useSendCommand();
  const moKhoa = useUnlockAcks();
  const doiCheDo = useSetQuotaMode();
  const { schedule } = useDelayedAction();
  const [hopThoai, setHopThoai] = useState<LoaiLenh | null>(null);
  const [ketQua, setKetQua] = useState<KetQuaLenh | null>(null);

  const onGui = (command: Command, nhan: string) => {
    schedule({
      label: nhan,
      run: async () => {
        // BẮT BUỘC try/catch: DelayedActionProvider gọi run() bằng `void`, nên một lỗi không bắt
        // sẽ trôi đi thành unhandled rejection và người vận hành tin rằng lệnh đã chạy.
        try {
          setKetQua({ loai: 'bien-lai', nhan, receipt: await guiLenh.mutateAsync({ tenantId, command }) });
        } catch (error) {
          const { ma, cau } = loiVi(error);
          setKetQua({ loai: 'loi', nhan, ma, cau });
        }
      },
    });
  };

  const onMoKhoa = (operationId: string, reason: string, nhan: string) => {
    schedule({
      label: nhan,
      run: async () => {
        try {
          const receipt = await moKhoa.mutateAsync({ tenantId, operationId, reason });
          setKetQua({ loai: 'mo-khoa', nhan, unlocked: receipt.unlocked });
        } catch (error) {
          const { ma, cau } = loiVi(error);
          setKetQua({ loai: 'loi', nhan, ma, cau });
        }
      },
    });
  };

  /**
   * Spec 11.4 xếp "đổi chế độ" vào nhóm lệnh của màn này, và spec mục 8 xếp nó vào loại ĐẢO NGƯỢC
   * ĐƯỢC. Vẫn đi qua toast đếm ngược cho đồng nhất với chỗ còn lại của trang, nhưng nhãn nói rõ
   * hậu quả: chuyển sang thương mại là bật chặn theo hạn mức ngay lập tức.
   */
  const onDoiCheDo = () => {
    const nhan = 'Chuyển tenant sang chế độ thương mại';
    schedule({
      label: nhan,
      run: async () => {
        try {
          await doiCheDo.mutateAsync({ tenantId, mode: 'commercial' });
          setKetQua({
            loai: 'thong-bao',
            nhan,
            cau: 'Từ giờ mọi request của tenant này đi qua sổ quota và bị chặn khi hết hạn mức.',
          });
        } catch (error) {
          const { ma, cau } = loiVi(error);
          setKetQua({ loai: 'loi', nhan, ma, cau });
        }
      },
    });
  };

  if (detail.isPending) return <LoadingSkeleton rows={4} />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;

  const soHienTai = usage.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">{detail.data?.tenant.name}</h1>
        <Badge tone={thuongMai ? 'brand' : 'neutral'}>
          {MODE_VI[detail.data?.tenant.quota_mode ?? 'legacy']}
        </Badge>
        <Button variant="ghost" className="ml-auto" onClick={onDoiTenant}>
          Đổi tenant
        </Button>
      </div>

      {ketQua && <ReceiptPanel ketQua={ketQua} onDong={() => setKetQua(null)} />}

      {!thuongMai && (
        <div className="rounded-[var(--radius-btn)] bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          <p>
            Tenant này chưa vào sổ thương mại: hạn mức bên dưới đếm theo ngày trong KV. Cấp gói ở
            đây vẫn được, và sẽ có hiệu lực ngay khi chuyển sang chế độ thương mại.
          </p>
          <Button variant="secondary" className="mt-2" onClick={onDoiCheDo}>
            Chuyển sang thương mại
          </Button>
        </div>
      )}

      {thuongMai && usage.isPending && <LoadingSkeleton rows={2} />}
      {thuongMai && usage.isError && (
        <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
      )}
      {thuongMai && soHienTai && <UsagePanel usage={soHienTai} />}

      {!thuongMai && legacy.isPending && <LoadingSkeleton rows={2} />}
      {!thuongMai && legacy.isError && (
        <ErrorState error={legacy.error} onRetry={() => void legacy.refetch()} />
      )}
      {!thuongMai && legacy.data && <LegacyPanel legacy={legacy.data} />}

      <div className="flex flex-wrap gap-2">
        {soHienTai?.trialUsedOnce !== true && (
          <Button onClick={() => setHopThoai('trial')}>Bật dùng thử</Button>
        )}
        <Button onClick={() => setHopThoai('grant')}>Cấp kỳ trả phí</Button>
        {soHienTai?.status === 'active' && soHienTai.tier !== 'trial' && (
          <Button variant="secondary" onClick={() => setHopThoai('credits')}>
            Cộng credit
          </Button>
        )}
        {soHienTai?.status === 'suspended' ? (
          <Button variant="secondary" onClick={() => setHopThoai('resume')}>
            Mở lại thuê bao
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setHopThoai('suspend')}>
            Tạm dừng thuê bao
          </Button>
        )}
        <Button variant="secondary" onClick={() => setHopThoai('unlock')}>
          Mở khoá receipt
        </Button>
      </div>

      {thuongMai && periods.data && <PeriodsPanel history={periods.data} />}

      {hopThoai && (
        <CommandDialog
          loai={hopThoai}
          usage={
            soHienTai ?? {
              tenantId,
              status: 'none',
              tier: null,
              revision: 0,
              periodId: null,
              startsAt: null,
              endsAt: null,
              trialUsedOnce: false,
              maintenance: false,
              places: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
              directions: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
            }
          }
          catalog={catalog.data}
          onGui={onGui}
          onMoKhoa={onMoKhoa}
          onDong={() => setHopThoai(null)}
        />
      )}
    </div>
  );
}

export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const tenantId = params.get('tenant');
  if (tenantId === null) {
    return <ChonTenant onChon={(id) => setParams({ tenant: id })} />;
  }
  return <BillingTenant tenantId={tenantId} onDoiTenant={() => setParams({})} />;
}
```

Lưu ý khi viết: hộp thoại đóng ngay trong `CommandDialog.onSubmit` (đã gọi `onDong()`), nên toast đếm ngược không bị Radix chặn — đúng bài học của pha 2. Đừng thêm `onDong` lần nữa ở `onGui`.

- [ ] **Step 3: Thêm route**

Trong `apps/admin/src/routes.tsx`:

```tsx
const BillingPage = lazy(() =>
  import('@/features/billing/page').then((module) => ({ default: module.BillingPage })),
);
```

và trong `children`, sau `{ path: 'tenants', … }`:

```tsx
        { path: 'billing', element: wait(<BillingPage />) },
```

Mục menu `/billing` đã có sẵn trong `layout/sidebar-nav.tsx` từ pha 0 (nhóm "Khách hàng"), không phải sửa gì ở đó.

- [ ] **Step 4: Chạy test của cả mảng**

```bash
pnpm exec vitest run apps/admin/src
```

Mong đợi: toàn bộ xanh, gồm 6 bài của `page.test.tsx`.

- [ ] **Step 5: Xem tận mắt trên trình duyệt**

```bash
node scripts/api-db-test.mjs --serve   # cửa sổ 1
pnpm --filter @mapslibvn/admin dev     # cửa sổ 2
```

Mở `http://localhost:5173/admin/billing`, chọn tenant `M4 itest free`, kiểm bằng mắt:
- thấy băng "chưa vào sổ thương mại" và bảng "Hôm nay";
- bấm **Bật dùng thử**, nhập lý do, Gửi lệnh → hộp thoại đóng, toast đếm ngược hiện, bấm **Huỷ** → không có gì xảy ra (tab Network không có POST nào);
- làm lại, để hết 5 giây → khối biên lai xanh hiện `operationId` và bản sổ số 1;
- thu hẹp cửa sổ xuống 390px: mọi nút vẫn đủ 44px và không tràn ngang.

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm typecheck
git add apps/admin/src/features/billing/page.tsx apps/admin/src/features/billing/page.test.tsx apps/admin/src/routes.tsx
git commit -m "$(cat <<'EOF'
feat(admin): màn Gói cước & hạn mức tại /admin/billing

Tenant thương mại đọc sổ quota, tenant legacy đọc bộ đếm KV (không tạo sổ).
Lệnh đi qua toast đếm ngược 5 giây và luôn kết thúc bằng một biên lai hoặc
một mã lỗi hiện trên trang.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 16 — E2E TRÊN TRÌNH DUYỆT THẬT

**Files:**
- Modify: `apps/admin/e2e/admin.spec.ts`

- [ ] **Step 1: Thêm hai test**

Thêm vào cuối `apps/admin/e2e/admin.spec.ts`:

```ts
test('màn Gói cước: cấp kỳ trả phí cho một tenant rồi thấy hạn mức thật', async ({ page, request }) => {
  // Tenant seed của harness ở chế độ legacy, nên màn hình đi nhánh bộ đếm KV; lệnh billing vẫn
  // gửi được và sổ quota nhận ngay. Dùng tenant seed chứ không tạo tenant mới: Playwright không
  // có đường nối Postgres, còn sổ Durable Object thì harness đã xoá sạch trước mỗi lượt chạy.
  await page.goto('/admin/billing');
  await page.getByRole('button', { name: /M4 itest free/ }).click();

  await expect(page.getByText(/chưa vào sổ thương mại/)).toBeVisible();

  await page.getByRole('button', { name: 'Cấp kỳ trả phí' }).click();
  await page.getByLabel('Mã thanh toán').fill(`CK-E2E-${Date.now()}`);
  await page.getByLabel('Lý do').fill('e2e cấp kỳ');
  await page.getByRole('button', { name: 'Gửi lệnh' }).click();

  // Hoãn gửi 5 giây: hộp thoại đóng ngay, request chỉ đi sau đó.
  await expect(page.getByRole('status')).toContainText('gửi sau');
  await page.waitForTimeout(6000);

  await expect(page.getByText('Đã gửi: Cấp kỳ cho tenant')).toBeVisible();
  await expect(page.getByText(/Bản sổ/)).toBeVisible();
});

test('huỷ trong 5 giây ở màn Gói cước: sổ quota không đổi', async ({ page, request }) => {
  await page.goto('/admin/billing');
  await page.getByRole('button', { name: /M4 itest internal/ }).click();
  await page.getByRole('button', { name: 'Bật dùng thử' }).click();
  await page.getByLabel('Lý do').fill('e2e huỷ');
  await page.getByRole('button', { name: 'Gửi lệnh' }).click();
  await page.getByRole('button', { name: 'Huỷ' }).click();
  await page.waitForTimeout(6000);

  // Kiểm bằng chính API: sổ vẫn trắng vì request chưa bao giờ rời trình duyệt.
  const tenants = await (
    await request.get('/v1/admin/tenants?limit=100', {
      headers: { 'Cf-Access-Jwt-Assertion': ACCESS_JWT },
    })
  ).json();
  const tenant = tenants.items.find((item: { name: string }) => item.name.includes('internal'));
  const usage = await (
    await request.get(`/v1/admin/billing/${tenant.id}/usage`, {
      headers: { 'Cf-Access-Jwt-Assertion': ACCESS_JWT },
    })
  ).json();
  expect(usage.status).toBe('none');
  expect(usage.revision).toBe(0);
});

test('email ngoài BILLING_ADMIN_EMAILS gọi thẳng API billing → 403', async ({ browser }) => {
  // Tiêu chí nghiệm thu số 3 của spec: lớp bảo vệ sẵn có không được yếu đi sau đợt làm này.
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8799' });
  const response = await context.request.get(
    '/v1/admin/billing/00000000-0000-4000-8000-0000000000cc/usage',
    { headers: { 'Cf-Access-Jwt-Assertion': signAccessJwt({ email: 'nguoila@e2e.local' }) } },
  );
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe('billing_admin_forbidden');
  await context.close();
});
```

Trước khi viết, mở `apps/api/test-db/setup.sql` và lấy đúng tên ba tenant seed — nếu tên khác `M4 itest free` / `M4 itest internal`, dùng tên thật trong file đó thay vì hai chuỗi trên.

- [ ] **Step 2: Chạy e2e**

```bash
pnpm test:admin-e2e
```

Mong đợi: toàn bộ xanh, gồm 6 test cũ và 3 test mới. Nếu test cấp kỳ đỏ với `period_overlap`, nghĩa là harness chưa xoá sổ Durable Object giữa các lượt — quay lại Task 3 chứ đừng đổi ngày trong test để né.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/e2e/admin.spec.ts
git commit -m "$(cat <<'EOF'
test(admin): e2e cho màn Gói cước — cấp kỳ, huỷ trong 5 giây, cổng quyền

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# TASK 17 — KIỂM TOÀN BỘ, DEPLOY VÀ CHỨNG CỨ NGHIỆM THU

**Files:**
- Create: `docs/evidence/admin/2026-09-16-pha-3-goi-cuoc-han-muc.md`

- [ ] **Step 1: Chạy sạch toàn bộ bốn tầng**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:api-db
pnpm test:admin-e2e
```

Mong đợi: tất cả xanh. Hai lưu ý đã biết:
- `pnpm typecheck` chạy qua Turbo và **có thể phát lại kết quả cache**. Nếu nghi ngờ, chạy `pnpm turbo run typecheck --force`.
- `pnpm test:db` (tầng quyền) **không** cần chạy cho pha này vì không có migration; nếu vẫn chạy thì `pipelines/poi/tests/pipeline-fixture.dbtest.mjs` sẽ đỏ trên máy dev do thiếu `tippecanoe` — hiện tượng đã biết, không liên quan.

- [ ] **Step 2: Chạy `pnpm test:api-db` lần thứ hai liên tiếp**

```bash
pnpm test:api-db 2>&1 | tail -10
```

Mong đợi: y hệt lượt trước. Đây là bằng chứng bộ test billing tự chứa.

- [ ] **Step 3: PHONG deploy (auto mode không đọc/ghi production)**

Gõ trong phiên Claude Code bằng tiền tố `!`:

```bash
cd apps/api && pnpm exec wrangler deploy --env production
```

Trang Admin là asset của chính Worker này, nên lệnh trên đưa cả API mới lẫn giao diện mới lên cùng lúc. Trước đó `pnpm build` phải đã chạy (bước `pnpm test` ở Step 1 có build `@mapslibvn/admin`); nếu không chắc, chạy `pnpm build` trước.

- [ ] **Step 4: Đối chiếu máy chủ sau deploy**

```bash
curl -s https://api.ai-solutions.io.vn/healthz/db
```

Mong đợi: `schema_migration` vẫn là `0019` (pha này không có migration) và `user` là `api`.

- [ ] **Step 5: Nghiệm thu thật trên production**

PHONG mở `https://api.ai-solutions.io.vn/admin/billing` **trên điện thoại**, chọn một tenant thật rồi làm đủ bốn việc dưới đây, chụp màn hình từng bước:

1. Xem một tenant đang ở chế độ **legacy**: thấy bảng "Hôm nay" có số thật của ít nhất một khoá.
2. Xem một tenant đang ở chế độ **thương mại** (hoặc chuyển một tenant thử nghiệm sang): thấy kỳ hiện tại, hai thanh hạn mức và bảng các kỳ đã cấp.
3. Bấm một lệnh rồi **bấm Huỷ trong 5 giây**: không có gì đổi, mở lại màn hình thấy bản sổ giữ nguyên số cũ.
4. Gửi thật một lệnh nhỏ (ví dụ **Cộng credit 1 gói** cho tenant thử nghiệm, hoặc **Tạm dừng rồi Mở lại**): thấy khối biên lai với `operationId` và bản sổ tăng đúng 1.

Sau đó đối chiếu nhật ký bằng lệnh PHONG chạy trực tiếp trên máy chủ:

```sql
SELECT actor, action, target, detail, created_at
FROM admin_audit
WHERE action LIKE 'billing.%'
ORDER BY id DESC LIMIT 10;
```

Mong đợi: mỗi lệnh đã gửi có đúng một dòng, `actor` là email Access của PHONG, `detail` có `kind`/`operation_id`/`revision` và **không** chứa mã thanh toán.

- [ ] **Step 6: Viết chứng cứ**

Tạo `docs/evidence/admin/2026-09-16-pha-3-goi-cuoc-han-muc.md` theo đúng khuôn của `2026-09-16-pha-2-tenant-khoa-api.md`: ngày giờ, lệnh đã chạy kèm output thật, ảnh chụp màn hình trên máy thật, các dòng `admin_audit` đọc được, và một mục "những gì CHƯA làm" ghi rõ:

- mức dùng tách theo endpoint là việc của pha 5 (Cloudflare Analytics), pha 3 chỉ có hai nhóm quota;
- bộ đếm legacy là số **xấp xỉ** trong ngày, không có lịch sử;
- chưa có màn xem `entitlement_event` của sổ (biên lai lịch sử) — nhật ký kiểm toán ở pha 4 mới là nơi tra cứu.

- [ ] **Step 7: Commit chứng cứ**

```bash
git add docs/evidence/admin/2026-09-16-pha-3-goi-cuoc-han-muc.md
git commit -m "$(cat <<'EOF'
docs(admin): chứng cứ nghiệm thu pha 3 trên production

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Tiêu chí nghiệm thu pha 3

Đối chiếu trước khi coi là xong. Đây là bản thu hẹp của spec mục 18 cho đúng phạm vi pha này.

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:api-db`, `pnpm test:admin-e2e` đều xanh; `pnpm test:api-db` chạy hai lượt liên tiếp cho cùng kết quả.
2. `POST /v1/admin/billing/...` từ một trang khác origin nhận **403 `cross_site_request`**, chặn trước cả bước kiểm JWT.
3. Email ngoài `BILLING_ADMIN_EMAILS` gọi bất kỳ route billing nào vẫn nhận **403 `billing_admin_forbidden`**.
4. Mỗi lệnh billing thành công để lại **đúng một** dòng `admin_audit` với đúng `actor`, và `detail` không chứa mã thanh toán.
5. Mở màn hình cho một tenant `legacy` **không** tạo sổ Durable Object (kiểm bằng bài itest "KHÔNG tạo sổ quota").
6. Bấm một lệnh rồi Huỷ trong 5 giây: **không** có request nào rời trình duyệt.
7. Mọi mã 409 trong bảng ở đầu plan hiện đúng mã kèm câu tiếng Việt riêng; một lệnh trượt **không bao giờ** kết thúc im lặng.
8. Trên khung 390px: mọi nút cao tối thiểu 44px, không có cuộn ngang, chữ nội dung ≥ 14px.
9. Bản sáng và bản tối đều đọc được; trạng thái không bao giờ chỉ truyền đạt bằng màu.
10. Ba test e2e cũ của pha 0–2 vẫn xanh.

## Ngoài phạm vi pha 3 (ghi để không ai tự ý mở rộng)

- **Tách mức dùng theo endpoint** — cần Cloudflare Analytics API, thuộc pha 5.
- **Đọc `entitlement_event`** (lịch sử biên lai trong sổ) — pha 4 đọc `admin_audit` là đủ cho nhu cầu tra cứu; thêm một cửa nữa vào sổ là thêm một chỗ phải bảo vệ.
- **Sao lưu/phục hồi sổ quota** — đã có `pnpm audit:quota` và nhóm route `backup/*` đứng sau `BILLING_BACKUP_EMAILS` riêng. Không đưa lên giao diện: đây là thao tác ghi đè được cả lịch sử tiêu thụ, không nên cách một cú chạm trên điện thoại.
- **Tự động hoá hoá đơn / thanh toán** — pha này chỉ ghi nhận một giao dịch đã xảy ra ở ngoài hệ thống.
- **Phân quyền** — PHONG đã chốt chưa làm ở giai đoạn này; ba điểm móc (`GET /v1/admin/me`, `can()`, `admin_audit`) vẫn giữ nguyên.
