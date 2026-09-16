# Đặc tả Trang Admin MapsLibVN — SPA React mobile-first

Ngày: 16/09/2026. PHONG duyệt hướng thiết kế qua phiên brainstorming cùng ngày.
Thay thế hoàn toàn trang `apps/admin` hiện tại (bảng HTML trần, một màn hình duy nhất).
PHONG đã chọn gói cả năm mảng vào **một** spec sau khi được cảnh báo về độ dài; rủi ro đó
được xử lý bằng cách chia pha ở mục 17, mỗi pha kết thúc là một thứ dùng được.

## 1. Mục tiêu và phạm vi

Một trang quản trị duy nhất, mobile-first, dùng được thật trên điện thoại lẫn máy tính, thay cho
tình trạng hiện nay: một màn hình duyệt POI thô sơ cộng với việc phải gọi curl cho mọi thứ còn lại.

Trong phạm vi — năm mảng cộng một trang đích:

1. Tổng quan
2. Duyệt đóng góp POI
3. Tenant & khoá API
4. Gói cước & hạn mức
5. Sức khoẻ hệ thống
6. Nhật ký kiểm toán

Ngoài phạm vi, đã cân nhắc và loại bỏ có chủ ý:

- **Chạy pipeline dữ liệu từ web** (`data:update`, `data:rollback`). Cho phép bấm nút chạy pipeline
  production từ trình duyệt là rủi ro không tương xứng lợi ích; giữ nguyên CLI trên máy chủ.
- **Sửa POI trực tiếp** không qua luồng đóng góp.
- **Địa giới hành chính và alias** (bài Cô Tô). PHONG loại khỏi phạm vi ngày 16/09; tiếp tục dùng
  seed override và SQL tay.
- Sao lưu/phục hồi Durable Object billing: đã có API nhưng là thao tác vận hành nguy hiểm, giữ CLI.

## 2. Các quyết định đã chốt

| Hạng mục | Quyết định | Ghi chú |
|---|---|---|
| Nền giao diện | Tailwind v4 + shadcn/ui (trên Radix) | Mã component nằm trong repo, không phải dependency đen |
| Khung điều hướng | Sidebar chia nhóm, thu vào sau nút ☰ trên màn hình hẹp | |
| Đơn vị nội dung (hẹp) | Thẻ xếp dọc, hành động ngay trên thẻ | |
| Màn hình rộng | Chuyển hẳn sang **bảng** (không phải lưới thẻ) | Ba trong năm mảng vốn là dữ liệu bảng |
| Phong cách | Xanh bản đồ `#1b3a6b`, lấy từ style bản đồ sẵn có; kèm bản tối | Hệ thống chưa có bộ nhận diện riêng |
| Phân quyền | **Chưa phân quyền** ở giai đoạn này; giữ nguyên Access và allowlist sẵn có | PHONG chốt 16/09: hệ thống một người quản lý. Điểm móc để thêm sau ở mục 9 |
| Tầng dữ liệu | TanStack Query + React Router v7 (khai báo, không loader) | |
| Số liệu lưu lượng | Gọi ngược Cloudflare Analytics API bằng token riêng | Thêm một secret phải quản lý |

## 3. Hiện trạng đã kiểm tra (16/09/2026)

- `apps/admin` là SPA Vite + React 19: `main.tsx`, `app.tsx`, `api.ts`, tổng khoảng 150 dòng.
  Build ra `dist/admin`, Worker phục vụ qua `[assets] directory = "../admin/dist"`.
- Cùng origin với `/v1/admin/*`, nên **chỉ cần một Cloudflare Access application**. Đây là ràng
  buộc kiến trúc phải giữ, không phải chi tiết triển khai.
- `apps/api/src/routes/admin.ts`: `GET /v1/admin/edits` (`LIMIT 200` cứng, không phân trang,
  không lọc ngoài `status`), `POST …/approve`, `POST …/reject`. Có middleware chống CSRF chặn
  POST cross-site, đứng **trước** `requireAccess()`.
- `apps/api/src/routes/billing-admin.ts`: đã đủ `usage`, `commands`, `mode`,
  `missing-acks/unlock`, `keys/:keyHash/revocation`, và nhóm `backup/*`. Chưa có giao diện nào.
