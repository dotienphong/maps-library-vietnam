# SEO và AI search cho website và tài liệu — 25/09/2026

Trạng thái: **PHONG đã duyệt phạm vi, hai chính sách (tên miền, bot AI), cách làm và bốn phần thiết
kế trong phiên brainstorm 25/09/2026.** Bảng title/description ở mục 6.1 là bản đề xuất đầy đủ để
PHONG duyệt khi đọc spec này. Mọi con số ở đây là quyết định, không phải gợi ý.

Kế thừa spec `2026-09-18-thuong-mai-tu-phuc-vu-design.md` mục 11.3 (SEO kỹ thuật) và spec
`2026-09-22-thiet-ke-lai-giao-dien-design.md`. Mọi ràng buộc SEO đã có của site **giữ nguyên**: một
`h1` mỗi trang, `title` ≤ 60, `description` 120–160, canonical tuyệt đối, `trailingSlash: 'always'`,
JSON-LD, sitemap, không React. Chỗ nào spec này nói khác thì spec này thắng.

## 1. Vấn đề

Đo trên production ngày 25/09/2026. Nền SEO của site đã chắc (tiêu đề, mô tả, canonical, OG, năm
loại JSON-LD, sitemap, một `h1` — đều có test khoá). Bot AI không bị chặn: GPTBot, OAI-SearchBot,
ClaudeBot, PerplexityBot, Googlebot, bingbot, CCBot đều nhận `200` ở cả hai tên miền. Console có
`noindex, nofollow`. Chỗ hổng nằm ở những việc sau:

| Hạng mục | Website `mapslibvn.pages.dev` | Tài liệu `mapslibvn-docs.pages.dev` |
|---|---|---|
| Được biết tới | Search Console và Bing **chưa xác thực** — việc tay treo từ 18/09 (`docs/evidence/commerce/2026-09-18-pha-1-website.md` mục 5.3). Hostname đổi 24/09, `mapslibvn-site.pages.dev` không còn DNS | Như bên trái |
| IndexNow | Không có | Không có |
| `robots.txt` | Có, `Allow: /` + `Sitemap:`; chưa nói gì về bot AI | **Chỉ là đoạn chú thích mặc định của Cloudflare**: không có `User-agent`, không có `Sitemap:` |
| Sitemap | 9 URL, không `lastmod` | 21 URL, không `lastmod`; có `react-demo` (trang mỏng) và `thong-bao-ben-thu-ba` (chép giấy phép) |
| `<title>` | Đạt | Trang chủ là **"MapsLibVN \| MapsLibVN"**; phần lớn còn lại quá chung: "React \| MapsLibVN", "Cài đặt \| MapsLibVN", "REST API \| MapsLibVN" |
| `description` | Đạt | **11/20 trang dưới 120 ký tự** (ngắn nhất 59, trang chủ); một trang ghi cứng số phiên bản "0.5" |
| Ảnh chia sẻ | Có `og:image` | **Không có `og:image`** — chia sẻ Zalo/Facebook ra thẻ trống |
| JSON-LD | `Organization`, `SoftwareApplication`, `FAQPage`, `Article`, `BreadcrumbList`; `Organization.logo` đang trỏ ảnh OG 1200×630; không `@id`, không `WebSite`, không `sameAs` | **Không có** |
| Liên kết qua lại | Site link sang docs nhiều chỗ | Docs link về site đúng **4 lần**, toàn trong nội dung; header/footer không có link nào |
| Trùng từ khoá | `/tinh-nang/` | `/tinh-nang/` — cùng tên, cùng ý định tìm kiếm với trang của site |
| Cho AI đọc | Không có `llms.txt` | Không có `llms.txt` / `llms-full.txt` |

Gói npm: bốn gói `@mapslibvn/*` không có `homepage`, không có `keywords`. Tìm "vietnam map" hay
"bản đồ việt nam" trên npm không ra gói nào của MapsLibVN.

## 2. Quyết định đã chốt

| # | Câu hỏi | PHONG chốt |
|---|---|---|
| 1 | Tên miền | **Giữ `pages.dev`, làm ngay.** Mọi URL đi qua một hằng; đổi tên miền về sau là spec riêng. |
| 2 | Bot AI | **Cho tất cả, kể cả huấn luyện**: `search=yes, ai-input=yes, ai-train=yes`. Sản phẩm cho dev: model biết SDK thì viết đúng code `@mapslibvn`. Docs chỉ dạy dùng API trả phí; hướng dẫn tự host đã gỡ 23/09. |
| 3 | Cách làm | **Sinh lúc build, trong repo.** Không Pages Functions, không Worker. |
| 4 | Phạm vi | SEO kỹ thuật + lớp AI cho cả hai site + metadata npm. Nội dung mới và tên miền tách spec riêng. |
| 5 | `lastmod` trang marketing | **Không đặt.** Chúng phụ thuộc nhiều nguồn (catalog, component), không có ngày nào đúng thật. |
| 6 | Title docs | Title mới là `h1` luôn (quy ước Starlight); nhãn sidebar giữ nguyên. |
| 7 | npm | Thêm `homepage`, `keywords`, mô tả; **không** thêm `repository`/`bugs` (không dẫn khách về repo — quy định không công bố tự host). |

