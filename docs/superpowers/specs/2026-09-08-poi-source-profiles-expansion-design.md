# Spec — Mở rộng profile POI: Overture và Foursquare

Ngày: 08/09/2026. Trạng thái: PHONG đã duyệt thiết kế qua đối thoại 08/09/2026.
Kế thừa các bất biến phát hành trong
`2026-09-07-poi-sources-profile-design.md`; tài liệu này chỉ mô tả phần mở rộng ba profile.

## 1. Mục tiêu

Bổ sung ba profile archive có thể chọn đồng nhất qua API, SDK và playground:

| Profile | `primary_source` được chọn | Prefix archive |
|---|---|---|
| `overture-fsq` | `overture`, `fsq` | `poi-overture-fsq-<build-id>` |
| `overture` | `overture` | `poi-overture-<build-id>` |
| `fsq` | `fsq` | `poi-fsq-<build-id>` |

Hai profile hiện có `all` và `osm` giữ nguyên contract, tên archive và dữ liệu đang phục vụ.
`all` tiếp tục là mặc định. POI `created_by='user'` luôn được giữ trong cả năm profile, nhưng vẫn
chịu `status`, xếp hạng, giới hạn và thinning như POI khác.

Không đổi schema DB, conflate, taxonomy, attribution, `GET /v1/places/{id}`, geocode, cách chọn
POI progressive hoặc định dạng vector tile. Không publish npm trong hạng mục này; SDK source và
tài liệu được cập nhật, còn phát hành package vẫn phụ thuộc cổng pháp lý hiện hữu.

## 2. Quyết định kiến trúc

### Chọn: registry profile dùng chung và batch phát hành nguyên tử

`POI_SOURCE_PROFILES` trong `@mapslibvn/core` là nguồn sự thật duy nhất. Type
`PoiSourceProfile` được suy ra từ key của registry để thêm profile không phải sửa một union song
song. API, SDK, pipeline và playground đều ánh xạ về registry này.

Pipeline thay các nhánh hard-code `all`/`osm` bằng helper tạo release/step từ danh sách profile.
Đợt bootstrap này chỉ build ba profile mới từ **một snapshot bất biến** và giữ release `all`/`osm`
hiện hành. Mỗi archive chạy lọc và progressive thinning độc lập.

Hai phương án không chọn:

1. Thêm ba nhánh hard-code vào mọi file: diff ban đầu nhỏ nhưng tiếp tục nhân bản contract và dễ
   quên một bề mặt khi thêm profile sau.
2. Gọi publisher một-profile ba lần: tái dùng lệnh cũ nhưng cập nhật manifest ba lần, để production
   có thể lộ trạng thái dở dang nếu lần thứ hai hoặc thứ ba lỗi.

## 3. Core và public contract

Registry chuẩn:

```ts
export const POI_SOURCE_PROFILES = {
  all: ['osm', 'overture', 'fsq'],
  osm: ['osm'],
  'overture-fsq': ['overture', 'fsq'],
  overture: ['overture'],
  fsq: ['fsq'],
} as const;
```

`parsePoiSourcesCsv` tiếp tục nhận danh sách nguồn. `profileForSources` chuẩn hoá thứ tự nên cả
`sources=overture,fsq` và `sources=fsq,overture` đều ánh xạ về `overture-fsq`. Các tổ hợp không có
archive, như `osm,overture`, vẫn hợp lệ với Places API nhưng style trả `400 invalid_request` như
hiện tại.

SDK không thêm option mới: người tích hợp dùng `poiSources` hiện hữu. Ba cấu hình mới là:

```ts
poiSources: ['overture', 'fsq']
poiSources: ['overture']
poiSources: ['fsq']
```

Map, `map.places`, React, React Native và autocomplete gắn map tiếp tục dùng cùng một client/tập
nguồn. Mặc định bỏ trống `poiSources` vẫn là `all`.

## 4. Archive, manifest và tiles

Tên release mới dùng cùng build ID `YYYYMMDD-HHmmss-<nonce>` cho cả batch. Hàm tạo release trả
map theo profile thay vì cặp cố định; wrapper cũ được giữ nếu test hoặc caller hiện hữu cần tương
thích.

Manifest vẫn giữ `poi` là archive `all`. Các archive còn lại nằm trong:

```json
{
  "poi": "poi-...",
  "poiProfiles": {
    "osm": "poi-osm-...",
    "overture-fsq": "poi-overture-fsq-...",
    "overture": "poi-overture-...",
    "fsq": "poi-fsq-..."
  }
}
```

CLI manifest nhận cập nhật profile theo dạng tổng quát, đồng thời tiếp tục hiểu `--poi-osm` để
không phá runbook cũ. Tiles route và smoke chỉ chấp nhận prefix sinh từ registry, không nhận chuỗi
tự do. `poiReleaseFor` giữ fallback `all` khi một profile đã có trong code nhưng chưa được publish;
header trả `all;fallback` đúng contract hiện tại.

Rollback duyệt mọi release có trong `poiProfiles`, bắt buộc archive `.pmtiles` và companion
`.sha256` hợp lệ trước khi đổi manifest. Không giả định chỉ có key `osm`.

## 5. Luồng build và publish bootstrap

Thêm batch mode cho `pnpm poi:profile` để nhận đúng ba profile mới. Luồng chạy trong pipeline
container và dùng tunnel/credentials hiện hữu:

1. Kiểm tra profile, credentials và remote manifest trước khi làm việc nặng.
2. Tạo một `buildId`, chụp một `snapshot-<buildId>.jsonl` và companion SHA-256.
3. Với từng profile: export từ snapshot, kiểm build ID/checksum, QA và chặn archive lớn hơn
   `300 * 2 ** 20` byte.
4. Upload bất biến từng archive cùng checksum; cùng tên+cùng bytes được reuse, khác bytes bị từ chối.
5. Smoke từng archive qua URL production nhưng chưa đổi manifest.
6. Gọi manifest đúng một lần để thêm cả ba release; đây là commit point duy nhất.

Nếu export, QA, upload hoặc smoke nào lỗi, manifest không đổi. Archive đã upload nhưng chưa trỏ tới
là an toàn và có thể reuse khi retry. `all` và `osm` không bị rebuild hoặc đổi ID trong bootstrap.

Sau bootstrap, luồng `data:update --poi` build đủ năm profile từ cùng snapshot để các lần cập nhật
nguồn tương lai không làm profile mới bị cũ dữ liệu. State R2 ghi release theo map profile, nhưng
vẫn đọc được trường `poiOsm` lịch sử.

## 6. API, SDK và playground

`GET /v1/styles/{theme}.json` nhận ba tập nguồn mới và chọn archive tương ứng. Header
`x-poi-profile` trả `overture-fsq`, `overture` hoặc `fsq`; nếu archive chưa có thì trả
`all;fallback`. Search, nearby, reverse và autocomplete đã lọc theo danh sách nguồn nên chỉ cần mở
rộng test ngữ nghĩa/cache, không thêm endpoint.

Playground hiển thị năm lựa chọn:

- Tất cả
- Chỉ OpenStreetMap
- Overture + Foursquare
- Chỉ Overture
- Chỉ Foursquare

Giá trị được đồng bộ vào map, `map.places`, URL chia sẻ và snippet embed. URL dùng
`?sources=overture,fsq`, `?sources=overture` hoặc `?sources=fsq`; parser chấp nhận thứ tự nguồn bất
kỳ và serialize lại theo thứ tự chuẩn.

Tài liệu API/Web/React/React Native/Search/SDK nêu đủ profile, mặc định, fallback và quy tắc luôn
giữ POI người dùng. Không thay đổi version package chỉ để cập nhật danh sách profile vì public type
`PoiSource[]` không đổi; nếu registry export thay đổi cần release package sau khi cổng pháp lý mở.

## 7. Kiểm thử và nghiệm thu

Mọi thay đổi hành vi theo TDD: test đỏ trước implementation, test mục tiêu sau từng lát dọc.

- Core: registry, type suy ra, chuẩn hoá thứ tự và ánh xạ đủ năm profile.
- Pipeline: release prefix/map, batch step order, một snapshot, thinning độc lập, giới hạn kích
  thước, manifest-last và fault injection tại từng profile.
- Manifest/rollback/tiles: set động, tương thích `--poi-osm`, fallback và checksum toàn bộ profile.
- API unit + PostgreSQL thật: ma trận OSM/Overture/FSQ/user trên search, nearby, reverse,
  autocomplete; cache chạy cả hai chiều giữa các profile.
- SDK: URL cho bốn Places method và style; Web/React/React Native truyền đúng `poiSources`.
- Playground: parse/serialize/snippet, đổi selector E2E và không có console error.
- Gate repo: test mục tiêu, `pnpm test:api-db`, `pnpm test:db`, `pnpm test`, `pnpm lint`,
  `pnpm typecheck`, `pnpm build` và docs build.

Nghiệm thu production sau khi manifest đổi:

1. Lưu release ID, SHA-256, kích thước, selected/thinned và smoke result của từng archive.
2. Gọi style light/dark cho đủ năm profile; kiểm HTTP 200, `x-poi-profile` và URL PMTiles đúng.
3. Kiểm search/nearby/reverse/autocomplete trả đúng partition nguồn và vẫn thấy fixture/user POI
   phù hợp; `/places/{id}` không đổi.
4. Kiểm bản đồ ở Hà Nội, Hải Phòng, Đà Nẵng, TP.HCM và Cần Thơ tại z12/14/16, lưu ảnh và console.
5. Đo autocomplete paired, tách cold/warm; warm p95 của mỗi profile mới không được chậm hơn `all`
   quá 50 ms. Không dùng cache-hit để kết luận cho cold.
6. Kiểm manifest production chứa cả ba key mới, rồi diễn tập read-only việc resolve rollback target
   và xác minh checksum; không thực hiện rollback thật nếu production đang đúng.
7. Kiểm CI/deploy theo commit. Nếu GitHub Actions vẫn bị billing block, ghi rõ là cổng hạ tầng chưa
   xác minh thay vì gọi green.

## 8. Rollout và rollback

Thứ tự rollout: merge/deploy code có fallback trước, build/upload ba archive, smoke, cập nhật
manifest nguyên tử, nghiệm thu API/browser, cập nhật evidence và DEVLOG. Việc deploy code trước
không đổi người dùng hiện hữu vì `all` vẫn mặc định và manifest chưa có key mới.

Rollback ứng dụng là đưa manifest về history đã xác minh checksum. Code mới đọc manifest cũ; code
cũ bỏ qua các key profile mới, nên thay đổi tương thích hai chiều. Archive bất biến được giữ trên R2
để điều tra/retry, không xoá trong hạng mục này.
