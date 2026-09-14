# Hiệu năng và độ tương thích khi nhúng vào app bên thứ ba — trọng tâm React Native

- Ngày: 14/09/2026
- Trạng thái: PHONG duyệt 14/09/2026
- Phạm vi: `@mapslibvn/react-native` là chính; `@mapslibvn/web`, `@mapslibvn/react`,
  `@mapslibvn/core` là phụ

## 1. Vì sao làm

MapsLibVN chưa có khách ngoài nào nhúng thật. Trước khi bán, cần trả lời được bằng số ba câu
hỏi mà khách sẽ hỏi ngay: bản đồ mở nhanh không, kéo có mượt không, app của tôi có cài được
không. Hiện tại dự án **không có một phép đo nào** cho hai câu đầu, và câu thứ ba đang có câu
trả lời xấu mà chưa ai nhận ra (xem mục 4, món C1).

Đây là việc tối ưu chủ động, không phải chữa cháy. Không có triệu chứng nào do khách báo.

## 2. Nguyên tắc chi phối

**Đo trước, sửa sau.** Dự án đã nhiều lần kết luận sai vì đo ở môi trường dev rồi suy ra
production (bậc 2/3 của tìm kiếm, p95 autocomplete). Với hiệu năng mobile, sai số giữa
emulator và máy thật còn lớn hơn. Vì vậy mọi con số phải ghi kèm nơi đo, và không kết luận
nào về FPS được coi là đóng khi chưa có xác nhận trên máy thật.

**Món nào không cải thiện thì hoàn tác.** Không giữ lại code phức tạp hơn để đổi lấy con số
không đổi.

**Không tự ý phát hành.** Không bump version, không push, không publish, không deploy — theo
đúng nếp mục 14 của DEVLOG.

## 3. Giai đoạn 1 — bộ đo

Ba lệnh mới, bám nếp `scripts/` hiện có: một `scripts/<tên>.mjs` + `scripts/lib/<tên>.mjs`
cho phần thuần logic + `.test.mjs` đi kèm, in p50/p95 như `perf-autocomplete.mjs`.

### 3.1 `pnpm perf:rn` — đo trong app RN thật

Thêm **một màn hình đo riêng** vào `examples/embed-rn`, không sửa màn hình demo hiện có.
`scripts/perf-rn.mjs` lái emulator (hoặc máy thật khi có), gom số, ghi JSON + Markdown.

| Số đo | Cách lấy | Emulator | Máy thật |
|---|---|---|---|
| Thời gian mở màn hình bản đồ | mount → `onDidFinishLoadingMap`, tách chặng: style JSON, sprite, glyph, tile đầu | máy làm được | PHONG |
| Frame rớt khi kéo/zoom | `adb shell dumpsys gfxinfo <pkg> framestats`, đếm frame quá 16,7 ms trên kịch bản pan/zoom cố định | Android: máy làm được | Android: PHONG |
| Số lượt qua cầu JS↔native mỗi giây khi dẫn đường | đếm trong JS mỗi lần đổi `ShapeSource`/props của lớp tuyến và lớp vị trí | máy làm được | PHONG |
| Số lần React re-render mỗi fix GPS | `Profiler` của React bọc cây map | máy làm được | — |

iOS không có công cụ tương đương `gfxinfo`. Phần iOS là **quan sát định tính trên máy thật**,
ghi rõ như vậy trong evidence thay vì bịa ra số.

Mỗi số chạy lặp (mặc định 10 lượt) ra p50/p95, kèm nhãn môi trường: thiết bị, bản OS, bản RN,
Debug hay Release.

### 3.2 `pnpm perf:size` — kích thước

- JS bundle Metro của app thử, đo trước và sau khi thêm SDK (phần chênh mới là phần SDK tốn)
- Kích thước APK và IPA bản Release
- `dist/index.js` và `dist/expo/index.js` của gói RN
- Mở rộng size-limit ra `@mapslibvn/react` và `@mapslibvn/react-native` (hiện chỉ gác `core`
  và `web`)