## 3. Phạm vi

**Trong phạm vi**

- `apps/site`: robots, `llms.txt`, JSON-LD, `lastmod`, thẻ meta nhỏ, ảnh logo, chỗ cắm mã xác thực.
- `apps/docs`: title/description mọi trang, route middleware (OG, JSON-LD, `noindex`), `lastUpdated`,
  sitemap tự khai, robots, footer link về site, playground, react-demo, plugin `starlight-llms-txt`,
  chỗ cắm mã xác thực.
- `packages/catalog`: chính sách bot dùng chung, hằng đường dẫn site và API.
- `scripts/indexnow.mjs`, `scripts/site-images.mjs` (thêm ảnh OG docs và logo).
- `.github/workflows/deploy-site.yml`, `deploy-docs.yml`; `pnpm deploy:site`, `pnpm deploy:docs`.
- `packages/{core,web,react,react-native}/package.json` và README.

**Ngoài phạm vi**

- Nội dung mới: bài viết, trang tiếng Anh. Spec riêng, PHONG duyệt từng bài.
- Chữ trên các trang marketing đã duyệt 22/09. Spec này chỉ đụng metadata của site.
- Đổi tên miền; console, admin (đã `noindex`); domain API `api.ai-solutions.io.vn`.
- Mọi việc ngoài code để MapsLibVN được nhắc tên ở nơi khác — chỉ ghi danh sách gợi ý ở mục 13.

## 4. Nền dùng chung — `packages/catalog`

`src/bot.ts` (mới):

```ts
export const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=yes';
export function robotsTxt(siteUrl: string): string; // siteUrl không có gạch cuối
```

`robotsTxt('https://mapslibvn.pages.dev')` trả đúng:

```
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /

Sitemap: https://mapslibvn.pages.dev/sitemap-index.xml
```

`src/lien-ket.ts` thêm `SITE_URL = 'https://mapslibvn.pages.dev'`,
`API_BASE = 'https://api.ai-solutions.io.vn'` và `DOCS_LLMS = `${DOCS_URL}/llms.txt``. `DOCS` thêm
`api` (`/api/`). `DOCS_LLMS` cố ý **không** nằm trong `DOCS`: bài kiểm `lien-ket-docs.test.ts` đòi
mọi URL trong `DOCS` có gạch cuối, còn đây là một tệp. Mỗi tệp `.mjs` thuần của từng app
(`apps/site/site.config.mjs`, `apps/docs/docs.config.mjs` mới) giữ bản sao hằng mình cần cho
`astro.config.mjs` — tệp cấu hình Astro không import TypeScript — và có bài kiểm khẳng định khớp
catalog, đúng cách `DOCS_URL` đang làm (`lien-ket-docs.test.ts`).

`apps/docs` thêm phụ thuộc `@mapslibvn/catalog` (workspace), và `deploy-docs.yml` thêm
`packages/catalog/**` vào `paths` — thiếu thì đổi chính sách bot không deploy lại docs.

## 5. Website `apps/site`

### 5.1. robots

`src/lib/robots.ts` gọi `robotsTxt(SITE_URL)`. Test cũ giữ nguyên, thêm dòng `Content-Signal`.

### 5.2. `/llms.txt`

`src/pages/llms.txt.ts` → `src/lib/llms.ts` (hàm thuần, có test). Theo llmstxt.org, sinh hoàn toàn
từ `TRANG`, bộ bài viết đã duyệt, `PLAN_CATALOG`, `DOCS` và `site.config.mjs`:

```
# MapsLibVN

> {TRANG.trangChu.description — nguyên văn, không viết câu quảng cáo mới}

Cần biết:

- API: {API_BASE}; mọi endpoint /v1/* cần khoá API gửi qua header X-Api-Key.
- SDK trên npm: @mapslibvn/web, @mapslibvn/react, @mapslibvn/react-native, @mapslibvn/core.
- Giá mỗi tháng, tính theo lượt gọi API chứ không theo số người dùng:
  {mỗi gói một dòng: tên, giá dinhDangVnd, lượt Places, lượt tính tuyến — từ PLAN_CATALOG}
- Đăng ký và lấy khoá: {CONSOLE_URL}
- Liên hệ: {SUPPORT_EMAIL}, {SUPPORT_PHONE_HIEN_THI}

## Trang chính

- [{TRANG.x.h1}]({canonical}): {TRANG.x.description}     ← mọi trang trừ trangChu và 404

## Bài viết

- [{title}]({canonical}): {description}                  ← chỉ bài daDuyet, mới nhất trước

## Tài liệu

- [Mục lục tài liệu cho LLM]({DOCS_LLMS}): toàn bộ tài liệu kỹ thuật dạng văn bản
- [Bắt đầu 5 phút]({DOCS.batDau}) · [Khoá API]({DOCS.khoaApi}) · [REST API]({DOCS.api})
```

