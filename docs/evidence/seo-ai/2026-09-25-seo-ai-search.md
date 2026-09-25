# Nghiệm thu SEO và AI search — 25/09/2026

Spec `docs/superpowers/specs/2026-09-25-seo-ai-search-design.md` mục 11, plan
`docs/superpowers/plans/2026-09-25-seo-ai-search.md`. Làm thẳng trên `main` theo lựa chọn của
PHONG ngày 25/09/2026, mỗi task một commit, từ `3e6a829` tới commit tài liệu cuối.

## Trước deploy — đo trên máy (MacBook), 25/09/2026

| Hạng mục | Kết quả |
|---|---|
| Cổng kiểm | `pnpm lint` sạch (1 info có từ trước ở `doi-dau.test.ts`); notices khớp; `pnpm typecheck` 18/18 và `turbo run typecheck --force` 18/18 với `Cached: 0 cached`; `pnpm test` 2.215 test gốc xanh (5 bỏ qua) + 867 test API xanh |
| vitest mới | catalog `bot`, site `llms`/`lastmod`/`seo`/`robots`/`lien-ket-docs`, docs `docs-config`/`ngay-git`/`copy-legal`/`seo-docs`/`lastmod`, `scripts/indexnow` (15 bài, gồm thứ tự bước trong workflow), `package-release` (metadata npm) — nằm trong số xanh ở trên |
| e2e website (`pnpm test:site-e2e`) | 44/44 xanh, gồm 4 bài mới (robots, llms, lastmod, logo); chạy trên build + server mới (đã dừng một preview mồ côi giữ cổng 4323 từ phiên trước) |
| e2e SEO docs (`pnpm --filter @mapslibvn/docs e2e:seo`) | 3/3 xanh: 20 URL trong sitemap đều có title 20–60 ký tự không trùng, description 120–160, canonical, `og:image` 200, JSON-LD parse được |
| Schema ép description | Tạm đổi description `bat-dau.md` thành "Ngắn." → `astro build` đỏ: `description: Too small: expected string to have >=120 characters` |
| `<title>` docs | 22 title, không trùng, không còn dạng "X \| MapsLibVN"; trang chủ: "Tài liệu API bản đồ Việt Nam — MapsLibVN" |
| sitemap docs | 20 URL, URL nào cũng có `lastmod` lấy từ git. Phần lớn trang mang `2026-09-25T10:46:48Z` = giờ commit `1ed3138` (sửa frontmatter cả 18 trang), KHÁC giờ build 10:49Z; `dieu-khoan` 21/09 (commit cuối của `docs/legal/dieu-khoan-tenant.md`), `/playground` theo commit cuối của `public/playground*` |
| sitemap site | 2 bài viết có `lastmod` 2026-09-18, 7 trang marketing không có (quyết định 5) |
| `llms.txt` site | giá 4 gói đúng catalog (650.000đ / 2.600.000đ / 10.400.000đ mỗi tháng), 6 trang chính, 2 bài, 4 link tài liệu |
| `llms*.txt` docs | `llms.txt` 2,2 KB, `llms-full.txt` 380 KB (150 tiêu đề `##`), `llms-small.txt` 297 KB, 3 nhóm; không tệp nào chứa chuỗi dạng khoá `mlv_live_…` hay "tự host" |
| IndexNow `truoc` website so với production | 0 URL — đúng: thay đổi của site chỉ nằm trong `<head>`, chữ trong `<main>` không đổi |

### e2e docs cũ (`pnpm --filter @mapslibvn/docs e2e`) — đỏ có từ trước, không do đợt này

- Build với khoá trong `apps/docs/.env` (khoá demo production): 42 xanh, 6 đỏ ở
  `playground.spec.ts`. Nguyên nhân: bài "tuỳ chọn trên URL" chờ khoá seed
  `mlv_live_demo00000000000000000000`, nhận khoá production — API local từ chối khoá đó nên
  autocomplete không trả gợi ý.