- `requireBillingAccess()` lọc theo `BILLING_ADMIN_EMAILS`; nhóm backup lọc theo
  `BILLING_BACKUP_EMAILS`. Giữ nguyên hai lớp này, xem mục 9.
- Schema: `tenant(id, name, plan, quota_mode, created_at)`, `api_key(key_hash, tenant_id, label,
  kind, allowed_origins, allowed_bundle_ids, scopes, quota_*, active, created_at, revoked_at)`,
  `poi_edit(id, poi_id, tenant_id, kind, changes, photo_url, note, status, reviewer, reviewed_at,
  created_at)`.
- Role `api` **chỉ có `SELECT`** trên `tenant`, `api_key`, cộng `UPDATE (quota_mode)` và
  `UPDATE (active, revoked_at)` được cấp riêng ở migration `0015`, `0016`.
- `vitest.config.ts` gốc **không include `apps/admin`** — trang admin hiện không có unit test nào.
- `pnpm test` có chạy `pnpm --filter @mapslibvn/admin build`, nên build hỏng là chặn cả bộ test.
- E2E Playwright đã có 3 test, chạy trên harness `node scripts/api-db-test.mjs --serve`, ký JWT
  giả bằng `scripts/lib/access-fake.mjs`.
- Biome 2.5.13 lint cả CSS với preset `recommended`.

## 4. Kiến trúc và ranh giới

Giữ nguyên mô hình triển khai: SPA tĩnh, `base: '/admin/'`, `outDir: dist/admin`, Worker phục vụ.
Không tách sang domain riêng — làm vậy sẽ phá mô hình một Access application và kéo theo CORS,
cookie cross-site, cùng một bề mặt tấn công mới.

Chia thư mục theo **mảng nghiệp vụ**, không theo loại file, để mỗi mảng đọc được trọn vẹn một chỗ
và mảng thứ n chỉ là lặp lại khuôn của mảng thứ nhất:

```
apps/admin/src/
  main.tsx              gắn QueryClient + RouterProvider + ThemeProvider
  routes.tsx            khai báo route, lazy-load từng feature
  layout/
    app-shell.tsx       khung: topbar + sidebar/drawer + vùng nội dung
    sidebar-nav.tsx     ba nhóm mục, huy hiệu số việc tồn, ẩn mục thiếu quyền
    drawer.tsx          ngăn kéo cho màn hình hẹp
    topbar.tsx          nút ☰, tiêu đề trang, email, nút sáng/tối
  components/
    data-view.tsx       thẻ ↔ bảng theo bề ngang (mục 7)
    states.tsx          LoadingSkeleton · EmptyState · ErrorState · ForbiddenState · OfflineState
    confirm-dialog.tsx
    delayed-action.tsx  toast đếm ngược 5 giây (mục 8)
    pagination.tsx
    ui/                 shadcn: button, card, sheet, dialog, table, badge, toast, input, select…
  features/
    overview/ edits/ tenants/ billing/ health/ audit/
        api.ts    kiểu dữ liệu + hàm gọi, không chứa React
        hooks.ts  useQuery/useMutation, khoá cache, invalidate
        page.tsx  màn hình
        components/
  lib/
    fetcher.ts    fetch có xử lý lỗi ApiError, 401/403, no-store
    permissions.ts đọc từ /v1/admin/me, hàm can('…')
    format.ts     ngày giờ, số, tiền theo tiếng Việt
    theme.ts      sáng/tối, ghi nhớ lựa chọn
```

Ranh giới quan trọng: `features/*/api.ts` không import React và không biết gì về giao diện;
`page.tsx` không tự gọi `fetch`. Nhờ vậy đổi tầng dữ liệu không đụng màn hình và ngược lại.

## 5. Hệ thống thiết kế

Tailwind v4 khai báo kiểu CSS-first bằng `@theme`, nên mọi màu là biến CSS; bản tối là gán lại
biến dưới `.dark`, không nhân đôi class.

- Màu chính `#1b3a6b` và thang dẫn xuất; thang xám lạnh cho nền và viền.
- Màu trạng thái để riêng, không lẫn với màu thương hiệu: xanh lá = đã duyệt/khoẻ,
  đỏ = từ chối/lỗi, hổ phách = sắp vượt hạn mức, xanh dương = thông tin.
- Bo góc: 12px thẻ, 9px nút, 16px tấm trượt. Thang khoảng cách bội số 4px.
- **Cỡ chữ nội dung tối thiểu 14px.** Tiếng Việt có dấu; nhỏ hơn thì dấu dính nhau trên màn hình
  mật độ thấp. Nhãn phụ tối thiểu 12px.
