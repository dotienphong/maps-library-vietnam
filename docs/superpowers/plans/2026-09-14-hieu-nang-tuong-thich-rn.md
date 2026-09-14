# Bộ đo hiệu năng + ma trận tương thích RN — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng ba lệnh đo (`perf:size`, `perf:rn`, `compat:matrix`), ghi baseline hiệu năng và tương thích của `@mapslibvn/react-native` vào evidence, và khép món C1 bằng kết luận có bằng chứng.

**Architecture:** Mỗi lệnh tách đôi theo đúng nếp `scripts/` của repo: toàn bộ logic thuần (parse, thống kê, sinh tổ hợp, định dạng bảng) nằm ở `scripts/lib/<tên>.mjs` và được test bằng vitest; phần chạm thế giới thật (spawn, adb, đọc file, build) nằm ở `scripts/<tên>.mjs` và không có test đơn vị. App thử RN nhận thêm một màn hình đo riêng, bật bằng biến môi trường, không đụng màn hình demo.

**Tech Stack:** Node 22 ESM (`.mjs` + JSDoc, `checkJs`), vitest, `cross-spawn` qua `scripts/lib/run.mjs`, size-limit, adb (`dumpsys gfxinfo`, `input swipe`), Expo CLI, React `Profiler`.

**Spec:** `docs/superpowers/specs/2026-09-14-hieu-nang-tuong-thich-rn-design.md`

---

## Bẫy đã biết trong repo (đọc trước khi gõ dòng đầu tiên)

1. **`scripts/*.mjs` bị typecheck.** `tsconfig.scripts.json` bật `checkJs` và
   `exactOptionalPropertyTypes`. Mọi hàm phải có JSDoc đủ kiểu, và **không được** gán
   `undefined` vào thuộc tính tuỳ chọn — dùng spread có điều kiện
   (`...(x ? { k: x } : {})`) như code hiện có. Chạy `pnpm typecheck` trước mỗi commit.
2. **Lệnh wrangler phải chạy từ `apps/api`** — không liên quan plan này, nhưng đừng thêm
   lệnh nào chạm production.
3. **Không chạm DB máy chủ.** Plan này không cần DB. Nếu phát sinh, để PHONG chạy bằng `!`.
4. **Máy dev thiếu `tippecanoe`** — không liên quan, nhưng đừng chạy `pnpm test:db`.
5. **Không bump version, không push, không publish, không deploy.**

## Một chỗ đo bằng vật thay thế, nói rõ từ đầu

Spec mục 3.1 liệt kê riêng "số lượt qua cầu JS↔native mỗi giây" và "số lần React re-render mỗi
fix GPS". Không có API công khai nào đếm được lượt qua cầu từ phía JS, nên plan này đo **số
commit React của cây map trên mỗi fix GPS** và dùng nó làm vật thay thế cho cả hai: mỗi commit
chạm tới `GeoJSONSource`/`Layer` là một lượt serialize đi qua cầu. Evidence phải ghi đúng tên
"commit React mỗi fix", không được ghi thành "lượt qua cầu" — con số là proxy, không phải phép
đo trực tiếp.

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `scripts/lib/perf-size.mjs` | Hàm thuần: gộp bảng kích thước, tính chênh lệch bundle, định dạng Markdown |
| `scripts/lib/perf-size.test.mjs` | Test cho trên |
| `scripts/perf-size.mjs` | CLI: đọc kích thước file thật, gọi Metro bundle, in bảng |
| `packages/react/.size-limit.json` | Ngưỡng kích thước gói react |
| `packages/react-native/.size-limit.json` | Ngưỡng kích thước gói react-native |
| `examples/embed-rn/perf-screen.tsx` | Màn hình đo trong app thử: đo thời gian mở map, đếm commit React |
| `scripts/lib/perf-rn.mjs` | Hàm thuần: parse dòng log `MLVPERF`, parse `gfxinfo`, thống kê p50/p95, sinh lệnh cử chỉ, định dạng evidence |
| `scripts/lib/perf-rn.test.mjs` | Test cho trên |
| `scripts/perf-rn.mjs` | CLI: lái emulator/máy thật, reset gfxinfo, bắn cử chỉ, đọc logcat |
| `scripts/lib/compat-matrix.mjs` | Hàm thuần: sinh tổ hợp, sinh `package.json` app thử, phân loại lỗi, định dạng bảng |
| `scripts/lib/compat-matrix.test.mjs` | Test cho trên |
| `scripts/compat-matrix.mjs` | CLI: dựng app thử cho từng ô, cài tarball, build, ghi kết quả |
| `docs/evidence/perf/2026-09-14-baseline-rn.md` | Baseline |

---

## Task 1: Ngưỡng kích thước cho hai gói còn thiếu

**Files:**
- Create: `packages/react/.size-limit.json`
- Create: `packages/react-native/.size-limit.json`
- Modify: `packages/react/package.json` (script `build`)
- Modify: `packages/react-native/package.json` (script `build`, `devDependencies`)

- [x] **Step 1: Đo kích thước hiện tại để đặt ngưỡng có căn cứ**

```bash
pnpm --filter @mapslibvn/react build && pnpm --filter @mapslibvn/react-native build
for f in packages/react/dist/index.js packages/react-native/dist/index.js packages/react-native/dist/expo/index.js; do
  printf '%s  raw=%s  gzip=%s\n' "$f" "$(wc -c < "$f")" "$(gzip -c "$f" | wc -c)"
done
```

Ghi lại ba số gzip. Ngưỡng đặt ở **số đo hiện tại làm tròn lên rồi cộng 15 %** — đủ chỗ cho
thay đổi bình thường, đủ chặt để bắt một lần phình bất ngờ.

- [x] **Step 2: Viết hai file ngưỡng**

`packages/react/.size-limit.json` (thay `<N>` bằng số ở bước 1):

```json
[
  { "path": "dist/index.js", "limit": "<N> kB", "gzip": true }
]
```

`packages/react-native/.size-limit.json`:

```json
[
  { "path": "dist/index.js", "limit": "<N> kB", "gzip": true },
  { "path": "dist/expo/index.js", "limit": "<N> kB", "gzip": true }
]
```

- [x] **Step 3: Nối size-limit vào build của hai gói**

Trong `packages/react/package.json`, đổi script `build` thành:

```json
"build": "tsup src/index.ts --format esm --dts --clean --target es2022 --external react --external maplibre-gl --external pmtiles && size-limit"
```

Trong `packages/react-native/package.json`, đổi script `build` thành:

```json
"build": "tsup && size-limit"
```

và thêm vào `devDependencies` của cả hai gói:

```json
"size-limit": "^11.1.0",
"@size-limit/file": "^11.1.0"
```

- [x] **Step 4: Cài và chạy**

```bash
pnpm install
pnpm --filter @mapslibvn/react build && pnpm --filter @mapslibvn/react-native build
```

Kỳ vọng: cả hai in bảng size-limit và **không** vượt ngưỡng.

- [x] **Step 5: Commit**

```bash
git add packages/react/.size-limit.json packages/react-native/.size-limit.json \
        packages/react/package.json packages/react-native/package.json pnpm-lock.yaml
git commit -m "build(sdk): gác kích thước cho @mapslibvn/react và react-native"
```

---

## Task 2: `scripts/lib/perf-size.mjs` — hàm thuần cho bảng kích thước

**Files:**
- Create: `scripts/lib/perf-size.mjs`
- Test: `scripts/lib/perf-size.test.mjs`