Test khẳng định: mọi `TRANG` trừ `trangChu`/`khong404` có mặt; từng giá khớp `PLAN_CATALOG`; không
có chuỗi khớp `mlv_live_[0-9A-Za-z]{24}`, "tự host", "self-host", `github.com`.

### 5.3. JSON-LD — một thực thể cho hai tên miền

Sửa `src/lib/seo.ts`. Mỗi khối vẫn là một `<script>` riêng có `@context` (giữ cách test hiện tại):

- `Organization`: thêm `"@id": "https://mapslibvn.pages.dev/#organization"`; `logo` thành
  `{ "@type": "ImageObject", "url": ".../logo-512.png", "width": 512, "height": 512 }`;
  `sameAs: ["https://www.npmjs.com/org/mapslibvn"]` (danh sách lấy từ một hằng trong
  `site.config.mjs`, thêm trang Facebook/LinkedIn khi PHONG lập).
- `WebSite` (mới, chỉ trang chủ): `@id` `.../#website`, `name`, `url`, `inLanguage: "vi"`,
  `publisher: { "@id": ".../#organization" }`. Không `SearchAction` — site không có ô tìm kiếm.
- `SoftwareApplication`: thêm `@id` `.../#software`, `publisher` tham chiếu `@id`, `description`
  (= description trang chủ), `softwareHelp: { "@type": "CreativeWork", "url": DOCS_URL + "/" }`.
  `offers` giữ nguyên.
- `Article`: `author` và `publisher` thành `{ "@id": ".../#organization" }`; thêm `image` (ảnh OG
  của bài, thiếu thì ảnh mặc định) và `inLanguage: "vi"`.
- `FAQPage`, `BreadcrumbList`: giữ nguyên.

Docs (mục 6.3) dùng đúng `@id` tổ chức này, nên máy hiểu hai tên miền cùng một chủ.

### 5.4. `lastmod`

`astro.config.mjs`: `sitemap({ serialize })` đặt `lastmod` cho URL `/bai-viet/<slug>/` bằng
`updatedAt ?? publishedAt` đọc từ frontmatter `src/content/bai-viet/<slug>.md`. Hàm đọc nằm trong
`src/lib/lastmod.mjs` (JS thuần để `astro.config.mjs` import được, có test). Mọi URL khác **không**
có `lastmod` (quyết định 5).

### 5.5. Thẻ meta trong `SeoHead.astro`

- `<meta name="robots" content="max-image-preview:large" />`.
- `og:image:width` 1200, `og:image:height` 630, `og:image:alt` = title trang.
- `google-site-verification` khi hằng `GOOGLE_SITE_VERIFICATION` trong `site.config.mjs` khác rỗng.
  Mặc định rỗng — không in thẻ.

### 5.6. Logo

`scripts/site-images.mjs` sinh thêm `apps/site/public/logo-512.png` (512×512) từ
`apps/site/public/favicon.svg`. Ảnh được commit, như ảnh OG.

## 6. Tài liệu `apps/docs`

### 6.1. Title và description

`titleDelimiter: '—'` để khớp site. `<title>` = `{title} — MapsLibVN`. Trang chủ đặt `title` mới và
`hero.title: MapsLibVN` để phần hero vẫn hiện tên thương hiệu.

