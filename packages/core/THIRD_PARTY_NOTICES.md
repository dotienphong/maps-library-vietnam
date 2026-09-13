# Thông báo bên thứ ba — MapsLibVN SDK

Tài liệu này đi kèm các gói `@mapslibvn/core`, `@mapslibvn/web`, `@mapslibvn/react`,
`@mapslibvn/react-native` (giấy phép MIT, xem `LICENSE`). Phần mã máy chủ của MapsLibVN
(`apps/*`, `pipelines/*`, `infra/*`, `db/*`) không được phân phối và không nằm trong phạm vi
tài liệu này.

MapsLibVN **không liên kết với, không được tài trợ hay chứng thực bởi** MapLibre. "MapLibre" là
nhãn hiệu của bên thứ ba; tên đó xuất hiện ở đây và trong tài liệu chỉ để mô tả nguồn gốc kỹ
thuật của thư viện mà MapsLibVN sử dụng.

Cập nhật: 12/09/2026.

## 1. Thư viện được đóng gói hoặc là peer dependency của SDK

| Thành phần | Phiên bản đã kiểm | Giấy phép | Vai trò |
|---|---|---|---|
| maplibre-gl | 6.8.0 (peer, các gói web) | BSD-3-Clause | bộ vẽ bản đồ |
| pmtiles | 4.5.0 (dependency) | BSD-3-Clause | đọc tiles PMTiles qua HTTP Range |
| react, react-dom | 18.3.1 (peer, chỉ `@mapslibvn/react`) | MIT | |
| @maplibre/maplibre-react-native | 11.3.8 (peer, chỉ `@mapslibvn/react-native`) | MIT | bộ vẽ bản đồ native iOS/Android |
| react, react-native | react ≥ 19.1, react-native ≥ 0.80 (peer, chỉ `@mapslibvn/react-native`) | MIT | |
| expo-location, expo-task-manager | 57.0.17 (peer **tuỳ chọn**, chỉ entry `@mapslibvn/react-native/expo`) | MIT | định vị tiền cảnh và nền cho dẫn đường |
| expo-speech, expo-audio, expo-keep-awake, expo-sensors | 57.0.3 / 57.0.5 / 57.0.1 / 57.0.3 (peer **tuỳ chọn**, chỉ entry `@mapslibvn/react-native/expo`) | MIT | đọc câu chỉ dẫn, phiên âm thanh khi nền, giữ màn hình sáng, con quay hồi chuyển cho la bàn |

Nguyên văn giấy phép ở mục 4.

## 2. Style, phông, icon mà API phục vụ tới client

Worker trả style MapLibre tại `/v1/styles/*.json`, phông dạng glyph PBF và sprite icon.
Các thành phần này dẫn xuất từ:

| Thành phần | Nguồn | Giấy phép |
|---|---|---|
| Style sáng (`light`) | osm-liberty (maputnik) | mã BSD-3-Clause, thiết kế CC-BY 3.0 / CC-BY 4.0 (OpenMapTiles) |
| Style tối (`dark`) | dark-matter-gl-style (OpenMapTiles, dẫn xuất CartoDB Basemaps) | mã BSD-3-Clause, thiết kế CC-BY 4.0 |
| Lược đồ lớp tiles | OpenMapTiles | BSD-3-Clause (mã) + CC-BY 4.0 (thiết kế) |
| Phông Noto Sans (Regular, Bold, Italic) | openmaptiles/fonts v2.0 | SIL Open Font License 1.1 |
| Sprite icon | Maki (qua sprite osm-liberty) | CC0 1.0 Universal |

Cả osm-liberty và dark-matter **yêu cầu ghi nguồn OpenMapTiles hiển thị được trên bản đồ**;
MapsLibVN đáp ứng bằng chuỗi attribution bắt buộc ở mục 3. Nguyên văn hai giấy phép ở mục 4.

## 3. Dữ liệu bản đồ và nghĩa vụ ghi nguồn (spec 12.3)

