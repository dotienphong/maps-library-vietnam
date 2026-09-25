# @mapslibvn/core

[![npm version](https://img.shields.io/npm/v/@mapslibvn/core.svg)](https://www.npmjs.com/package/@mapslibvn/core)
[![npm downloads](https://img.shields.io/npm/dm/@mapslibvn/core.svg)](https://www.npmjs.com/package/@mapslibvn/core)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@mapslibvn/core)](https://bundlephobia.com/package/@mapslibvn/core)
[![license](https://img.shields.io/npm/l/@mapslibvn/core.svg)](https://www.npmjs.com/package/@mapslibvn/core)

**[Website](https://mapslibvn.pages.dev/) · [Pricing](https://mapslibvn.pages.dev/bang-gia/) · [Docs](https://mapslibvn-docs.pages.dev/sdk/)**

**The Vietnam-first geodata client for TypeScript/JavaScript.** Framework-agnostic, no runtime dependencies, and built from day one to understand Vietnamese addresses the way people actually type them — no diacritics, abbreviated street types, old-vs-new administrative names, and hẻm/ngõ (alley) numbering that generic geocoders get wrong.

`@mapslibvn/core` is the foundation shared by [`@mapslibvn/web`](https://www.npmjs.com/package/@mapslibvn/web), [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react) and [`@mapslibvn/react-native`](https://www.npmjs.com/package/@mapslibvn/react-native) — but it works just as well on its own, in any Node.js service, CLI, or non-map UI (search bars, address forms, delivery apps, coverage checks…).

## Why teams pick it

- 🇻🇳 **Vietnamese text handling, built in** — `normalizeVi`, `stripDiacritics`, `expandAbbrev`, `applyBrandAlias` normalize things like "chung cu", "P. Bến Thành" or "Cty" the way Vietnamese users actually search.
- 🏠 **Real address parsing** — `parseAddress` splits a raw Vietnamese address string into house number, hẻm/ngõ, street, ward, district and province, with a confidence score.
- 🌍 **Pick your POI sources** — mix OpenStreetMap and Foursquare Open Places per request, or just use the sensible "all" default.
- 🧭 **Headless turn-by-turn navigation** — a pure state machine (`createNavigator`) handling rerouting, off-route detection, maneuver formatting and voice-announcement timing, with zero UI dependency. It's the same engine powering the web and React Native navigation layers.
- 📦 **Small and fully typed** — ESM-only, one flat export surface, gzip barrel kept under 20 kB by CI.
- ⚖️ **Attribution helpers included** — `attributionText()` / `attributionHtml()` so you stay compliant with OSM/Foursquare data licenses even outside a map view.

## Install

```bash
npm install @mapslibvn/core
```

Works with Node.js 22+ on the server, and any modern browser with `fetch`.

## Quick start

```ts
import { createClient } from '@mapslibvn/core';

const places = createClient({
  apiKey: 'mlv_live_…',
  baseUrl: 'https://api.ai-solutions.io.vn',
});

const { items } = await places.autocomplete('cho ben thanh', {
  near: [106.7, 10.776],
  limit: 5,
});
```

The client covers autocomplete, search, nearby, geocode, reverse geocode, place details, directions, style URLs and edit suggestions. Never ship a secret key in client-side code or commit it to source control — browser-facing keys must be origin-restricted.

For commercial quota, the client persists the server receipt before returning data and acknowledges
it in the background. Browsers use `localStorage`. Node and React Native default to memory; mobile
apps should pass a durable `receiptStore` adapter backed by AsyncStorage or SecureStore through
`createClient({ receiptStore })`. The adapter implements `load` (returning every receipt still
awaiting acknowledgement), `save` and `remove`. If an older receipt still cannot be acknowledged
after finite retries, the next metered call throws `quota_ack_pending` and does not create another
charge candidate. A receipt the server can no longer settle — wrong token, closed or expired — is
dropped instead of blocking the client forever, and is never charged. Receipts carry the server's
`expiresAt`, so an expired one is dropped locally without spending a round trip.

📖 Full API reference: <https://mapslibvn-docs.pages.dev/sdk/>

📦 Part of the MapsLibVN SDK family: [`@mapslibvn/web`](https://www.npmjs.com/package/@mapslibvn/web) · [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react) · [`@mapslibvn/react-native`](https://www.npmjs.com/package/@mapslibvn/react-native)

Source license: MIT. When you display map data, you must keep attribution as described in the docs and `THIRD_PARTY_NOTICES.md`.

---

## Tiếng Việt

**Client TypeScript/JavaScript "Việt Nam trước" cho dữ liệu địa lý.** Không phụ thuộc framework, không cần thư viện ngoài lúc chạy, và được xây dựng ngay từ đầu để hiểu địa chỉ tiếng Việt đúng như người dùng thật gõ — không dấu, viết tắt loại đường, tên hành chính cũ/mới, và cách đánh số hẻm/ngõ mà các bộ geocoder thông thường không xử lý đúng.

`@mapslibvn/core` là nền tảng dùng chung cho [`@mapslibvn/web`](https://www.npmjs.com/package/@mapslibvn/web), [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react) và [`@mapslibvn/react-native`](https://www.npmjs.com/package/@mapslibvn/react-native) — nhưng vẫn dùng tốt độc lập trong bất kỳ service Node.js, CLI hay giao diện không có bản đồ nào (ô tìm kiếm, form địa chỉ, app giao hàng, kiểm tra vùng phủ…).

## Vì sao nên chọn

- 🇻🇳 **Xử lý tiếng Việt có sẵn** — `normalizeVi`, `stripDiacritics`, `expandAbbrev`, `applyBrandAlias` chuẩn hoá "chung cư", "P. Bến Thành", "Cty" đúng cách người Việt hay tìm.
- 🏠 **Phân tích địa chỉ thật** — `parseAddress` tách một chuỗi địa chỉ tiếng Việt thành số nhà, hẻm/ngõ, đường, phường, quận, tỉnh, kèm điểm tin cậy (`confidence`).
- 🌍 **Tự chọn nguồn POI** — trộn OpenStreetMap và Foursquare Open Places theo từng request, hoặc dùng mặc định "cả hai" (`all`).
- 🧭 **Dẫn đường không giao diện** — một máy trạng thái thuần (`createNavigator`) lo việc tính lại tuyến, phát hiện lệch tuyến, định dạng chỉ dẫn rẽ và thời điểm đọc thoại — không phụ thuộc UI, dùng chung cho cả lớp dẫn đường web lẫn React Native.
- 📦 **Nhỏ gọn và có kiểu đầy đủ** — chỉ ESM, một điểm export duy nhất, CI giữ trần gzip dưới 20 kB.
- ⚖️ **Có sẵn hàm ghi nguồn** — `attributionText()` / `attributionHtml()` để tuân thủ giấy phép dữ liệu OSM/Foursquare kể cả khi không hiển thị bản đồ.

## Cài đặt

```bash
npm install @mapslibvn/core
```

Yêu cầu Node.js 22+ khi chạy phía máy chủ. Trình duyệt hiện đại có sẵn `fetch` cũng dùng được.

## Bắt đầu nhanh

```ts
import { createClient } from '@mapslibvn/core';

const places = createClient({
  apiKey: 'mlv_live_…',
  baseUrl: 'https://api.ai-solutions.io.vn',
});

const { items } = await places.autocomplete('cho ben thanh', {
  near: [106.7, 10.776],
  limit: 5,
});
```

API gồm autocomplete, search, nearby, geocode, reverse geocode, chi tiết địa điểm, chỉ đường (directions), style URL và gửi đề xuất chỉnh sửa. Không đưa khóa bí mật vào mã nguồn hoặc commit; khóa trình duyệt phải giới hạn đúng origin.

Với quota thương mại, client lưu receipt trước khi trả dữ liệu và ACK nền. Trình duyệt dùng
`localStorage`; Node và React Native mặc định dùng bộ nhớ. App mobile nên truyền `receiptStore` bền
vững dùng AsyncStorage hoặc SecureStore vào `createClient({ receiptStore })`. Adapter có ba hàm
`load` (trả về MỌI receipt còn chờ ACK), `save`, `remove`. Nếu ACK cũ vẫn chưa xác định sau số lần
thử hữu hạn, request tính lượt kế tiếp trả lỗi `quota_ack_pending` và không tạo thêm lượt chờ.
Receipt mà máy chủ không còn chốt được — sai token, đã đóng hoặc hết hạn — bị bỏ đi thay vì chặn
client vĩnh viễn, và không bị tính lượt. Receipt mang sẵn `expiresAt` của máy chủ nên cái quá hạn
được bỏ ngay tại client, không tốn vòng mạng.

📖 Tài liệu API đầy đủ: <https://mapslibvn-docs.pages.dev/sdk/>

📦 Nằm trong họ SDK MapsLibVN: [`@mapslibvn/web`](https://www.npmjs.com/package/@mapslibvn/web) · [`@mapslibvn/react`](https://www.npmjs.com/package/@mapslibvn/react) · [`@mapslibvn/react-native`](https://www.npmjs.com/package/@mapslibvn/react-native)

Giấy phép mã nguồn: MIT. Khi hiển thị dữ liệu bản đồ, phải giữ attribution theo tài liệu và `THIRD_PARTY_NOTICES.md`.