| Trang | `title` mới (cũng là `h1`) | `<title>` | `description` |
|---|---|---|---|
| `index` | Tài liệu API bản đồ Việt Nam | 40 | Tài liệu MapsLibVN: nhúng bản đồ Việt Nam vào web, React và React Native, tìm địa điểm, geocode địa chỉ, dẫn đường, kèm playground chạy thử bằng khoá demo. |
| `tinh-nang` | Tính năng kỹ thuật và 164 mã POI | 44 | Tham chiếu kỹ thuật của MapsLibVN: tiles PMTiles, style sáng và tối, 164 mã POI trong 13 nhóm, Places API, geocode có precision, cùng những gì chưa có. |
| `cai-dat` | Cài đặt SDK bản đồ cho web và mobile | 48 | giữ |
| `khoa-api` | Khoá API: web, mobile và server | 43 | Lấy khoá API MapsLibVN trong năm phút, phân biệt ba loại khoá web, mobile và server, cách kiểm origin, scope, quota, khoá demo và cách truyền khoá qua header. |
| `bat-dau` | Nhúng bản đồ Việt Nam trong 5 phút | 46 | Đường nhanh nhất để chạy bản đồ MapsLibVN: một thẻ script không cần build, hoặc cài từ npm cho web, React và React Native, kèm marker và sự kiện bấm POI. |
| `react-native` | Bản đồ Việt Nam cho React Native | 44 | Nhúng bản đồ MapsLibVN vào app iOS và Android bằng @mapslibvn/react-native: yêu cầu New Architecture, cài bằng Expo hoặc bare, MapsLibVNMap, Marker, useMap. |
| `ban-do-web` | Bản đồ web: tuỳ chọn, marker, sự kiện | 49 | giữ |
| `tim-kiem` | Tìm kiếm và autocomplete địa chỉ Việt Nam | 53 | giữ |
| `dan-duong` | Dẫn đường từng bước trên web | 40 | Dẫn đường từng bước trên web với MapsLibVN: vẽ tuyến từ /v1/directions, bám GPS, đọc câu rẽ bằng giọng tiếng Việt và tự tính lại tuyến khi người dùng đi lệch. |
| `dan-duong-react-native` | Dẫn đường trên React Native có giọng Việt | 53 | Dẫn đường trên iOS và Android bằng @mapslibvn/react-native: phiên chạy độc lập với màn hình bản đồ, định vị cả khi khoá máy, đọc chỉ dẫn tiếng Việt bằng TTS. |
| `doi-xe` | Tối ưu tuyến giao hàng và đội xe | 44 | giữ |
| `react` | SDK React cho bản đồ Việt Nam | 41 | giữ |
| `do-chinh-xac` | Độ chính xác geocode địa chỉ Việt Nam | 49 | Ý nghĩa của precision và confidence trong kết quả geocode và reverse của MapsLibVN, thang phân giải từ mái nhà tới phường, địa chỉ theo đơn vị hành chính cũ. |
| `dong-gop` | Đóng góp và sửa địa điểm (POI) | 42 | Cho người dùng cuối sửa giờ mở cửa, vị trí, liên hệ hoặc thêm địa điểm mới qua POST /v1/edits và suggestEdit của SDK, kèm scope cần có và luật tự duyệt. |
| `api` | REST API bản đồ, geocode và dẫn đường | 49 | giữ |
| `sdk` | Tham chiếu SDK JavaScript @mapslibvn | 48 | giữ |
| `nhung-thu` | Nhúng thử bản đồ vào trang HTML của bạn | 51 | Chạy một trang HTML có bản đồ MapsLibVN trên máy trong hai phút bằng khoá demo và một máy chủ tĩnh, vì sao file:// không chạy, rồi chuyển sang origin thật. |
| `giay-phep` | Giấy phép dữ liệu và chuỗi ghi nguồn | 48 | SDK MapsLibVN theo giấy phép MIT, dữ liệu mở từ OpenStreetMap (ODbL) và Foursquare OS Places (Apache-2.0), chuỗi ghi nguồn bắt buộc và cách áp dụng ODbL. |
| `dieu-khoan` ¹ | Điều khoản sử dụng API cho tenant | 45 | Điều khoản sử dụng MapsLibVN cho ứng dụng nhúng: khoá API, chuỗi ghi nguồn bắt buộc, hành vi bị cấm như cào dữ liệu, dữ liệu cá nhân theo Nghị định 13/2023. |
| `thong-bao-ben-thu-ba` ¹ | Thông báo bên thứ ba (giữ) | 32 | Giấy phép của thư viện, phông chữ, icon, style nền và dữ liệu mà SDK và API MapsLibVN đóng gói hoặc phục vụ tới client, kèm ghi chú về nhãn hiệu MapLibre. |

¹ Trang sinh: sửa trong `apps/docs/scripts/copy-legal.mjs`, không sửa tệp đích (tệp đích nằm trong
`.gitignore` và bị ghi đè mỗi lần build).

Slug không đổi, nên không URL nào đổi và không cần redirect. Nhãn sidebar đặt riêng trong
`astro.config.mjs` nên giữ nguyên chữ ngắn.

**Ép bằng build:** `content.config.ts` dùng `docsSchema({ extend: z.object({ description:
z.string().min(120).max(160) }) })` — description sai độ dài là `astro build` đỏ, giống bài viết của
site. Độ dài và tính duy nhất của `<title>` (do Starlight ghép) kiểm ở e2e (mục 10).

### 6.2. Route middleware — `src/route-data.ts`

Khai `routeMiddleware: './src/route-data.ts'`. Logic nằm trong hàm thuần ở `src/lib/seo-docs.ts`
(test được bằng vitest), middleware chỉ gọi hàm và đẩy kết quả vào `starlightRoute.head`:

- `og:image` = `https://mapslibvn-docs.pages.dev/og/tai-lieu-v1.png` (1200×630, mục 6.9),
  `og:image:width`, `og:image:height`, `og:image:alt`, `twitter:image`.