### 3.3 `pnpm compat:matrix` — ma trận tương thích

Cài tarball vào app tối giản rồi **build thật**. Mỗi ô cho ĐẠT hoặc HỎNG kèm nguyên văn lỗi.

Ô bên RN (chính):

- RN 0.76, 0.80, 0.81
- React 18 và React 19
- Hai bản Expo SDK gần nhất
- New Architecture (Fabric) bật và tắt
- App Expo và app RN thuần (bare)

Ô bên web (phụ, ba ô cốt lõi): Vite, Next.js có SSR, UMD dưới CSP nghiêm (không
`unsafe-inline`, không `unsafe-eval`).

Ô Android Release là ô đắt nhất về thời gian build: chỉ chạy cho tổ hợp tối thiểu và tối đa,
dựng tuần tự và dọn sau mỗi ô.

### 3.4 Evidence

`docs/evidence/perf/2026-09-14-baseline-rn.md`, tách rõ hai nhóm "máy đo được" và
"CHỜ PHONG cắm máy thật", đúng cách nhật ký đang phân biệt ĐẠT với CHỜ PHONG.

## 4. Danh mục món tối ưu

Gói RN đã được tối ưu khá kỹ: nón hướng xoay bằng `Animated` native driver nên không
re-render, bearing camera throttle 250 ms/2°, easing `linear` để hết giật nhịp,
`useSyncExternalStore` chỉ đọc đúng lát cần, client memo theo khoá chuỗi. Ba bài học thực địa
đã nằm trong code. Dư địa còn lại nằm ở **thời gian mở màn hình** và **độ tương thích**, không
phải ở độ mượt khi dẫn đường.

### Nhóm A — thời gian mở màn hình bản đồ

| # | Món | Vấn đề hiện tại | Phá API |
|---|---|---|---|
| A1 | Cache style JSON | `useResolvedStyle` fetch lại style mỗi lần mount khi `lang ≠ 'vi'` hoặc tắt POI; rời màn hình rồi quay lại là tải lại từ đầu | Không |
| A2 | Style đóng gói sẵn theo app | Mỗi lần mở app đều phải đi vòng qua Worker lấy style trước khi vẽ được gì | Không, thêm prop |
| A3 | Đổi theme/ngôn ngữ không dựng lại map | `mapKey` chứa `style`/`lang`/`poiLayer` → đổi sáng↔tối tạo lại toàn bộ map native: màn hình trắng, tải lại style và tile từ đầu | Có, nhẹ: `onLoad` thôi gọi lại |
| A4 | Tải trước tile quanh vị trí đầu | Không có; bản đồ hiện ra rồi mới bắt đầu kéo tile | Không, thêm tuỳ chọn |

### Nhóm B — độ mượt

| # | Món | Vấn đề hiện tại | Phá API |
|---|---|---|---|
| B1 | Cắt tuyến khi dẫn đường | Mỗi fix GPS, `routes-store` dựng lại toàn bộ FeatureCollection tuyến rồi đẩy cả qua cầu; tuyến liên tỉnh vài nghìn điểm, mỗi giây một lần | Không |
| B2 | Bán kính bao dung khi chạm POI | `queryRenderedFeatures` tại đúng một điểm, lệch khoảng 10 px là trượt — DEVLOG mục 11 đã ghi là việc cần xem xét, chưa sửa | Không |
| B3 | Vòng sai số vẽ lại mỗi giây | `GeoJSONSource` và `Layer` dựng lại mỗi fix dù bán kính hầu như không đổi | Không |

### Nhóm C — tương thích và kích thước