| Nguồn | Giấy phép | Ghi nguồn bắt buộc |
|---|---|---|
| OpenStreetMap contributors | ODbL 1.0 | `© OpenStreetMap contributors` — https://www.openstreetmap.org/copyright |
| OpenMapTiles | BSD-3-Clause + CC-BY 4.0 | `© OpenMapTiles` — https://openmaptiles.org/ |
| Foursquare OS Places | Apache-2.0 | `Foursquare OS Places` |

Chuỗi đầy đủ do API trả tại `GET /v1/attribution`:

```
© MapsLibVN · © OpenStreetMap contributors (ODbL) · © OpenMapTiles · Foursquare OS Places (Apache-2.0)
```

SDK luôn hiển thị chuỗi này và **không có tuỳ chọn tắt**.

Dữ liệu OSM và các bảng dẫn xuất thuần OSM là Derivative Database theo ODbL; bản xuất có sẵn
qua `pnpm export:odbl`. Bản đồ và kết quả API là Produced Work: chỉ cần ghi nguồn.

## 4. Nguyên văn giấy phép

### 4.1 maplibre-gl — BSD-3-Clause

```
Copyright (c) 2023, MapLibre contributors

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.
    * Neither the name of MapLibre GL JS nor the names of its contributors
      may be used to endorse or promote products derived from this software
      without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


-------------------------------------------------------------------------------

Contains code from mapbox-gl-js v1.13 and earlier

Version v1.13 of mapbox-gl-js and earlier are licensed under a BSD-3-Clause license

Copyright (c) 2020, Mapbox
Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice,
  this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
* Neither the name of Mapbox GL JS nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


-------------------------------------------------------------------------------

Contains code from glfx.js

Copyright (C) 2011 by Evan Wallace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

--------------------------------------------------------------------------------

Contains a portion of d3-color https://github.com/d3/d3-color

Copyright 2010-2016 Mike Bostock
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### 4.2 pmtiles — BSD-3-Clause

Gói npm `pmtiles` không kèm file giấy phép; nguyên văn dưới đây lấy từ repo gốc
https://github.com/protomaps/PMTiles (`LICENSE`).

```
The below license (BSD-3) applies to the reference implementations in this repository.

The PMTiles specification itself is public domain, or CC0 where applicable.

Sample tilesets available in this repository are subject to their own license terms.

---

Copyright 2021 Protomaps LLC

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### 4.3 react, react-dom — MIT

```
MIT License

Copyright (c) Facebook, Inc. and its affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 4.4 osm-liberty (style sáng) — BSD-3-Clause + CC-BY

```
## Code License