- Một khối JSON-LD `@graph` mỗi trang:
  - `Organization` rút gọn: `@id` = `https://mapslibvn.pages.dev/#organization`, `name`, `url`,
    `logo`. Lặp lại ở docs vì Google không sang tên miền khác để tra `@id`.
  - `WebSite` của docs: `@id` `https://mapslibvn-docs.pages.dev/#website`, `name: "Tài liệu
    MapsLibVN"`, `inLanguage: "vi"`, `publisher` tham chiếu tổ chức.
  - Trang khác trang chủ thêm `TechArticle`: `headline` = title, `description`, `url`,
    `inLanguage`, `dateModified` = `starlightRoute.lastUpdated` (cùng ngày với dòng "Cập nhật lần
    cuối" in trên trang), `datePublished` = `taoLuc` của `entry.filePath` khi có (hai trang sinh
    không có thì bỏ trường), `image` = ảnh OG, `isPartOf` → WebSite docs, `author` và `publisher` →
    tổ chức.
  - Trang chủ docs chỉ có `Organization` + `WebSite`.
  - Trang khác trang chủ thêm `BreadcrumbList` hai bậc: Tài liệu → trang.
- `<meta name="robots" content="noindex" />` cho `thong-bao-ben-thu-ba` (chủ yếu là văn bản giấy
  phép MIT/Apache có ở khắp nơi). Danh sách `noindex` là một hằng trong `seo-docs.ts`.

### 6.3. Ngày cập nhật

- `lastUpdated: true`: cuối mỗi trang hiện "Cập nhật lần cuối: …" (chuỗi tiếng Việt Starlight có
  sẵn). Starlight đọc `git log`.
- Hai trang sinh không nằm trong git: `copy-legal.mjs` ghi `lastUpdated: <ISO>` vào frontmatter,
  lấy ngày commit cuối của tệp gốc (`docs/legal/dieu-khoan-tenant.md`, `THIRD_PARTY_NOTICES.md`).
- Một hàm dùng chung `apps/docs/scripts/ngay-git.mjs` trả `{ taoLuc, suaLuc }` cho một tệp, dùng
  **ngày committer** (`%cI`) — cùng loại ngày Starlight dùng cho `lastUpdated`. Sitemap (6.4),
  `datePublished` (6.2) và `copy-legal.mjs` cùng dùng hàm này, nên sitemap, JSON-LD và dòng "Cập
  nhật lần cuối" luôn cùng một ngày.
- `deploy-docs.yml`: `actions/checkout` đặt `fetch-depth: 0`. Clone nông thì mọi trang mang cùng
  một ngày — sai và không ai thấy.

### 6.4. Sitemap và robots

- Tự khai `@astrojs/sitemap` trong `astro.config.mjs` (Starlight tự bỏ sitemap của nó khi thấy có sẵn):
  - `lastmod` = `suaLuc` của tệp nguồn ứng với URL: `/` → `index.mdx`, `/<slug>/` →
    `<slug>.md|mdx`, hai trang sinh → tệp gốc, `/playground` → tệp mới nhất trong
    `public/playground*`.
  - `filter` bỏ `thong-bao-ben-thu-ba` và `react-demo`.
  - `customPages` thêm `https://mapslibvn-docs.pages.dev/playground`.
- `src/pages/robots.txt.ts` trả `robotsTxt(DOCS_URL)`. Tệp này thay cho đoạn chú thích mặc định
  của Cloudflare.

### 6.5. Footer nối về site

Override `Footer` của Starlight (`components.Footer`): render Footer gốc rồi thêm một hàng link
"Website MapsLibVN · Bảng giá · So với Google Maps · Liên hệ", trỏ các trang của site bằng hằng từ
catalog. Có mặt ở mọi trang docs.

### 6.6. Playground và React demo

- `public/playground.html` (ngoài Starlight): `<title>Playground bản đồ Việt Nam — MapsLibVN</title>`,
  description "Chạy thử bản đồ Việt Nam, tìm kiếm địa điểm, geocode và dẫn đường của MapsLibVN
  ngay trên trình duyệt bằng khoá demo, không cần cài đặt hay đăng ký tài khoản." (158 ký tự),
  canonical `https://mapslibvn-docs.pages.dev/playground`, thẻ `og:*` với ảnh OG docs.
- `src/pages/react-demo.astro`: thêm `<meta name="robots" content="noindex" />` — trang mỏng, nội
  dung thật nằm ở trang React; đã bỏ khỏi sitemap (6.4).

### 6.7. `starlight-llms-txt`

Thêm plugin (0.12, đòi `astro ^7`, `@astrojs/starlight >=0.41` — khớp repo). Sinh `/llms.txt`,
`/llms-full.txt`, `/llms-small.txt` và `/_llms-txt/<nhóm>.txt`:

- `projectName: 'MapsLibVN'`.
- `description`: "Tài liệu kỹ thuật của MapsLibVN — API bản đồ, tìm kiếm địa điểm, geocode và dẫn
  đường cho Việt Nam, kèm SDK cho web, React và React Native."