- **Vùng chạm tối thiểu 44×44px** cho mọi phần tử bấm được trên màn hình hẹp.
- Tương phản đạt WCAG AA cho cả bản sáng và bản tối; không dùng riêng màu để truyền đạt trạng
  thái, luôn kèm chữ hoặc biểu tượng.

Ngưỡng bề ngang:

| Ngưỡng | Điều hướng | Nội dung |
|---|---|---|
| `< 640px` | sidebar sau ☰ | một cột, thẻ |
| `640–1023px` | sidebar sau ☰ | hai cột, thẻ |
| `≥ 1024px` | sidebar cố định, ☰ biến mất | bảng |

## 6. AppShell và điều hướng

Sidebar chia ba nhóm:

- **Nội dung** — Tổng quan, Duyệt đóng góp
- **Khách hàng** — Tenant & khoá API, Gói cước & hạn mức
- **Vận hành** — Sức khoẻ hệ thống, Nhật ký kiểm toán

Mục Duyệt đóng góp mang huy hiệu số bản ghi `pending`, lấy từ một query đếm riêng, làm mới mỗi
60 giây và sau mỗi lần duyệt. Mỗi mục kiểm `can(...)` trước khi render — giai đoạn này luôn đúng
nên mọi mục đều hiện; khi có phân quyền, mục không đủ quyền sẽ **ẩn hẳn** chứ không hiện dạng mờ.

Ngăn kéo phải làm đúng bốn điều, đây là chỗ dễ làm ẩu nhất:

1. Giam tiêu điểm bàn phím bên trong khi đang mở, trả tiêu điểm về nút ☰ khi đóng.
2. Esc đóng; chạm vùng nền tối đóng.
3. Khoá cuộn trang nền khi mở.
4. Trượt bằng `transform`, **không** animate `width` — animate width gây giật trên máy yếu.

Cộng `env(safe-area-inset-*)` cho thiết bị có tai thỏ; topbar dính trên cùng.

## 7. `DataView`

Một component nhận cùng một mảng dữ liệu và hai cách vẽ do mảng nghiệp vụ khai báo:

```ts
interface DataViewProps<T> {
  items: T[];
  columns: Column<T>[];        // dùng khi ≥1024px
  renderCard: (item: T) => ReactNode;  // dùng khi <1024px
  rowKey: (item: T) => string;
  selectable?: boolean;        // chỉ có tác dụng ở chế độ bảng
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSortChange?: (sort: …) => void;
}
```

Chuyển chế độ theo bề ngang khung nhìn bằng `matchMedia('(min-width: 1024px)')`, không theo user
agent và không đo container — một ngưỡng duy nhất cho cả trang thì hành vi mới đoán được. Chọn nhiều dòng
và sắp xếp theo cột chỉ tồn tại ở chế độ bảng — cố đưa chúng xuống điện thoại sẽ hỏng cả hai.

## 8. Trạng thái chuẩn và mô hình hành động

Mọi màn hình bắt buộc xử lý đủ năm trạng thái, lấy từ `components/states.tsx`:

| Trạng thái | Yêu cầu |
|---|---|
| Đang tải | Khung xương đúng hình dạng nội dung sắp tới, **không** dùng vòng xoay toàn trang |
| Rỗng | Giải thích vì sao rỗng và đề xuất hành động, không chỉ ghi "Không có dữ liệu" |
| Lỗi | Hiện `error.code` thật của API cộng câu tiếng Việt, kèm nút Thử lại |
| Thiếu quyền | Nói rõ vì sao bị chặn, không im lặng hay chuyển hướng ngầm. Giai đoạn này chỉ gặp ở nhóm billing khi email ngoài `BILLING_ADMIN_EMAILS` |
| Mất mạng | Báo rõ và tự thử lại khi có mạng |

**Mô hình hành động — chia hai loại.** `apply_poi_edit` ghi thẳng vào bảng POI và xoá cache, nên
"hoàn tác" sau khi đã duyệt là không đảo ngược được sạch sẽ. Vì vậy:

- **Hành động khó đảo ngược** — duyệt/từ chối đóng góp, thu hồi khoá, vô hiệu hoá người dùng:
  dùng `delayed-action`. Bấm nút → giao diện cập nhật lạc quan + toast đếm ngược 5 giây →
  **chưa gọi API**. Bấm Huỷ thì khôi phục, không có request nào rời trình duyệt. Hết 5 giây mới
  gọi thật. Rời trang trong khi đang đếm sẽ gửi ngay chứ không bỏ lệnh.
- **Hành động đảo ngược được** — đổi `quota_mode`, khôi phục khoá: gọi ngay, cập nhật lạc quan,
  toast kèm "Hoàn tác" gọi endpoint nghịch; thất bại thì cuộn ngược trạng thái.

Mọi lệnh ghi tới nhóm billing phải kèm `operationId` (ULID sinh ở client, giữ nguyên khi thử lại)
để bấm hai lần không thành hai lệnh.

## 9. Đăng nhập, kiểm soát truy cập và phân quyền

### 9.1. Không có màn hình đăng nhập trong ứng dụng

Đăng nhập do Cloudflare Access lo, đứng **trước** Worker: request chưa đăng nhập không bao giờ
chạm tới mã ứng dụng. Luồng thật:

1. Mở `https://api.ai-solutions.io.vn/admin/`.
2. Chưa có cookie hợp lệ → Access chuyển sang team domain `snowy-credit-f444.cloudflareaccess.com`
   (khai trong `[env.production]` của `apps/api/wrangler.toml`).
3. Đăng nhập bằng phương thức đã bật trong Zero Trust.
4. Access đặt cookie `CF_Authorization` và chèn header `Cf-Access-Jwt-Assertion` vào mọi request
   tới Worker.
5. `apps/api/src/access.ts` kiểm chữ ký theo JWKS, `aud` khớp `ACCESS_AUD`, `iss` khớp team domain,
   `exp` còn hạn; lấy `email` làm `reviewer`.

**Ai vào được là policy trong Cloudflare Zero Trust, không phải cấu hình trong repo.** Thêm hoặc
bớt người không cần deploy. Đây là lý do việc chưa phân quyền ở 9.3 vẫn an toàn: lớp "ai vào được"
đầy đủ, chỉ chưa phân biệt "vào rồi làm được gì".

Địa chỉ trang:

| Môi trường | Địa chỉ |
|---|---|
| Production | `https://api.ai-solutions.io.vn/admin/` |
| Wrangler dev | `http://localhost:8787/admin/` |
| Harness e2e | `http://127.0.0.1:8799/admin/`, JWT giả ký bằng `scripts/lib/access-fake.mjs` |

### 9.2. Bốn ràng buộc bắt buộc

1. **Access application phải phủ cả `/admin*` lẫn `/v1/admin*`.** Nếu chỉ phủ `/admin`, API dựa
   hoàn toàn vào việc Worker tự kiểm JWT — thiếu header thì vẫn 401 nên còn đóng, nhưng đó là may
   chứ không phải thiết kế. Đưa vào danh sách kiểm khi deploy.
2. **Xử lý JWT hết hạn giữa phiên.** Token hết hạn khi đang duyệt dở thì `fetch` nhận 401 kèm
   **trang HTML đăng nhập của Access, không phải JSON** — `apps/admin/src/api.ts` hiện đã có ghi
   chú về đúng tình huống này. `lib/fetcher.ts` phải nhận ra 401 và tải lại trang để Access đưa về
   màn đăng nhập, thay vì hiện "Lỗi: HTTP 401" rồi đứng im. Trước khi tải lại phải cảnh báo nếu
   đang có `delayed-action` chờ gửi.
3. **Đăng xuất** dùng `/cdn-cgi/access/logout`, đặt trong menu email ở topbar.
4. **Chạy dev tại máy** không có Access nên `ACCESS_TEAM_DOMAIN` trống và mọi route admin trả 401.
   Phải dùng harness `node scripts/api-db-test.mjs --serve` có JWKS giả, không phải `wrangler dev`
   trần. Ghi rõ trong README của `apps/admin`.

### 9.3. Phân quyền

**Giai đoạn này không có phân quyền.** PHONG chốt 16/09/2026: hệ thống do một người quản lý, nên
dựng bảng vai trò và màn hình quản lý người dùng là xây nhà cho người chưa tồn tại. Cloudflare
Access đã kiểm soát *ai vào được*; khi chỉ có một người thì *vào rồi làm được gì* chưa phải câu hỏi.