The Mapbox GL Style JSON file is originally derived from [OSM Bright from Mapbox Open Styles](https://github.com/mapbox/mapbox-gl-styles/blob/master/LICENSE.md). The modified Mapbox GL Style JSON retains the same BSD license.

> Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

> * Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
* Neither the name of Mapbox nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Design License

The look and feel of the OSM liberty map design is also derived (although heavily altered) from [OSM Bright from Mapbox Open Styles](https://github.com/mapbox/mapbox-gl-styles/blob/master/LICENSE.md) which is licensed under the Creative Commons Attribution 3.0 license.

The map is displaying and styling the data from [OpenMapTiles](https://openmaptiles.org/) with [CC-BY 4.0 design license](https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md).

The products or services using this map style need to visibly credit "OpenMapTiles.org" or reference "OpenMapTiles" with a link to http://openmaptiles.org/. For a browsable electronic map based on OpenMapTiles and OpenStreetMap data, the credit should appear in the corner of the map. For example:

[© OpenMapTiles](https://openmaptiles.org/)
[© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

For printed and static maps a similar attribution should be made in a textual description near the image, in the same fashion as if you cite a photograph.

## Icons

OSM Liberty is using the [Maki POI icon set](https://github.com/mapbox/maki/blob/master/LICENSE.txt) which is licensed under CC0 1.0 Universal.

The right arrow was derived from [Wikipedia][wiki_arrow] which is in the public domain.

[wiki_arrow]: https://commons.wikimedia.org/wiki/File:Arrowright.svg

## Fonts

OSM Liberty is using the Roboto font family (Copyright 2011 Google).
Roboto is licensed under the [Apache License, Version 2.0](https://github.com/google/roboto/blob/master/LICENSE).
```

### 4.5 dark-matter-gl-style (style tối) — BSD-3-Clause + CC-BY 4.0

```
Copyright (c) 2024, MapTiler.com & OpenMapTiles contributors.
Copyright (c) 2015, CartoDB Inc.
All rights reserved.

Derived from "CartoDB Basemaps" (https://github.com/CartoDB/CartoDB-basemaps)
designed by Stamen and Paul Norman for CartoDB Inc., licensed under CC-BY 3.0.

# Code license: BSD 3-Clause License

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

# Design license: CC-BY 4.0

The visual design features of the style (also known as the "look and feel" of
the map) are licensed under the Creative Commons Attribution 4.0 license.

To view a copy of the license, visit https://creativecommons.org/licenses/by/4.0/.

Attribution for the design defined in this repository needs not to be provided
on map images, but should be reasonably accessible from maps based on this style
(for example, in a webpage linked from copyright notice on the map).

Products or services using maps derived from OpenMapTiles schema need to visibly
credit "OpenMapTiles.org" or reference "OpenMapTiles" with a link to
https://openmaptiles.org/.

For a browsable electronic map based on OpenMapTiles and OpenStreetMap data, the
credit should appear in the corner of the map. For example:

[© OpenMapTiles](https://openmaptiles.org/)
[© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

For printed and static maps a similar attribution should be made in a textual
description near the image, in the same fashion as if you cite a photograph.

Exceptions to OpenMapTiles attribution requirement can be in a written form granted
by MapTiler AG (info@maptiler.com).
The project contributors grant MapTiler AG the license to give such
exceptions on a commercial basis.
```

### 4.6 Noto Sans — SIL Open Font License 1.1

Phông Noto Sans (Copyright Google Inc.) được dùng dưới SIL Open Font License 1.1.
Nguyên văn: https://openfontlicense.org/open-font-license-official-text/

Điều kiện chính: được dùng, nhúng, sửa và phân phối lại kèm phần mềm, kể cả thương mại;
**không được bán riêng lẻ** bản thân phông; bản sửa đổi không được dùng tên "Noto" trừ khi
được phép; giấy phép và thông báo bản quyền phải đi kèm mọi bản phân phối.

### 4.7 Maki — CC0 1.0 Universal

Icon Maki (Mapbox) ở phạm vi công cộng theo CC0 1.0 Universal:
https://creativecommons.org/publicdomain/zero/1.0/ — không yêu cầu ghi nguồn.

### 4.8 @maplibre/maplibre-react-native — MIT

```
Copyright (c) 2022 MapLibre contributors

Copyright (c) 2015-2020 Mapbox

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Gói này nhúng MapLibre Native (Android, iOS) khi build app — xem thông báo giấy phép trong
chính gói đó cho các thành phần native.

### 4.9 expo-location, expo-task-manager, expo-speech, expo-audio, expo-keep-awake, expo-sensors — MIT

```
The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Các gói này là peer dependency **tuỳ chọn**: chỉ app import `@mapslibvn/react-native/expo` (dẫn
đường) mới cài; SDK không đóng gói mã của chúng.

## 5. Công cụ phía máy chủ (không phân phối, liệt kê để minh bạch)

Planetiler (Apache-2.0), tippecanoe (BSD-2-Clause), osmium-tool (GPL-3.0 — dùng như công cụ
dòng lệnh, không liên kết mã), pyosmium (BSD-2-Clause), DuckDB (MIT), PostgreSQL
(PostgreSQL License), PostGIS (GPL-2.0 — chạy như dịch vụ), Valhalla (MIT — engine chỉ đường, chạy như dịch vụ riêng trên máy chủ, không liên kết mã), Hono (MIT), cloudflared
(Apache-2.0), Astro Starlight (MIT), Vitest (MIT), Playwright (Apache-2.0).