- `details` (không ghi số tiền — docs cố ý không chép cứng giá, xem `khoa-api.md`):
  - API base `https://api.ai-solutions.io.vn`, khoá gửi qua header `X-Api-Key`.
  - Ba loại khoá `web` / `mobile` / `server`; khoá demo chỉ chạy trên `localhost`.
  - Bốn gói npm và gói nào dùng cho môi trường nào.
  - Ghi nguồn là bắt buộc, SDK không có tuỳ chọn tắt.
  - Giá và hạn mức: `GET /v1/catalog` hoặc trang Bảng giá của site.
- `customSets`: "Bắt đầu" (`cai-dat`, `khoa-api`, `bat-dau`, `react-native`), "Hướng dẫn"
  (`ban-do-web`, `tim-kiem`, `dan-duong`, `dan-duong-react-native`, `doi-xe`, `react`,
  `do-chinh-xac`, `dong-gop`), "Tham chiếu" (`api`, `sdk`).
- `optionalLinks`: Website, Bảng giá, So với Google Maps, So với VIETMAP của site.
- `demote`: `dieu-khoan`, `giay-phep`, `thong-bao-ben-thu-ba`. `exclude` (chỉ tác động
  `llms-small.txt`): `thong-bao-ben-thu-ba`.

Plugin in các tiêu đề cố định bằng tiếng Anh ("Documentation Sets", "Notes"). Chấp nhận: người
đọc tệp này là model, không phải khách.

### 6.8. Mã xác thực

Hằng `GOOGLE_SITE_VERIFICATION` trong `apps/docs/docs.config.mjs`; khác rỗng thì `astro.config.mjs`
thêm thẻ `google-site-verification` vào `head`. Mặc định rỗng.

### 6.9. Ảnh OG docs

`scripts/site-images.mjs --og` sinh thêm `apps/docs/public/og/tai-lieu-v1.png` (1200×630) cùng
khuôn với bốn ảnh OG của site, chữ "Tài liệu MapsLibVN". Hậu tố `-v1` theo đúng quy ước đổi tên
khi đổi ảnh (mạng xã hội cache ảnh OG theo URL).

## 7. IndexNow

Bing, Yandex, Naver, Seznam dùng chung kênh này; ChatGPT search và Copilot thấy trang qua Bing.
Google không nhận IndexNow — với Google là sitemap và Search Console (mục 8).

- **Khoá:** một chuỗi 32 ký tự hex, là **tên và nội dung** của tệp
  `apps/site/public/<khoá>.txt` và `apps/docs/public/<khoá>.txt` (cùng một khoá cho hai host).
  Tệp là nguồn sự thật duy nhất: script tìm tệp có tên khớp `^[0-9a-f]{32}\.txt$` và nội dung
  trùng tên. Khoá công khai theo thiết kế của IndexNow — nó chỉ chứng minh quyền với host; ai biết
  khoá cũng chỉ làm được một việc là báo công cụ tìm kiếm đọc lại trang của chính mình.
- **`scripts/indexnow.mjs truoc --dist <thư mục> --site <URL> --out <tệp>`** — chạy sau build,
  trước deploy:
  1. Đọc sitemap trong `dist` ra danh sách URL mới; tải sitemap đang chạy ra danh sách URL cũ.
  2. Với mỗi URL mới: tải bản đang chạy, lấy chữ trong `<main>` (không có `<main>` thì `<body>`),
     bỏ thẻ, gộp khoảng trắng; so với cùng phần đó của tệp trong `dist`. Khác, hoặc bản đang chạy
     không phải `200`, hoặc tải lỗi → đưa vào danh sách. Tối đa 4 request song song, mỗi request
     chờ tối đa 10 giây.
  3. URL có trong sitemap cũ mà không còn trong sitemap mới → đưa vào danh sách (để công cụ tìm
     kiếm đọc lại và thấy 404/301).
  4. Ghi danh sách ra `--out`.
- **`scripts/indexnow.mjs gui --list <tệp> --site <URL>`** — chạy sau deploy: danh sách rỗng thì
  in "không có URL đổi" và thoát; không thì POST `https://api.indexnow.org/indexnow` với
  `{ host, key, keyLocation, urlList }`. In mã phản hồi. `200`/`202` là đạt. Mọi lỗi (mạng, `4xx`,
  `5xx`) chỉ in `::warning::` và **thoát 0** — IndexNow không bao giờ làm đỏ deploy.
- **Gắn vào:** `deploy-site.yml` và `deploy-docs.yml` (bước `truoc` giữa build và
  `wrangler pages deploy`, bước `gui` sau deploy); `pnpm deploy:site` và `pnpm deploy:docs` cho lúc
  deploy tay.

## 8. Search Console và Bing — việc tay của PHONG