- Build lại với `PUBLIC_MAPSLIBVN_DEMO_KEY=mlv_live_demo00000000000000000000`: 20/22 xanh; còn 2 đỏ
  ("đã tìm địa điểm rồi mới bấm Dẫn đường", "Giả lập: banner rẽ…").
- **Baseline** trên commit `317f640` (trước mọi thay đổi, worktree riêng, cùng DB dev, cùng khoá
  seed): đúng 2 bài đó đỏ theo đúng cách → lỗi có từ trước, do môi trường/dữ liệu local. Đợt này chỉ
  đổi `<head>` của `playground.html`.
- Lượt chạy đủ bộ lúc 18:10 (sau đó): 46 xanh, 5 đỏ — thêm 3 bài autocomplete. Gọi thẳng API local
  (`wrangler dev`, nối DB **dev** `mapslibvn-dev-postgres-1` qua `localhost:5432`, không phải
  production) bằng khoá seed: `401 invalid_key`. DB dev hiện chỉ còn 1 tenant, 1 khoá, bảng
  `api_key` không còn cột `key` — khoá seed mà `playground.spec.ts` cần không tồn tại; lượt 17:52 xanh
  nhiều khả năng nhờ cache KV của `wrangler dev`. Muốn bộ này xanh lại ở máy phải seed lại DB dev —
  việc môi trường, ngoài phạm vi đợt này, KHÔNG tự làm.

## Sau deploy — máy tự đo trên production

| # | Tiêu chí | Lệnh | Kết quả |
|---|---|---|---|
| 1 | robots hai host đúng nguyên văn | `curl -s https://mapslibvn.pages.dev/robots.txt; curl -s https://mapslibvn-docs.pages.dev/robots.txt` | |
| 2 | llms 200 + `text/plain; charset=utf-8` | `for u in https://mapslibvn.pages.dev/llms.txt https://mapslibvn-docs.pages.dev/llms.txt https://mapslibvn-docs.pages.dev/llms-full.txt https://mapslibvn-docs.pages.dev/llms-small.txt; do curl -s -o /dev/null -w "%{http_code} %{content_type} $u\n" $u; done` | |
| 3 | không còn title "X \| MapsLibVN" | `curl -s https://mapslibvn-docs.pages.dev/ \| grep -o '<title>[^<]*'` | |
| 4 | lastmod theo git, không theo giờ build | `curl -s https://mapslibvn-docs.pages.dev/sitemap-0.xml \| grep -o '<lastmod>[^<]*' \| sort \| uniq -c`; `curl -s https://mapslibvn.pages.dev/sitemap-0.xml \| grep -o '<lastmod>[^<]*'` | |
| 5 | IndexNow 200/202, chỉ URL đổi | `gh run list --workflow "Deploy Docs" --limit 1` rồi `gh run view <id> --log \| grep IndexNow` (và Deploy Site) | |
| 5b | tệp khoá sống | `curl -s https://mapslibvn.pages.dev/c1da44e6cf8707383215e23e4fc36e9e.txt; curl -s https://mapslibvn-docs.pages.dev/c1da44e6cf8707383215e23e4fc36e9e.txt` | |
| 7 | Lighthouse SEO = 100 (trang chủ docs, `/api/`, `/tim-kiem/`) | Task 18 Step 7 của plan | |

## Việc của PHONG

| # | Việc | Ngày làm | Kết quả |
|---|---|---|---|
| 6 | Rich Results Test: `/`, `/bang-gia/`, một bài viết, `/api/` của docs | | |
| 8a | Search Console: xác thực `https://mapslibvn.pages.dev/`, gửi sitemap, Request indexing trang chủ | | |
| 8b | Search Console: xác thực `https://mapslibvn-docs.pages.dev/`, gửi sitemap | | |
| 8c | Bing Webmaster: Import from Google Search Console | | |
| 8d | Kiểm lại: trang chủ đã được lập chỉ mục (hạn 14 ngày sau 8a) | | |