| # | Món | Vấn đề hiện tại | Phá API |
|---|---|---|---|
| C1 | Nới peer deps | Đang đòi React ≥ 19.1 và RN ≥ 0.80. App khách còn React 18 hoặc RN 0.7x là không cài được. Đây là rào lớn nhất, lớn hơn mọi chuyện tốc độ. **Xem mục 4b: rào này không nằm ở code ta** | Không, nới là mở rộng |
| C2 | New Architecture (Fabric) | Chưa có bằng chứng đã chạy thử với Fabric bật và tắt | Không |
| C3 | PNG puck nhúng data URI | `PUCK_PNG_DATA_URI` nằm thẳng trong bundle JS | Không |

> **Phạm vi của plan đầu tiên:** chỉ giai đoạn 1 (bộ đo + baseline) và món C1. Giai đoạn 3
> không lập plan được trước khi PHONG tick món, nên sẽ có plan riêng sau giai đoạn 2.

### 4b. Phát hiện 14/09/2026 về C1 — rào nằm ở thư viện nền

Kiểm lại khi lập plan: `peerDependencies` của `@mapslibvn/react-native` đang **sao chép đúng**
`peerDependencies` của `@maplibre/maplibre-react-native@11.3.8`:

```
react >= 19.1.0 · react-native >= 0.80.0 · expo >= 54.0.0 · @types/react >= 19.1.0
```

Code của ta **không** dùng gì riêng của React 19 — toàn bộ gói RN chỉ dùng `useSyncExternalStore`,
`useEffect`, `useMemo`, `useRef`, `useState`, `useContext`, `useCallback`, đều có từ React 18.
Nghĩa là ràng buộc hẹp đến từ thư viện nền, không đến từ ta.

Bản `@maplibre/maplibre-react-native@10` rộng hơn hẳn (`react >= 16.6.1`, `react-native >= 0.59.9`)
nhưng là **API khác hẳn v11** (tên component và cách khai báo layer đều đổi), nên hỗ trợ song song
hai bản là việc lớn, không phải một dòng `peerDependencies`.

C1 vì vậy đổi từ "sửa một dòng" thành một câu hỏi cần đo: **peer range của v11 có bảo thủ quá
không.** Ma trận tương thích sẽ cài bằng `--legacy-peer-deps` rồi build và chạy thật trên
React 18 / RN 0.79 để biết con số `>= 19.1 / >= 0.80` là ràng buộc thật hay chỉ là khai báo
phòng xa. Ba kết cục và việc tương ứng:

| Kết cục | Việc |
|---|---|
| Build và chạy được trên React 18 / RN 0.79 | Nới `peerDependencies` của ta xuống, ghi rõ trong docs là "đã thử tới đâu" |
| Vỡ ở bước build hoặc lúc chạy | Giữ nguyên, ghi yêu cầu tối thiểu vào README gói RN và trang docs; C1 khép lại với kết luận có bằng chứng |
| Chỉ vỡ ở một vài ô | Nới tới ngưỡng thấp nhất còn chạy được, ghi rõ ngưỡng đó |

Việc hỗ trợ song song v10 cho RN 0.7x **nằm ngoài phạm vi** spec này; nếu ma trận cho thấy đó là
cách duy nhất chạm tới nhóm khách hàng đó thì lập spec riêng.

## 5. Giai đoạn 2 — PHONG chọn món

Sau giai đoạn 1, mỗi món có một dòng "đổi được bao nhiêu ms / bao nhiêu frame rớt / bao nhiêu
kB", PHONG tick. Không có việc nào của máy ở giai đoạn này.

Ngoại lệ: **C1 làm bất kể số đo**. Nó không phải chuyện hiệu năng mà là chuyện có bán được hay
không. Ma trận tương thích ở giai đoạn 1 sẽ cho biết đó là sửa một dòng `peerDependencies` hay
là phải sửa code.

## 6. Giai đoạn 3 — làm, đo lại, gác

Mỗi món một commit riêng. Thứ tự: C1 trước (mở rộng tập khách hàng), rồi nhóm A (thời gian mở
màn), rồi nhóm B. A3 là món duy nhất chạm API nên để cuối nhóm A, và phải viết test cho hành
vi hiện tại trước khi đổi.