`pages.dev` là tên miền của Cloudflare nên không xác thực bằng DNS được; dùng property **URL
prefix** và phương thức **thẻ HTML**. Làm cho từng site:

1. Search Console → Add property → URL prefix → `https://mapslibvn.pages.dev/` → HTML tag → chép
   giá trị `content`.
2. Dán vào `GOOGLE_SITE_VERIFICATION` (site: `apps/site/site.config.mjs`; docs:
   `apps/docs/docs.config.mjs`), commit, chờ deploy xong → bấm Verify. Mã này công khai trong HTML,
   commit được.
3. Sitemaps → gửi `sitemap-index.xml`. URL Inspection → trang chủ → Request indexing.
4. Lặp lại với `https://mapslibvn-docs.pages.dev/`.
5. Bing Webmaster Tools → **Import from Google Search Console** → chọn hai site. Bing nhận luôn quyền
   sở hữu và sitemap, không cần mã riêng. Nếu nhập thất bại thì mới thêm thẻ `msvalidate.01`.
6. Ghi ngày làm và ngày kiểm chỉ mục vào tệp chứng cứ (mục 11).

## 9. npm

Có hiệu lực ở lần `pnpm sdk:publish` tới — npm chỉ cập nhật metadata khi có bản mới. Nếu PHONG
muốn sớm hơn thì bump bản vá riêng cho việc này.

| Gói | `description` mới | `keywords` riêng |
|---|---|---|
| `core` | Client TypeScript cho API bản đồ Việt Nam MapsLibVN: autocomplete, tìm kiếm địa điểm, geocode, dẫn đường, ma trận khoảng cách và chuỗi ghi nguồn (Vietnam maps API client) | `api-client`, `typescript`, `reverse-geocoding`, `distance-matrix` |
| `web` | Bản đồ Việt Nam cho web: nhúng bản đồ MapLibre với tiles PMTiles, marker, ô tìm kiếm địa điểm và dẫn đường từng bước (Vietnam map SDK for web) | `maplibre`, `maplibre-gl`, `pmtiles`, `web-map` |
| `react` | Bản đồ Việt Nam cho React: `<MapsLibVNMap>`, `<Marker>`, `useMap`, `usePlaces` (Vietnam map for React) | `react`, `react-map`, `maplibre` |
| `react-native` | Bản đồ Việt Nam cho React Native (iOS, Android): `<MapsLibVNMap>`, `<Marker>`, `useMap`, `usePlaces`, dẫn đường giọng Việt, la bàn — bọc @maplibre/maplibre-react-native (Vietnam map for React Native) | `react-native`, `expo`, `ios`, `android`, `navigation`, `turn-by-turn`, `maplibre` |

`keywords` chung cho cả bốn: `mapslibvn`, `vietnam`, `viet-nam`, `vietnam-map`, `ban-do`,
`bản đồ`, `map`, `maps`, `geocoding`, `autocomplete`, `places`, `poi`, `directions`, `routing`,
`openstreetmap`. `homepage: https://mapslibvn.pages.dev/` cho cả bốn. README mỗi gói thêm một dòng
đầu: Website · Bảng giá · Tài liệu. **Không** thêm `repository`, `bugs` (quyết định 7).

## 10. Kiểm thử

**vitest** (chạy trong `pnpm test`):

- `packages/catalog/src/bot.test.ts`: nội dung `robotsTxt` đúng từng dòng; `Sitemap:` tuyệt đối.
- `apps/site/src/lib/llms.test.ts`: như 5.2.
- `apps/site/src/lib/seo.test.ts` (sửa): `@id` tổ chức; `WebSite`; logo là ảnh vuông; `Article`
  tham chiếu `@id`; mọi khối vẫn có `@context`.
- `apps/site/src/lib/lastmod.test.ts`: `updatedAt` thắng `publishedAt`; bài không có frontmatter
  ngày thì không có `lastmod`.
- `apps/docs/src/lib/seo-docs.test.ts`: `@graph` đủ nút; trang chủ không có `TechArticle` và
  `BreadcrumbList`; danh sách `noindex`; URL ảnh OG tuyệt đối.
- `apps/docs/scripts/ngay-git.test.mjs`: tệp có lịch sử trả hai ngày ISO, `taoLuc ≤ suaLuc`; tệp
  không có lịch sử trả `undefined`, không ném lỗi.
- `scripts/indexnow.test.mjs`: bóc chữ `<main>`, gộp khoảng trắng, bỏ qua đổi tên tệp asset; tính
  danh sách mới/đổi/bị bỏ; payload đúng dạng; không gọi mạng thật.
- Bài kiểm khoá IndexNow: mỗi site đúng một tệp khoá, nội dung trùng tên, hai site cùng khoá.
- Bài kiểm metadata npm: bốn `package.json` có `homepage` và đủ `keywords` chung, không có
  `repository`/`bugs`.