- [x] **Step 1: Viết test đang đỏ**

`scripts/lib/perf-size.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { formatKb, formatSizeTable } from './perf-size.mjs';

describe('formatKb', () => {
  it('làm tròn tới 0,1 kB và dùng dấu phẩy thập phân', () => {
    expect(formatKb(1536)).toBe('1,5 kB');
    expect(formatKb(0)).toBe('0,0 kB');
  });
});

describe('formatSizeTable', () => {
  it('dựng bảng Markdown theo thứ tự đưa vào', () => {
    const md = formatSizeTable([
      { name: 'dist/index.js', bytes: 2048, gzipBytes: 1024 },
      { name: 'dist/expo/index.js', bytes: 1024, gzipBytes: 512 },
    ]);
    expect(md.split('\n')[0]).toBe('| File | Thô | Gzip |');
    expect(md).toContain('| dist/index.js | 2,0 kB | 1,0 kB |');
    expect(md).toContain('| dist/expo/index.js | 1,0 kB | 0,5 kB |');
  });

  it('bảng rỗng vẫn có phần đầu', () => {
    expect(formatSizeTable([])).toBe('| File | Thô | Gzip |\n|---|---|---|');
  });
});
```

- [x] **Step 2: Chạy test để chắc chắn nó đỏ**

```bash
pnpm vitest run scripts/lib/perf-size.test.mjs
```

Kỳ vọng: FAIL, `Failed to load .../perf-size.mjs`.

- [x] **Step 3: Viết cài đặt tối thiểu**

`scripts/lib/perf-size.mjs`:

```js
// Hàm thuần cho `pnpm perf:size` (scripts/perf-size.mjs). Không đọc file, không spawn.

/**
 * kB một chữ số thập phân, dấu phẩy kiểu Việt.
 * @param {number} bytes
 */
export function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1).replace('.', ',')} kB`;
}

/**
 * @param {{ name: string, bytes: number, gzipBytes: number }[]} rows
 */
export function formatSizeTable(rows) {
  const head = '| File | Thô | Gzip |\n|---|---|---|';
  const body = rows.map((r) => `| ${r.name} | ${formatKb(r.bytes)} | ${formatKb(r.gzipBytes)} |`);
  return [head, ...body].join('\n');
}
```

- [x] **Step 4: Chạy test để chắc chắn nó xanh**

```bash
pnpm vitest run scripts/lib/perf-size.test.mjs
```

Kỳ vọng: PASS, 3 test.

> Hàm tính chênh lệch trước/sau **chưa viết ở đây** — mốc "trước" chỉ tồn tại ở giai đoạn 3, khi
> so từng món. Viết lúc cần, không viết trước.

- [x] **Step 5: Typecheck rồi commit**

```bash
pnpm typecheck
git add scripts/lib/perf-size.mjs scripts/lib/perf-size.test.mjs
git commit -m "feat(perf): hàm thuần dựng bảng kích thước cho perf:size"
```

---

## Task 3: `pnpm perf:size` — CLI

**Files:**
- Create: `scripts/perf-size.mjs`
- Modify: `package.json` (thêm script `perf:size`)

- [x] **Step 1: Viết CLI**

`scripts/perf-size.mjs`:

```js
#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';
import { formatSizeTable } from './lib/perf-size.mjs';

/** Các file SDK đo mỗi lần. Đường dẫn tương đối gốc repo. */
const TARGETS = [
  'packages/core/dist/index.js',
  'packages/web/dist/index.js',
  'packages/web/dist/mapslibvn.umd.js',
  'packages/web/dist/mapslibvn.css',
  'packages/react/dist/index.js',
  'packages/react-native/dist/index.js',
  'packages/react-native/dist/expo/index.js',
];

/** @param {string} path */
function measure(path) {
  const buf = readFileSync(path);
  return { name: path, bytes: statSync(path).size, gzipBytes: gzipSync(buf).length };
}

/**
 * Bundle Metro của app thử và APK Release nếu đã dựng. Cả hai đều tuỳ chọn: máy chưa dựng app
 * thì bỏ qua, không coi là lỗi — người chạy chỉ muốn xem kích thước SDK là chuyện thường.
 * @returns {{ name: string, bytes: number, gzipBytes: number }[]}
 */
function appArtifacts() {
  /** @type {{ name: string, bytes: number, gzipBytes: number }[]} */
  const rows = [];
  const bundle = 'work/perf/embed-rn.android.bundle';
  const apk = 'examples/embed-rn/android/app/build/outputs/apk/release/app-release.apk';
  for (const path of [bundle, apk]) {
    try {
      statSync(path);
      rows.push(measure(path));
    } catch {
      // chưa dựng — bỏ qua
    }
  }
  return rows;
}

