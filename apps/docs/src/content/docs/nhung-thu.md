---
title: Nhúng thử trang của bạn
description: Chạy một trang HTML trắng có bản đồ MapsLibVN trên máy trong hai phút bằng khoá demo, rồi chuyển sang origin thật.
---

Trang này để bạn tự kiểm chứng: SDK nhúng được vào một trang HTML bất kỳ, không cần build, không cần
npm, không cần tài khoản. Chỉ cần một file và một máy chủ tĩnh.

## 1. Tạo `index.html`

Tạo một thư mục trống, đặt file `index.html` với nội dung sau. Khoá mặc định là **khoá demo**, chạy
được trên `http://localhost` và `http://127.0.0.1` ở mọi port:

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Thử nhúng MapsLibVN</title>
  <link rel="stylesheet" href="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.css" />
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    header { padding: 10px 14px; border-bottom: 1px solid #ddd; }
    h1 { font-size: 15px; margin: 0 0 6px; }
    #ac { max-width: 360px; }
    #map { height: 70vh; }
    #log { padding: 10px 14px; font: 12px ui-monospace, monospace; white-space: pre-wrap; }
  </style>
</head>
<body>
  <header>
    <h1>Bản đồ MapsLibVN trên trang của tôi</h1>
    <mapslibvn-autocomplete id="ac" placeholder="Tìm địa điểm…"></mapslibvn-autocomplete>
  </header>
  <div id="map"></div>
  <div id="log">đang tải…</div>

  <script src="https://mapslibvn-docs.pages.dev/sdk/mapslibvn.umd.js"></script>
  <script>
    // Dán khoá của bạn vào đây. Muốn thử nhanh thì lấy khoá demo trong ô "Khoá API" của
    // playground (https://mapslibvn-docs.pages.dev/playground) — nó chỉ chạy trên
    // localhost / 127.0.0.1 (mọi port) và trên trang tài liệu.
    // Mở trang với ?key=mlv_live_… cũng ghi đè được mà không phải sửa file.
    const DEMO_KEY = 'mlv_live_…';
    const API_BASE = 'https://api.ai-solutions.io.vn';

    const params = new URLSearchParams(location.search);
    const key = params.get('key') || DEMO_KEY;
    const log = document.getElementById('log');
    const say = (line) => { log.textContent += (log.textContent ? '\n' : '') + line; };
    log.textContent = 'key: ' + key.slice(0, 13) + '…' + key.slice(-4);

    // file:// làm web worker của maplibre chết im lặng: bản đồ trắng mà không một sự kiện lỗi nào
    // nổ. Bắt sớm ở đây, vì không lớp nào phía dưới báo được ca này.
    if (location.protocol === 'file:') {
      say('LỖI: đang mở bằng file:// — bản đồ sẽ trắng. Phải chạy qua HTTP, xem mục 2.');
    }

    const map = MapsLibVN.createMap({
      container: 'map',
      apiKey: key,
      apiBase: API_BASE,
      center: [106.70, 10.776],
      zoom: 13,
    });

    // Cho autocomplete biết map để lấy tâm bản đồ làm tham số `near`.
    const ac = document.getElementById('ac');
    ac.setAttribute('api-key', key);
    ac.setAttribute('api-base', API_BASE);
    ac.map = map;

    let marker = null;
    ac.addEventListener('select', (e) => {
      const item = e.detail;
      if (marker) marker.remove();
      marker = map.addMarker({ lng: item.lng, lat: item.lat, popupHtml: '<b>' + item.name + '</b>' });
      map.flyTo([item.lng, item.lat], 16);
      say('đã chọn: ' + item.name);
    });

    let loaded = false;
    map.on('load', () => {
      loaded = true;
      say('bản đồ đã tải · origin ' + location.origin);
    });
    // Worker chết không phát 'error'; im lặng quá 15 s là dấu hiệu duy nhất còn lại.
    setTimeout(() => {
      if (!loaded) say('LỖI: quá 15 s chưa tải xong — xem hàng "Worker" ở mục 3.');
    }, 15000);
    map.on('poiClick', (poi) => {
      console.log('poiClick', poi);
      say('POI: ' + poi.name + ' · ' + poi.category + ' · ' + poi.group);
    });
    map.gl.on('error', (e) => say('LỖI: ' + (e && e.error ? e.error.message : 'không rõ')));
  </script>
</body>
</html>
```

Không có bước build nào. Bản UMD đã gói sẵn `maplibre-gl` và `pmtiles`, tự đăng ký web component
`<mapslibvn-autocomplete>`, và phơi global `MapsLibVN`.

## 2. Chạy một máy chủ tĩnh

Mở trực tiếp bằng `file://` **không chạy được**, và lý do không phải khoá: ở `file://` thì
`/v1/styles/light.json` vẫn trả 200 và hai file `.pmtiles` vẫn trả 206. Bản UMD dựng web worker của
maplibre bằng `new Worker(URL.createObjectURL(blob), { type: 'module' })`; ở `file://` blob mang
origin rỗng (`blob:null/…`) nên lệnh `import` tới `maplibre-gl-worker.mjs` bên trong worker bị chặn.
Worker chết im lặng — không request nào fail, `map.gl.on('error')` cũng không nổ — nên không còn
luồng giải mã tile, maplibre không vẽ xong khung đầu tiên, `load` không bao giờ nổ và khung bản đồ
trắng mà không báo gì. Phải phục vụ qua HTTP:

```bash
# Python có sẵn trên macOS và hầu hết Linux
python3 -m http.server 5500 --bind 127.0.0.1

# hoặc Node
npx serve -l 5500
```

`--bind 127.0.0.1` để thư mục chỉ mở cho chính máy này; thiếu nó, `http.server` mở ra cả mạng LAN.

Rồi mở `http://localhost:5500`. Port nào cũng được — khoá `web` so protocol và hostname, bỏ qua
port.

Có khoá riêng rồi thì không cần sửa file: mở `http://localhost:5500/?key=mlv_live_…`.

## 3. Checklist kiểm

| Kiểm | Dấu hiệu đúng | Sai thì là gì |
|---|---|---|
| Tiles | Tab Network: các request `.pmtiles` trả **206** (hoặc 200) | Toàn 403/404 → sai `apiBase`, hoặc tiles chưa phát hành |
| Style | Tab Network: `/v1/styles/light.json` trả **200** | 401/403 → xem hai dòng dưới bảng |
| Worker | Tab Network có `maplibre-gl-worker.mjs`, và dòng "bản đồ đã tải" hiện trong khung log | Thiếu cả hai **trong khi** style vẫn 200 → worker chết, gần như chắc là đang mở bằng `file://` |
| Ghi nguồn | Góc dưới phải có `© OpenStreetMap contributors` | Không có → thiếu `mapslibvn.css` hoặc SDK chưa khởi tạo |
| Autocomplete | Gõ 2 ký tự trở lên, gợi ý hiện sau ~300 ms | Im lặng → thiếu `api-key`/`api-base` trên thẻ |
| POI | Bấm vào biểu tượng POI: console in `poiClick` | Không có → phải bấm **đúng** biểu tượng |
| Khoá | Không có dòng đỏ 401/403 trong console | Xem hai dòng dưới bảng |

Biểu tượng POI xuất hiện tăng dần từ zoom 10 theo độ quan trọng và mật độ. Nhãn địa danh lớn xuất
hiện từ zoom 12; nhãn địa điểm địa phương từ zoom 16. POI không hiện trên nền vẫn tìm được qua
Search/Nearby.

Hai lỗi khoá hay gặp:

- **`403 origin_not_allowed`** — origin của trang không nằm trong `allowed_origins` của khoá. Với
  khoá demo, nghĩa là bạn đang mở ở đâu đó không phải `localhost`/`127.0.0.1`. Với khoá riêng,
  nghĩa là origin đó chưa được đăng ký.
- **`401 invalid_key`** — khoá gõ sai hoặc đã bị thu hồi.

Chi tiết: [Khoá API](/khoa-api/) mục 3.

## 4. Chuyển sang tên miền thật

Khoá demo cố tình **không** chạy trên tên miền của bạn. Khi trang thử đã chạy, lấy một khoá `web`
kèm origin thật:

- Nhanh nhất: tự đăng ký ở [cổng khách hàng](https://api.ai-solutions.io.vn/console/) — email, mã
  sáu số, tên tổ chức, rồi tự khai origin khi tạo khoá. Bản dùng thử 30 ngày, không cần thẻ.
- Khoá `mobile`, khoá `server` hay scope `edits:write`: gửi email `[MapsLibVN]` tới
  `dotienphong1993@gmail.com` — nội dung cần ghi nằm ở [Khoá API](/khoa-api/) mục 7.
- Kê đủ origin: `https://vidu.vn` và `https://*.vidu.vn` là hai mẫu khác nhau; staging cũng phải kê.
- Cả `api.ai-solutions.io.vn` lẫn `mapslibvn-docs.pages.dev` đều là endpoint **tạm thời** của giai
  đoạn nội bộ và sẽ đổi khi MapsLibVN có tên miền riêng; khi đó chỉ cần thay hai tên miền trong
  file trên.

## 5. Ví dụ có sẵn trong repo

Người đã có quyền truy cập repo dùng ví dụ dựng sẵn thay vì gõ tay:

```bash
pnpm example:embed              # phục vụ examples/embed-web ở http://localhost:5500 và mở trình duyệt
pnpm example:embed --key mlv_live_…   # dùng khoá khác mà không sửa .env
```

`examples/embed-web` là một trang HTML trắng nằm **ngoài** `apps/docs`, dựng riêng để chứng minh SDK
nhúng được vào origin bất kỳ. Khoá đọc từ `KEY_EXAMPLE_EMBED` trong `.env` ở gốc repo, không nằm
trong mã nguồn.

## 6. Thử trên điện thoại

App iOS/Android dùng `@mapslibvn/react-native` và khoá kind `mobile` (không kiểm origin). Repo có
sẵn một app Expo độc lập:

```bash
pnpm example:rn            # macOS: iOS simulator; nơi khác: Android
pnpm example:rn --android
```

Không chạy được trên Expo Go vì cần native module. Xem [React Native](/react-native/).

Đọc thêm: [Cài đặt](/cai-dat/) cho bốn cách nhúng, [Khoá API](/khoa-api/) để xin khoá,
[Playground](/playground) để thử toàn bộ Places API ngay trên trang này.