- Bài kiểm hằng: `site.config.mjs` và `docs.config.mjs` khớp `SITE_URL`, `DOCS_URL`, `API_BASE`
  của catalog.

**Playwright:**

- `apps/docs/e2e/seo.spec.ts` (mới): với **mọi** URL trong sitemap đã build — `200`; đúng một `h1`;
  `<title>` 20–60 ký tự và không trùng giữa các trang; description 120–160; canonical tuyệt đối;
  `og:image` trả `200`; mọi JSON-LD parse được và có `@context`. Thêm: `/robots.txt` có
  `Content-Signal` và `Sitemap:`; `/llms.txt`, `/llms-full.txt` trả `200`, không có chuỗi khớp
  `mlv_live_[0-9A-Za-z]{24}`; `thong-bao-ben-thu-ba` có `noindex`.
- `apps/site/e2e/seo.spec.ts` (sửa): `/llms.txt` trả `200`, có mọi trang chính; `/robots.txt` có
  `Content-Signal`.

**Cổng trước khi merge:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:site-e2e`, e2e docs
(`pnpm --filter @mapslibvn/docs e2e`) đều xanh.

## 11. Tiêu chí nghiệm thu

Ghi vào `docs/evidence/seo-ai/2026-09-25-seo-ai-search.md`, đo trên production:

1. `robots.txt` hai host đúng nguyên văn mục 4 (curl).
2. `/llms.txt` hai host, `/llms-full.txt` và `/llms-small.txt` docs: `200`,
   `content-type: text/plain; charset=utf-8`; tiếng Việt đọc đúng dấu.
3. Mọi trang docs đạt e2e mục 10 trên bản build đã deploy; không còn `<title>` nào dạng
   "X | MapsLibVN".
4. Sitemap docs có `lastmod` khác nhau giữa các trang (không phải một ngày build chung); sitemap
   site có `lastmod` cho bài viết.
5. Log CI của một lần deploy mỗi site: IndexNow trả `200` hoặc `202` và danh sách chỉ gồm URL đổi.
6. Rich Results Test (PHONG, hoặc Claude nếu có trình duyệt) không lỗi ở `/`, `/bang-gia/`, một
   bài viết, một trang docs.
7. Lighthouse SEO = 100 ở trang chủ docs và hai trang docs.
8. (PHONG) Search Console nhận sitemap của cả hai site; trang chủ được lập chỉ mục trong 14 ngày;
   Bing đã import xong.

## 12. Rủi ro

| Rủi ro | Cách xử lý |
|---|---|
| `docsSchema({ extend })` không siết được `description` của Starlight | Chuyển bài kiểm độ dài sang vitest đọc frontmatter; e2e vẫn bắt ở tầng HTML |
| Plugin `starlight-llms-txt` vỡ build vì component MDX lạ | Plugin có `rawContent`; bật cho trang lỗi, hoặc bỏ trang đó khỏi custom set |
| `fetch-depth: 0` chậm deploy docs | Repo ~72 MB pack — chấp nhận; nếu cần thì thêm `filter: blob:none` |
| `Content-Signal` chưa là chuẩn chính thức | RFC 9309: bot không hiểu dòng này sẽ bỏ qua — không hại gì |
| Title docs dài hơn làm `h1` dài | Nhãn sidebar vẫn ngắn; title ≤ 48 ký tự trước hậu tố |
| Khoá demo lọt vào `llms-full.txt` rồi agent curl trần làm khoá tenant 24 giờ | Khoá chỉ nằm trong bundle JS, không trong markdown; e2e chặn chuỗi dạng khoá |
| Google không sang docs để tra `@id` tổ chức | Docs lặp lại nút `Organization` rút gọn cùng `@id` |
| IndexNow báo nhầm cả loạt khi asset đổi tên | Chỉ so chữ trong `<main>`, không so HTML thô |

## 13. Phụ lục — ngoài code, để AI và công cụ tìm kiếm thấy MapsLibVN được nhắc ở nơi khác

AI chọn nguồn dựa nhiều vào việc một tên được nhắc ở những chỗ độc lập. Không làm bằng code, chỉ
ghi để PHONG chọn:

1. Một bài hướng dẫn trên Viblo hoặc TopDev: "Nhúng bản đồ Việt Nam vào React trong 5 phút",
   link về docs.
2. Giới thiệu ở các group lập trình (React, React Native, Node.js Việt Nam), trả lời thật các câu
   hỏi kiểu "API bản đồ Việt Nam nào rẻ", nói rõ chỗ Google vẫn hơn.
3. Gửi vào các danh sách tổng hợp công cụ dùng MapLibre.
4. Lập trang Facebook và LinkedIn của MapsLibVN, rồi thêm vào `sameAs` (mục 5.3).
5. Nhờ khách đầu tiên ghi "Bản đồ: MapsLibVN" kèm link trong trang giới thiệu của họ.