Giữ nguyên, không đụng tới, đúng như đang chạy trên production:

- `requireAccess()` cho `/v1/admin/*` — xác thực JWT Access, lấy email vào `c.get('reviewer')`.
- `requireBillingAccess()` lọc theo `BILLING_ADMIN_EMAILS`, nhóm `backup/*` lọc theo
  `BILLING_BACKUP_EMAILS`. **Không bỏ hai lớp này** — bỏ là hạ mức bảo vệ hiện có để đổi lấy sự
  gọn gàng, không đáng.
- Middleware chống CSRF cho POST.

Không tạo bảng `admin_user`, không có vai trò, không có `requireAdmin`, không có màn hình quản lý
người dùng.

**Ba điểm móc phải làm ngay, để thêm phân quyền sau không phải sửa rải rác sáu màn hình:**

1. `GET /v1/admin/me` trả `{ email, permissions }`. Giai đoạn này `permissions` là danh sách đầy
   đủ cho mọi người qua được Access. Hợp đồng API không đổi khi thêm vai trò sau.
2. `lib/permissions.ts` với `can(permission: string): boolean` — khoảng mười dòng, hiện đọc từ
   `/me` và thực tế luôn trả `true`. **Các màn hình gọi `can('billing.write')` ngay từ đầu.** Ngày
   thêm RBAC chỉ cần đổi thân hàm và thêm middleware phía API.
3. `admin_audit` ghi `actor` là email lấy từ Access (mục 10). Nhật ký không phụ thuộc phân quyền,
   và giá trị của nó — "hai tháng trước ai đã thu hồi khoá này" — vẫn có nghĩa khi chỉ có một
   người, vì người đó là chính mình của hai tháng trước.

Khi công ty mở rộng, việc phải làm thêm là: bảng `admin_user(email, roles, active)`, middleware
`requireAdmin(permission)` tra bảng đó, đổi thân `can()`, và một màn hình quản lý người dùng. Giao
diện sáu màn hình hiện có không phải sửa. Lúc đó nhớ giữ một đường bootstrap qua
`BILLING_ADMIN_EMAILS` phòng khi bảng rỗng hoặc DB chết, nếu không một lần lỡ tay là tự khoá mình
ra khỏi hệ thống và phải sửa bằng SQL trên production.

Nguyên tắc vẫn áp dụng từ bây giờ: **API là nơi chặn thật, giao diện chỉ ẩn cho gọn mắt.**

## 10. Nhật ký kiểm toán

Migration `0017` thêm:

```sql
CREATE TABLE admin_audit (
  id         bigserial PRIMARY KEY,
  actor      text NOT NULL,
  action     text NOT NULL,          -- 'edit.approve', 'key.revoke', 'billing.grant'…
  target     text,                   -- id edit, key_hash, tenant_id
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON admin_audit (created_at DESC);
CREATE INDEX admin_audit_actor_idx   ON admin_audit (actor, created_at DESC);
```

Ghi nhật ký là **middleware ở tầng API**, bật ngay từ pha 0, không phải việc từng route tự nhớ.
Ghi sau khi thao tác thành công, trong `waitUntil` để không cộng độ trễ vào phản hồi. Nhật ký ghi
hỏng không được làm hỏng thao tác chính.

`detail` không bao giờ chứa khoá API dạng rõ, chỉ chứa `key_hash`.

## 11. Sáu màn hình

### 11.1. Tổng quan — `/admin`

Bốn ô số liệu: đóng góp chờ duyệt, tenant sắp vượt hạn mức, trạng thái DB và schema migration,
trạng thái routing. Dưới là năm việc gần nhất từ `admin_audit`. Mỗi ô bấm vào là sang mảng tương
ứng, và mỗi ô kiểm `can(...)` như mọi chỗ khác.

### 11.2. Duyệt đóng góp — `/admin/edits`

- Lọc: trạng thái (4 giá trị), loại (5 giá trị), tenant, khoảng thời gian; tìm theo tên POI.
- Phân trang theo con trỏ, mặc định 25 bản ghi.
- Thẻ/dòng hiển thị: loại, tên POI kèm địa chỉ suy từ toạ độ, thời gian tương đối, người gửi.
- Chi tiết: `changes` trình bày dạng **so sánh cũ → mới theo từng trường**, không phải JSON thô
  như hiện nay; ảnh đóng góp; bản đồ nhỏ chỉ vị trí đề xuất.