function main() {
  const missing = TARGETS.filter((p) => {
    try {
      statSync(p);
      return false;
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    console.error(`Thiếu file dist — chạy \`pnpm build\` trước:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  console.log(formatSizeTable([...TARGETS.map(measure), ...appArtifacts()]));
}

main();
```

Bundle Metro không tự có — dựng bằng lệnh riêng trước khi chạy `perf:size`:

```bash
mkdir -p work/perf
cd examples/embed-rn && npx expo export:embed \
  --platform android --dev false --reset-cache \
  --entry-file index.ts \
  --bundle-output ../../work/perf/embed-rn.android.bundle; cd ../..
```

- [x] **Step 2: Nối vào `package.json`**

Thêm vào `scripts` (giữ nguyên thứ tự các dòng khác, đặt cạnh `load:api`):

```json
"perf:size": "node scripts/perf-size.mjs",
```

- [x] **Step 3: Chạy thật**

```bash
pnpm build && pnpm perf:size
```

Kỳ vọng: bảng Markdown 7 dòng (9 nếu đã dựng bundle Metro và APK Release), mỗi dòng có kích
thước thô và gzip.

- [x] **Step 4: Kiểm tra nhánh lỗi**

```bash
mv packages/react/dist/index.js /tmp/index.js.bak && pnpm perf:size; echo "exit=$?"
mv /tmp/index.js.bak packages/react/dist/index.js
```

Kỳ vọng: in "Thiếu file dist — chạy `pnpm build` trước" và `exit=1`.

- [x] **Step 5: Typecheck rồi commit**

```bash
pnpm typecheck
git add scripts/perf-size.mjs package.json
git commit -m "feat(perf): pnpm perf:size in bảng kích thước toàn bộ SDK"
```

---

## Task 4: Màn hình đo trong app thử RN

**Files:**
- Create: `examples/embed-rn/perf-screen.tsx`
- Modify: `examples/embed-rn/App.tsx` (rẽ nhánh theo biến môi trường)

Màn hình này in các dòng log có tiền tố `MLVPERF ` kèm JSON để `scripts/perf-rn.mjs` đọc lại
từ `adb logcat`. Nó **không** thay màn hình demo: chỉ hiện khi
`EXPO_PUBLIC_MLV_PERF=1`.

- [x] **Step 1: Viết màn hình đo**

`examples/embed-rn/perf-screen.tsx`:

```tsx
import {
  type DirectionsResponse,
  type MapHandle,
  MapsLibVNMap,
  type NavigationSession,
  createClient,
  createNavigationSession,
  playbackSource,
  simulateFixes,
} from '@mapslibvn/react-native';
import { Profiler, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

const API_KEY = process.env.EXPO_PUBLIC_MAPSLIBVN_KEY ?? '';
const API_BASE = process.env.EXPO_PUBLIC_MAPSLIBVN_API ?? 'https://api.ai-solutions.io.vn';

/** Tiền tố để scripts/perf-rn.mjs lọc ra khỏi logcat. Đổi ở đây thì đổi cả PERF_PREFIX bên script. */
const PREFIX = 'MLVPERF ';

/** Hai điểm cố định ở Quận 1 — `client.directions` nhận [lat, lng], không phải [lng, lat]. */
const FROM: [number, number] = [10.7798, 106.699];
const TO: [number, number] = [10.7725, 106.6981];

/** Chờ bấy nhiêu mili giây sau khi map sẵn sàng rồi mới vào pha dẫn đường — xem chú thích ở pha 2. */
const NAV_DELAY_MS = 8000;

const client = createClient({ apiKey: API_KEY, baseUrl: API_BASE });

/** In một dòng JSON để script parse lại. */
function emit(payload: Record<string, unknown>): void {
  console.log(PREFIX + JSON.stringify(payload));
}

/**
 * Màn hình đo hai pha:
 * 1. dựng map, đo mốc tới khi style tải xong;
 * 2. chạy một phiên dẫn đường giả lập và đếm số commit React của cây map trên mỗi fix GPS.
 * Không có nút bấm — kịch bản cử chỉ do adb bắn vào từ ngoài.
 */
export function PerfScreen() {
  // Mốc gốc: thời điểm mount, lấy một lần và không đổi giữa các lần render.
  const mountedAt = useRef(Date.now()).current;
  const commits = useRef(0);
  // Số commit ngay trước khi vào pha 2, để tách commit lúc dựng map ra khỏi commit lúc dẫn đường.
  const commitsAtNavStart = useRef<number | null>(null);
  const fixes = useRef(0);
  const [session, setSession] = useState<NavigationSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let started: NavigationSession | null = null;
    // Trì hoãn pha 2: scripts/perf-rn.mjs mở rồi tắt app mười lượt để lấy p50/p95 thời gian mở
    // màn hình, mỗi lượt ngắn hơn NAV_DELAY_MS nên không lượt nào chạy nhầm vào pha dẫn đường.
    // Lượt cuối script để app sống, bắn cử chỉ đo frame giật, rồi mới tới lượt pha 2 chạy.
    const timer = setTimeout(() => {
      void run();
    }, NAV_DELAY_MS);

    async function run() {
      if (cancelled) return;
      try {
        const response: DirectionsResponse = await client.directions({
          from: FROM,
          to: TO,
          mode: 'motorbike',
        });
        const route = response.routes[0];
        if (!route || cancelled) return;
        const s = createNavigationSession({
          provider: client,
          // rate 4: chạy nhanh gấp bốn để một lượt đo không mất vài phút.
          source: playbackSource(simulateFixes(route, { jitter_m: 4 }), { rate: 4 }),
        });
        started = s;
        s.on('progress', () => {
          fixes.current += 1;
        });
        s.on('arrive', () => {
          emit({
            kind: 'nav_done',
            fixes: fixes.current,
            commits: commits.current - (commitsAtNavStart.current ?? 0),
          });
        });
        commitsAtNavStart.current = commits.current;
        emit({ kind: 'nav_start' });
        setSession(s);
        await s.start({ response, routeIndex: 0, lang: 'vi' });
      } catch (e) {
        emit({ kind: 'error', message: e instanceof Error ? e.message : 'không rõ' });
      }
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
      void started?.stop();
    };
  }, [ready]);

  return (
    <View style={styles.container}>
      <Profiler
        id="map"
        onRender={(_id, phase, actualDuration) => {
          commits.current += 1;
          emit({ kind: 'commit', n: commits.current, phase, ms: Math.round(actualDuration) });
        }}
      >
        <MapsLibVNMap
          apiKey={API_KEY}
          apiBase={API_BASE}
          center={[106.699, 10.7798]}
          zoom={14}
          {...(session ? { navigation: session } : {})}
          onLoad={(_map: MapHandle) => {
            setReady(true);
            emit({ kind: 'map_ready', ms: Date.now() - mountedAt });
          }}
          onError={(e: Error) => emit({ kind: 'error', message: e.message })}
          testID="perf-map"
        />
      </Profiler>
      <Text style={styles.badge}>{ready ? 'ĐO: map sẵn sàng' : 'ĐO: đang tải'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  badge: {
    position: 'absolute',
    top: 48,
    left: 12,
    backgroundColor: '#000000aa',
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
  },
});
```

- [x] **Step 2: Rẽ nhánh trong `App.tsx`**

Thêm import cạnh các import cục bộ sẵn có (`import { MODES, NavigationPanel } from './navigation-ui';`):

```tsx
import { PerfScreen } from './perf-screen';
```

Ngay sau dòng `export default function App() {` (dòng 113), chèn:

```tsx
  // Chế độ đo (scripts/perf-rn.mjs) — hoàn toàn tách khỏi màn hình demo.
  if (process.env.EXPO_PUBLIC_MLV_PERF === '1') return <PerfScreen />;
```

Đặt **trước** mọi lời gọi hook khác trong `App` là sai luật hook. Vì `App` đã có `useState`
ngay đầu thân hàm, hãy chèn dòng `if` này **trước dòng `const [theme, setTheme] = ...`** và
chấp nhận rằng `PerfScreen` là một cây khác hẳn — React unmount toàn bộ `App` cũ. Biến môi
trường đọc lúc bundle nên giá trị cố định suốt phiên chạy, không có chuyện đổi giữa chừng làm
số hook lệch nhau.

- [x] **Step 3: Kiểm tra typecheck của app thử**

```bash
cd examples/embed-rn && npx tsc --noEmit; cd ../..
```

Kỳ vọng: không lỗi.

- [x] **Step 4: Chạy thử trên emulator ở chế độ đo**

```bash
EXPO_PUBLIC_MLV_PERF=1 pnpm example:rn --android
```

Kỳ vọng: app mở ra hiện bản đồ kèm nhãn "ĐO: map sẵn sàng". Kiểm tra log:

```bash
adb logcat -d | grep MLVPERF | head
```

Kỳ vọng: thấy dòng `MLVPERF {"kind":"map_ready","ms":...}`, rồi sau vài chục giây thấy
`MLVPERF {"kind":"nav_done","fixes":...,"commits":...}` khi phiên giả lập chạy tới nơi.

- [x] **Step 5: Commit**

```bash
git add examples/embed-rn/perf-screen.tsx examples/embed-rn/App.tsx
git commit -m "feat(examples/embed-rn): màn hình đo bật bằng EXPO_PUBLIC_MLV_PERF"
```

---

## Task 5: `scripts/lib/perf-rn.mjs` — hàm thuần

**Files:**
- Create: `scripts/lib/perf-rn.mjs`
- Test: `scripts/lib/perf-rn.test.mjs`

- [x] **Step 1: Viết test đang đỏ**

`scripts/lib/perf-rn.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import {
  PERF_PREFIX,
  formatEvidence,
  gestureCommands,
  navCommitsPerFix,
  parseGfxinfo,
  parsePerfLines,
  summarize,
} from './perf-rn.mjs';

describe('parsePerfLines', () => {
  it('lấy JSON sau tiền tố, kể cả khi logcat thêm phần đầu dòng', () => {
    const text = [
      '09-14 08:00:00.000  1234  1234 I ReactNativeJS: MLVPERF {"kind":"map_ready","ms":812}',
      '09-14 08:00:00.100  1234  1234 I ReactNativeJS: MLVPERF {"kind":"commit","n":1}',
      'dòng không liên quan',
    ].join('\n');
    expect(parsePerfLines(text)).toEqual([
      { kind: 'map_ready', ms: 812 },
      { kind: 'commit', n: 1 },
    ]);
  });

  it('bỏ qua dòng JSON hỏng thay vì ném lỗi', () => {
    expect(parsePerfLines(`${PERF_PREFIX}{không phải json}`)).toEqual([]);
  });

  it('văn bản rỗng trả mảng rỗng', () => {
    expect(parsePerfLines('')).toEqual([]);
  });
});

describe('summarize', () => {
  it('tính p50 và p95 theo thứ tự đã sắp', () => {
    expect(summarize([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toEqual({
      n: 10,
      p50: 50,
      p95: 100,
    });
  });

  it('một mẫu thì p50 = p95 = chính nó', () => {
    expect(summarize([42])).toEqual({ n: 1, p50: 42, p95: 42 });
  });

  it('không có mẫu nào trả n = 0 và null', () => {
    expect(summarize([])).toEqual({ n: 0, p50: null, p95: null });
  });
});

describe('parseGfxinfo', () => {
  it('đọc tổng số frame và số frame giật', () => {
    const text = [
      'Graphics info for pid 1234 [vn.mapslibvn.demo]',
      '',
      'Total frames rendered: 480',
      'Janky frames: 24 (5.00%)',
      '50th percentile: 8ms',
    ].join('\n');
    expect(parseGfxinfo(text)).toEqual({ total: 480, janky: 24, jankyPct: 5 });
  });

  it('trả null khi không có khối số liệu', () => {
    expect(parseGfxinfo('Graphics info for pid 1234')).toBeNull();
  });
});

describe('gestureCommands', () => {
  it('kịch bản kéo và zoom bám theo kích thước màn hình', () => {
    const cmds = gestureCommands(1080, 2400);
    expect(cmds.length).toBeGreaterThanOrEqual(4);
    for (const c of cmds) expect(c[0]).toBe('shell');
    // Mọi toạ độ nằm trong màn hình.
    for (const c of cmds) {
      for (const n of c.slice(3).map(Number).filter(Number.isFinite)) {
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('navCommitsPerFix', () => {
  it('chia số commit cho số fix của pha dẫn đường', () => {
    expect(
      navCommitsPerFix([
        { kind: 'commit', n: 1 },
        { kind: 'nav_start' },
        { kind: 'nav_done', fixes: 40, commits: 80 },
      ]),
    ).toBe(2);
  });

  it('làm tròn tới hai chữ số thập phân', () => {
    expect(navCommitsPerFix([{ kind: 'nav_done', fixes: 3, commits: 5 }])).toBe(1.67);
  });

  it('không có nav_done thì trả null', () => {
    expect(navCommitsPerFix([{ kind: 'map_ready', ms: 800 }])).toBeNull();
  });

  it('không chia cho 0 fix', () => {
    expect(navCommitsPerFix([{ kind: 'nav_done', fixes: 0, commits: 9 }])).toBeNull();
  });
});

describe('formatEvidence', () => {
  it('ghi rõ nơi đo và đánh dấu phần chờ máy thật', () => {
    const md = formatEvidence({
      device: 'emulator-5554 · Pixel 7 · Android 14',
      build: 'Release',
      mapReady: { n: 10, p50: 812, p95: 940 },
      gfx: { total: 480, janky: 24, jankyPct: 5 },
      commitsPerFix: 2,
    });
    expect(md).toContain('emulator-5554 · Pixel 7 · Android 14');
    expect(md).toContain('Release');
    expect(md).toContain('812');
    expect(md).toContain('5');
    expect(md).toContain('CHỜ PHONG');
  });

  it('thiếu số liệu gfx thì ghi dấu gạch, không ghi 0', () => {
    const md = formatEvidence({
      device: 'emulator-5554',
      build: 'Debug',
      mapReady: { n: 0, p50: null, p95: null },
      gfx: null,
      commitsPerFix: null,
    });
    expect(md).toContain('—');
    expect(md).not.toContain('null');
  });
});
```

- [x] **Step 2: Chạy test để chắc chắn nó đỏ**

```bash
pnpm vitest run scripts/lib/perf-rn.test.mjs
```

Kỳ vọng: FAIL, không nạp được module.

- [x] **Step 3: Viết cài đặt**

`scripts/lib/perf-rn.mjs`:

```js
// Hàm thuần cho `pnpm perf:rn` (scripts/perf-rn.mjs). Không spawn, không đọc file.

/** Phải khớp PREFIX trong examples/embed-rn/perf-screen.tsx. */
export const PERF_PREFIX = 'MLVPERF ';

/**
 * Lọc các dòng có tiền tố và parse phần JSON đứng sau. Dòng hỏng bị bỏ, không ném lỗi —
 * logcat cắt dòng dài là chuyện thường.
 * @param {string} text
 * @returns {Record<string, unknown>[]}
 */
export function parsePerfLines(text) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(PERF_PREFIX);
    if (at === -1) continue;
    try {
      out.push(JSON.parse(line.slice(at + PERF_PREFIX.length)));
    } catch {
      // bỏ qua
    }
  }
  return out;
}

/**
 * p50/p95 theo cách `perf-autocomplete.mjs` đang dùng: sắp tăng dần rồi lấy phần tử theo chỉ số.
 * @param {number[]} values
 * @returns {{ n: number, p50: number | null, p95: number | null }}
 */
export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, p50: null, p95: null };
  /** @param {number} p */
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return { n: sorted.length, p50: pct(50) ?? null, p95: pct(95) ?? null };
}

/**
 * Đọc `adb shell dumpsys gfxinfo <pkg>`. Hai dòng cần là "Total frames rendered" và "Janky frames".
 * @param {string} text
 * @returns {{ total: number, janky: number, jankyPct: number } | null}
 */
export function parseGfxinfo(text) {
  const total = text.match(/Total frames rendered:\s*(\d+)/);
  const janky = text.match(/Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/);
  if (!total || !janky) return null;
  return {
    total: Number(total[1]),
    janky: Number(janky[1]),
    jankyPct: Number(janky[2]),
  };
}

/**
 * Kịch bản cử chỉ cố định: hai lần kéo ngang, hai lần kéo dọc, mỗi lần 400 ms. `adb shell input`
 * chỉ mô phỏng một ngón nên KHÔNG chụm zoom được — đây là phép đo kéo bản đồ thuần, không có zoom.
 * Toạ độ suy từ kích thước màn hình để chạy được trên mọi thiết bị.
 * @param {number} width
 * @param {number} height
 * @returns {string[][]} mỗi phần tử là argv cho `adb`
 */
export function gestureCommands(width, height) {
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const dx = Math.round(width / 4);
  const dy = Math.round(height / 6);
  const swipe = (/** @type {number[]} */ a) => ['shell', 'input', 'swipe', ...a.map(String)];
  return [
    swipe([cx + dx, cy, cx - dx, cy, 400]),
    swipe([cx - dx, cy, cx + dx, cy, 400]),
    swipe([cx, cy + dy, cx, cy - dy, 400]),
    swipe([cx, cy - dy, cx, cy + dy, 400]),
  ];
}

/**
 * Số commit React của cây map trên mỗi fix GPS, đọc từ sự kiện `nav_done` mà perf-screen phát ra
 * lúc phiên giả lập tới nơi (hoặc dừng sớm). null khi: không có `nav_done`; 0 fix; hoặc
 * `profiler === false` — bản Release, nơi `Profiler.onRender` của React không chạy (chuỗi
 * "onRender" không tồn tại trong bundle `ReactFabric-prod.js`), nên `commits` luôn là 0 vô nghĩa.
 * Thiếu hẳn trường `profiler` (log cũ) được coi như `true`.
 * @param {Record<string, unknown>[]} events
 * @returns {number | null}
 */
export function navCommitsPerFix(events) {
  const done = events.find((e) => e.kind === 'nav_done');
  if (!done) return null;
  if (done.profiler === false) return null;
  const { fixes, commits } = done;
  if (typeof fixes !== 'number' || typeof commits !== 'number' || fixes === 0) return null;
  return Math.round((commits / fixes) * 100) / 100;
}

/**
 * true nếu có bất kỳ sự kiện `error` nào (khoá API hết hạn, mất mạng…) — để CLI báo lỗi rõ ràng
 * thay vì để evidence hiện dấu gạch giống hệt "chưa đo được".
 * @param {Record<string, unknown>[]} events
 * @returns {boolean}
 */
export function hasErrorEvent(events) {
  return events.some((e) => e.kind === 'error');
}

/** @param {number | null} n @param {string} [unit] */
const num = (n, unit = '') => (n === null ? '—' : `${n}${unit}`);

/**
 * Bảng evidence. Phần iOS và phần máy thật luôn có mặt, đánh dấu CHỜ PHONG — không bịa số.
 * @param {{
 *   device: string,
 *   build: string,
 *   mapReady: { n: number, p50: number | null, p95: number | null },
 *   gfx: { total: number, janky: number, jankyPct: number } | null,
 *   commitsPerFix: number | null,
 * }} r
 */
export function formatEvidence(r) {
  return [
    `**Nơi đo:** ${r.device} · bản dựng ${r.build}`,
    '',
    '| Số đo | Giá trị |',
    '|---|---|',
    `| Thời gian mở màn hình bản đồ (p50) | ${num(r.mapReady.p50, ' ms')} |`,
    `| Thời gian mở màn hình bản đồ (p95) | ${num(r.mapReady.p95, ' ms')} |`,
    `| Số lần đo | ${r.mapReady.n} |`,
    `| Tổng frame khi kéo bản đồ | ${r.gfx ? r.gfx.total : '—'} |`,
    `| Frame giật | ${r.gfx ? `${r.gfx.janky} (${r.gfx.jankyPct} %)` : '—'} |`,
    `| Commit React mỗi fix GPS | ${num(r.commitsPerFix)} |`,
    '',
    '| Hạng mục cần máy thật | Trạng thái |',
    '|---|---|',
    '| FPS Android trên Mi 9 (Release) | CHỜ PHONG |',
    '| Quan sát iOS trên iPhone 14 Plus (Release) | CHỜ PHONG |',
  ].join('\n');
}
```

- [x] **Step 4: Chạy test để chắc chắn nó xanh**

```bash
pnpm vitest run scripts/lib/perf-rn.test.mjs
```

Kỳ vọng: PASS. Đếm số test bằng output vitest thật — đừng tin một con số cố định ghi sẵn trong
plan (bài học từ chính plan này: số ghi ở đây từng sai 2 lần vì nội dung test đổi sau khi viết
số).

- [x] **Step 5: Typecheck rồi commit**

```bash
pnpm typecheck
git add scripts/lib/perf-rn.mjs scripts/lib/perf-rn.test.mjs
git commit -m "feat(perf): hàm thuần parse log và gfxinfo cho perf:rn"
```

---

## Task 6: `pnpm perf:rn` — CLI lái thiết bị Android

**Files:**
- Create: `scripts/perf-rn.mjs`
- Modify: `package.json` (thêm script `perf:rn`)

Phạm vi CLI: **Android**. iOS không có công cụ tương đương `gfxinfo`, nên script từ chối thẳng
`--ios` kèm lời nhắc đo tay, đúng như spec mục 3.1.

- [x] **Step 1: Viết CLI**

`scripts/perf-rn.mjs`:

> **Cập nhật sau review Task 5:** bản dưới đây đã khác bản đầu tiên của plan — có dùng
> `hasErrorEvent` (Task 5) để thoát sớm khi gặp lỗi thật (khoá API hết hạn, mất mạng…) thay vì
> chờ hết hạn mức rồi âm thầm in dấu gạch. Không có bước này, một khoá chết sẽ làm cả 10 lượt chờ
> đủ 30 giây (5 phút) rồi mới báo — đúng kiểu lỗi từng xảy ra thật với dự án (khoá `KEY_EXAMPLE_RN`
> từng bị thu hồi).

```js
#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { BUNDLE_ID } from './lib/example-rn.mjs';
import {
  formatEvidence,
  gestureCommands,
  hasErrorEvent,
  navCommitsPerFix,
  parseGfxinfo,
  parsePerfLines,
  summarize,
} from './lib/perf-rn.mjs';
import { capture, run, sleep } from './lib/run.mjs';

const ROUNDS = 10;

/** Kích thước màn hình từ `adb shell wm size` (ví dụ "Physical size: 1080x2400"). */
function screenSize() {
  const m = capture('adb', ['shell', 'wm', 'size']).match(/(\d+)x(\d+)/);
  if (!m) throw new Error('Không đọc được kích thước màn hình từ `adb shell wm size`');
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Nhãn thiết bị để ghi vào evidence — không có thì evidence vô nghĩa. */
function deviceLabel() {
  const serial = capture('adb', ['get-serialno']);
  const model = capture('adb', ['shell', 'getprop', 'ro.product.model']);
  const release = capture('adb', ['shell', 'getprop', 'ro.build.version.release']);
  return `${serial} · ${model} · Android ${release}`;
}

/** @param {Record<string, unknown>[]} events */
function errorMessage(events) {
  const err = events.find((e) => e.kind === 'error');
  return typeof err?.message === 'string' ? err.message : '(không rõ)';
}

/** Mở lại app từ đầu và đợi dòng map_ready, trả số ms; null nếu quá hạn HOẶC có lỗi thật. */
async function oneRound() {
  run('adb', ['shell', 'am', 'force-stop', BUNDLE_ID]);
  run('adb', ['logcat', '-c']);
  run('adb', ['shell', 'monkey', '-p', BUNDLE_ID, '-c', 'android.intent.category.LAUNCHER', '1'], {
    stdio: 'ignore',
  });
  for (let waited = 0; waited < 30_000; waited += 500) {
    await sleep(500);
    const events = parsePerfLines(capture('adb', ['logcat', '-d']));
    // Thoát sớm khi lỗi thật (khoá/mạng…) — đừng chờ hết 30s rồi mới báo, và đừng lẫn với
    // "chưa đo được" (timeout bình thường).
    if (hasErrorEvent(events)) {
      console.error(`  lỗi: ${errorMessage(events)}`);
      return null;
    }
    const ready = events.find((e) => e.kind === 'map_ready');
    if (ready && typeof ready.ms === 'number') return ready.ms;
  }
  return null;
}

async function main() {
  if (process.argv.includes('--ios')) {
    console.error(
      'iOS không có công cụ tương đương `dumpsys gfxinfo`.\n' +
        'Đo iOS bằng quan sát trên máy thật (bản Release) và ghi tay vào evidence.',
    );
    process.exit(2);
  }
  if (capture('adb', ['get-state']) !== 'device') {
    console.error('Không thấy thiết bị Android. Mở emulator hoặc cắm máy rồi chạy lại.');
    process.exit(1);
  }

  const device = deviceLabel();
  console.log(`Đo trên ${device}`);

  /** @type {number[]} */
  const readyMs = [];
  for (let i = 0; i < ROUNDS; i++) {
    const ms = await oneRound();
    if (ms !== null) readyMs.push(ms);
    console.log(`  lượt ${i + 1}/${ROUNDS}: ${ms === null ? 'quá hạn/lỗi (xem ở trên)' : `${ms} ms`}`);
  }

  // Lượt cuối để app sống. Bắn cử chỉ NGAY, trong khoảng NAV_DELAY_MS của perf-screen, để số
  // frame giật phản ánh kéo bản đồ thuần chứ không lẫn với camera tự bám lúc dẫn đường.
  run('adb', ['shell', 'dumpsys', 'gfxinfo', BUNDLE_ID, 'reset'], { stdio: 'ignore' });
  const { width, height } = screenSize();
  for (const args of gestureCommands(width, height)) {
    run('adb', args, { stdio: 'ignore' });
    await sleep(300);
  }
  const gfxRaw = capture('adb', ['shell', 'dumpsys', 'gfxinfo', BUNDLE_ID]);
  const gfx = parseGfxinfo(gfxRaw);
  // null có 2 nghĩa: không có output (app không chạy — đã biết) hoặc có output nhưng parse thất
  // bại (định dạng Android đã đổi). Phân biệt ở đây vì đây là chỗ duy nhất có cả 2 mảnh thông tin.
  if (gfx === null && gfxRaw.trim()) {
    console.warn('  cảnh báo: gfxinfo có output nhưng không parse được — định dạng Android đổi?');
  }

  // Rồi mới tới pha dẫn đường giả lập của lượt cuối; chờ tối đa 3 phút cho nó tới nơi, nhưng
  // thoát ngay nếu thấy lỗi thật — không chờ hết hạn mức cho một khoá đã chết.
  console.log('Chờ pha dẫn đường giả lập…');
  /** @type {number | null} */
  let commitsPerFix = null;
  let navFailed = false;
  for (let waited = 0; waited < 180_000; waited += 2000) {
    await sleep(2000);
    const events = parsePerfLines(capture('adb', ['logcat', '-d']));
    if (hasErrorEvent(events)) {
      console.log(`  lỗi trong pha dẫn đường: ${errorMessage(events)} — dừng sớm`);
      navFailed = true;
      break;
    }
    commitsPerFix = navCommitsPerFix(events);
    if (commitsPerFix !== null) break;
  }
  if (commitsPerFix === null && !navFailed) console.log('  không thấy nav_done — ô này ghi dấu gạch');

  const md = formatEvidence({
    device,
    build: process.argv.includes('--release') ? 'Release' : 'Debug',
    mapReady: summarize(readyMs),
    gfx,
    commitsPerFix,
  });
  console.log(`\n${md}`);

  if (process.argv.includes('--write')) {
    mkdirSync('docs/evidence/perf', { recursive: true });
    const path = 'docs/evidence/perf/2026-09-14-baseline-rn.md';
    writeFileSync(path, `# Baseline hiệu năng RN — 14/09/2026\n\n${md}\n`, 'utf8');
    console.log(`\nĐã ghi ${path}`);
  }
}

await main();
```

- [x] **Step 2: Nối vào `package.json`**

```json
"perf:rn": "node scripts/perf-rn.mjs",
```

- [x] **Step 3: Kiểm tra nhánh từ chối iOS**

```bash
pnpm perf:rn --ios; echo "exit=$?"
```

Kỳ vọng: in lời nhắc đo tay và `exit=2`.

- [x] **Step 4: Chạy thật trên emulator**

Cài app ở chế độ đo trước (Task 4 bước 4 đã cài), rồi:

```bash
pnpm perf:rn
```

Kỳ vọng: in 10 dòng "lượt i/10: N ms", rồi phần cử chỉ, rồi "Chờ pha dẫn đường giả lập…"
(tới vài phút), cuối cùng là bảng evidence có số thật ở các hàng thời gian, frame và commit.
Nếu **mọi lượt đều quá hạn**, kiểm tra lại app đang chạy đúng bản có `EXPO_PUBLIC_MLV_PERF=1`
bằng `adb logcat -d | grep MLVPERF`.

- [x] **Step 5: Typecheck rồi commit**

```bash
pnpm typecheck
git add scripts/perf-rn.mjs package.json
git commit -m "feat(perf): pnpm perf:rn đo thời gian mở map và frame giật trên Android"
```

---

## Task 7: `scripts/lib/compat-matrix.mjs` — hàm thuần

**Files:**
- Create: `scripts/lib/compat-matrix.mjs`
- Test: `scripts/lib/compat-matrix.test.mjs`

- [x] **Step 1: Viết test đang đỏ**

`scripts/lib/compat-matrix.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import {
  RN_MATRIX,
  appPackageJson,
  classifyFailure,
  comboId,
  formatMatrixTable,
} from './compat-matrix.mjs';

describe('RN_MATRIX', () => {
  it('có ô React 18 và ô RN 0.79 — hai ô C1 cần trả lời', () => {
    expect(RN_MATRIX.some((c) => c.react.startsWith('18.'))).toBe(true);
    expect(RN_MATRIX.some((c) => c.reactNative.startsWith('0.79'))).toBe(true);
  });

  it('mỗi ô có đủ bốn trường', () => {
    for (const c of RN_MATRIX) {
      expect(typeof c.react).toBe('string');
      expect(typeof c.reactNative).toBe('string');
      expect(typeof c.expo).toBe('string');
      expect(typeof c.newArch).toBe('boolean');
    }
  });
});

describe('comboId', () => {
  it('id ổn định, dùng được làm tên thư mục', () => {
    const id = comboId({ react: '18.3.1', reactNative: '0.79.0', expo: '53.0.0', newArch: false });
    expect(id).toBe('react18.3.1-rn0.79.0-expo53.0.0-oldarch');
    expect(id).not.toMatch(/[^a-z0-9.-]/);
  });

  it('phân biệt kiến trúc mới và cũ', () => {
    const on = comboId({ react: '19.2.3', reactNative: '0.86.3', expo: '57.0.0', newArch: true });
    expect(on.endsWith('-newarch')).toBe(true);
  });
});

describe('appPackageJson', () => {
  it('ghim đúng phiên bản của ô và trỏ SDK vào tarball', () => {
    const pkg = appPackageJson(
      { react: '18.3.1', reactNative: '0.79.0', expo: '53.0.0', newArch: false },
      'vendor/mapslibvn-react-native.tgz',
    );
    expect(pkg.dependencies.react).toBe('18.3.1');
    expect(pkg.dependencies['react-native']).toBe('0.79.0');
    expect(pkg.dependencies.expo).toBe('53.0.0');
    expect(pkg.dependencies['@mapslibvn/react-native']).toBe(
      'file:vendor/mapslibvn-react-native.tgz',
    );
    expect(pkg.private).toBe(true);
  });
});

describe('classifyFailure', () => {
  it('nhận ra xung đột peer dependency', () => {
    expect(classifyFailure('npm error ERESOLVE unable to resolve dependency tree')).toBe('peer');
  });

  it('nhận ra lỗi Metro', () => {
    expect(classifyFailure('error: Unable to resolve module ./foo from bar')).toBe('metro');
  });

  it('nhận ra lỗi build native', () => {
    expect(classifyFailure('FAILURE: Build failed with an exception.')).toBe('build');
  });

  it('không khớp gì thì trả khác', () => {
    expect(classifyFailure('cái gì đó lạ')).toBe('khác');
  });
});

describe('formatMatrixTable', () => {
  it('đánh dấu ĐẠT và HỎNG kèm loại lỗi', () => {
    const md = formatMatrixTable([
      {
        combo: { react: '19.2.3', reactNative: '0.86.3', expo: '57.0.0', newArch: true },
        ok: true,
        failure: null,
      },
      {
        combo: { react: '18.3.1', reactNative: '0.79.0', expo: '53.0.0', newArch: false },
        ok: false,
        failure: 'peer',
      },
    ]);
    expect(md).toContain('ĐẠT');
    expect(md).toContain('HỎNG');
    expect(md).toContain('peer');
  });
});
```

- [x] **Step 2: Chạy test để chắc chắn nó đỏ**

```bash
pnpm vitest run scripts/lib/compat-matrix.test.mjs
```

Kỳ vọng: FAIL, không nạp được module.

- [x] **Step 3: Viết cài đặt**

`scripts/lib/compat-matrix.mjs`:

```js
// Hàm thuần cho `pnpm compat:matrix` (scripts/compat-matrix.mjs). Không spawn, không đọc file.

/**
 * @typedef {{ react: string, reactNative: string, expo: string, newArch: boolean }} Combo
 */

/**
 * Các ô có ý nghĩa thương mại, không phải tích Descartes đầy đủ:
 * - ô hiện tại của app thử (mốc so sánh)
 * - ô thấp nhất mà `@maplibre/maplibre-react-native@11` khai báo chịu được
 * - ô React 18 và ô RN 0.79: hai câu hỏi mà món C1 cần trả lời
 * - kiến trúc mới bật và tắt trên ô hiện tại
 * @type {Combo[]}
 */
export const RN_MATRIX = [
  { react: '19.2.3', reactNative: '0.86.3', expo: '57.0.0', newArch: true },
  { react: '19.2.3', reactNative: '0.86.3', expo: '57.0.0', newArch: false },
  { react: '19.1.0', reactNative: '0.80.0', expo: '54.0.0', newArch: true },
  { react: '19.1.0', reactNative: '0.79.0', expo: '53.0.0', newArch: true },
  { react: '18.3.1', reactNative: '0.79.0', expo: '53.0.0', newArch: false },
];

/**
 * Id ổn định, chỉ chữ thường/số/dấu chấm/gạch — dùng làm tên thư mục app thử.
 * @param {Combo} c
 */
export function comboId(c) {
  return `react${c.react}-rn${c.reactNative}-expo${c.expo}-${c.newArch ? 'newarch' : 'oldarch'}`;
}

/**
 * `package.json` cho app thử của một ô. Ghim chính xác (không `^`, không `~`) để ô đo đúng
 * phiên bản mình khai báo.
 * @param {Combo} c
 * @param {string} tarballPath đường dẫn tarball tương đối thư mục app
 */
export function appPackageJson(c, tarballPath) {
  return {
    name: `compat-${comboId(c)}`,
    version: '1.0.0',
    main: 'index.ts',
    private: true,
    dependencies: {
      '@maplibre/maplibre-react-native': '11.3.8',
      '@mapslibvn/react-native': `file:${tarballPath}`,
      expo: c.expo,
      react: c.react,
      'react-native': c.reactNative,
    },
  };
}

/**
 * Phân loại lỗi để bảng đọc được mà không phải mở log.
 * @param {string} output stdout + stderr gộp
 * @returns {'peer' | 'metro' | 'build' | 'khác'}
 */
export function classifyFailure(output) {
  if (/ERESOLVE|peer dep/i.test(output)) return 'peer';
  if (/BUILD FAILED|Build failed|CompileError|ld: error/i.test(output)) return 'build';
  if (/Unable to resolve module|Metro/i.test(output)) return 'metro';
  return 'khác';
}

/**
 * @param {{ combo: Combo, ok: boolean, failure: string | null }[]} results
 */
export function formatMatrixTable(results) {
  const head = '| React | React Native | Expo | Kiến trúc | Kết quả |\n|---|---|---|---|---|';
  const rows = results.map((r) => {
    const arch = r.combo.newArch ? 'mới' : 'cũ';
    const verdict = r.ok ? 'ĐẠT' : `HỎNG (${r.failure ?? 'khác'})`;
    return `| ${r.combo.react} | ${r.combo.reactNative} | ${r.combo.expo} | ${arch} | ${verdict} |`;
  });
  return [head, ...rows].join('\n');
}
```

- [x] **Step 4: Chạy test để chắc chắn nó xanh**

```bash
pnpm vitest run scripts/lib/compat-matrix.test.mjs
```

Kỳ vọng: PASS. Đếm số test bằng output vitest thật — đừng dùng số cố định.

- [x] **Step 5: Typecheck rồi commit**

```bash
pnpm typecheck
git add scripts/lib/compat-matrix.mjs scripts/lib/compat-matrix.test.mjs
git commit -m "feat(compat): ma trận tổ hợp RN và phân loại lỗi dạng hàm thuần"
```

---

## Task 8: `pnpm compat:matrix` — CLI dựng app thử từng ô

**Files:**
- Create: `scripts/compat-matrix.mjs`
- Modify: `package.json` (thêm script `compat:matrix`)

Mặc định chỉ chạy tới bước **cài dependency** (nhanh, trả lời được câu hỏi peer deps của C1).
Cờ `--build` mới dựng Android Release — đắt, chỉ chạy cho ô đầu và ô cuối.

> **Cập nhật sau review Task 7:** bản dưới đây khác bản đầu tiên của plan — thêm `--legacy-peer-deps`
> vào `npm install` (đúng spec mục 4b đã chỉ định nhưng bản đầu tiên của plan bỏ sót) và in ra vài
> dòng cuối của output khi một ô hỏng. Không có `--legacy-peer-deps`: `@maplibre/maplibre-react-native@11.3.8`
> tự khai báo `react>=19.1.0 / react-native>=0.80.0 / expo>=54.0.0` — CẢ HAI ô C1 cần trả lời
> (React 18, RN 0.79) đều nằm dưới sàn đó, nên `npm install` trơn sẽ luôn báo `HỎNG (peer)` ngay
> từ cổng cài đặt, không bao giờ trả lời được câu hỏi thật (mã nguồn `@mapslibvn/react-native` có
> chạy được không) — bảng sẽ luôn nói "hỏng" vì lý do sai.

- [x] **Step 1: Viết CLI**

`scripts/compat-matrix.mjs`:

```js
#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import crossSpawn from 'cross-spawn';
import {
  RN_MATRIX,
  appPackageJson,
  classifyFailure,
  comboId,
  formatMatrixTable,
} from './lib/compat-matrix.mjs';

const WORK_DIR = 'work/compat';
const TARBALL = 'examples/embed-rn/vendor/mapslibvn-react-native.tgz';

/**
 * Chạy lệnh, gom stdout + stderr, không ném lỗi — ô hỏng là dữ liệu, không phải sự cố.
 * @param {string} cmd @param {string[]} args @param {string} cwd
 */
function tryRun(cmd, args, cwd) {
  const r = crossSpawn.sync(cmd, args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

async function main() {
  const withBuild = process.argv.includes('--build');
  mkdirSync(WORK_DIR, { recursive: true });

  /** @type {{ combo: import('./lib/compat-matrix.mjs').Combo, ok: boolean, failure: string | null }[]} */
  const results = [];

  for (const combo of RN_MATRIX) {
    const id = comboId(combo);
    const dir = join(WORK_DIR, id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'vendor'), { recursive: true });

    // Tarball copy vào từng ô: npm không theo được đường dẫn tương đối ra ngoài thư mục app.
    crossSpawn.sync('cp', [TARBALL, join(dir, 'vendor', 'mapslibvn-react-native.tgz')]);
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify(appPackageJson(combo, 'vendor/mapslibvn-react-native.tgz'), null, 2)}\n`,
      'utf8',
    );

    console.log(`\n=== ${id} ===`);
    // --legacy-peer-deps: một số ô cố ý nằm dưới sàn peer mà chính @maplibre/maplibre-react-native
    // khai báo (xem ghi chú trên) — không có cờ này, npm chặn NGAY tại bước cài, không bao giờ tới
    // được bước build để trả lời câu hỏi thật (mã của @mapslibvn/react-native có chạy được không).
    const install = tryRun('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps'], dir);
    if (!install.ok) {
      const kind = classifyFailure(install.output);
      console.log(`  cài: HỎNG (${kind})`);
      console.log(install.output.split('\n').slice(-15).join('\n'));
      results.push({ combo, ok: false, failure: kind });
      continue;
    }
    console.log('  cài: ĐẠT');

    if (!withBuild) {
      results.push({ combo, ok: true, failure: null });
      continue;
    }

    const build = tryRun('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], dir);
    const verdict = build.ok;
    const buildKind = verdict ? null : classifyFailure(build.output);
    console.log(`  dựng: ${verdict ? 'ĐẠT' : `HỎNG (${buildKind})`}`);
    if (!verdict) console.log(build.output.split('\n').slice(-15).join('\n'));
    results.push({ combo, ok: verdict, failure: buildKind });
    // Ô dựng xong chiếm hàng trăm MB; dọn ngay.
    rmSync(join(dir, 'android'), { recursive: true, force: true });
  }

  const md = formatMatrixTable(results);
  console.log(`\n${md}`);

  if (process.argv.includes('--write')) {
    mkdirSync('docs/evidence/perf', { recursive: true });
    const path = 'docs/evidence/perf/2026-09-14-compat-matrix.md';
    writeFileSync(path, `# Ma trận tương thích RN — 14/09/2026\n\n${md}\n`, 'utf8');
    console.log(`\nĐã ghi ${path}`);
  }

  const broken = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - broken}/${results.length} ô ĐẠT`);
}

await main();
```

- [x] **Step 2: Bảo đảm `work/` không bị commit**

```bash
grep -n "^work" .gitignore || echo "work/" >> .gitignore
```

- [x] **Step 3: Nối vào `package.json`**

```json
"compat:matrix": "node scripts/compat-matrix.mjs",
```

- [x] **Step 4: Dựng tarball rồi chạy**

```bash
pnpm --filter @mapslibvn/react-native build
pnpm --filter @mapslibvn/react-native exec npm pack --pack-destination ../../examples/embed-rn/vendor
mv examples/embed-rn/vendor/mapslibvn-react-native-*.tgz examples/embed-rn/vendor/mapslibvn-react-native.tgz
pnpm compat:matrix
```

Kỳ vọng: 5 ô chạy xong, bảng Markdown ở cuối, dòng tổng kết "N/5 ô ĐẠT".
**Ô `react18.3.1-rn0.79.0-expo53.0.0-oldarch` là ô quyết định món C1** — ghi lại nó ĐẠT hay
HỎNG và loại lỗi.

- [x] **Step 5: Typecheck rồi commit**

```bash
pnpm typecheck
git add scripts/compat-matrix.mjs package.json .gitignore
git commit -m "feat(compat): pnpm compat:matrix dựng app thử cho từng tổ hợp React/RN/Expo"
```

---

## Task 9: Chạy baseline, viết evidence, khép món C1

**Files:**
- Create: `docs/evidence/perf/2026-09-14-baseline-rn.md` (sinh bởi `perf:rn --write`, rồi sửa tay)
- Create: `docs/evidence/perf/2026-09-14-compat-matrix.md` (sinh bởi `compat:matrix --write`)
- Modify: `packages/react-native/README.md` (mục yêu cầu tối thiểu)
- Modify: `docs/DEVLOG.md` (mục mới)

- [x] **Step 1: Chạy cả ba phép đo, ghi file**

```bash
pnpm build
mkdir -p work/perf
cd examples/embed-rn && npx expo export:embed \
  --platform android --dev false --reset-cache \
  --entry-file index.ts \
  --bundle-output ../../work/perf/embed-rn.android.bundle; cd ../..
pnpm perf:size | tee /tmp/perf-size.md
pnpm compat:matrix --write
pnpm perf:rn --write
```

- [x] **Step 2: Bổ sung bảng kích thước vào evidence baseline**

Mở `docs/evidence/perf/2026-09-14-baseline-rn.md`, thêm mục "Kích thước" và dán bảng từ
`/tmp/perf-size.md` vào. Thêm một câu nói rõ bản dựng là Debug hay Release và app thử chạy
trên emulator nào.

- [x] **Step 3: Viết kết luận C1**

Thêm vào `docs/evidence/perf/2026-09-14-compat-matrix.md` một mục "Kết luận C1" trả lời đúng
một câu hỏi: **ô React 18 / RN 0.79 ĐẠT hay HỎNG.** Rồi làm đúng một trong ba việc theo bảng
kết cục ở mục 4b của spec:

- ô ĐẠT → sửa `peerDependencies` trong `packages/react-native/package.json` xuống
  `"react": ">=18.3.0"`, `"react-native": ">=0.79.0"`, và ghi trong README rằng đó là mức đã
  thử thật, không phải suy đoán
- ô HỎNG → giữ nguyên `peerDependencies`, ghi yêu cầu tối thiểu hiện hành vào README kèm lý
  do (ràng buộc đến từ `@maplibre/maplibre-react-native@11`, không phải từ code MapsLibVN)
- ô ĐẠT ở bước cài nhưng HỎNG ở bước dựng → nới tới mức thấp nhất còn dựng được và ghi rõ

- [x] **Step 4: Cập nhật README gói RN**

Thêm vào `packages/react-native/README.md` một mục "Yêu cầu tối thiểu" ghi bản React / RN /
Expo thấp nhất đã thử thật, kèm ngày đo. **Không ghi version của chính SDK vào README** —
badge npm đã tự động.

- [x] **Step 5: Chạy toàn bộ cổng**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm notices:sync --check
```

Kỳ vọng: cả bốn xanh. `pnpm test` phải có thêm các test mới của Task 2, 5, 7.

- [x] **Step 6: Ghi DEVLOG rồi commit**

Thêm mục mới vào `docs/DEVLOG.md` theo đúng giọng các mục sẵn có: baseline đo được gì, ô nào
của ma trận hỏng, kết luận C1, và danh sách hạng mục **CHỜ PHONG** (FPS máy thật Android,
quan sát iOS).

```bash
git add docs/evidence/perf docs/DEVLOG.md packages/react-native/README.md packages/react-native/package.json
git commit -m "docs(perf): baseline hiệu năng RN, ma trận tương thích và kết luận C1"
```

---

## Sau plan này

Giai đoạn 2 của spec: PHONG đọc bảng số, tick món trong nhóm A và B. Giai đoạn 3 có plan riêng.

Không bump version, không push, không publish, không deploy trong plan này.