Sau mỗi món, chạy lại đúng phép đo của món đó và ghi số trước/sau vào evidence.

### Gác hồi quy — hai loại ngưỡng khác nhau

| Loại | Gác ở đâu | Vì sao |
|---|---|---|
| Kích thước (`perf:size`) | CI, ngưỡng cứng như size-limit đang làm | Số tất định, máy nào chạy cũng ra một kết quả |
| Ma trận tương thích (`compat:matrix`) | CI, ĐẠT/HỎNG | Cũng tất định; đây là thứ dễ vỡ nhất khi nâng dependency |
| Thời gian mở màn, FPS (`perf:rn`) | Không gác trên CI. Chạy tay, ghi evidence | Số phụ thuộc máy và emulator; gác cứng sẽ đỏ ngẫu nhiên rồi bị vô hiệu hoá, tệ hơn là không gác |

`perf:rn --check` so với baseline đã chốt và **chỉ cảnh báo**, biên độ rộng, để chạy trước mỗi
lần phát hành chứ không chặn mọi commit.

## 7. Rủi ro và cách chặn

| Rủi ro | Cách chặn |
|---|---|
| Đo trên emulator rồi kết luận sai cỡ | Mọi con số ghi kèm nơi đo; không kết luận nào về FPS đóng khi chưa có máy thật |
| A3 làm vỡ hành vi đang chạy | Viết test cho hành vi hiện tại trước, rồi mới đổi; để cuối nhóm A |
| C1 lộ ra code thực sự cần React 19 | Ma trận tương thích ở giai đoạn 1 phát hiện trước khi hứa gì |
| `compat:matrix` build hàng chục tổ hợp, chạy hàng giờ, đầy đĩa | Giới hạn ở ô có ý nghĩa thương mại; dựng tuần tự, dọn sau mỗi ô; Android Release chỉ chạy tổ hợp tối thiểu và tối đa |
| Chạm nhầm production | Việc này không cần đụng DB hay API máy chủ. Lệnh nào cần thì để PHONG chạy bằng `!` |

## 8. Việc PHONG phải tự làm

1. Cắm Mi 9 và iPhone 14 Plus đo FPS và thời gian mở màn thật, bằng **bản Release**
   (`pnpm release:android` / `pnpm release:ios`) — bản Debug cho số sai hoàn toàn
2. Tick món ở giai đoạn 2
3. Quyết bump version, `pnpm sdk:publish`, `pnpm deploy:docs`

## 9. Tiêu chí nghiệm thu

1. Ba lệnh `pnpm perf:rn`, `pnpm perf:size`, `pnpm compat:matrix` chạy được, mỗi script có
   `.test.mjs` đi kèm đúng nếp `scripts/`
2. Evidence baseline điền đủ số cho mọi ô máy đo được; ô cần máy thật ghi rõ **CHỜ PHONG**,
   không để trống không giải thích
3. Ma trận tương thích kết luận được bản React / RN / Expo **tối thiểu** nào cài được, và con
   số đó được viết vào README của gói RN cùng trang docs react-native
4. Mỗi món được tick đều có số trước/sau trong evidence; món không cải thiện thì hoàn tác và
   ghi lại lý do
5. Cổng hiện có không hồi quy: `pnpm test`, `pnpm typecheck`, `pnpm lint`,
   `notices-sync --check` xanh
6. Không bump version, không push, không publish, không deploy

## 10. Ngoài phạm vi

- Đổi engine bản đồ hoặc bỏ MapLibre Native
- Mô hình nhúng bằng `<iframe>` (đã cân nhắc và loại ở giai đoạn thiết kế: mất khả năng gọi
  sự kiện từ code khách, và không giải quyết gì cho React Native)
- Tối ưu phía API máy chủ (autocomplete, directions) — đã có `perf-autocomplete.mjs` và
  `smoke-directions.mjs` riêng
- Chế độ bản đồ ngoại tuyến hoàn toàn