- Hành động: Duyệt, Từ chối — qua `delayed-action` 5 giây. Ở chế độ bảng có chọn nhiều dòng và
  duyệt hàng loạt, cũng qua cơ chế đếm ngược, một lệnh cho cả lô.
- Giữ nguyên chuỗi tiêu đề **"Duyệt đóng góp POI"** để ba test e2e hiện có không vỡ vô cớ.

### 11.3. Tenant & khoá API — `/admin/tenants`

- Danh sách tenant: tên, gói, `quota_mode`, số khoá đang hoạt động, ngày tạo; tìm theo tên.
- Chi tiết tenant: danh sách khoá kèm nhãn, loại, phạm vi, origin cho phép, trạng thái.
- Cấp khoá mới: **khoá dạng rõ chỉ hiện đúng một lần** ngay sau khi tạo, kèm nút sao chép và cảnh
  báo rõ ràng; DB chỉ lưu `key_hash`, mất là phải cấp lại.
- Thu hồi / khôi phục khoá, đổi `quota_mode` — lệnh thu hồi có `operationId`.

### 11.4. Gói cước & hạn mức — `/admin/billing`

- Chọn tenant → xem mức dùng theo endpoint và theo kỳ, phần trăm đã tiêu, **cảnh báo hổ phách từ
  80% và đỏ từ 100%** của hạn mức kỳ hiện tại.
- Lệnh: cấp/gia hạn gói, cộng credit, mở khoá `ack_required` (bắt buộc nhập lý do), đổi chế độ.
- Hiện biên lai trả về của mỗi lệnh; lỗi 409 phải hiện đúng mã (`period_overlap`,
  `trial_already_used`, `credits_require_paid_active`…) kèm giải thích tiếng Việt, vì mỗi mã ứng
  với một cổng chặn khác nhau mà người vận hành cần biết chính xác.

### 11.5. Sức khoẻ hệ thống — `/admin/health`

- Lượt gọi theo endpoint, p95 độ trễ, tỉ lệ lỗi, tách theo tenant — từ Cloudflare Analytics API.
- Trạng thái DB và `schema_migration` từ `/healthz/db`.
- Trạng thái routing đo bằng **một `/route` thật**, không tin `/status` của Valhalla: graph rỗng
  vẫn trả 200, đã có tiền lệ.
- Phiên bản manifest tile và POI đang phục vụ.
- Kết quả cache trong KV 5 phút; màn hình hiện rõ "số liệu tính đến HH:MM".

### 11.6. Nhật ký kiểm toán — `/admin/audit`

Dòng thời gian từ `admin_audit`, lọc theo người thực hiện, loại việc và khoảng thời gian; phân
trang theo con trỏ. Giai đoạn này mọi người vào được đều xem toàn bộ; bộ lọc theo người thực hiện
vẫn làm sẵn vì nó cũng dùng để soát lại việc của chính mình theo mốc thời gian.

## 12. API phải viết thêm

Tất cả đều sau `requireAccess()`; nhóm billing giữ nguyên `requireBillingAccess()` như hiện tại.

| Phương thức | Đường dẫn | Ghi chú |
|---|---|---|
| GET | `/v1/admin/me` | `{ email, permissions }`; giai đoạn này trả quyền đầy đủ |
| GET | `/v1/admin/edits` | **sửa**: thêm phân trang con trỏ, lọc `kind`/`tenant`/thời gian, tìm theo tên |
| GET | `/v1/admin/edits/count` | huy hiệu số việc tồn |
| POST | `/v1/admin/edits/bulk` | duyệt/từ chối một lô |
| GET | `/v1/admin/tenants` | phân trang, tìm theo tên |
| GET | `/v1/admin/tenants/:id` | kèm danh sách khoá |
| POST | `/v1/admin/tenants/:id/keys` | trả khoá rõ **đúng một lần** |
| GET | `/v1/admin/metrics` | gọi Cloudflare Analytics API, cache KV |
| GET | `/v1/admin/health` | gộp `/healthz/db` + `/route` thật + manifest |
| GET | `/v1/admin/audit` | phân trang con trỏ |

Toàn bộ dùng lại middleware chống CSRF sẵn có và `cache-control: private, no-store`.

## 13. Migration và quyền database

Migration `0017_admin_audit.sql` cộng file `.down.sql` tương ứng, gồm bảng `admin_audit`, hai chỉ
mục, và **`GRANT` đầy đủ cho role `api`**:

```sql
GRANT SELECT, INSERT ON admin_audit TO api;
GRANT USAGE, SELECT ON SEQUENCE admin_audit_id_seq TO api;
GRANT INSERT ON api_key TO api;                              -- cho việc cấp khoá từ web
```

Đây là chỗ đã từng cháy: migration `0016` sinh ra vì `0005` quên `GRANT UPDATE` trên `api_key`,
route thu hồi khoá rơi vào catch chung và trả `upstream_unavailable` trên production. Mọi bảng và
cột mới đều phải kèm `GRANT`, và cấp **theo cột** khi chỉ cần vài cột.

Thứ tự triển khai bắt buộc: chạy migration → kiểm `/healthz/db` thấy `schema_migration` đã sang
bản mới → mới deploy Worker. Deploy trước migration đã từng làm chết API.

## 14. Kiểm thử

**Tầng component** — vitest 5 + `@testing-library/react` + jsdom, đều đã có ở gốc. Phải thêm
`'apps/admin/src/**/*.test.tsx'` vào `include` của `vitest.config.ts`, hiện chưa có.

- `DataView` đổi thẻ ↔ bảng đúng theo `matchMedia`.
- Ngăn kéo: giam tiêu điểm, Esc đóng, trả tiêu điểm về nút ☰.
- Năm trạng thái render đúng.
- **`delayed-action`: huỷ trong 5 giây thì không có lời gọi API nào.** Đây là bài test quan trọng
  nhất của mảng này — nếu sai, người duyệt mất khả năng rút lại và dữ liệu POI đã bị ghi.
- `permissions.ts`: `can()` trả `false` thì mục menu không render — kiểm bằng cách giả lập `/me`
  trả quyền thiếu, để cơ chế này có bài test sẵn từ trước khi thật sự có phân quyền.
- `fetcher.ts`: phản hồi 401 **trả về HTML** (giả lập trang đăng nhập Access) thì kích hoạt tải
  lại trang, không hiện lỗi thô; và không tải lại khi đang có `delayed-action` chờ gửi.

**Tầng e2e** — Playwright trên harness `api-db-test.mjs --serve` đã có, mở rộng từ 3 test:

- Luồng duyệt có huỷ: bấm Duyệt rồi bấm Huỷ trong 5 giây → bản ghi vẫn `pending`, POI chưa active.
- Điều hướng bằng drawer ở khung hình hẹp.
- Email ngoài `BILLING_ADMIN_EMAILS` gọi thẳng `/v1/admin/billing/...` nhận 403 — lớp bảo vệ sẵn
  có phải còn nguyên sau khi thay trang.
- Giữ 3 test hiện có chạy được.

**Tầng quyền DB** — kiểm mọi route mới bằng role `api` thật, không phải role chủ sở hữu.
`test:api-db` nối bằng role chủ sở hữu nên sẽ không bắt được thiếu `GRANT`; cần một bài kiểm riêng
nối bằng `api`.

Thêm claim mới vào JWT thì phải sửa kèm `scripts/lib/access-fake.mjs` và `scripts/api-db-test.mjs`.

## 15. Rủi ro và cạm bẫy đã biết

| Rủi ro | Cách xử lý |
|---|---|
| Worker không đọc thẳng Analytics Engine | Token Cloudflare chỉ quyền đọc, lưu trong secret, cache KV 5 phút |
| `/status` Valhalla xanh giả khi graph rỗng | Đo bằng `/route` thật |
| Deploy trước migration làm chết API | Cổng thứ tự ở mục 13 |
| Biome lint CSS va at-rule Tailwind v4 | Xử lý dứt điểm ở pha 0, không để dồn |
| Thiếu `GRANT` không lộ ra khi test | Bài kiểm bằng role `api` ở mục 14 |
| Khoá API chỉ hiện một lần | Cảnh báo rõ trên giao diện, nút sao chép, không cách nào xem lại |
| Bundle phình vì gộp 7 màn hình | Lazy-load theo route; đo kích thước ở pha cuối |
| Thay hoàn toàn trang cũ | Giữ chuỗi tiêu đề cũ; chạy 3 e2e hiện có mỗi pha |

## 16. Files và quy ước

- Thêm vào `apps/admin`: Tailwind v4, shadcn/ui, `@tanstack/react-query`, `react-router`.
- `apps/api/src/audit.ts` — middleware ghi `admin_audit`.
- `apps/api/src/routes/admin.ts` — mở rộng; thêm `routes/admin-tenants.ts`,
  `routes/admin-metrics.ts`, `routes/admin-audit.ts`.
- `apps/api/src/access.ts` — giữ nguyên; **không** thay `requireBillingAccess()`.
- `db/migrations/0017_admin_audit.sql` và `.down.sql`.
- `vitest.config.ts` — thêm include cho `apps/admin`.
- Toàn bộ chuỗi hiển thị bằng tiếng Việt có dấu đầy đủ.

## 17. Thứ tự triển khai theo pha

PHONG chọn một spec cho cả năm mảng. Rủi ro "sáu màn hình dở dang" được kiểm soát bằng cách mỗi
pha kết thúc là một thứ dùng được, và pha 1 đã đủ thay thế trang hiện tại.

| Pha | Nội dung | Kết quả dùng được |
|---|---|---|
| 0 | Tailwind + shadcn, AppShell, drawer, sáng/tối, router, fetcher, `DataView`, năm trạng thái; migration `0017`; `GET /me` + `can()`; **middleware ghi audit bật ngay** | Khung chạy được, chưa thay trang cũ |
| 1 | Duyệt đóng góp đầy đủ + API phân trang/lọc/bulk | **Thay hẳn trang admin hiện tại** |
| 2 | Tenant & khoá API + ba endpoint mới | Bỏ được `pnpm key:issue` cho việc thường ngày |
| 3 | Gói cước & hạn mức | Bỏ được curl cho billing |
| 4 | Nhật ký kiểm toán (chỉ phần đọc, phần ghi đã chạy từ pha 0) | |
| 5 | Sức khoẻ hệ thống | Cần secret Cloudflare |
| 6 | Tổng quan | Làm cuối vì nó tổng hợp số liệu từ năm mảng kia; làm sớm sẽ phải sửa lại năm lần |

Ghi nhật ký kiểm toán phải bật ở pha 0 chứ không phải pha 4: để tới pha 4 thì mọi việc làm ở pha
1–3 không có vết nào.

## 18. Tiêu chí nghiệm thu

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` xanh; `pnpm test:admin-e2e` xanh gồm cả 3 test cũ.
2. Trang dùng được thật trên điện thoại: mở bằng máy thật, duyệt được một đóng góp, huỷ được
   trong 5 giây, ngăn kéo đóng mở bằng cả chạm lẫn bàn phím.
3. Email ngoài `BILLING_ADMIN_EMAILS` gọi `/v1/admin/billing/...` vẫn nhận 403 sau khi thay trang —
   lớp bảo vệ sẵn có không được yếu đi vì đợt làm này.
4. Mọi thao tác ghi để lại đúng một dòng trong `admin_audit` với đúng `actor`.
5. `/healthz/db` báo `schema_migration` đã sang `0017` **trước** khi deploy Worker.
6. Access application phủ cả `/admin*` lẫn `/v1/admin*` — kiểm bằng cách mở trang ở cửa sổ ẩn danh
   và thấy bị chuyển sang màn đăng nhập, rồi gọi `/v1/admin/edits` không kèm cookie và nhận 401.
7. Đăng xuất qua `/cdn-cgi/access/logout` đưa về màn đăng nhập; mở lại trang phải đăng nhập lại.
8. Token hết hạn giữa phiên đưa về màn đăng nhập, không hiện lỗi thô và không mất việc đang chờ gửi.
9. Bản tối và bản sáng đều đạt tương phản AA ở các màn hình chính.
10. Mỗi route mới có ít nhất một bài kiểm chạy bằng role `api` thật.

## 19. Ngoài phạm vi

Chạy pipeline dữ liệu từ web; sửa POI trực tiếp; địa giới hành chính và alias; sao lưu/phục hồi
Durable Object billing; đăng nhập ngoài Cloudflare Access; thông báo đẩy; đa ngôn ngữ.

**Phân quyền theo vai trò và màn hình quản lý người dùng** — hoãn tới khi có người thứ hai dùng
trang này. Ba điểm móc ở mục 9 giữ cho việc thêm sau không phải sửa lại giao diện.
