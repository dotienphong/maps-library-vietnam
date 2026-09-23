# Tối ưu đội xe (`POST /v1/fleet-plan`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm bộ giải đội xe VROOM cạnh Valhalla và endpoint `POST /v1/fleet-plan` chia N đơn cho K xe (sức chứa, khung giờ, thời gian dừng, open-end), trả tuyến đầy đủ từng xe; SDK core/web/RN, Playground, smoke production, docs và site theo spec `docs/superpowers/specs/2026-09-23-toi-uu-doi-xe-design.md`.

**Architecture:** Worker kiểm body ở preflight quota (400 không tốn lượt), gọi VROOM (`FLEET_BASE`, cùng header Access với Valhalla) để chia đơn và sắp thứ tự, rồi gọi Valhalla `/route` song song cho từng xe để có `DirectionsResponse` kèm câu tiếng Việt; VROOM chạy trong compose máy chủ và dev, lấy ma trận từ `valhalla:8002`, Worker tới nó qua luật đường dẫn `/fleet/` của hostname Tunnel `maps-route`. Core thêm `client.fleetPlan()` + `fleetRouteFeatures()`; web/RN thêm `routes.showFleet()` vẽ K xe K màu.

**Tech Stack:** Cloudflare Workers (Hono, vitest-pool-workers), VROOM 1.15 (vroom-express, image GHCR đa kiến trúc), Valhalla 3.8.3, TypeScript 6 (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), biome, vitest 5, MapLibre GL / MapLibre React Native, Playwright, pnpm workspace.

---

## Quy ước chung cho mọi task

- Làm **thẳng trên `main`** (PHONG chốt 23/09/2026), không tạo nhánh. Chạy lệnh từ gốc repo.
- Test API: `pnpm --filter @mapslibvn/api exec vitest run test/<file>.test.ts` (một file) hoặc `pnpm --filter @mapslibvn/api test` (cả bộ). Test root (core, web, RN, scripts, site, docs lib): `pnpm exec vitest run <đường dẫn file>`. Typecheck: `pnpm typecheck`. Lint: `pnpm lint` (biome; tự sửa bằng `pnpm lint:fix`).
- **`pnpm --filter @mapslibvn/core build` phải chạy lại sau mỗi lần sửa `packages/core/src`** trước khi test API, web, RN hay typecheck: các gói khác import `@mapslibvn/core` từ `dist`. Lệnh build cũng chạy `size-limit` (trần barrel core trong `packages/core/.size-limit.json`).
- `exactOptionalPropertyTypes` và `noUncheckedIndexedAccess` đang bật: không gán `undefined` vào thuộc tính tuỳ chọn (dùng spread có điều kiện hoặc bỏ khoá); `arr[i]` luôn có thể `undefined` — lấy ra biến rồi kiểm.
- Biome cấm `!` (non-null assertion) và `forEach` trong mã TS (dùng `for…of` với `.entries()`); format nghiêm — sau khi dán mã từ plan, chạy `pnpm lint:fix` rồi `pnpm lint`. Mã JS trong `apps/docs/public` theo phong cách file hiện có (JSDoc đầy đủ).
- API unit test **không được cần Postgres hay mạng**: mock VROOM bằng `fetchMock.get('https://fleet.test')` và Valhalla bằng `fetchMock.get('https://routing.test')` (origin test trong `apps/api/vitest.config.ts`); `fetchMock.disableNetConnect()` nên request không có interceptor → lỗi → 503. Một test 400 **không** đăng ký interceptor là bằng chứng VROOM không bị gọi.
- Toạ độ: body API và client `[lat, lng]`; VROOM và Valhalla `[lng, lat]`/`{lat, lon}`; mọi toạ độ **trong response** `[lng, lat]`.
- Scripts `.mjs` nằm trong `include` của `tsconfig.scripts.json` nên qua `checkJs`: viết JSDoc kiểu đầy đủ.
- Commit message tiếng Việt, tiền tố `feat/fix/test/docs/chore(scope)`, kết bằng dòng trống rồi `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. **Không push** cho tới Task 16 và Task 20 (PHONG duyệt push).
- Production: auto mode chặn Fable đụng production. Mọi lệnh gọi production (smoke, curl có khoá, docker trên máy chủ) do **PHONG gõ với tiền tố `!`**, kết quả dán lại để ghi evidence.

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `infra/dev/vroom/config.yml`, `infra/dev/compose.yml` | VROOM dev (profile `routing`), threads 1 |
| `scripts/lib/routing-test.mjs` (+ `.test.mjs`), `scripts/routing-test.mjs`, `.github/workflows/routing-test.yml` | dựng VROOM, chờ `/fleet/health`, `--var FLEET_BASE`, capture fixture VROOM thô và fixture API |
| `apps/api/src/env.ts`, `wrangler.toml`, `vitest.config.ts` | `FLEET_BASE`, `FLEET_RATE_LIMITER` |
| `apps/api/src/routing/nhip.ts` | `apDungNhip(limiter, keyHash, thongDiep)`; `apDungNhipMaTran` thành wrapper |
| `apps/api/src/quota.ts` (+ `test/quota.test.ts`) | preflight nhận `Promise<void>` |
| `apps/api/src/routing/fleet-time.ts` (+ `test/fleet-time.test.ts`) | `parseIsoWithOffset`, `formatIsoAt` |
| `apps/api/src/routing/vroom.ts` (+ `test/routing-vroom.test.ts`) | `callVroom`, `mapVroomError`, `fleetBase`, kiểu VROOM, timeout |
| `packages/core/src/types.ts`, `client.ts` (+ `client.fleet-plan.test.ts`) | kiểu Fleet*, `client.fleetPlan()` |
| `apps/api/src/routing/fleet.ts` (+ `test/routing-fleet.test.ts`) | hằng số, `parseFleetBody`, `fleetVroomBody`, `fleetCacheUrl`, `translateFleet`, `fleetRouteBody`, `assembleFleetPlan`, `noRouteMessage` |
| `apps/api/test/fixtures/vroom/two-vehicles.json` (tay), `q1-fleet.json` (capture) | fixture VROOM |
| `apps/api/src/routes/fleet.ts` (+ `test/fleet-plan.test.ts`), `src/index.ts` | `POST /v1/fleet-plan`, `GET /healthz/fleet` |
| `apps/api/src/health/phep-do.ts` (+ `test/health-canh-bao.test.ts`, `test/admin-health.test.ts`) | thành phần `fleet` |
| `apps/admin/src/features/health/{api,page}.tsx`, `overview/page.tsx` (+ tests) | ô "Đội xe" |
| `apps/api/test-routing/fleet-plan.rtest.mjs` | test tích hợp trên Valhalla + VROOM Quận 1 |
| `packages/core/tests/fixtures/fleet-plan-q1.json`, `apps/docs/e2e/fixtures/fleet-plan-q1.json` | fixture API (capture qua Worker) cho core/web/RN/e2e |
| `packages/core/src/navigation/route-features.ts` (+ test), `.size-limit.json` | `FLEET_COLORS`, `decodeFleet`, `fleetRouteFeatures` |
| `packages/web/src/routes-layer.ts` (+ test), `index.ts`, `umd.ts` | `routes.showFleet()` |
| `packages/react-native/src/navigation/routes-store.ts`, `route-layers.tsx` (+ tests), `context.ts`, `map.tsx`, `index.ts` | `routes.showFleet()` RN |
| `apps/docs/public/playground{.html,-fleet.js,-lib.js,.css}`, `apps/docs/scripts/playground-lib.test.mjs`, `apps/docs/e2e/playground.spec.ts` | mục "Chia đơn cho nhiều xe" |
| `scripts/lib/receipt-ack.mjs` (+ test), `scripts/lib/smoke-fleet.mjs` (+ test), `scripts/smoke-fleet.mjs`, `package.json` | smoke production bài E/E2/F |
| `infra/server/compose.yml`, `infra/server/vroom/config.yml`, `infra/server/README.md`, `scripts/server-setup.mjs`, `scripts/lib/server-env.mjs` (+ test), `THIRD_PARTY_NOTICES.md` | VROOM production |
| `docs/evidence/routing/2026-09-<ngày>-fleet.md` | số đo |
| `apps/docs/src/content/docs/{doi-xe,api,sdk,tinh-nang,tu-host}.md` | tài liệu |
| `apps/site/src/lib/doi-dau.ts` (+ test), `pages/{tinh-nang,index}.astro`, `pages/so-sanh/{google-maps-api,vietmap}.astro` | website |
| `docs/DEVLOG.md`, spec (trạng thái), spec 22/09 mục 12 | nhật ký |

---

### Task 1: VROOM cho dev — compose, cấu hình, `routing-test.mjs`, CI

**Files:**
- Create: `infra/dev/vroom/config.yml`
- Modify: `infra/dev/compose.yml` (sau service `valhalla`)
- Modify: `scripts/lib/routing-test.mjs:13-27`
- Modify: `scripts/lib/routing-test.test.mjs:14-42`
- Modify: `scripts/routing-test.mjs` (dựng vroom, chờ health, `--var FLEET_BASE`)
- Modify: `.github/workflows/routing-test.yml`

- [ ] **Step 1: Viết cấu hình VROOM dev**

Tạo `infra/dev/vroom/config.yml`:

```yaml
# vroom-express cho `pnpm test:routing` (spec 2026-09-23 mục 5.2). Bản production ở
# infra/server/vroom/config.yml chỉ khác `threads: 2`. Entrypoint của image chép file này vào
# /vroom-express/config.yml lúc khởi động và `touch` access.log cạnh nó — mount THƯ MỤC ./vroom:/conf.
cliArgs:
  geometry: false   # Worker tự lấy tuyến từng xe bằng /route (có câu chỉ dẫn); VROOM chỉ giải
  planmode: false
  threads: 1        # 1 luồng để fixture capture ổn định giữa các lần chạy
  explore: 5
  limit: '256kb'
  logdir: '/conf'
  logsize: '20M'
  maxlocations: 40  # lớp chặn thứ hai sau Worker: 5 xe + 30 đơn ≤ 40 điểm
  maxvehicles: 5
  override: []      # request không đổi được cờ nào (không -g, không -c)
  path: ''
  port: 3000
  router: 'valhalla'
  timeout: 25000
  baseurl: '/fleet/'
routingServers:
  valhalla:
    auto:
      host: 'valhalla'
      port: '8002'
    motor_scooter:
      host: 'valhalla'
      port: '8002'
    pedestrian:
      host: 'valhalla'
      port: '8002'
```

- [ ] **Step 2: Thêm service `vroom` vào compose dev**

Trong `infra/dev/compose.yml`, ngay sau khối `valhalla:` (trước `volumes:`), thêm:

```yaml
  # Bộ giải đội xe cho `pnpm test:routing` (spec 2026-09-23 mục 5.2). Cùng profile routing với
  # valhalla; nối valhalla:8002 trong mạng compose để lấy ma trận. Ghim digest manifest list v1.15.0
  # (amd64 + arm64, `docker buildx imagetools inspect` 23/09/2026).
  vroom:
    profiles: ["routing"]
    image: ghcr.io/vroom-project/vroom-docker:v1.15.0@sha256:247d5683d6745c755d718a156d16b16aac80baccc276a003a68b986c13883b08
    environment:
      VROOM_ROUTER: valhalla
    ports:
      - "127.0.0.1:${VROOM_PORT:-3000}:3000"
    volumes:
      - ./vroom:/conf
```

`access.log` mà entrypoint tạo trong `infra/dev/vroom/` đã bị `.gitignore` bỏ qua nhờ mẫu `*.log` sẵn có.

- [ ] **Step 3: Viết test đỏ cho `parseRoutingTestArgs` có `vroomBase`**

Trong `scripts/lib/routing-test.test.mjs`, thay khối `describe('parseRoutingTestArgs', …)` (dòng 14–42) bằng:

```js
describe('parseRoutingTestArgs', () => {
  it('mặc định máy dev: dựng compose, valhalla 8002, vroom 3000/fleet, api 8798', () => {
    expect(parseRoutingTestArgs([], {})).toEqual({
      compose: true,
      valhallaBase: 'http://127.0.0.1:8002',
      vroomBase: 'http://127.0.0.1:3000/fleet',
      apiPort: 8798,
      capture: false,
      down: false,
    });
  });

  it('--no-compose bắt buộc VALHALLA_BASE và VROOM_BASE; --capture/--down; *_PORT đổi cổng', () => {
    expect(() => parseRoutingTestArgs(['--no-compose'], {})).toThrow(/VALHALLA_BASE/);
    expect(() =>
      parseRoutingTestArgs(['--no-compose'], { VALHALLA_BASE: 'http://valhalla:8002' }),
    ).toThrow(/VROOM_BASE/);
    expect(
      parseRoutingTestArgs(['--no-compose', '--capture', '--down'], {
        VALHALLA_BASE: 'http://valhalla:8002/',
        VROOM_BASE: 'http://vroom:3000/fleet/',
      }),
    ).toEqual({
      compose: false,
      valhallaBase: 'http://valhalla:8002',
      vroomBase: 'http://vroom:3000/fleet',
      apiPort: 8798,
      capture: true,
      down: true,
    });
    expect(parseRoutingTestArgs([], { VALHALLA_PORT: '8102' }).valhallaBase).toBe(
      'http://127.0.0.1:8102',
    );
    expect(parseRoutingTestArgs([], { VROOM_PORT: '3100' }).vroomBase).toBe(
      'http://127.0.0.1:3100/fleet',
    );
  });
});
```

- [ ] **Step 4: Chạy test, thấy đỏ**

Run: `pnpm exec vitest run scripts/lib/routing-test.test.mjs`
Expected: FAIL — `vroomBase` không có trong object trả về.

- [ ] **Step 5: Thêm `vroomBase` vào `parseRoutingTestArgs`**

Thay hàm trong `scripts/lib/routing-test.mjs` (dòng 8–27) bằng:

```js
/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {{ compose: boolean, valhallaBase: string, vroomBase: string, apiPort: number, capture: boolean, down: boolean }}
 */
export function parseRoutingTestArgs(argv, env) {
  const compose = !argv.includes('--no-compose');
  let valhallaBase = env.VALHALLA_BASE?.replace(/\/+$/, '') ?? '';
  let vroomBase = env.VROOM_BASE?.replace(/\/+$/, '') ?? '';
  if (!compose && !valhallaBase) {
    throw new Error('--no-compose cần VALHALLA_BASE trỏ tới Valhalla đang chạy');
  }
  if (!compose && !vroomBase) {
    throw new Error('--no-compose cần VROOM_BASE trỏ tới vroom-express đang chạy (…/fleet)');
  }
  if (compose) {
    valhallaBase = `http://127.0.0.1:${env.VALHALLA_PORT ?? '8002'}`;
    vroomBase = `http://127.0.0.1:${env.VROOM_PORT ?? '3000'}/fleet`;
  }
  return {
    compose,
    valhallaBase,
    vroomBase,
    apiPort: DEFAULT_API_PORT,
    capture: argv.includes('--capture'),
    down: argv.includes('--down'),
  };
}
```

- [ ] **Step 6: Chạy test, thấy xanh**

Run: `pnpm exec vitest run scripts/lib/routing-test.test.mjs`
Expected: PASS.

- [ ] **Step 7: `routing-test.mjs` dựng VROOM, chờ health, truyền `FLEET_BASE`, capture fixture VROOM thô**

Trong `scripts/routing-test.mjs`:

(a) Đổi lệnh `up -d valhalla` (trong `if (opts.compose)`) thành dựng cả hai và ghi nhớ để `--down` dừng cả hai:

```js
    valhallaStartAttempted = true;
    run('docker', [...compose, 'up', '-d', 'valhalla', 'vroom'], {
      env: { ...process.env, MAPSLIBVN_VALHALLA_DEV: DEV_DIR },
    });
```

và trong `createRoutingCleanup({ … stopValhalla … })` đổi `run('docker', [...compose, 'stop', 'valhalla'])` thành `run('docker', [...compose, 'stop', 'valhalla', 'vroom'])`.

(b) Ngay sau dòng `log(\`Valhalla sẵn sàng tại ${opts.valhallaBase}\`);` thêm:

```js
  await waitForOk(`${opts.vroomBase}/health`, 2 * 60_000, {
    onTick: (ms) => log(`chờ vroom-express /fleet/health… ${Math.round(ms / 1000)}s`),
  });
  log(`VROOM sẵn sàng tại ${opts.vroomBase}`);
```

(c) Trong khối `if (opts.capture)`, sau vòng `for (const { path, file, body } of captures)`, thêm capture VROOM thô — 2 xe cùng kho Chợ Bến Thành, `max_tasks: 3` để 5 đơn buộc phải dùng cả hai xe:

```js
    // VROOM thô cho unit test translateFleet (spec 23/09 mục 9): [lng, lat], id là chỉ số.
    // max_tasks 3 để 5 đơn phải chia cho cả hai xe — fixture mới có xe thứ hai để kiểm.
    const depot = [106.698, 10.7725];
    const vroomBody = {
      vehicles: [0, 1].map((id) => ({
        id,
        profile: 'motor_scooter',
        start: depot,
        end: depot,
        max_tasks: 3,
      })),
      jobs: [
        [106.6958, 10.7826], // Hồ Con Rùa
        [106.7069, 10.7686], // Bến Nhà Rồng
        [106.6953, 10.777], // Dinh Độc Lập
        [106.7043, 10.7716], // Bitexco
        [106.699, 10.7798], // Nhà thờ Đức Bà
      ].map((location, id) => ({ id, location, service: 0, priority: 0 })),
    };
    const vroomResponse = await fetch(`${opts.vroomBase}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(vroomBody),
    });
    if (!vroomResponse.ok) throw new Error(`capture vroom: trả ${vroomResponse.status}`);
    mkdirSync(resolve('apps/api/test/fixtures/vroom'), { recursive: true });
    const vroomTarget = resolve('apps/api/test/fixtures/vroom/q1-fleet.json');
    writeFileSync(vroomTarget, `${JSON.stringify(await vroomResponse.json(), null, 2)}\n`);
    log(`đã ghi ${vroomTarget}`);
```

(d) Thêm `--var FLEET_BASE:${opts.vroomBase}` vào mảng tham số spawn wrangler, ngay sau hai dòng `'--var', \`ROUTING_BASE:${opts.valhallaBase}\``:

```js
      '--var',
      `FLEET_BASE:${opts.vroomBase}`,
```

(e) Sau khi Worker lên (`await waitForProcessOk(...)`) và TRƯỚC `crossSpawn.sync('pnpm', ['exec', 'vitest', …])`, thêm capture fixture API (dùng cho core/web/RN test và e2e docs — Task 10 sẽ tạo file yêu cầu):

```js
  if (opts.capture) {
    // Fixture API-level (FleetPlanResponse thật từ Worker + VROOM + Valhalla Quận 1) dùng chung cho
    // test core/web/RN và e2e docs. Body yêu cầu nằm ở apps/api/test/fixtures/vroom/q1-fleet-request.json.
    const requestBody = readFileSync(
      resolve('apps/api/test/fixtures/vroom/q1-fleet-request.json'),
      'utf8',
    );
    const planResponse = await fetch(`http://127.0.0.1:${opts.apiPort}/v1/fleet-plan`, {
      method: 'POST',
      headers: { 'X-Api-Key': TEST_KEY, 'content-type': 'application/json' },
      body: requestBody,
    });
    if (!planResponse.ok) throw new Error(`capture fleet-plan: Worker trả ${planResponse.status}`);
    const planText = `${JSON.stringify(await planResponse.json(), null, 2)}\n`;
    for (const target of [
      'packages/core/tests/fixtures/fleet-plan-q1.json',
      'apps/docs/e2e/fixtures/fleet-plan-q1.json',
    ]) {
      writeFileSync(resolve(target), planText);
      log(`đã ghi ${target}`);
    }
  }
```

Thêm `readFileSync` vào import từ `node:fs` ở đầu file.

- [ ] **Step 8: CI chạy thêm container VROOM**

Trong `.github/workflows/routing-test.yml`: thêm hai đường dẫn kích hoạt `"infra/dev/vroom/**"` và `"scripts/lib/receipt-ack.mjs"` vào `paths`; thay step "Valhalla trên fixture Quận 1" bằng:

```yaml
      - name: Valhalla trên fixture Quận 1 + VROOM
        run: |
          mkdir -p "$RUNNER_TEMP/valhalla"
          cp pipelines/poi/fixtures/q1.osm.pbf "$RUNNER_TEMP/valhalla/"
          docker network create routing
          docker run -d --name valhalla --network routing -p 8002:8002 -e server_threads=2 \
            -v "$RUNNER_TEMP/valhalla:/custom_files" \
            ghcr.io/valhalla/valhalla-scripted:3.8.3@sha256:24ef7955899dececb94e26c6dfb89d64fabfae875f980432694b0261eb6c251b
          # vroom nối valhalla:8002 qua tên container trong mạng `routing` — cùng cấu hình với compose dev.
          docker run -d --name vroom --network routing -p 3000:3000 -e VROOM_ROUTER=valhalla \
            -v "$PWD/infra/dev/vroom:/conf" \
            ghcr.io/vroom-project/vroom-docker:v1.15.0@sha256:247d5683d6745c755d718a156d16b16aac80baccc276a003a68b986c13883b08
      - run: node scripts/routing-test.mjs --no-compose
        env:
          VALHALLA_BASE: http://127.0.0.1:8002
          VROOM_BASE: http://127.0.0.1:3000/fleet
      - if: failure()
        run: |
          docker logs valhalla 2>&1 | tail -100 || true
          docker logs vroom 2>&1 | tail -50 || true
```

- [ ] **Step 9: Kiểm typecheck script và lint**

Run: `pnpm exec tsc -p tsconfig.scripts.json && pnpm lint`
Expected: không lỗi.

- [ ] **Step 10: Commit**

```bash
git add infra/dev/vroom/config.yml infra/dev/compose.yml scripts/lib/routing-test.mjs scripts/lib/routing-test.test.mjs scripts/routing-test.mjs .github/workflows/routing-test.yml
git commit -m "feat(infra): VROOM cho môi trường dev và CI routing — compose profile routing, routing-test dựng và chờ /fleet/health

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Cấu hình Worker — `FLEET_BASE`, `FLEET_RATE_LIMITER`, nhịp tổng quát, preflight bất đồng bộ

**Files:**
- Modify: `apps/api/src/env.ts` (sau `MATRIX_RATE_LIMITER`)
- Modify: `apps/api/wrangler.toml` (`[vars]`, `[env.production] vars`, `ratelimits`)
- Modify: `apps/api/vitest.config.ts` (bindings, ratelimits)
- Modify: `apps/api/src/routing/nhip.ts`
- Modify: `apps/api/src/quota.ts:66-90`
- Test: `apps/api/test/routing-nhip.test.ts` (mới), `apps/api/test/quota.test.ts`

- [ ] **Step 1: Test đỏ cho `apDungNhip`**

Tạo `apps/api/test/routing-nhip.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import { apDungNhip, apDungNhipMaTran } from '../src/routing/nhip';

const limiter = (success: boolean): RateLimit =>
  ({ limit: () => Promise.resolve({ success }) }) as unknown as RateLimit;

describe('apDungNhip', () => {
  it('thiếu binding → bỏ qua; qua nhịp → không ném', async () => {
    await expect(apDungNhip(undefined, 'k', 'x')).resolves.toBeUndefined();
    await expect(apDungNhip(limiter(true), 'k', 'x')).resolves.toBeUndefined();
  });

  it('quá nhịp → 429 rate_limit_exceeded, retry-after 60, đúng thông điệp truyền vào', async () => {
    try {
      await apDungNhip(limiter(false), 'k', 'Gửi quá nhiều request chia đơn đội xe trong một phút');
      throw new Error('phải ném');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const e = error as ApiError;
      expect(e.status).toBe(429);
      expect(e.code).toBe('rate_limit_exceeded');
      expect(e.retryAfter).toBe(60);
      expect(e.message).toMatch(/chia đơn đội xe/);
    }
  });

  it('apDungNhipMaTran giữ thông điệp cũ của ma trận', async () => {
    await expect(apDungNhipMaTran(limiter(false), 'k')).rejects.toThrow(/ma trận/);
  });
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-nhip.test.ts`
Expected: FAIL — `apDungNhip` không tồn tại.

- [ ] **Step 3: Tổng quát `nhip.ts`**

Thay toàn bộ `apps/api/src/routing/nhip.ts`:

```ts
import { ApiError } from '../errors';

/**
 * Nhịp theo **khoá thuần**, không kèm IP: mục tiêu là giữ tải tổng lên engine, không phải chống spam
 * từ một địa chỉ. Áp cho CẢ khoá `server`. Thiếu binding (dev, test chưa cấu hình) thì bỏ qua — cùng
 * cách mọi limiter khác trong mã này làm.
 *
 * Dùng cho `/v1/matrix` + `/v1/optimized-route` (`MATRIX_RATE_LIMITER`, 6/phút — spec 22/09/2026 mục
 * 6.3) và `/v1/fleet-plan` (`FLEET_RATE_LIMITER`, 2/phút — spec 23/09/2026 mục 4.7).
 */
export async function apDungNhip(
  limiter: RateLimit | undefined,
  keyHash: string,
  thongDiep: string,
): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key: keyHash });
  if (!success) throw new ApiError(429, 'rate_limit_exceeded', thongDiep, 60);
}

/** Nhịp riêng cho ma trận và tối ưu thứ tự — máy chủ 2 nhân, engine 1 luồng, năm ma trận cỡ tối đa song song đẩy p95 directions lên 2,7–5,3 s (đo 22/09/2026). */
export function apDungNhipMaTran(limiter: RateLimit | undefined, keyHash: string): Promise<void> {
  return apDungNhip(
    limiter,
    keyHash,
    'Gửi quá nhiều request ma trận / tối ưu thứ tự trong một phút',
  );
}
```

- [ ] **Step 4: Chạy test nhịp, thấy xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-nhip.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Thêm biến môi trường**

Trong `apps/api/src/env.ts`, ngay sau khai báo `MATRIX_RATE_LIMITER?: RateLimit;` thêm:

```ts
  /**
   * Gốc vroom-express (spec 2026-09-23 mục 5.3): dev `http://127.0.0.1:3000/fleet`; production
   * `https://maps-route.<domain>/fleet` — cùng hostname Tunnel với Valhalla, luật đường dẫn `/fleet/`
   * trỏ `vroom:3000`, nên dùng lại service token Access của routing. Vắng → 503.
   */
  FLEET_BASE?: string;
  /**
   * Nhịp riêng cho `/v1/fleet-plan`: 2 request/phút/colo theo KHOÁ thuần, áp cả khoá `server`. Một
   * request cỡ tối đa là ma trận ≤ 1.600 cặp cộng 5 lượt `/route` — gấp nhiều lần một ma trận 50 cặp.
   */
  FLEET_RATE_LIMITER?: RateLimit;
```

- [ ] **Step 6: wrangler.toml**

(a) Trong `[vars]`, ngay sau dòng `ROUTING_BASE = "http://127.0.0.1:8002"` thêm:

```toml
# Bộ giải đội xe (spec 2026-09-23). Dev: vroom-express của compose dev, baseurl /fleet/.
FLEET_BASE = "http://127.0.0.1:3000/fleet"
```

(b) Trong `[env.production]`, dòng `vars = { … }` thêm phần tử `FLEET_BASE = "https://maps-route.ai-solutions.io.vn/fleet"` ngay sau `ROUTING_BASE = "https://maps-route.ai-solutions.io.vn"`.

(c) Trong `ratelimits`, ngay sau phần tử `MATRIX_RATE_LIMITER`, thêm:

```toml
  # Chia đơn đội xe: 2 request/phút theo khoá thuần (spec 2026-09-23 mục 4.7). Một request cỡ tối đa
  # là ma trận ≤ 1.600 cặp + 5 tuyến trên cùng Valhalla, nên nhịp thấp hơn hẳn ma trận (6/phút).
  { name = "FLEET_RATE_LIMITER", namespace_id = "20260924", simple = { limit = 2, period = 60 } },
```

- [ ] **Step 7: vitest.config.ts của API**

Trong `apps/api/vitest.config.ts`: `bindings` thêm `FLEET_BASE: 'https://fleet.test',` ngay sau `ROUTING_BASE`; `ratelimits` thêm:

```ts
          FLEET_RATE_LIMITER: {
            namespace_id: '20260924',
            simple: { limit: 10_000, period: 60 },
          },
```

- [ ] **Step 8: Test đỏ cho preflight bất đồng bộ**

Thêm vào cuối `apps/api/test/quota.test.ts` (giữ import hiện có; thêm `import { Hono } from 'hono';` và `import type { AppEnv } from '../src/env';` nếu file chưa có):

```ts
describe('quotaMiddleware preflight bất đồng bộ (fleet-plan)', () => {
  it('await preflight: 400 từ preflight async trả về TRƯỚC handler, handler không chạy', async () => {
    const app = new Hono<AppEnv>();
    let handlerChay = false;
    app.post(
      '/x',
      async (c, next) => {
        c.set('auth', {
          keyHash: 'h',
          keyPrefix: 'mlv_live_x',
          tenantId: '00000000-0000-4000-8000-0000000000aa',
          plan: 'internal',
          kind: 'server',
          scopes: ['places:read'],
          allowedOrigins: [],
          quotaPlacesPerDay: null,
          quotaDirectionsPerDay: null,
        });
        await next();
      },
      quotaMiddleware('directions', async (c) => {
        const body = (await c.req.json()) as { ok?: boolean };
        if (!body.ok) throw new ApiError(400, 'invalid_request', 'body sai');
        c.set('params', body);
      }),
      (c) => {
        handlerChay = true;
        return c.json(c.get('params'));
      },
    );
    app.onError((err, c) => errorResponse(c, err));
    const sai = await app.request('/x', { method: 'POST', body: '{}' }, env);
    expect(sai.status).toBe(400);
    expect(handlerChay).toBe(false);
    const dung = await app.request('/x', { method: 'POST', body: '{"ok":true}' }, env);
    expect(dung.status).toBe(200);
    expect(await dung.json()).toEqual({ ok: true });
  });
});
```

Thêm `import { ApiError, errorResponse } from '../src/errors';` và `import { env } from 'cloudflare:test';` nếu chưa có ở đầu file.

- [ ] **Step 9: Chạy, thấy đỏ (typecheck: preflight trả Promise)**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/quota.test.ts`
Expected: FAIL hoặc lỗi kiểu — preflight hiện là `(c) => void`, Promise bị bỏ rơi nên 400 không ném trước handler.

- [ ] **Step 10: Cho preflight trả Promise**

Trong `apps/api/src/quota.ts`, đổi chữ ký và lời gọi:

```ts
export function quotaMiddleware(
  group: QuotaGroup,
  preflight?: (c: Context<AppEnv>) => void | Promise<void>,
) {
```

và dòng `preflight?.(c);` thành `await preflight?.(c);`. Cập nhật JSDoc phía trên hàm: thêm câu "Preflight có thể bất đồng bộ (đọc body JSON của POST /v1/fleet-plan) — luôn `await`."

- [ ] **Step 11: Chạy cả hai file test, xanh; typecheck**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/quota.test.ts test/routing-nhip.test.ts && pnpm --filter @mapslibvn/api typecheck`
Expected: PASS, typecheck sạch.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/env.ts apps/api/wrangler.toml apps/api/vitest.config.ts apps/api/src/routing/nhip.ts apps/api/src/quota.ts apps/api/test/routing-nhip.test.ts apps/api/test/quota.test.ts
git commit -m "feat(api): FLEET_BASE + FLEET_RATE_LIMITER, apDungNhip tổng quát, preflight quota bất đồng bộ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: `routing/fleet-time.ts` — ISO 8601 kèm múi giờ ↔ UNIX giây

**Files:**
- Create: `apps/api/src/routing/fleet-time.ts`
- Test: `apps/api/test/fleet-time.test.ts`

- [ ] **Step 1: Test đỏ**

Tạo `apps/api/test/fleet-time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import { formatIsoAt, parseIsoWithOffset } from '../src/routing/fleet-time';

const T = '2026-09-24T08:00:00+07:00';
const T_UNIX = Date.parse(T) / 1000;

const expect400 = (fn: () => unknown, re: RegExp) => {
  try {
    fn();
    throw new Error('phải ném');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toMatch(re);
  }
};

describe('parseIsoWithOffset', () => {
  it('+07:00 → unix và lệch 420 phút; Z → 0; -05:30 → -330; giây tuỳ chọn', () => {
    expect(parseIsoWithOffset(T, 'x')).toEqual({ unix: T_UNIX, offsetMin: 420 });
    expect(parseIsoWithOffset('2026-09-24T01:00Z', 'x')).toEqual({ unix: T_UNIX, offsetMin: 0 });
    expect(parseIsoWithOffset('2026-09-23T19:30:00-05:30', 'x').offsetMin).toBe(-330);
    expect(parseIsoWithOffset('2026-09-23T19:30:00-05:30', 'x').unix).toBe(T_UNIX);
  });

  it('thiếu múi giờ, không phải chuỗi, ngày vô lý → 400 nêu tên trường', () => {
    expect400(() => parseIsoWithOffset('2026-09-24T08:00:00', 'vehicles[0].time_window[0]'), /múi giờ/);
    expect400(() => parseIsoWithOffset('2026-09-24 08:00+07:00', 'x'), /ISO 8601/);
    expect400(() => parseIsoWithOffset(1790000000, 'jobs[2].time_windows[0][1]'), /jobs\[2\]/);
    expect400(() => parseIsoWithOffset('2026-13-40T08:00:00+07:00', 'x'), /không phải thời điểm/);
  });
});

describe('formatIsoAt', () => {
  it('đi và về cùng múi giờ; Z khi lệch 0; không mili giây', () => {
    expect(formatIsoAt(T_UNIX, 420)).toBe(T);
    expect(formatIsoAt(T_UNIX, 0)).toBe('2026-09-24T01:00:00Z');
    expect(formatIsoAt(T_UNIX, -330)).toBe('2026-09-23T19:30:00-05:30');
    expect(formatIsoAt(T_UNIX + 754, 420)).toBe('2026-09-24T08:12:34+07:00');
  });
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/fleet-time.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `fleet-time.ts`**

```ts
import { ApiError } from '../errors';

/** Mốc giờ đã parse: UNIX giây (nguyên) và độ lệch múi giờ (phút) để in lại đúng múi người gọi dùng. */
export interface ParsedTime {
  unix: number;
  offsetMin: number;
}

const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/;
const VI_DU = '2026-09-24T08:00:00+07:00';

/**
 * ISO 8601 KÈM múi giờ → UNIX giây. Không nhận chuỗi thiếu múi giờ: "08:00" của ai? Worker chạy ở
 * UTC, khách ở +07:00, và VROOM chỉ hiểu số giây — một mốc mập mờ là một lịch sai cả tiếng.
 */
export function parseIsoWithOffset(raw: unknown, name: string): ParsedTime {
  if (typeof raw !== 'string') {
    throw new ApiError(
      400,
      'invalid_request',
      `${name} phải là chuỗi ISO 8601 kèm múi giờ, ví dụ ${VI_DU}`,
    );
  }
  const trimmed = raw.trim();
  const match = ISO_WITH_OFFSET.exec(trimmed);
  if (!match) {
    const thieuMui = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed);
    throw new ApiError(
      400,
      'invalid_request',
      thieuMui
        ? `${name} phải kèm múi giờ, ví dụ ${VI_DU} (nhận "${trimmed}")`
        : `${name} phải là ISO 8601 kèm múi giờ, ví dụ ${VI_DU} (nhận "${trimmed}")`,
    );
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new ApiError(
      400,
      'invalid_request',
      `${name} không phải thời điểm hợp lệ (nhận "${trimmed}")`,
    );
  }
  const tz = match[7] ?? 'Z';
  const offsetMin =
    tz === 'Z'
      ? 0
      : (tz.startsWith('-') ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(4, 6)));
  return { unix: Math.floor(ms / 1000), offsetMin };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** UNIX giây → ISO 8601 theo múi giờ cho trước, không mili giây: 1790211600, 420 → 2026-09-24T08:00:00+07:00. */
export function formatIsoAt(unix: number, offsetMin: number): string {
  const d = new Date((unix + offsetMin * 60) * 1000);
  const abs = Math.abs(offsetMin);
  const tz =
    offsetMin === 0 ? 'Z' : `${offsetMin < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${tz}`;
}
```

- [ ] **Step 4: Chạy, xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/fleet-time.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routing/fleet-time.ts apps/api/test/fleet-time.test.ts
git commit -m "feat(api): fleet-time — parse ISO 8601 kèm múi giờ và in lại theo đúng múi

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `routing/vroom.ts` — gọi vroom-express, bảng lỗi

**Files:**
- Create: `apps/api/src/routing/vroom.ts`
- Test: `apps/api/test/routing-vroom.test.ts`

- [ ] **Step 1: Test đỏ**

Tạo `apps/api/test/routing-vroom.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  callVroom,
  FLEET_TIMEOUT_MS,
  fleetBase,
  mapVroomError,
  type VroomRequest,
} from '../src/routing/vroom';
import { fetchMock } from './helpers/fetch-mock';

const env = { FLEET_BASE: 'https://fleet.test/' } as never;
const body: VroomRequest = {
  vehicles: [{ id: 0, profile: 'motor_scooter', start: [106.698, 10.7725], max_tasks: 10 }],
  jobs: [{ id: 0, location: [106.6958, 10.7826], service: 0, priority: 0 }],
};
const mock = (status: number, reply: object | string) =>
  fetchMock.get('https://fleet.test').intercept({ path: '/', method: 'POST' }).reply(status, reply);
const loi = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
    throw new Error('phải ném');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
};

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

describe('fleetBase', () => {
  it('cắt dấu / cuối; vắng FLEET_BASE → 503 nêu tên biến', () => {
    expect(fleetBase({ FLEET_BASE: 'https://x.test/fleet/' })).toBe('https://x.test/fleet');
    try {
      fleetBase({});
      throw new Error('phải ném');
    } catch (e) {
      expect((e as ApiError).status).toBe(503);
      expect((e as ApiError).message).toMatch(/FLEET_BASE/);
    }
  });
});

describe('mapVroomError', () => {
  it('413 và 400 → 400 invalid_request; code 3 Unfound → 404 no_route qua hàm đặt tên; còn lại 503', () => {
    expect(mapVroomError(413, null).status).toBe(400);
    const tuChoi = mapVroomError(400, { code: 2, error: 'Invalid vehicle' });
    expect(tuChoi.status).toBe(400);
    expect(tuChoi.message).toMatch(/mã 2.*Invalid vehicle/);
    const unfound = mapVroomError(
      500,
      { code: 3, error: 'Unfound route(s) from location [106.7069,10.7686] to location [106.6958,10.7826]' },
      (error) => `tên: ${error.length}`,
    );
    expect(unfound.status).toBe(404);
    expect(unfound.code).toBe('no_route');
    expect(unfound.message).toMatch(/^tên: /);
    expect(mapVroomError(500, { code: 3, error: 'Unfound route(s) …' }).message).toMatch(
      /không tới được/,
    );
    expect(mapVroomError(500, { code: 3, error: 'Failed to connect to valhalla:8002' }).status).toBe(503);
    expect(mapVroomError(500, { code: 1, error: 'boom' }).status).toBe(503);
    expect(mapVroomError(302, null).status).toBe(503);
  });
});

describe('callVroom', () => {
  it('POST {base}/ với header JSON, trả JSON khi code 0', async () => {
    mock(200, { code: 0, summary: { routes: 1 }, routes: [], unassigned: [] });
    const json = await callVroom(env, body);
    expect(json.code).toBe(0);
  });

  it('code khác 0 hoặc thiếu routes trong 200 → 503 dữ liệu không hợp lệ', async () => {
    mock(200, { code: 1, error: 'lạ' });
    expect((await loi(callVroom(env, body))).message).toMatch(/không hợp lệ/);
    mock(200, 'not json');
    expect((await loi(callVroom(env, body))).status).toBe(503);
  });

  it('HTTP lỗi đi qua mapVroomError; fetch ném → 503 không phản hồi', async () => {
    mock(500, { code: 3, error: 'Unfound route(s) from location [1,2] to location [3,4]' });
    expect((await loi(callVroom(env, body))).code).toBe('no_route');
    fetchMock
      .get('https://fleet.test')
      .intercept({ path: '/', method: 'POST' })
      .replyWithError(new Error('ECONNREFUSED'));
    expect((await loi(callVroom(env, body))).message).toMatch(/không phản hồi/);
    expect(FLEET_TIMEOUT_MS).toBe(18_000);
  });
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-vroom.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `vroom.ts`**

```ts
import type { Env } from '../env';
import { ApiError } from '../errors';
import { routingHeaders } from './valhalla';

/** VROOM giải + ma trận Valhalla; cộng FLEET_ROUTE_TIMEOUT_MS vẫn dưới trần 30 s của handler thương mại. */
export const FLEET_TIMEOUT_MS = 18_000;
/** `/route` từng xe chạy song song sau khi VROOM trả. */
export const FLEET_ROUTE_TIMEOUT_MS = 8_000;
/** Bài tí hon cho /healthz/fleet và cron: có người đang ngồi đợi màn hình. */
export const FLEET_HEALTH_TIMEOUT_MS = 6_000;

/** Body vroom-express (docs/API.md của VROOM 1.15): toạ độ [lon, lat], id số nguyên, thời gian giây. */
export interface VroomVehicle {
  id: number;
  /** Truyền nguyên văn làm `costing` của Valhalla: auto | motor_scooter | pedestrian. */
  profile: string;
  start: [number, number];
  /** Bỏ = open-end (kết thúc ở đơn cuối). */
  end?: [number, number];
  capacity?: number[];
  max_tasks: number;
  time_window?: [number, number];
}
export interface VroomJob {
  id: number;
  location: [number, number];
  service: number;
  delivery?: number[];
  priority: number;
  time_windows?: [number, number][];
}
export interface VroomRequest {
  vehicles: VroomVehicle[];
  jobs: VroomJob[];
}
export interface VroomStep {
  type: 'start' | 'job' | 'pickup' | 'delivery' | 'break' | 'end';
  /** Giây: tương đối từ 0 khi không có khung giờ, UNIX giây khi có. */
  arrival: number;
  duration: number;
  service?: number;
  waiting_time?: number;
  id?: number;
  location?: [number, number];
  load?: number[];
}
export interface VroomRoute {
  vehicle: number;
  steps: VroomStep[];
  cost: number;
  service: number;
  duration: number;
  waiting_time: number;
}
export interface VroomSummary {
  cost: number;
  routes: number;
  unassigned: number;
  service: number;
  duration: number;
  waiting_time: number;
}
export interface VroomResponse {
  /** 0 ok · 1 lỗi trong · 2 lỗi đầu vào · 3 lỗi định tuyến. */
  code: number;
  error?: string;
  summary?: VroomSummary;
  unassigned?: { id: number; location?: [number, number] }[];
  routes?: VroomRoute[];
}

type FleetEnv = Pick<Env, 'FLEET_BASE' | 'ROUTING_ACCESS_CLIENT_ID' | 'ROUTING_ACCESS_CLIENT_SECRET'>;

export function fleetBase(env: Pick<Env, 'FLEET_BASE'>): string {
  const base = env.FLEET_BASE?.replace(/\/+$/, '');
  if (!base) {
    throw new ApiError(503, 'upstream_unavailable', 'Chưa cấu hình bộ giải đội xe (FLEET_BASE)');
  }
  return base;
}

const khongPhanHoi = () =>
  new ApiError(503, 'upstream_unavailable', 'Bộ giải đội xe không phản hồi');
const duLieuSai = () =>
  new ApiError(503, 'upstream_unavailable', 'Bộ giải đội xe trả dữ liệu không hợp lệ');
const UNFOUND = /Unfound route\(s\)/i;

/**
 * Bảng lỗi spec 23/09/2026 mục 4.5. vroom-express: 413 khi quá `limit`/`maxlocations`/`maxvehicles`;
 * 400 khi VROOM báo lỗi đầu vào (code 2); 500 cho lỗi định tuyến (code 3) và lỗi trong (code 1).
 * `noRouteMessage` do fleet.ts cung cấp để gọi tên đơn/xe từ toạ độ trong thông điệp của VROOM.
 */
export function mapVroomError(
  status: number,
  body: VroomResponse | null,
  noRouteMessage?: (error: string) => string,
): ApiError {
  const error = body?.error ?? '';
  if (status === 413) {
    return new ApiError(400, 'invalid_request', 'Yêu cầu quá cỡ với bộ giải đội xe');
  }
  if (status === 400) {
    return new ApiError(
      400,
      'invalid_request',
      `Bộ giải từ chối yêu cầu (mã ${body?.code ?? 2})${error ? `: ${error}` : ''}`,
    );
  }
  if (body?.code === 3 && UNFOUND.test(error)) {
    return new ApiError(
      404,
      'no_route',
      noRouteMessage ? noRouteMessage(error) : 'Có điểm không tới được bằng mạng đường',
    );
  }
  return khongPhanHoi();
}

interface CallOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  noRouteMessage?: (error: string) => string;
}

/**
 * POST `{FLEET_BASE}/` (baseurl `/fleet/` của vroom-express). Cùng header Access với Valhalla vì cùng
 * hostname Tunnel; `redirect: 'manual'` để 302 của Access không dẫn tới trang đăng nhập.
 */
export async function callVroom(
  env: FleetEnv,
  body: VroomRequest,
  options: CallOptions = {},
): Promise<VroomResponse> {
  const base = fleetBase(env);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${base}/`, {
      method: 'POST',
      headers: routingHeaders(env, base),
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? FLEET_TIMEOUT_MS),
    });
  } catch {
    throw khongPhanHoi();
  }
  let json: VroomResponse | null = null;
  try {
    json = (await response.json()) as VroomResponse;
  } catch {
    json = null;
  }
  if (!response.ok) throw mapVroomError(response.status, json, options.noRouteMessage);
  if (!json || json.code !== 0 || !Array.isArray(json.routes)) throw duLieuSai();
  return json;
}
```

- [ ] **Step 4: Chạy, xanh**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-vroom.test.ts`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routing/vroom.ts apps/api/test/routing-vroom.test.ts
git commit -m "feat(api): lớp gọi vroom-express — callVroom, mapVroomError, timeout

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Core — kiểu Fleet* và `client.fleetPlan()`

**Files:**
- Modify: `packages/core/src/types.ts` (sau `OptimizedRouteResponse`)
- Modify: `packages/core/src/client.ts` (import kiểu; phương thức sau `optimizedRoute`)
- Modify: `packages/web/src/index.ts`, `packages/web/src/umd.ts`, `packages/react-native/src/index.ts` (re-export kiểu)
- Test: `packages/core/src/client.fleet-plan.test.ts`

- [ ] **Step 1: Test đỏ**

Tạo `packages/core/src/client.fleet-plan.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client';
import type { FleetPlanResponse } from './types';

const PLAN: FleetPlanResponse = {
  mode: 'motorbike',
  vehicles: [],
  unassigned: [],
  summary: {
    vehicles_used: 0,
    jobs_assigned: 0,
    jobs_unassigned: 0,
    distance_m: 0,
    duration_s: 0,
    service_s: 0,
    waiting_s: 0,
  },
  attribution: '© OpenStreetMap contributors',
};

describe('client.fleetPlan', () => {
  it('POST /v1/fleet-plan, body JSON giữ nguyên [lat, lng] và mọi trường tuỳ chọn', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify(PLAN), { headers: { 'content-type': 'application/json' } }),
    );
    const client = createClient({
      apiKey: 'mlv_live_test00000000000000000000',
      baseUrl: 'https://api.test/',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const opts = {
      mode: 'car' as const,
      vehicles: [
        { id: 'xe-1', start: [10.7725, 106.698] as [number, number], capacity: 20, max_jobs: 4 },
        { id: 'xe-2', start: [10.7725, 106.698] as [number, number], end: 'open' as const },
      ],
      jobs: [
        {
          id: 'don-1',
          location: [10.7826, 106.6958] as [number, number],
          demand: 3,
          service_s: 300,
          time_windows: [['2026-09-24T09:00:00+07:00', '2026-09-24T10:00:00+07:00']] as [
            string,
            string,
          ][],
        },
      ],
    };
    const result = await client.fleetPlan(opts);
    expect(result).toEqual(PLAN);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(new URL(url).pathname).toBe('/v1/fleet-plan');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe(
      'mlv_live_test00000000000000000000',
    );
    expect(JSON.parse(String(init.body))).toEqual(opts);
  });
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm exec vitest run packages/core/src/client.fleet-plan.test.ts`
Expected: FAIL — `fleetPlan` không tồn tại.

- [ ] **Step 3: Thêm kiểu vào `types.ts`**

Sau `OptimizedRouteResponse` trong `packages/core/src/types.ts`:

```ts
/** Một xe trong `POST /v1/fleet-plan` (spec 23/09/2026 mục 4.1). Toạ độ `[lat, lng]`. */
export interface FleetVehicle {
  /** Chuỗi 1–64 ký tự, duy nhất trong `vehicles`. */
  id: string;
  start: [number, number];
  /** Bỏ trống = về lại `start`; `'open'` = kết thúc ở đơn cuối. */
  end?: [number, number] | 'open';
  /** Sức chứa (một chiều, số nguyên). Một xe có thì mọi xe phải có. */
  capacity?: number;
  /** Tối đa đơn cho xe này, 1–10; mặc định 10. */
  max_jobs?: number;
  /** Giờ làm [sớm nhất rời start, muộn nhất kết thúc], ISO 8601 kèm múi giờ. Có khung giờ thì mọi xe phải có. */
  time_window?: [string, string];
}

/** Một đơn trong `POST /v1/fleet-plan`. */
export interface FleetJob {
  id: string;
  location: [number, number];
  /** Khối lượng, mặc định 0; `> 0` chỉ khi các xe có `capacity`. */
  demand?: number;
  /** Thời gian dừng tại điểm, giây (0–7.200). */
  service_s?: number;
  /** 0–100: đơn ưu tiên được xếp trước khi không đủ chỗ. */
  priority?: number;
  /** 1–3 khung giờ khách nhận, ISO 8601 kèm múi giờ. */
  time_windows?: [string, string][];
}

export interface FleetPlanOptions {
  /** 1–5 xe. */
  vehicles: FleetVehicle[];
  /** 1–30 đơn, tổng không quá tổng `max_jobs` các xe. */
  jobs: FleetJob[];
  /** Một phương tiện cho cả đội; mặc định máy chủ `motorbike`. */
  mode?: TravelMode;
  lang?: DirectionsLang;
}

/** Một điểm ghé trong lịch của xe. `*_at` chỉ có ở chế độ tuyệt đối (mọi xe có `time_window`). */
export interface FleetStop {
  job: string;
  /** Giây kể từ lúc xe rời `start`. */
  arrival_s: number;
  arrival_at?: string;
  /** Chờ tới khung giờ khách, giây. */
  waiting_s: number;
  service_s: number;
}

/** Kế hoạch một xe: `DirectionsResponse` đầy đủ (vẽ và dẫn đường được ngay) cộng đơn, lịch, tải. */
export interface FleetVehiclePlan extends DirectionsResponse {
  vehicle: string;
  /** Id đơn theo thứ tự ghé; rỗng = xe nghỉ (khi đó `routes`/`waypoints` rỗng). */
  jobs: string[];
  stops: FleetStop[];
  /** Tổng `demand` các đơn được giao; 0 khi không dùng sức chứa. */
  load: number;
  /** Giây từ lúc rời start tới lúc kết thúc (tới `end`, hoặc xong đơn cuối khi open-end). */
  finish_s: number;
  departure_at?: string;
  finish_at?: string;
}

/** `POST /v1/fleet-plan` (spec 23/09/2026 mục 4.4). */
export interface FleetPlanResponse {
  mode: TravelMode;
  /** Theo thứ tự `vehicles` bạn gửi, kể cả xe không được giao đơn. */
  vehicles: FleetVehiclePlan[];
  /** Đơn không xếp được (hết chỗ, quá sức chứa, khung giờ không thoả). */
  unassigned: { id: string }[];
  summary: {
    vehicles_used: number;
    jobs_assigned: number;
    jobs_unassigned: number;
    /** Tổng `routes[0]` các xe (tuyến thật từ /route). */
    distance_m: number;
    duration_s: number;
    /** Tổng dừng và chờ theo lịch VROOM. */
    service_s: number;
    waiting_s: number;
  };
  attribution: string;
  /** Thông tin chẩn đoán, không phải hợp đồng ổn định. */
  engine?: { name: string; graph: string | null };
}
```

- [ ] **Step 4: Thêm `fleetPlan` vào `client.ts`**

Thêm `FleetPlanOptions, FleetPlanResponse,` vào danh sách `import type { … } from './types'` (giữ thứ tự alphabet: sau `DirectionsResponse`, trước `GeocodeItem`). Sau phương thức `optimizedRoute` thêm:

```ts
    /**
     * Chia đơn cho đội xe (spec 23/09/2026): body JSON `[lat, lng]`; mỗi `vehicles[k]` trong response
     * là DirectionsResponse + `vehicle`/`jobs`/`stops`, đưa thẳng vào routes.show() hay navigation.start().
     * Một lượt Chỉ đường mỗi request; nhịp 2 request/phút/khoá.
     */
    fleetPlan: (opts: FleetPlanOptions) => post<FleetPlanResponse>('/v1/fleet-plan', opts),
```

- [ ] **Step 5: Re-export kiểu ở web và RN**

- `packages/web/src/index.ts`: thêm `FleetJob, FleetPlanOptions, FleetPlanResponse, FleetStop, FleetVehicle, FleetVehiclePlan,` vào khối `export type { … } from '@mapslibvn/core'` (sau `DirectionsResponse`).
- `packages/web/src/umd.ts`: thêm cùng sáu tên vào khối `export type { … } from './index'`.
- `packages/react-native/src/index.ts`: thêm cùng sáu tên vào khối `export type { … } from '@mapslibvn/core'`.

- [ ] **Step 6: Build core, chạy test, typecheck**

Run: `pnpm --filter @mapslibvn/core build && pnpm exec vitest run packages/core/src/client.fleet-plan.test.ts && pnpm typecheck`
Expected: build xanh (size-limit còn dưới 16 kB — kiểu không tốn byte, `fleetPlan` ~60 B), test PASS, typecheck sạch.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/client.ts packages/core/src/client.fleet-plan.test.ts packages/web/src/index.ts packages/web/src/umd.ts packages/react-native/src/index.ts
git commit -m "feat(core): kiểu FleetPlan* và client.fleetPlan() — POST /v1/fleet-plan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 6: `routing/fleet.ts` (phần 1) — hằng số, `parseFleetBody`, `fleetVroomBody`, `fleetCacheUrl`

**Files:**
- Create: `apps/api/src/routing/fleet.ts`
- Test: `apps/api/test/routing-fleet.test.ts`

- [ ] **Step 1: Test đỏ — kiểm đầu vào**

Tạo `apps/api/test/routing-fleet.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  FLEET_MAX_JOBS,
  FLEET_MAX_JOBS_PER_VEHICLE,
  FLEET_MAX_VEHICLES,
  fleetCacheUrl,
  fleetVroomBody,
  parseFleetBody,
} from '../src/routing/fleet';
import { OPTIMIZED_MAX_STOPS } from '../src/routing/optimized';

export const DEPOT: [number, number] = [10.7725, 106.698]; // Chợ Bến Thành
export const HO_CON_RUA: [number, number] = [10.7826, 106.6958];
export const NHA_RONG: [number, number] = [10.7686, 106.7069];
export const DINH_DOC_LAP: [number, number] = [10.777, 106.6953];
const T0 = '2026-09-24T08:00:00+07:00';
const T1 = '2026-09-24T12:00:00+07:00';

/** Body hợp lệ nhỏ nhất: 2 xe cùng kho (xe-2 open-end), 3 đơn, không ràng buộc giờ. */
export const BODY = {
  vehicles: [
    { id: 'xe-1', start: DEPOT },
    { id: 'xe-2', start: DEPOT, end: 'open' },
  ],
  jobs: [
    { id: 'don-1', location: HO_CON_RUA, service_s: 120 },
    { id: 'don-2', location: NHA_RONG, service_s: 120 },
    { id: 'don-3', location: DINH_DOC_LAP },
  ],
};

/** Chế độ tuyệt đối: mọi xe có time_window, đơn 1 có khung giờ, sức chứa 5. */
export const BODY_ABS = {
  mode: 'car',
  vehicles: [
    { id: 'xe-1', start: DEPOT, capacity: 5, time_window: [T0, T1] },
    { id: 'xe-2', start: DEPOT, end: 'open', capacity: 5, max_jobs: 2, time_window: [T0, T1] },
  ],
  jobs: [
    {
      id: 'don-1',
      location: HO_CON_RUA,
      demand: 3,
      service_s: 300,
      priority: 50,
      time_windows: [['2026-09-24T09:00:00+07:00', '2026-09-24T10:00:00+07:00']],
    },
    { id: 'don-2', location: NHA_RONG, demand: 2 },
  ],
};

export function expect400(action: () => unknown, message: RegExp): void {
  try {
    action();
    throw new Error('phải ném');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).code).toBe('invalid_request');
    expect((error as ApiError).message).toMatch(message);
  }
}

const voi = (patch: Record<string, unknown>) => ({ ...BODY, ...patch });
const xe = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `xe-${i}`, start: DEPOT }));
const don = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `don-${i}`, location: [10.77 + i * 0.001, 106.69] }));

describe('hằng số', () => {
  it('5 xe, 30 đơn, 10 đơn mỗi xe = OPTIMIZED_MAX_STOPS', () => {
    expect(FLEET_MAX_VEHICLES).toBe(5);
    expect(FLEET_MAX_JOBS).toBe(30);
    expect(FLEET_MAX_JOBS_PER_VEHICLE).toBe(OPTIMIZED_MAX_STOPS);
  });
});

describe('parseFleetBody — mặc định', () => {
  it('end bỏ = về start; "open" = null; capacity null; max_jobs 10; demand/service/priority 0; motorbike/vi; tương đối', () => {
    const p = parseFleetBody(BODY);
    expect(p.mode).toBe('motorbike');
    expect(p.lang).toBe('vi');
    expect(p.absoluteTime).toBe(false);
    expect(p.vehicles[0]).toEqual({
      id: 'xe-1',
      start: { lat: 10.7725, lng: 106.698 },
      end: { lat: 10.7725, lng: 106.698 },
      capacity: null,
      maxJobs: 10,
      timeWindow: null,
    });
    expect(p.vehicles[1]?.end).toBeNull();
    expect(p.jobs[0]).toEqual({
      id: 'don-1',
      location: { lat: 10.7826, lng: 106.6958 },
      demand: 0,
      serviceS: 120,
      priority: 0,
      timeWindows: [],
    });
    expect(p.jobs[2]?.serviceS).toBe(0);
  });

  it('chế độ tuyệt đối: parse ISO thành unix + lệch múi, capacity, max_jobs, priority, mode car', () => {
    const p = parseFleetBody(BODY_ABS);
    expect(p.absoluteTime).toBe(true);
    expect(p.mode).toBe('car');
    expect(p.vehicles[0]?.timeWindow?.[0]).toEqual({ unix: Date.parse(T0) / 1000, offsetMin: 420 });
    expect(p.vehicles[0]?.capacity).toBe(5);
    expect(p.vehicles[1]?.maxJobs).toBe(2);
    expect(p.jobs[0]?.timeWindows).toHaveLength(1);
    expect(p.jobs[0]?.priority).toBe(50);
    expect(p.jobs[0]?.demand).toBe(3);
  });
});

describe('parseFleetBody — 400', () => {
  it('body không phải object; thiếu/quá số xe, số đơn', () => {
    expect400(() => parseFleetBody(null), /JSON object/);
    expect400(() => parseFleetBody([]), /JSON object/);
    expect400(() => parseFleetBody(voi({ vehicles: [] })), /vehicles phải là mảng/);
    expect400(() => parseFleetBody(voi({ vehicles: xe(6) })), /vehicles tối đa 5/);
    expect400(() => parseFleetBody(voi({ jobs: [] })), /jobs phải là mảng/);
    expect400(() => parseFleetBody(voi({ vehicles: xe(5), jobs: don(31) })), /jobs tối đa 30/);
  });

  it('id: chuỗi 1–64, duy nhất trong từng danh sách', () => {
    expect400(() => parseFleetBody(voi({ vehicles: [{ id: 7, start: DEPOT }] })), /vehicles\[0\]\.id/);
    expect400(() => parseFleetBody(voi({ vehicles: [{ id: 'a'.repeat(65), start: DEPOT }] })), /1–64/);
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'x', start: DEPOT }, { id: 'x', start: DEPOT }] })),
      /bị trùng/,
    );
    // Cùng id ở xe và đơn thì hợp lệ — hai danh sách khác nhau.
    expect(() =>
      parseFleetBody(voi({ vehicles: [{ id: 'don-1', start: DEPOT }] })),
    ).not.toThrow();
  });

  it('toạ độ sai, ngoài Việt Nam, cặp xa hơn trần chim bay theo mode', () => {
    expect400(() => parseFleetBody(voi({ vehicles: [{ id: 'x', start: [106.698, 10.7725, 1] }] })), /\[lat, lng\]/);
    expect400(() => parseFleetBody(voi({ vehicles: [{ id: 'x', start: ['a', 'b'] }] })), /hợp lệ/);
    expect400(() => parseFleetBody(voi({ jobs: [{ id: 'bkk', location: [13.75, 100.5] }] })), /Việt Nam/);
    // Hà Nội cách kho HCM ~1.140 km: quá 200 km xe máy, quá 400 km ô tô, nhưng thông điệp gọi đúng tên hai điểm.
    expect400(
      () => parseFleetBody(voi({ jobs: [{ id: 'hn', location: [21.0285, 105.8542] }] })),
      /xe xe-1 \(start\) và đơn hn cách nhau 1\d{3} km, đội xe motorbike tối đa 200 km/,
    );
    expect400(
      () => parseFleetBody(voi({ mode: 'car', jobs: [{ id: 'hn', location: [21.0285, 105.8542] }] })),
      /tối đa 400 km/,
    );
  });

  it('mode/lang lạ; số nguyên ngoài khoảng', () => {
    expect400(() => parseFleetBody(voi({ mode: 'bike' })), /mode chỉ nhận/);
    expect400(() => parseFleetBody(voi({ lang: 7 })), /lang/);
    expect400(() => parseFleetBody(voi({ vehicles: [{ id: 'x', start: DEPOT, max_jobs: 11 }] })), /max_jobs phải là số nguyên từ 1 đến 10/);
    expect400(() => parseFleetBody(voi({ vehicles: [{ id: 'x', start: DEPOT, max_jobs: 0 }] })), /max_jobs/);
    expect400(() => parseFleetBody(voi({ vehicles: [{ id: 'x', start: DEPOT, capacity: 1.5 }] })), /capacity/);
    expect400(() => parseFleetBody(voi({ jobs: [{ id: 'd', location: HO_CON_RUA, service_s: 7201 }] })), /service_s.*0 đến 7200/);
    expect400(() => parseFleetBody(voi({ jobs: [{ id: 'd', location: HO_CON_RUA, priority: 101 }] })), /priority/);
  });

  it('số đơn vượt tổng max_jobs', () => {
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'x', start: DEPOT, max_jobs: 2 }] })),
      /3 đơn nhưng các xe chỉ nhận tối đa 2/,
    );
  });

  it('sức chứa tất cả-hoặc-không; demand cần capacity', () => {
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'a', start: DEPOT, capacity: 5 }, { id: 'b', start: DEPOT }] })),
      /mọi xe phải có/,
    );
    expect400(
      () => parseFleetBody(voi({ jobs: [{ id: 'd', location: HO_CON_RUA, demand: 1 }] })),
      /demand.*capacity/,
    );
  });

  it('khung giờ: mọi xe phải có time_window; kèm múi giờ; bắt đầu < kết thúc; ≤ 24 h; trải ≤ 48 h; ≤ 3 khung', () => {
    expect400(
      () => parseFleetBody(voi({ jobs: [{ id: 'd', location: HO_CON_RUA, time_windows: [[T0, T1]] }] })),
      /mọi xe phải có time_window/,
    );
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'a', start: DEPOT, time_window: ['2026-09-24T08:00:00', T1] }] })),
      /múi giờ/,
    );
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'a', start: DEPOT, time_window: [T1, T0] }] })),
      /bắt đầu phải trước kết thúc/,
    );
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'a', start: DEPOT, time_window: [T0, '2026-09-25T08:00:01+07:00'] }] })),
      /tối đa 24 giờ/,
    );
    expect400(
      () =>
        parseFleetBody(
          voi({
            vehicles: [{ id: 'a', start: DEPOT, time_window: [T0, T1] }],
            jobs: [{ id: 'd', location: HO_CON_RUA, time_windows: [['2026-09-26T09:00:00+07:00', '2026-09-26T10:00:00+07:00']] }],
          }),
        ),
      /48 giờ/,
    );
    expect400(
      () =>
        parseFleetBody(
          voi({
            vehicles: [{ id: 'a', start: DEPOT, time_window: [T0, T1] }],
            jobs: [{ id: 'd', location: HO_CON_RUA, time_windows: [[T0, T1], [T0, T1], [T0, T1], [T0, T1]] }],
          }),
        ),
      /time_windows tối đa 3/,
    );
  });
});

describe('fleetVroomBody', () => {
  it('id là chỉ số, [lng, lat], profile theo mode, end bỏ khi open, không capacity/delivery/time_window khi không dùng', () => {
    const body = fleetVroomBody(parseFleetBody(BODY));
    expect(body.vehicles).toEqual([
      { id: 0, profile: 'motor_scooter', start: [106.698, 10.7725], end: [106.698, 10.7725], max_tasks: 10 },
      { id: 1, profile: 'motor_scooter', start: [106.698, 10.7725], max_tasks: 10 },
    ]);
    expect(body.jobs[0]).toEqual({ id: 0, location: [106.6958, 10.7826], service: 120, priority: 0 });
    expect(body.jobs[2]).toEqual({ id: 2, location: [106.6953, 10.777], service: 0, priority: 0 });
  });

  it('chế độ tuyệt đối: capacity [c], delivery [demand] cho MỌI đơn, time_window unix, priority, auto', () => {
    const body = fleetVroomBody(parseFleetBody(BODY_ABS));
    const t0 = Date.parse(T0) / 1000;
    const t1 = Date.parse(T1) / 1000;
    expect(body.vehicles[0]).toEqual({
      id: 0, profile: 'auto', start: [106.698, 10.7725], end: [106.698, 10.7725], capacity: [5], max_tasks: 10, time_window: [t0, t1],
    });
    expect(body.vehicles[1]?.max_tasks).toBe(2);
    expect(body.jobs[0]).toEqual({
      id: 0, location: [106.6958, 10.7826], service: 300, delivery: [3], priority: 50,
      time_windows: [[Date.parse('2026-09-24T09:00:00+07:00') / 1000, Date.parse('2026-09-24T10:00:00+07:00') / 1000]],
    });
    expect(body.jobs[1]).toEqual({ id: 1, location: [106.7069, 10.7686], service: 0, delivery: [2], priority: 0 });
  });
});

describe('fleetCacheUrl', () => {
  it('làm tròn 4 chữ số (11 m); khác mode/lang/đơn → khoá khác; dạng URL cache', async () => {
    const a = await fleetCacheUrl(parseFleetBody(BODY));
    const b = await fleetCacheUrl(parseFleetBody(voi({ vehicles: [{ id: 'xe-1', start: [10.77251, 106.69801] }, { id: 'xe-2', start: DEPOT, end: 'open' }] })));
    const c = await fleetCacheUrl(parseFleetBody(voi({ mode: 'car' })));
    const d = await fleetCacheUrl(parseFleetBody(voi({ jobs: [BODY.jobs[0], BODY.jobs[1]] })));
    expect(a).toMatch(/^https:\/\/cache\.mapslibvn\/fleet-plan\?v=1&h=[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
  });
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-fleet.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `fleet.ts` phần 1**

Tạo `apps/api/src/routing/fleet.ts`:

```ts
import type { DirectionsLang, TravelMode } from '@mapslibvn/core';
import { ApiError } from '../errors';
import type { LatLng } from '../params';
import { type ParsedTime, parseIsoWithOffset } from './fleet-time';
import { OPTIMIZED_MAX_STOPS } from './optimized';
import {
  assertInVietnam,
  DIRECTIONS_LANGS,
  haversineM,
  MATRIX_MAX_CROW_DISTANCE_M,
  oneOf,
  TRAVEL_MODES,
} from './params';
import { VALHALLA_COSTING } from './valhalla';
import type { VroomJob, VroomRequest, VroomVehicle } from './vroom';

/**
 * Trần cỡ (spec 2026-09-23 mục 4.9): 5 xe + 30 đơn ≤ 40 điểm → ma trận Valhalla ≤ 1.600 cặp, dưới
 * `max_matrix_location_pairs` 2.500. Mỗi xe ≤ 10 đơn = OPTIMIZED_MAX_STOPS = MAX_VIA: tuyến từng xe
 * dẫn đường và tính lại được như tuyến tối ưu một xe. Đổi số ở đây phải đổi docs, site, playground-lib
 * và smoke cùng commit; số cuối chốt theo phép đo production (mục 8).
 */
export const FLEET_MAX_VEHICLES = 5;
export const FLEET_MAX_JOBS = 30;
export const FLEET_MAX_JOBS_PER_VEHICLE = OPTIMIZED_MAX_STOPS;
export const FLEET_MAX_TIME_WINDOWS = 3;
export const FLEET_MAX_SERVICE_S = 7_200;
export const FLEET_MAX_QUANTITY = 1_000_000;
export const FLEET_MAX_PRIORITY = 100;
export const FLEET_MAX_BODY_BYTES = 65_536;
export const FLEET_ID_MAX_LENGTH = 64;
export const FLEET_MAX_WINDOW_S = 86_400;
export const FLEET_MAX_SPAN_S = 172_800;

export interface FleetVehicleParams {
  id: string;
  start: LatLng;
  /** null = open-end (kết thúc ở đơn cuối); mặc định = start. */
  end: LatLng | null;
  capacity: number | null;
  maxJobs: number;
  timeWindow: [ParsedTime, ParsedTime] | null;
}
export interface FleetJobParams {
  id: string;
  location: LatLng;
  demand: number;
  serviceS: number;
  priority: number;
  timeWindows: [ParsedTime, ParsedTime][];
}
export interface FleetParams {
  vehicles: FleetVehicleParams[];
  jobs: FleetJobParams[];
  mode: TravelMode;
  lang: DirectionsLang;
  /** true = mọi xe có time_window: VROOM nhận UNIX giây và response có `*_at` (spec mục 4.3). */
  absoluteTime: boolean;
}

const bad = (message: string) => new ApiError(400, 'invalid_request', message);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function readId(raw: unknown, name: string, seen: Set<string>): string {
  if (typeof raw !== 'string') throw bad(`${name}.id phải là chuỗi`);
  const id = raw.trim();
  if (id.length === 0 || id.length > FLEET_ID_MAX_LENGTH) {
    throw bad(`${name}.id phải dài 1–${FLEET_ID_MAX_LENGTH} ký tự`);
  }
  if (seen.has(id)) throw bad(`${name}.id "${id}" bị trùng`);
  seen.add(id);
  return id;
}

function readLatLng(raw: unknown, name: string): LatLng {
  if (!Array.isArray(raw) || raw.length !== 2) throw bad(`${name} phải là [lat, lng]`);
  const [lat, lng] = raw as unknown[];
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    throw bad(`${name} phải là [lat, lng] hợp lệ`);
  }
  return { lat, lng };
}

function readInt(raw: unknown, name: string, min: number, max: number, dflt: number): number {
  if (raw === undefined) return dflt;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw bad(`${name} phải là số nguyên từ ${min} đến ${max}`);
  }
  return raw;
}

function readEnum<T extends string>(raw: unknown, allowed: readonly T[], dflt: T, name: string): T {
  if (raw === undefined) return dflt;
  if (typeof raw !== 'string') throw bad(`${name} chỉ nhận ${allowed.join(', ')}`);
  return oneOf(raw, allowed, dflt, name);
}

function readWindow(raw: unknown, name: string): [ParsedTime, ParsedTime] {
  if (!Array.isArray(raw) || raw.length !== 2) throw bad(`${name} phải là [bắt đầu, kết thúc]`);
  const start = parseIsoWithOffset(raw[0], `${name}[0]`);
  const end = parseIsoWithOffset(raw[1], `${name}[1]`);
  if (start.unix >= end.unix) throw bad(`${name}: bắt đầu phải trước kết thúc`);
  if (end.unix - start.unix > FLEET_MAX_WINDOW_S) throw bad(`${name}: mỗi khung giờ tối đa 24 giờ`);
  return [start, end];
}

/** Đếm TRƯỚC khi parse sâu: mảng nghìn phần tử bị từ chối ở bước đếm, không tốn CPU parse từng cái. */
function countList(raw: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw bad(`${name} phải là mảng có ít nhất 1 phần tử`);
  }
  if (raw.length > max) throw bad(`${name} tối đa ${max} phần tử (đang ${raw.length})`);
  return raw;
}

interface NamedPoint {
  name: string;
  point: LatLng;
}

/** Mọi cặp điểm ≤ trần chim bay của ma trận theo mode — VROOM gửi một ma trận vuông cho Valhalla, một cặp quá xa là engine từ chối cả request. */
function assertFleetCrowDistance(named: readonly NamedPoint[], mode: TravelMode): void {
  const limit = MATRIX_MAX_CROW_DISTANCE_M[mode];
  for (let a = 0; a < named.length; a++) {
    for (let b = a + 1; b < named.length; b++) {
      const pa = named[a];
      const pb = named[b];
      if (!pa || !pb) continue;
      const d = haversineM(pa.point, pb.point);
      if (d > limit) {
        throw bad(
          `${pa.name} và ${pb.name} cách nhau ${Math.round(d / 1000)} km, đội xe ${mode} tối đa ${limit / 1000} km đường chim bay`,
        );
      }
    }
  }
}

/** Kiểm hết ở Worker (spec mục 4.2), 400 không tốn lượt, không gọi VROOM. */
export function parseFleetBody(raw: unknown): FleetParams {
  if (!isRecord(raw)) throw bad('Body phải là JSON object có vehicles và jobs');
  const rawVehicles = countList(raw.vehicles, 'vehicles', FLEET_MAX_VEHICLES);
  const rawJobs = countList(raw.jobs, 'jobs', FLEET_MAX_JOBS);
  const mode = readEnum(raw.mode, TRAVEL_MODES, 'motorbike', 'mode');
  const lang = readEnum(raw.lang, DIRECTIONS_LANGS, 'vi', 'lang');

  const vehicleIds = new Set<string>();
  const vehicles: FleetVehicleParams[] = rawVehicles.map((v, i) => {
    const name = `vehicles[${i}]`;
    if (!isRecord(v)) throw bad(`${name} phải là object`);
    const id = readId(v.id, name, vehicleIds);
    const start = readLatLng(v.start, `${name}.start`);
    let end: LatLng | null = start;
    if (v.end === 'open') end = null;
    else if (v.end !== undefined) end = readLatLng(v.end, `${name}.end`);
    return {
      id,
      start,
      end,
      capacity:
        v.capacity === undefined
          ? null
          : readInt(v.capacity, `${name}.capacity`, 0, FLEET_MAX_QUANTITY, 0),
      maxJobs: readInt(
        v.max_jobs,
        `${name}.max_jobs`,
        1,
        FLEET_MAX_JOBS_PER_VEHICLE,
        FLEET_MAX_JOBS_PER_VEHICLE,
      ),
      timeWindow:
        v.time_window === undefined ? null : readWindow(v.time_window, `${name}.time_window`),
    };
  });

  const jobIds = new Set<string>();
  const jobs: FleetJobParams[] = rawJobs.map((j, i) => {
    const name = `jobs[${i}]`;
    if (!isRecord(j)) throw bad(`${name} phải là object`);
    const id = readId(j.id, name, jobIds);
    const location = readLatLng(j.location, `${name}.location`);
    let timeWindows: [ParsedTime, ParsedTime][] = [];
    if (j.time_windows !== undefined) {
      const list = countList(j.time_windows, `${name}.time_windows`, FLEET_MAX_TIME_WINDOWS);
      timeWindows = list.map((w, k) => readWindow(w, `${name}.time_windows[${k}]`));
    }
    return {
      id,
      location,
      demand: readInt(j.demand, `${name}.demand`, 0, FLEET_MAX_QUANTITY, 0),
      serviceS: readInt(j.service_s, `${name}.service_s`, 0, FLEET_MAX_SERVICE_S, 0),
      priority: readInt(j.priority, `${name}.priority`, 0, FLEET_MAX_PRIORITY, 0),
      timeWindows,
    };
  });

  const named: NamedPoint[] = [];
  for (const v of vehicles) {
    named.push({ name: `xe ${v.id} (start)`, point: v.start });
    if (v.end) named.push({ name: `xe ${v.id} (end)`, point: v.end });
  }
  for (const j of jobs) named.push({ name: `đơn ${j.id}`, point: j.location });
  assertInVietnam(named.map((n) => n.point));
  assertFleetCrowDistance(named, mode);

  const cho = vehicles.reduce((sum, v) => sum + v.maxJobs, 0);
  if (jobs.length > cho) {
    throw bad(
      `${jobs.length} đơn nhưng các xe chỉ nhận tối đa ${cho} (${vehicles.length} xe, max_jobs ${vehicles.map((v) => v.maxJobs).join(' + ')})`,
    );
  }

  const coSucChua = vehicles.some((v) => v.capacity !== null);
  if (coSucChua && vehicles.some((v) => v.capacity === null)) {
    throw bad('Sức chứa là tất cả hoặc không: một xe có capacity thì mọi xe phải có');
  }
  if (!coSucChua && jobs.some((j) => j.demand > 0)) {
    throw bad('Đơn có khối lượng (demand) thì mọi xe phải có sức chứa (capacity)');
  }

  const coKhungGio =
    vehicles.some((v) => v.timeWindow !== null) || jobs.some((j) => j.timeWindows.length > 0);
  if (coKhungGio && vehicles.some((v) => v.timeWindow === null)) {
    throw bad('Có khung giờ thì mọi xe phải có time_window (giờ làm)');
  }
  if (coKhungGio) {
    const moc = [
      ...vehicles.flatMap((v) => v.timeWindow ?? []),
      ...jobs.flatMap((j) => j.timeWindows.flat()),
    ];
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const t of moc) {
      min = Math.min(min, t.unix);
      max = Math.max(max, t.unix);
    }
    if (max - min > FLEET_MAX_SPAN_S) throw bad('Mọi mốc giờ trong request phải nằm trong 48 giờ');
  }

  return { vehicles, jobs, mode, lang, absoluteTime: coKhungGio };
}

const lngLat = ({ lat, lng }: LatLng): [number, number] => [lng, lat];

/** Body vroom-express: id là chỉ số vào mảng của ta (VROOM đòi số nguyên), profile = costing Valhalla. */
export function fleetVroomBody(p: FleetParams): VroomRequest {
  const coSucChua = p.vehicles.some((v) => v.capacity !== null);
  const profile = VALHALLA_COSTING[p.mode];
  return {
    vehicles: p.vehicles.map(
      (v, i): VroomVehicle => ({
        id: i,
        profile,
        start: lngLat(v.start),
        ...(v.end ? { end: lngLat(v.end) } : {}),
        ...(v.capacity !== null ? { capacity: [v.capacity] } : {}),
        max_tasks: v.maxJobs,
        ...(v.timeWindow
          ? { time_window: [v.timeWindow[0].unix, v.timeWindow[1].unix] as [number, number] }
          : {}),
      }),
    ),
    jobs: p.jobs.map(
      (j, i): VroomJob => ({
        id: i,
        location: lngLat(j.location),
        service: j.serviceS,
        ...(coSucChua ? { delivery: [j.demand] } : {}),
        priority: j.priority,
        ...(j.timeWindows.length > 0
          ? {
              time_windows: j.timeWindows.map(
                ([a, b]) => [a.unix, b.unix] as [number, number],
              ),
            }
          : {}),
      }),
    ),
  };
}

/**
 * Khoá cache = sha256 của tham số đã chuẩn hoá: toạ độ làm tròn 4 chữ số (~11 m, cùng bài học với
 * ma trận), giờ dạng UNIX giây. Body POST không có URL để làm khoá nên phải băm.
 */
export async function fleetCacheUrl(p: FleetParams): Promise<string> {
  const r4 = ({ lat, lng }: LatLng): string => `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const tw = (w: [ParsedTime, ParsedTime] | null): [number, number] | null =>
    w ? [w[0].unix, w[1].unix] : null;
  const canonical = JSON.stringify({
    v: 1,
    m: p.mode,
    l: p.lang,
    xe: p.vehicles.map((v) => [
      v.id,
      r4(v.start),
      v.end ? r4(v.end) : 'open',
      v.capacity,
      v.maxJobs,
      tw(v.timeWindow),
    ]),
    don: p.jobs.map((j) => [
      j.id,
      r4(j.location),
      j.demand,
      j.serviceS,
      j.priority,
      j.timeWindows.map(tw),
    ]),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `https://cache.mapslibvn/fleet-plan?v=1&h=${hex}`;
}
```

- [ ] **Step 4: Chạy, xanh; lint**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-fleet.test.ts && pnpm lint`
Expected: PASS toàn bộ; lint sạch (nếu biome đòi format, chạy `pnpm lint:fix` rồi kiểm lại).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routing/fleet.ts apps/api/test/routing-fleet.test.ts
git commit -m "feat(api): fleet.ts — kiểm body POST /v1/fleet-plan, body VROOM, khoá cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `routing/fleet.ts` (phần 2) — `translateFleet`, `fleetRouteBody`, `assembleFleetPlan`, `noRouteMessage`

**Files:**
- Modify: `apps/api/src/routing/fleet.ts` (thêm cuối file + import)
- Create: `apps/api/test/fixtures/vroom/two-vehicles.json`
- Modify: `apps/api/test/routing-fleet.test.ts` (thêm describe)

- [ ] **Step 1: Fixture VROOM viết tay**

Tạo `apps/api/test/fixtures/vroom/two-vehicles.json` — kết quả cho `BODY` của Task 6: xe-1 nhận đơn 2 rồi đơn 1, xe-2 rỗi, đơn 3 không xếp được:

```json
{
  "code": 0,
  "summary": {
    "cost": 760,
    "routes": 1,
    "unassigned": 1,
    "service": 240,
    "duration": 760,
    "waiting_time": 0
  },
  "unassigned": [{ "id": 2, "location": [106.6953, 10.777] }],
  "routes": [
    {
      "vehicle": 0,
      "cost": 760,
      "service": 240,
      "duration": 760,
      "waiting_time": 0,
      "steps": [
        { "type": "start", "location": [106.698, 10.7725], "arrival": 0, "duration": 0 },
        {
          "type": "job",
          "id": 1,
          "location": [106.7069, 10.7686],
          "arrival": 300,
          "duration": 300,
          "service": 120,
          "waiting_time": 0
        },
        {
          "type": "job",
          "id": 0,
          "location": [106.6958, 10.7826],
          "arrival": 700,
          "duration": 580,
          "service": 120,
          "waiting_time": 0
        },
        { "type": "end", "location": [106.698, 10.7725], "arrival": 1000, "duration": 760 }
      ]
    }
  ]
}
```

- [ ] **Step 2: Test đỏ**

Thêm vào đầu `apps/api/test/routing-fleet.test.ts` các import:

```ts
import type { ValhallaRouteResponse } from '../src/routing/valhalla';
import type { VroomResponse } from '../src/routing/vroom';
import routeFixture from './fixtures/valhalla/optimized-two-stops.json';
import vroomFixture from './fixtures/vroom/two-vehicles.json';
```

và mở rộng import từ `../src/routing/fleet` thêm `assembleFleetPlan, fleetRouteBody, noRouteMessage, translateFleet`. Thêm cuối file:

```ts
const route4 = routeFixture as unknown as ValhallaRouteResponse;
/** Tuyến 3 điểm / 2 leg cho xe open-end 2 đơn: cắt leg và điểm cuối khỏi fixture 4 điểm. */
const route3: ValhallaRouteResponse = {
  trip: {
    ...route4.trip,
    legs: route4.trip.legs.slice(0, 2),
    locations: route4.trip.locations.slice(0, 3),
  },
};
const vroom = vroomFixture as VroomResponse;

describe('translateFleet — chế độ tương đối', () => {
  it('xe-1: đơn theo thứ tự ghé, arrival_s từ lúc xuất phát, finish_s tới end; xe-2 rỗi; đơn 3 unassigned', () => {
    const p = parseFleetBody(BODY);
    const skel = translateFleet(vroom, p);
    expect(skel.vehicles).toHaveLength(2);
    expect(skel.vehicles[0]).toEqual({
      index: 0,
      jobIndexes: [1, 0],
      stops: [
        { job: 'don-2', arrival_s: 300, waiting_s: 0, service_s: 120 },
        { job: 'don-1', arrival_s: 700, waiting_s: 0, service_s: 120 },
      ],
      departureUnix: 0,
      finishS: 1000,
      load: 0,
    });
    expect(skel.vehicles[1]).toEqual({ index: 1, jobIndexes: [], stops: [], departureUnix: 0, finishS: 0, load: 0 });
    expect(skel.unassigned).toEqual([2]);
    expect(skel.serviceS).toBe(240);
    expect(skel.waitingS).toBe(0);
  });

  it('không đoán khi dữ liệu lệch: vehicle lạ, đơn lạ, đơn gán hai lần, tổng đơn không khớp, step lạ → 503', () => {
    const p = parseFleetBody(BODY);
    const loi503 = (json: VroomResponse) => {
      try {
        translateFleet(json, p);
        throw new Error('phải ném');
      } catch (error) {
        expect((error as ApiError).status).toBe(503);
      }
    };
    const route = vroom.routes?.[0];
    if (!route) throw new Error('fixture thiếu route');
    loi503({ ...vroom, routes: [{ ...route, vehicle: 5 }] });
    loi503({ ...vroom, routes: [{ ...route, steps: route.steps.map((s) => (s.type === 'job' ? { ...s, id: 9 } : s)) }] });
    loi503({ ...vroom, routes: [{ ...route, steps: route.steps.map((s) => (s.type === 'job' ? { ...s, id: 0 } : s)) }] });
    loi503({ ...vroom, unassigned: [] }); // 2 đơn gán + 0 unassigned ≠ 3
    loi503({ ...vroom, unassigned: [{ id: 0 }, { id: 2 }] }); // đơn 0 vừa gán vừa unassigned
    loi503({ ...vroom, routes: [{ ...route, steps: [{ type: 'pickup', arrival: 0, duration: 0 }] }] });
    loi503({ ...vroom, routes: undefined });
  });
});

describe('translateFleet — chế độ tuyệt đối', () => {
  const T_DEP = Date.parse('2026-09-24T08:12:00+07:00') / 1000;
  const absVroom: VroomResponse = {
    code: 0,
    summary: { cost: 1, routes: 1, unassigned: 0, service: 300, duration: 1380, waiting_time: 240 },
    unassigned: [],
    routes: [
      {
        vehicle: 0,
        cost: 1,
        service: 300,
        duration: 1380,
        waiting_time: 240,
        steps: [
          { type: 'start', arrival: T_DEP, duration: 0 },
          { type: 'job', id: 1, arrival: T_DEP + 540, duration: 540, service: 0, waiting_time: 0 },
          { type: 'job', id: 0, arrival: T_DEP + 1620, duration: 1380, service: 300, waiting_time: 240 },
          { type: 'end', arrival: T_DEP + 2700, duration: 1380 },
        ],
      },
    ],
  };

  it('departure do VROOM chọn; arrival_at theo múi +07:00; load = tổng demand; xe-2 rỗi departure = đầu ca', () => {
    const p = parseFleetBody(BODY_ABS);
    const skel = translateFleet(absVroom, p);
    expect(skel.vehicles[0]?.departureUnix).toBe(T_DEP);
    expect(skel.vehicles[0]?.stops).toEqual([
      { job: 'don-2', arrival_s: 540, arrival_at: '2026-09-24T08:21:00+07:00', waiting_s: 0, service_s: 0 },
      { job: 'don-1', arrival_s: 1620, arrival_at: '2026-09-24T08:39:00+07:00', waiting_s: 240, service_s: 300 },
    ]);
    expect(skel.vehicles[0]?.finishS).toBe(2700);
    expect(skel.vehicles[0]?.load).toBe(5);
    expect(skel.vehicles[1]?.departureUnix).toBe(Date.parse('2026-09-24T08:00:00+07:00') / 1000);
  });

  it('open-end không có step end: finish = đơn cuối + chờ + dừng', () => {
    const p = parseFleetBody(BODY_ABS);
    const route = absVroom.routes?.[0];
    if (!route) throw new Error('thiếu route');
    const openVroom: VroomResponse = {
      ...absVroom,
      routes: [{ ...route, vehicle: 1, steps: route.steps.slice(0, 3) }],
    };
    const skel = translateFleet(openVroom, p);
    expect(skel.vehicles[1]?.finishS).toBe(1620 + 240 + 300);
    expect(skel.vehicles[0]?.jobIndexes).toEqual([]);
  });
});

describe('fleetRouteBody', () => {
  it('start, đơn theo thứ tự ghé, end (bỏ khi open-end); costing và ngôn ngữ theo params', () => {
    const p = parseFleetBody({ ...BODY, lang: 'en' });
    const skel = translateFleet(vroom, p);
    const xe1 = skel.vehicles[0];
    if (!xe1) throw new Error('thiếu xe');
    expect(fleetRouteBody(p, xe1, 'req-1')).toEqual({
      locations: [
        { lat: 10.7725, lon: 106.698, type: 'break' },
        { lat: 10.7686, lon: 106.7069, type: 'break' },
        { lat: 10.7826, lon: 106.6958, type: 'break' },
        { lat: 10.7725, lon: 106.698, type: 'break' },
      ],
      costing: 'motor_scooter',
      directions_options: { language: 'en-US', units: 'kilometers' },
      id: 'req-1',
    });
    const open = fleetRouteBody(p, { ...xe1, index: 1 }, 'req-2');
    expect(open.locations).toHaveLength(3);
  });
});

describe('assembleFleetPlan', () => {
  it('xe có đơn = DirectionsResponse + vehicle/jobs/stops; xe rỗi có mặt với routes rỗng; summary; unassigned theo id', () => {
    const p = parseFleetBody(BODY);
    const skel = translateFleet(vroom, p);
    const plan = assembleFleetPlan(p, skel, [route4, null], '2026-09-17');
    expect(plan.mode).toBe('motorbike');
    expect(plan.vehicles).toHaveLength(2);
    const xe1 = plan.vehicles[0];
    expect(xe1?.vehicle).toBe('xe-1');
    expect(xe1?.jobs).toEqual(['don-2', 'don-1']);
    expect(xe1?.routes).toHaveLength(1);
    expect(xe1?.routes[0]?.legs).toHaveLength(3);
    expect(xe1?.waypoints).toHaveLength(4);
    expect(xe1?.stops).toHaveLength(2);
    expect(xe1?.finish_s).toBe(1000);
    expect(xe1?.load).toBe(0);
    expect(xe1).not.toHaveProperty('departure_at');
    expect(xe1?.attribution).toBe('© OpenStreetMap contributors');
    expect(plan.vehicles[1]).toMatchObject({ vehicle: 'xe-2', jobs: [], stops: [], routes: [], waypoints: [], load: 0, finish_s: 0 });
    expect(plan.unassigned).toEqual([{ id: 'don-3' }]);
    expect(plan.summary).toEqual({
      vehicles_used: 1,
      jobs_assigned: 2,
      jobs_unassigned: 1,
      distance_m: xe1?.routes[0]?.distance_m,
      duration_s: xe1?.routes[0]?.duration_s,
      service_s: 240,
      waiting_s: 0,
    });
    expect(plan.engine).toEqual({ name: 'vroom+valhalla', graph: '2026-09-17' });
  });

  it('chế độ tuyệt đối: departure_at/finish_at theo múi giờ của xe; open-end dùng tuyến 2 leg', () => {
    const p = parseFleetBody(BODY_ABS);
    const T_DEP = Date.parse('2026-09-24T08:12:00+07:00') / 1000;
    const skel = translateFleet(
      {
        code: 0,
        summary: { cost: 1, routes: 1, unassigned: 0, service: 300, duration: 900, waiting_time: 0 },
        unassigned: [],
        routes: [
          {
            vehicle: 1,
            cost: 1,
            service: 300,
            duration: 900,
            waiting_time: 0,
            steps: [
              { type: 'start', arrival: T_DEP, duration: 0 },
              { type: 'job', id: 1, arrival: T_DEP + 400, duration: 400, service: 0, waiting_time: 0 },
              { type: 'job', id: 0, arrival: T_DEP + 900, duration: 900, service: 300, waiting_time: 0 },
            ],
          },
        ],
      },
      p,
    );
    const plan = assembleFleetPlan(p, skel, [null, route3], null);
    const xe2 = plan.vehicles[1];
    expect(xe2?.departure_at).toBe('2026-09-24T08:12:00+07:00');
    expect(xe2?.finish_at).toBe('2026-09-24T08:32:00+07:00');
    expect(xe2?.routes[0]?.legs).toHaveLength(2);
    expect(xe2?.waypoints).toHaveLength(3);
    expect(plan.summary.vehicles_used).toBe(1);
    expect(plan.vehicles[0]?.departure_at).toBe('2026-09-24T08:00:00+07:00');
  });

  it('thiếu tuyến cho xe có đơn hoặc số leg lệch số đơn → 503', () => {
    const p = parseFleetBody(BODY);
    const skel = translateFleet(vroom, p);
    for (const routes of [[null, null], [route3, null]]) {
      try {
        assembleFleetPlan(p, skel, routes as (ValhallaRouteResponse | null)[], null);
        throw new Error('phải ném');
      } catch (error) {
        expect((error as ApiError).status).toBe(503);
      }
    }
  });
});

describe('noRouteMessage', () => {
  it('đối chiếu [lon, lat] trong thông điệp VROOM với đơn/xe đã gửi; không khớp → câu chung', () => {
    const ten = noRouteMessage(parseFleetBody(BODY));
    expect(
      ten('Unfound route(s) from location [106.7069,10.7686] to location [106.6958, 10.7826]'),
    ).toBe('Không tới được bằng mạng đường: đơn don-2, đơn don-1');
    expect(ten('Unfound route(s) from location [106.698,10.7725] to location [1,2]')).toBe(
      'Không tới được bằng mạng đường: xe xe-1 (điểm xuất phát)',
    );
    expect(ten('Unfound route(s)')).toBe('Có điểm không tới được bằng mạng đường');
  });
});
```

- [ ] **Step 3: Chạy, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-fleet.test.ts`
Expected: FAIL — `translateFleet` chưa export.

- [ ] **Step 4: Viết phần 2 của `fleet.ts`**

Đổi dòng import đầu file thành:

```ts
import type {
  DirectionsLang,
  DirectionsResponse,
  FleetPlanResponse,
  FleetStop,
  FleetVehiclePlan,
  TravelMode,
} from '@mapslibvn/core';
```

đổi `import { type ParsedTime, parseIsoWithOffset } from './fleet-time';` thành `import { formatIsoAt, type ParsedTime, parseIsoWithOffset } from './fleet-time';`, thêm `import { ROUTING_ATTRIBUTION, translateDirections } from './translate';`, đổi import valhalla thành `import { VALHALLA_COSTING, VALHALLA_LANGUAGE, type ValhallaRouteResponse } from './valhalla';` và import vroom thành `import type { VroomJob, VroomRequest, VroomResponse, VroomRoute, VroomVehicle } from './vroom';`. Thêm cuối file:

```ts
const ENGINE_NAME = 'vroom+valhalla';
const invalidUpstream = () =>
  new ApiError(503, 'upstream_unavailable', 'Bộ giải đội xe trả dữ liệu không hợp lệ');
const isIndex = (v: unknown, n: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n;

/** Khung kế hoạch từ VROOM, trước khi có tuyến Valhalla. */
export interface FleetVehicleSkeleton {
  index: number;
  /** Chỉ số đơn theo thứ tự ghé. */
  jobIndexes: number[];
  stops: FleetStop[];
  /** Giây: 0 ở chế độ tương đối, UNIX ở chế độ tuyệt đối (start.arrival do VROOM chọn). */
  departureUnix: number;
  finishS: number;
  load: number;
}
export interface FleetSkeleton {
  vehicles: FleetVehicleSkeleton[];
  unassigned: number[];
  serviceS: number;
  waitingS: number;
}

/**
 * VROOM → khung kế hoạch. Không đoán khi dữ liệu lệch: vehicle/id ngoài khoảng, đơn gán hai lần,
 * tổng đơn không khớp, kiểu step ta không gửi (pickup/delivery/break) → 503, không trả kế hoạch sai.
 */
export function translateFleet(json: VroomResponse, p: FleetParams): FleetSkeleton {
  const routes = json.routes;
  if (!Array.isArray(routes)) throw invalidUpstream();
  const nXe = p.vehicles.length;
  const nDon = p.jobs.length;
  const assigned = new Set<number>();
  const byVehicle = new Map<number, VroomRoute>();
  for (const route of routes) {
    if (!isIndex(route?.vehicle, nXe) || byVehicle.has(route.vehicle) || !Array.isArray(route.steps)) {
      throw invalidUpstream();
    }
    byVehicle.set(route.vehicle, route);
  }
  const vehicles: FleetVehicleSkeleton[] = p.vehicles.map((v, index) => {
    const route = byVehicle.get(index);
    const offsetMin = v.timeWindow ? v.timeWindow[0].offsetMin : 0;
    if (!route) {
      return {
        index,
        jobIndexes: [],
        stops: [],
        departureUnix: v.timeWindow ? v.timeWindow[0].unix : 0,
        finishS: 0,
        load: 0,
      };
    }
    const first = route.steps[0];
    if (!first || first.type !== 'start' || typeof first.arrival !== 'number') throw invalidUpstream();
    const departure = first.arrival;
    const jobIndexes: number[] = [];
    const stops: FleetStop[] = [];
    let load = 0;
    let finish = 0;
    for (const step of route.steps) {
      if (typeof step.arrival !== 'number') throw invalidUpstream();
      const waiting = step.waiting_time ?? 0;
      const service = step.service ?? 0;
      if (step.type === 'job') {
        if (!isIndex(step.id, nDon) || assigned.has(step.id)) throw invalidUpstream();
        const job = p.jobs[step.id];
        if (!job) throw invalidUpstream();
        assigned.add(step.id);
        jobIndexes.push(step.id);
        load += job.demand;
        stops.push({
          job: job.id,
          arrival_s: step.arrival - departure,
          ...(p.absoluteTime ? { arrival_at: formatIsoAt(step.arrival, offsetMin) } : {}),
          waiting_s: waiting,
          service_s: service,
        });
        finish = step.arrival + waiting + service - departure;
      } else if (step.type === 'end') {
        finish = step.arrival - departure;
      } else if (step.type !== 'start') {
        throw invalidUpstream();
      }
    }
    if (jobIndexes.length > v.maxJobs) throw invalidUpstream();
    return { index, jobIndexes, stops, departureUnix: departure, finishS: finish, load };
  });
  const unassigned: number[] = [];
  for (const u of json.unassigned ?? []) {
    if (!isIndex(u?.id, nDon) || assigned.has(u.id) || unassigned.includes(u.id)) {
      throw invalidUpstream();
    }
    unassigned.push(u.id);
  }
  if (assigned.size + unassigned.length !== nDon) throw invalidUpstream();
  return {
    vehicles,
    unassigned,
    serviceS: json.summary?.service ?? 0,
    waitingS: json.summary?.waiting_time ?? 0,
  };
}

/** Body `POST /route` cho một xe: start, đơn theo thứ tự VROOM, end (bỏ khi open-end). */
export function fleetRouteBody(p: FleetParams, v: FleetVehicleSkeleton, requestId: string) {
  const xe = p.vehicles[v.index];
  if (!xe) throw invalidUpstream();
  const points: LatLng[] = [xe.start];
  for (const i of v.jobIndexes) {
    const job = p.jobs[i];
    if (!job) throw invalidUpstream();
    points.push(job.location);
  }
  if (xe.end) points.push(xe.end);
  return {
    locations: points.map(({ lat, lng }) => ({ lat, lon: lng, type: 'break' })),
    costing: VALHALLA_COSTING[p.mode],
    directions_options: { language: VALHALLA_LANGUAGE[p.lang], units: 'kilometers' },
    id: requestId,
  };
}

/**
 * Ghép khung VROOM với tuyến Valhalla từng xe thành FleetPlanResponse. `routes[k]` là tuyến của xe k
 * (null khi xe rỗi). Số leg phải bằng số đơn (+1 nếu có end) — lệch là dữ liệu hỏng → 503.
 */
export function assembleFleetPlan(
  p: FleetParams,
  skel: FleetSkeleton,
  routes: readonly (ValhallaRouteResponse | null)[],
  graph: string | null,
): FleetPlanResponse {
  let distance = 0;
  let duration = 0;
  let used = 0;
  let assigned = 0;
  const vehicles: FleetVehiclePlan[] = skel.vehicles.map((v) => {
    const xe = p.vehicles[v.index];
    if (!xe) throw invalidUpstream();
    const offsetMin = xe.timeWindow ? xe.timeWindow[0].offsetMin : 0;
    const jobs = v.jobIndexes.map((i) => {
      const job = p.jobs[i];
      if (!job) throw invalidUpstream();
      return job.id;
    });
    let base: DirectionsResponse = {
      routes: [],
      waypoints: [],
      attribution: ROUTING_ATTRIBUTION,
      engine: { name: 'valhalla', graph },
    };
    if (jobs.length > 0) {
      const json = routes[v.index];
      if (!json) throw invalidUpstream();
      base = translateDirections(json, p.mode, graph, p.lang);
      const route = base.routes[0];
      if (!route || route.legs.length !== jobs.length + (xe.end ? 1 : 0)) throw invalidUpstream();
      distance += route.distance_m;
      duration += route.duration_s;
      used += 1;
      assigned += jobs.length;
    }
    return {
      ...base,
      vehicle: xe.id,
      jobs,
      stops: v.stops,
      load: v.load,
      finish_s: v.finishS,
      ...(p.absoluteTime && xe.timeWindow
        ? {
            departure_at: formatIsoAt(v.departureUnix, offsetMin),
            finish_at: formatIsoAt(v.departureUnix + v.finishS, offsetMin),
          }
        : {}),
    };
  });
  return {
    mode: p.mode,
    vehicles,
    unassigned: skel.unassigned.map((i) => ({ id: p.jobs[i]?.id ?? String(i) })),
    summary: {
      vehicles_used: used,
      jobs_assigned: assigned,
      jobs_unassigned: skel.unassigned.length,
      distance_m: distance,
      duration_s: duration,
      service_s: skel.serviceS,
      waiting_s: skel.waitingS,
    },
    attribution: ROUTING_ATTRIBUTION,
    engine: { name: ENGINE_NAME, graph },
  };
}

/**
 * VROOM báo "Unfound route(s) from location [lon,lat] to location [lon,lat]" — đối chiếu toạ độ với
 * điểm đã gửi (đơn trước, xe sau) để gọi đúng tên; không khớp thì câu chung. Người gọi soát hết điểm
 * hỏng bằng /v1/matrix 1×N (docs).
 */
export function noRouteMessage(p: FleetParams): (error: string) => string {
  const named: { name: string; lng: number; lat: number }[] = [];
  for (const j of p.jobs) named.push({ name: `đơn ${j.id}`, lng: j.location.lng, lat: j.location.lat });
  for (const v of p.vehicles) {
    named.push({ name: `xe ${v.id} (điểm xuất phát)`, lng: v.start.lng, lat: v.start.lat });
    if (v.end) named.push({ name: `xe ${v.id} (điểm kết thúc)`, lng: v.end.lng, lat: v.end.lat });
  }
  return (error) => {
    const names: string[] = [];
    for (const m of error.matchAll(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g)) {
      const lng = Number(m[1]);
      const lat = Number(m[2]);
      const hit = named.find((n) => Math.abs(n.lng - lng) < 1e-5 && Math.abs(n.lat - lat) < 1e-5);
      if (hit && !names.includes(hit.name)) names.push(hit.name);
    }
    return names.length > 0
      ? `Không tới được bằng mạng đường: ${names.join(', ')}`
      : 'Có điểm không tới được bằng mạng đường';
  };
}
```

- [ ] **Step 5: Chạy, xanh; typecheck; lint**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-fleet.test.ts && pnpm --filter @mapslibvn/api typecheck && pnpm lint`
Expected: PASS toàn bộ, typecheck và lint sạch.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routing/fleet.ts apps/api/test/routing-fleet.test.ts apps/api/test/fixtures/vroom/two-vehicles.json
git commit -m "feat(api): translateFleet, fleetRouteBody, assembleFleetPlan, noRouteMessage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: `POST /v1/fleet-plan`, `GET /healthz/fleet`, thành phần `fleet` của cron

**Files:**
- Modify: `apps/api/src/health/phep-do.ts`
- Create: `apps/api/src/routes/fleet.ts`
- Modify: `apps/api/src/index.ts` (import + `app.route('/', fleet)` sau `optimized`)
- Modify: `apps/api/test/health-canh-bao.test.ts:78-88` (thêm `fleet` vào trạng thái KV giả)
- Modify: `apps/api/test/admin-health.test.ts` (thêm ca `fleet`)
- Test: `apps/api/test/fleet-plan.test.ts`

- [ ] **Step 1: Test đỏ cho route và health**

Tạo `apps/api/test/fleet-plan.test.ts`:

```ts
import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vnDay } from '../src/quota';
import routeFixture from './fixtures/valhalla/optimized-two-stops.json';
import vroomFixture from './fixtures/vroom/two-vehicles.json';
import { fetchMock } from './helpers/fetch-mock';
import { seedKey, sha256Hex } from './helpers/seed-key';

const KEY = 'mlv_live_fleet0000000000000000000';
const FREE_KEY = 'mlv_live_fleetfree000000000000000';
const DEPOT = [10.7725, 106.698];
/** Mỗi test đổi `tag` vào id đơn đầu để không trúng cache của test trước (khoá cache băm cả id). */
const body = (tag: string, patch: Record<string, unknown> = {}) => ({
  vehicles: [
    { id: 'xe-1', start: DEPOT },
    { id: 'xe-2', start: DEPOT, end: 'open' },
  ],
  jobs: [
    { id: `don-1-${tag}`, location: [10.7826, 106.6958], service_s: 120 },
    { id: 'don-2', location: [10.7686, 106.7069], service_s: 120 },
    { id: 'don-3', location: [10.777, 106.6953] },
  ],
  ...patch,
});
const mockVroom = (status: number, reply: object | string) =>
  fetchMock.get('https://fleet.test').intercept({ path: '/', method: 'POST' }).reply(status, reply);
const mockRoute = () =>
  fetchMock
    .get('https://routing.test')
    .intercept({ path: '/route', method: 'POST' })
    .reply(200, routeFixture);
const mockStatus = () =>
  fetchMock
    .get('https://routing.test')
    .intercept({ path: '/status', method: 'GET' })
    .reply(200, { version: '3.8.3', tileset_last_modified: 1789430400 })
    .persist();
const post = (payload: unknown, key = KEY) =>
  SELF.fetch('https://api/v1/fleet-plan', {
    method: 'POST',
    headers: { 'X-Api-Key': key, 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
const code = async (r: Response) => ((await r.json()) as { error: { code: string; message: string } }).error;

/** Nghiệm VROOM tí hon cho /healthz/fleet: 1 xe, 2 đơn Hà Nội. */
const TI_HON = {
  code: 0,
  summary: { cost: 900, routes: 1, unassigned: 0, service: 0, duration: 900, waiting_time: 0 },
  unassigned: [],
  routes: [
    {
      vehicle: 0,
      cost: 900,
      service: 0,
      duration: 900,
      waiting_time: 0,
      steps: [
        { type: 'start', arrival: 0, duration: 0 },
        { type: 'job', id: 0, arrival: 400, duration: 400 },
        { type: 'job', id: 1, arrival: 700, duration: 700 },
        { type: 'end', arrival: 900, duration: 900 },
      ],
    },
  ],
};

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(async () => {
  await seedKey(KEY);
});

describe('POST /v1/fleet-plan', () => {
  it('không khoá → 401; body sai → 400 mà KHÔNG gọi VROOM', async () => {
    expect(
      (
        await SELF.fetch('https://api/v1/fleet-plan', {
          method: 'POST',
          body: JSON.stringify(body('a')),
        })
      ).status,
    ).toBe(401);
    expect((await code(await post('{không phải json'))).message).toMatch(/JSON/);
    expect((await post(body('b', { vehicles: [] }))).status).toBe(400);
    expect((await post(body('c', { jobs: [{ id: 'hn', location: [21.0285, 105.8542] }] }))).status).toBe(400);
    const to = await post(body('d', { pad: 'x'.repeat(70_000) }));
    expect(to.status).toBe(400);
    expect((await code(to)).message).toMatch(/64 KB/);
  });

  it('hợp lệ → 200: xe-1 là DirectionsResponse + jobs/stops, xe-2 rỗi, unassigned theo id, engine vroom+valhalla; lần hai → cache hit', async () => {
    mockVroom(200, vroomFixture);
    mockRoute();
    mockStatus();
    const res = await post(body('e'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-mlv-cache')).toBeNull();
    const plan = (await res.json()) as {
      vehicles: { vehicle: string; jobs: string[]; routes: { legs: unknown[] }[]; waypoints: unknown[]; stops: unknown[] }[];
      unassigned: { id: string }[];
      summary: { vehicles_used: number; jobs_assigned: number; jobs_unassigned: number };
      engine: { name: string; graph: string | null };
    };
    expect(plan.vehicles).toHaveLength(2);
    expect(plan.vehicles[0]?.vehicle).toBe('xe-1');
    expect(plan.vehicles[0]?.jobs).toEqual(['don-2', 'don-1-e']);
    expect(plan.vehicles[0]?.routes[0]?.legs).toHaveLength(3);
    expect(plan.vehicles[0]?.waypoints).toHaveLength(4);
    expect(plan.vehicles[0]?.stops).toHaveLength(2);
    expect(plan.vehicles[1]).toMatchObject({ vehicle: 'xe-2', jobs: [], routes: [] });
    expect(plan.unassigned).toEqual([{ id: 'don-3' }]);
    expect(plan.summary).toMatchObject({ vehicles_used: 1, jobs_assigned: 2, jobs_unassigned: 1 });
    expect(plan.engine).toEqual({ name: 'vroom+valhalla', graph: '2026-09-15' });
    // Không đăng ký interceptor mới: request thứ hai chỉ có thể 200 nếu lấy từ cache.
    const lai = await post(body('e'));
    expect(lai.status).toBe(200);
    expect(lai.headers.get('x-mlv-cache')).toBe('hit');
  });

  it('VROOM báo Unfound route → 404 no_route gọi tên đơn', async () => {
    mockVroom(500, {
      code: 3,
      error: 'Unfound route(s) from location [106.7069,10.7686] to location [106.698,10.7725]',
    });
    const res = await post(body('f'));
    expect(res.status).toBe(404);
    const err = await code(res);
    expect(err.code).toBe('no_route');
    expect(err.message).toMatch(/đơn don-2/);
  });

  it('VROOM không phản hồi → 503; VROOM ok nhưng /route lỗi → 503', async () => {
    const chet = await post(body('g'));
    expect(chet.status).toBe(503);
    expect((await code(chet)).code).toBe('upstream_unavailable');
    mockVroom(200, vroomFixture);
    mockStatus();
    const route = await post(body('h'));
    expect(route.status).toBe(503);
  });

  it('khoá free: 400 không tốn lượt, 200 tốn một lượt', async () => {
    const hash = await seedKey(FREE_KEY, { plan: 'free' });
    const kvKey = `quota:${hash}:${vnDay()}:directions`;
    expect((await post(body('i', { vehicles: [] }), FREE_KEY)).status).toBe(400);
    expect(await env.META.get(kvKey)).toBeNull();
    mockVroom(200, vroomFixture);
    mockRoute();
    mockStatus();
    expect((await post(body('j'), FREE_KEY)).status).toBe(200);
    expect(await env.META.get(kvKey)).toBe('1');
    expect(await sha256Hex(FREE_KEY)).toBe(hash);
  });
});

describe('GET /healthz/fleet', () => {
  it('VROOM xếp đủ 2 đơn thử → ok; VROOM chết → 503', async () => {
    mockVroom(200, TI_HON);
    const ok = await SELF.fetch('https://api/healthz/fleet');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, jobs_assigned: 2 });
    const chet = await SELF.fetch('https://api/healthz/fleet');
    expect(chet.status).toBe(503);
  });

  it('VROOM trả nhưng bỏ một đơn → 503 nêu số xếp được', async () => {
    const route = TI_HON.routes[0];
    if (!route) throw new Error('thiếu route');
    mockVroom(200, {
      ...TI_HON,
      unassigned: [{ id: 1 }],
      routes: [{ ...route, steps: route.steps.filter((s) => !(s.type === 'job' && s.id === 1)) }],
    });
    const res = await SELF.fetch('https://api/healthz/fleet');
    expect(res.status).toBe(503);
    expect((await code(res)).message).toMatch(/1\/2/);
  });
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/fleet-plan.test.ts`
Expected: FAIL — route trả 404 (chưa nối).

- [ ] **Step 3: Thêm thành phần `fleet` vào `health/phep-do.ts`**

(a) Import thêm: `import { callVroom, FLEET_HEALTH_TIMEOUT_MS, type VroomRequest } from '../routing/vroom';`

(b) Thay khai báo thành phần:

```ts
/**
 * Bốn thành phần mà trang Sức khoẻ và cron cảnh báo cùng đo. Thứ tự là thứ tự hiện trên trang và
 * trong tiêu đề thư. `fleet` thêm 23/09/2026 (spec tối ưu đội xe mục 4.8); trạng thái KV cũ thiếu
 * nó được `laTrangThai()` coi là chưa có → lượt `lan-dau`, không gửi thư giả.
 */
export const THANH_PHAN = ['db', 'routing', 'data', 'fleet'] as const;
export type TenThanhPhan = (typeof THANH_PHAN)[number];
export const TEN_THANH_PHAN: Readonly<Record<TenThanhPhan, string>> = {
  db: 'Cơ sở dữ liệu',
  routing: 'Định tuyến',
  data: 'Dữ liệu',
  fleet: 'Đội xe',
};
```

(c) Sau `TUYEN_THU` thêm bài tí hon:

```ts
/**
 * Bài đội xe tí hon: 1 xe ô tô từ Hồ Gươm, 2 đơn Văn Miếu và Nhà hát Lớn, về Hồ Gươm. Đo bằng một
 * lời giải THẬT (VROOM phải nối được Valhalla để lấy ma trận) chứ không phải GET /health của
 * vroom-express — cái đó chỉ nói tiến trình Node còn sống, cùng cái bẫy "Valhalla /status xanh giả".
 */
export const BAI_TI_HON: VroomRequest = {
  vehicles: [
    { id: 0, profile: 'auto', start: [105.8524, 21.0287], end: [105.8524, 21.0287], max_tasks: 2 },
  ],
  jobs: [
    { id: 0, location: [105.8355, 21.0293], service: 0, priority: 0 },
    { id: 1, location: [105.8573, 21.0243], service: 0, priority: 0 },
  ],
};
```

(d) `SoLieu` thêm `fleet: { assigned: number };`. Sau `doDinhTuyen` thêm:

```ts
/** Đếm step `job` trong lời giải; VROOM bỏ đơn nào (unassigned) là hỏng — hai đơn Hà Nội luôn phải tới được. */
export async function doDoiXe(env: Env): Promise<SoLieu['fleet']> {
  const json = await callVroom(env, BAI_TI_HON, { timeoutMs: FLEET_HEALTH_TIMEOUT_MS });
  let assigned = 0;
  for (const route of json.routes ?? []) {
    for (const step of route.steps) if (step.type === 'job') assigned += 1;
  }
  const can = BAI_TI_HON.jobs.length;
  if (assigned !== can) throw new Error(`Bộ giải chỉ xếp được ${assigned}/${can} đơn thử`);
  return { assigned };
}
```

(e) `PHEP_DO` thêm `fleet: (env) => doDoiXe(env),`. `doBaPhepDo` đổi thành đo bốn:

```ts
export async function doBaPhepDo(env: Env, ctx: WaitUntil): Promise<BaPhepDo> {
  const [db, routing, data, fleet] = await Promise.all([
    doPhepDo('db', env, ctx),
    doPhepDo('routing', env, ctx),
    doPhepDo('data', env, ctx),
    doPhepDo('fleet', env, ctx),
  ]);
  return { db, routing, data, fleet };
}
```

(Giữ tên `doBaPhepDo`/`BaPhepDo` để không đổi bốn chỗ gọi; thêm chú thích "nay là bốn" ở JSDoc.)

- [ ] **Step 4: Viết `routes/fleet.ts`**

```ts
import { type Context, Hono } from 'hono';
import { requireAuth } from '../auth';
import { cachedJson } from '../cache';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { doDoiXe } from '../health/phep-do';
import { quotaMiddleware } from '../quota';
import {
  assembleFleetPlan,
  FLEET_MAX_BODY_BYTES,
  type FleetParams,
  fleetCacheUrl,
  fleetRouteBody,
  fleetVroomBody,
  noRouteMessage,
  parseFleetBody,
  translateFleet,
} from '../routing/fleet';
import { graphBuiltAt } from '../routing/graph';
import { apDungNhip } from '../routing/nhip';
import { callValhalla, type ValhallaRouteResponse } from '../routing/valhalla';
import { callVroom, FLEET_ROUTE_TIMEOUT_MS } from '../routing/vroom';

export const fleet = new Hono<AppEnv>();

/** Chặn theo content-length TRƯỚC khi đọc, rồi kiểm độ dài thật: header có thể nói dối hoặc vắng. */
async function docBody(c: Context<AppEnv>): Promise<unknown> {
  const gioiHan = `Body tối đa ${FLEET_MAX_BODY_BYTES / 1024} KB`;
  if (Number(c.req.header('content-length') ?? '0') > FLEET_MAX_BODY_BYTES) {
    throw new ApiError(400, 'invalid_request', gioiHan);
  }
  const text = await c.req.text();
  if (text.length > FLEET_MAX_BODY_BYTES) throw new ApiError(400, 'invalid_request', gioiHan);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, 'invalid_request', 'Body phải là JSON');
  }
}

/**
 * Chia đơn cho đội xe (spec 2026-09-23 mục 4). Cùng khuôn ba route dẫn đường: scope places:read, MỘT
 * lượt nhóm `directions`, preflight parse để request sai không tốn lượt, cache 60 s / stale 300 s.
 * Khác: body JSON (POST), nhịp riêng 2/phút/khoá, và hai tầng upstream — VROOM chia đơn rồi Valhalla
 * `/route` từng xe song song.
 */
fleet.post(
  '/v1/fleet-plan',
  requireAuth('places:read', { deferRevocation: true }),
  async (c, next) => {
    const auth = c.get('auth');
    if (auth) {
      await apDungNhip(
        c.env.FLEET_RATE_LIMITER,
        auth.keyHash,
        'Gửi quá nhiều request chia đơn đội xe trong một phút',
      );
    }
    return next();
  },
  quotaMiddleware('directions', async (c) => {
    c.set('params', parseFleetBody(await docBody(c)));
  }),
  async (c) => {
    const params = c.get('params') as FleetParams;
    return cachedJson(c.executionCtx, await fleetCacheUrl(params), 60, 300, async () => {
      const vroom = await callVroom(c.env, fleetVroomBody(params), {
        noRouteMessage: noRouteMessage(params),
      });
      const skeleton = translateFleet(vroom, params);
      const [routes, graph] = await Promise.all([
        Promise.all(
          skeleton.vehicles.map((v) =>
            v.jobIndexes.length === 0
              ? Promise.resolve(null)
              : callValhalla<ValhallaRouteResponse>(
                  c.env,
                  '/route',
                  fleetRouteBody(params, v, crypto.randomUUID()),
                  { timeoutMs: FLEET_ROUTE_TIMEOUT_MS },
                ),
          ),
        ),
        graphBuiltAt(c),
      ]);
      return assembleFleetPlan(params, skeleton, routes, graph);
    });
  },
);

/** Không cần khoá, không tính lượt, như /healthz/routing. Lỗi (503) để errorResponse xử lý. */
fleet.get('/healthz/fleet', async (c) => {
  const t0 = Date.now();
  let ketQua: Awaited<ReturnType<typeof doDoiXe>>;
  try {
    ketQua = await doDoiXe(c.env);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      'upstream_unavailable',
      error instanceof Error ? error.message : 'Bộ giải đội xe lỗi',
    );
  }
  return c.json({ ok: true, jobs_assigned: ketQua.assigned, ms: Date.now() - t0 });
});
```

- [ ] **Step 5: Nối route**

Trong `apps/api/src/index.ts`: thêm `import { fleet } from './routes/fleet';` (theo alphabet, sau `edits`), và `app.route('/', fleet);` ngay sau `app.route('/', optimized);`.

- [ ] **Step 6: Cập nhật test cron và admin-health**

(a) `apps/api/test/health-canh-bao.test.ts`, trong `ghiKv` thêm dòng `fleet: { ok: true, tuLuc: '2026-09-19T20:00:00.000Z' },` sau `data`.

(b) `apps/api/test/admin-health.test.ts`: thêm helper và một ca ở cuối `describe` hiện có:

```ts
const mockFleet = (reply: object) =>
  fetchMock.get('https://fleet.test').intercept({ path: '/', method: 'POST' }).reply(200, reply);

it('thành phần thứ tư `fleet`: bài 1 xe 2 đơn xếp đủ → ok kèm assigned', async () => {
  mockCerts();
  mockRoute(200, TUYEN_OK);
  mockFleet({
    code: 0,
    summary: { cost: 1, routes: 1, unassigned: 0, service: 0, duration: 1, waiting_time: 0 },
    unassigned: [],
    routes: [
      {
        vehicle: 0,
        cost: 1,
        service: 0,
        duration: 1,
        waiting_time: 0,
        steps: [
          { type: 'start', arrival: 0, duration: 0 },
          { type: 'job', id: 0, arrival: 1, duration: 1 },
          { type: 'job', id: 1, arrival: 2, duration: 2 },
          { type: 'end', arrival: 3, duration: 3 },
        ],
      },
    ],
  });
  const body = (await (await goi()).json()) as { fleet: { ok: boolean; assigned?: number } };
  expect(body.fleet.ok).toBe(true);
  expect(body.fleet.assigned).toBe(2);
});
```

(Các ca cũ không mock VROOM: `fleet.ok` là false nhưng chúng không khẳng định gì về `fleet` — vẫn xanh.)

- [ ] **Step 7: Chạy bốn file test, typecheck, lint**

Run: `pnpm --filter @mapslibvn/api exec vitest run test/fleet-plan.test.ts test/health-canh-bao.test.ts test/admin-health.test.ts test/routing-fleet.test.ts && pnpm --filter @mapslibvn/api typecheck && pnpm lint`
Expected: PASS toàn bộ; typecheck và lint sạch.

- [ ] **Step 8: Chạy cả bộ test API**

Run: `pnpm --filter @mapslibvn/api test`
Expected: 0 đỏ (ca nào cũ khẳng định số thành phần sức khoẻ = 3 thì sửa thành 4 và ghi vào commit).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/health/phep-do.ts apps/api/src/routes/fleet.ts apps/api/src/index.ts apps/api/test/fleet-plan.test.ts apps/api/test/health-canh-bao.test.ts apps/api/test/admin-health.test.ts
git commit -m "feat(api): POST /v1/fleet-plan và GET /healthz/fleet; cron cảnh báo đo thêm Đội xe

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Trang Admin — ô "Đội xe" ở Sức khoẻ và Tổng quan

**Files:**
- Modify: `apps/admin/src/features/health/api.ts:22`
- Modify: `apps/admin/src/features/health/page.tsx:120-142`
- Modify: `apps/admin/src/features/overview/page.tsx:66-78`
- Modify: `apps/admin/src/features/health/page.test.tsx:8-24`, `apps/admin/src/features/overview/page.test.tsx` (fixture `HEALTH`)

- [ ] **Step 1: Test đỏ**

Trong `apps/admin/src/features/health/page.test.tsx`, thêm vào object `HEALTH` (sau `data`): `fleet: { ok: true, ms: 812, assigned: 2 },` và thêm ca:

```ts
  it('ô Đội xe: bài thử 1 xe 2 đơn, hiện số đơn xếp được', async () => {
    mo();
    expect(await screen.findByText('Đội xe')).toBeVisible();
    expect(screen.getByText(/xếp được 2\/2/)).toBeVisible();
  });
```

Trong `apps/admin/src/features/overview/page.test.tsx`, thêm `fleet: { ok: false, ms: 6001, error: 'Bộ giải đội xe không phản hồi' },` vào fixture `HEALTH` (sau `routing`).

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm exec vitest run apps/admin/src/features/health/page.test.tsx`
Expected: FAIL — không thấy chữ "Đội xe".

- [ ] **Step 3: Kiểu và giao diện**

(a) `apps/admin/src/features/health/api.ts`: sau dòng `routing: PhepDo<…>;` thêm

```ts
  /** Bài đội xe tí hon (1 xe, 2 đơn Hà Nội) qua VROOM + Valhalla — spec 2026-09-23 mục 4.8. */
  fleet: PhepDo<{ assigned: number }>;
```

(b) `apps/admin/src/features/health/page.tsx`, hàm `TrangThai`: đổi lưới thành `<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">` và thêm sau ô "Định tuyến":

```tsx
      <The ten="Đội xe" phepDo={health.fleet}>
        <p className="text-xs text-[var(--text-muted)]">
          Bài thử 1 xe 2 đơn: xếp được {health.fleet.ok ? health.fleet.assigned : 0}/2
        </p>
      </The>
```

(c) `apps/admin/src/features/overview/page.tsx`: sau khối `<O ten="Định tuyến" …/>` thêm

```tsx
        {can(me, 'health.read') && (
          <O
            ten="Đội xe"
            den="/health"
            dangTai={health.isPending}
            loi={health.isError}
            so={<TrangThaiBadge ok={health.data?.fleet?.ok} />}
            phu={health.data?.fleet?.ok ? 'bộ giải xếp đủ đơn thử' : undefined}
          />
        )}
```

- [ ] **Step 4: Chạy test Admin, typecheck**

Run: `pnpm exec vitest run apps/admin/src/features/health/page.test.tsx apps/admin/src/features/overview/page.test.tsx && pnpm --filter @mapslibvn/admin typecheck`
Expected: PASS; typecheck sạch.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/health/api.ts apps/admin/src/features/health/page.tsx apps/admin/src/features/health/page.test.tsx apps/admin/src/features/overview/page.tsx apps/admin/src/features/overview/page.test.tsx
git commit -m "feat(admin): ô Đội xe trên trang Sức khoẻ và Tổng quan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 10: Tích hợp trên Valhalla + VROOM Quận 1 — capture fixture, `fleet-plan.rtest.mjs`

**Files:**
- Create: `apps/api/test/fixtures/vroom/q1-fleet-request.json`
- Create: `apps/api/test-routing/fleet-plan.rtest.mjs`
- Capture (sinh bởi `--capture`): `apps/api/test/fixtures/vroom/q1-fleet.json`, `packages/core/tests/fixtures/fleet-plan-q1.json`, `apps/docs/e2e/fixtures/fleet-plan-q1.json`
- Modify: `apps/api/test/routing-fleet.test.ts` (thêm describe trên fixture thật)

- [ ] **Step 1: Body yêu cầu dùng chung cho capture và rtest**

Tạo `apps/api/test/fixtures/vroom/q1-fleet-request.json` — kho Chợ Bến Thành, 2 xe `max_jobs: 3` để 5 đơn mẫu của Playground buộc dùng cả hai xe:

```json
{
  "mode": "motorbike",
  "vehicles": [
    { "id": "xe-1", "start": [10.7725, 106.698], "max_jobs": 3 },
    { "id": "xe-2", "start": [10.7725, 106.698], "max_jobs": 3 }
  ],
  "jobs": [
    { "id": "don-1", "location": [10.7826, 106.6958] },
    { "id": "don-2", "location": [10.7686, 106.7069] },
    { "id": "don-3", "location": [10.777, 106.6953] },
    { "id": "don-4", "location": [10.7716, 106.7043] },
    { "id": "don-5", "location": [10.7798, 106.699] }
  ]
}
```

- [ ] **Step 2: Test tích hợp**

Tạo `apps/api/test-routing/fleet-plan.rtest.mjs`:

```js
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = process.env.ROUTING_API_BASE ?? 'http://127.0.0.1:8798';
const key = process.env.ROUTING_API_KEY ?? 'mlv_live_routingtest0000000000000';
/** @type {{ vehicles: Record<string, unknown>[], jobs: Record<string, unknown>[], mode: string }} */
const request = JSON.parse(
  readFileSync(new URL('../test/fixtures/vroom/q1-fleet-request.json', import.meta.url), 'utf8'),
);
/** @param {unknown} body */
const post = (body) =>
  fetch(`${base}/v1/fleet-plan`, {
    method: 'POST',
    headers: { 'X-Api-Key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const HOM_NAY = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

describe('/v1/fleet-plan trên Valhalla + VROOM fixture Quận 1', () => {
  it('5 đơn chia hết cho 2 xe (max_jobs 3): hoán vị đủ, mỗi xe là DirectionsResponse có câu tiếng Việt', async () => {
    const response = await post(request);
    expect(response.status).toBe(200);
    const plan = await response.json();
    expect(plan.vehicles).toHaveLength(2);
    expect(plan.unassigned).toEqual([]);
    const jobs = plan.vehicles.flatMap((/** @type {{ jobs: string[] }} */ v) => v.jobs);
    expect([...jobs].sort()).toEqual(['don-1', 'don-2', 'don-3', 'don-4', 'don-5']);
    for (const v of plan.vehicles) {
      expect(v.jobs.length).toBeGreaterThan(0);
      expect(v.jobs.length).toBeLessThanOrEqual(3);
      expect(v.routes[0].legs).toHaveLength(v.jobs.length + 1); // + leg về kho
      expect(v.waypoints).toHaveLength(v.jobs.length + 2);
      expect(v.stops).toHaveLength(v.jobs.length);
      expect(v.stops.map((/** @type {{ job: string }} */ s) => s.job)).toEqual(v.jobs);
      expect(v.waypoints[0].location).toEqual([106.698, 10.7725]);
      const steps = v.routes[0].legs.flatMap((/** @type {{ steps: { instruction: string }[] }} */ leg) => leg.steps);
      expect(steps.some((/** @type {{ instruction: string }} */ s) => VI.test(s.instruction))).toBe(true);
      expect(v).not.toHaveProperty('departure_at');
    }
    expect(plan.summary.vehicles_used).toBe(2);
    expect(plan.summary.jobs_assigned).toBe(5);
    expect(plan.engine.name).toBe('vroom+valhalla');
  });

  it('open-end một xe: số leg = số đơn, waypoint cuối là đơn cuối', async () => {
    const response = await post({
      ...request,
      vehicles: [{ id: 'xe-1', start: [10.7725, 106.698], end: 'open' }],
    });
    expect(response.status).toBe(200);
    const plan = await response.json();
    const xe = plan.vehicles[0];
    expect(xe.jobs).toHaveLength(5);
    expect(xe.routes[0].legs).toHaveLength(5);
    expect(xe.waypoints).toHaveLength(6);
  });

  it('một đơn ngoài graph (Vũng Tàu) → 404 no_route gọi tên đơn', async () => {
    const response = await post({
      ...request,
      jobs: [...request.jobs.slice(0, 2), { id: 'vt', location: [10.346, 107.0843] }],
    });
    expect(response.status).toBe(404);
    const err = (await response.json()).error;
    expect(err.code).toBe('no_route');
    expect(err.message).toMatch(/không tới được/i);
  });

  it('chế độ tuyệt đối: departure_at trong ca, arrival_at tăng dần cùng múi +07:00', async () => {
    const tw = [`${HOM_NAY}T08:00:00+07:00`, `${HOM_NAY}T12:00:00+07:00`];
    const response = await post({
      ...request,
      vehicles: request.vehicles.map((v) => ({ ...v, time_window: tw })),
      jobs: request.jobs.map((j) => ({ ...j, service_s: 300 })),
    });
    expect(response.status).toBe(200);
    const plan = await response.json();
    for (const v of plan.vehicles) {
      expect(v.departure_at >= tw[0] && v.departure_at <= tw[1]).toBe(true);
      expect(v.finish_at.endsWith('+07:00')).toBe(true);
      const arrivals = v.stops.map((/** @type {{ arrival_at: string }} */ s) => s.arrival_at);
      expect([...arrivals].sort()).toEqual(arrivals);
      for (const s of v.stops) expect(s.service_s).toBe(300);
    }
  });
});
```

- [ ] **Step 3: Chạy tích hợp kèm capture (lần đầu build graph Quận 1 vài phút)**

Run: `pnpm test:routing -- --capture`
Expected: log `VROOM sẵn sàng tại http://127.0.0.1:3000/fleet`, `đã ghi …q1-fleet.json`, `đã ghi packages/core/tests/fixtures/fleet-plan-q1.json`, `đã ghi apps/docs/e2e/fixtures/fleet-plan-q1.json`; vitest routing: mọi rtest cũ và 4 ca mới PASS. Nếu ca "5 đơn chia hết cho 2 xe" báo một xe có 0 đơn: VROOM đã dồn vào một xe dù `max_tasks: 3` — không thể (5 > 3); kiểm lại `fleetVroomBody` có truyền `max_tasks`.

- [ ] **Step 4: Kiểm fixture đã capture**

Run: `node -e "const p=require('./packages/core/tests/fixtures/fleet-plan-q1.json'); console.log(p.vehicles.map(v=>[v.vehicle,v.jobs,v.routes[0]?.legs.length]), p.unassigned)"`
Expected: hai xe, mỗi xe 2–3 đơn, số leg = số đơn + 1, `unassigned` rỗng. `apps/api/test/fixtures/vroom/q1-fleet.json` có `code: 0`, 2 `routes`.

- [ ] **Step 5: Test đơn vị trên fixture VROOM thật**

Thêm cuối `apps/api/test/routing-fleet.test.ts`:

```ts
import q1Request from './fixtures/vroom/q1-fleet-request.json';
import q1Vroom from './fixtures/vroom/q1-fleet.json';

describe('fixture VROOM thật Quận 1 (capture 23/09/2026)', () => {
  it('5 đơn chia cho 2 xe, không unassigned, mỗi xe ≤ 3 đơn, arrival_s tăng dần', () => {
    const p = parseFleetBody(q1Request);
    const skel = translateFleet(q1Vroom as VroomResponse, p);
    expect(skel.unassigned).toEqual([]);
    const tong = skel.vehicles.reduce((s, v) => s + v.jobIndexes.length, 0);
    expect(tong).toBe(5);
    for (const v of skel.vehicles) {
      expect(v.jobIndexes.length).toBeLessThanOrEqual(3);
      const arrivals = v.stops.map((s) => s.arrival_s);
      expect([...arrivals].sort((a, b) => a - b)).toEqual(arrivals);
      expect(v.finishS).toBeGreaterThanOrEqual(arrivals.at(-1) ?? 0);
    }
  });
});
```

(Đưa hai dòng `import` lên đầu file cùng các import khác — biome bắt import ở đầu.)

Run: `pnpm --filter @mapslibvn/api exec vitest run test/routing-fleet.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/test/fixtures/vroom/q1-fleet-request.json apps/api/test/fixtures/vroom/q1-fleet.json apps/api/test-routing/fleet-plan.rtest.mjs apps/api/test/routing-fleet.test.ts packages/core/tests/fixtures/fleet-plan-q1.json apps/docs/e2e/fixtures/fleet-plan-q1.json
git commit -m "test(routing): fleet-plan trên Valhalla + VROOM Quận 1, capture fixture VROOM thô và FleetPlanResponse thật

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Core — `FLEET_COLORS`, `decodeFleet`, `fleetRouteFeatures`, nâng trần size-limit

**Files:**
- Modify: `packages/core/src/navigation/route-features.ts`
- Modify: `packages/core/src/navigation/route-features.test.ts`
- Modify: `packages/core/.size-limit.json`
- Modify: `packages/web/src/index.ts`, `packages/web/src/umd.ts`, `packages/react-native/src/index.ts` (export `FLEET_COLORS`)

- [ ] **Step 1: Test đỏ**

Thêm vào `packages/core/src/navigation/route-features.test.ts` (import thêm `decodeFleet, FLEET_COLORS, FLEET_DIM_OPACITY, fleetRouteFeatures` từ `./route-features`, `import fleetFixture from '../../tests/fixtures/fleet-plan-q1.json';` và `import type { FleetPlanResponse } from '../types';`):

```ts
const plan = fleetFixture as unknown as FleetPlanResponse;

describe('decodeFleet', () => {
  it('một mảng toạ độ mỗi xe theo đúng chỉ số; xe rỗi → mảng rỗng, không lệch chỉ số', () => {
    const coords = decodeFleet(plan);
    expect(coords).toHaveLength(plan.vehicles.length);
    for (const c of coords) expect(c.length).toBeGreaterThan(2);
    const xe1 = plan.vehicles[1];
    if (!xe1) throw new Error('fixture thiếu xe');
    const coRoi = { ...plan, vehicles: [plan.vehicles[0], { ...xe1, jobs: [], routes: [], waypoints: [] }] } as FleetPlanResponse;
    const c2 = decodeFleet(coRoi);
    expect(c2).toHaveLength(2);
    expect(c2[1]).toEqual([]);
  });
});

describe('fleetRouteFeatures', () => {
  const coords = decodeFleet(plan);
  it('mỗi xe một LineString kind fleet, màu theo bảng, opacity 1 khi không chọn xe nào', () => {
    const fc = fleetRouteFeatures(coords, {});
    expect(fc.features).toHaveLength(coords.length);
    for (const [i, f] of fc.features.entries()) {
      expect(f.properties).toEqual({ kind: 'fleet', index: i, color: FLEET_COLORS[i], opacity: 1 });
      expect(lineCoords(f)).toBe(coords[i]); // dùng chung mảng, không sao chép
    }
  });

  it('active = 0 → xe khác mờ; bảng màu tuỳ chọn xoay vòng; xe rỗi bị bỏ nhưng chỉ số giữ nguyên', () => {
    const fc = fleetRouteFeatures(coords, { active: 0, colors: ['#111111'] });
    expect(fc.features[0]?.properties).toMatchObject({ opacity: 1, color: '#111111' });
    expect(fc.features[1]?.properties).toMatchObject({ opacity: FLEET_DIM_OPACITY, color: '#111111' });
    const thua = fleetRouteFeatures([[], coords[0] ?? []], {});
    expect(thua.features).toHaveLength(1);
    expect(thua.features[0]?.properties).toMatchObject({ index: 1, color: FLEET_COLORS[1] });
  });

  it('bảng màu mặc định 5 màu (= trần 5 xe), phân biệt được với người mù màu (Okabe–Ito)', () => {
    expect(FLEET_COLORS).toEqual(['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00']);
  });
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm exec vitest run packages/core/src/navigation/route-features.test.ts`
Expected: FAIL — `decodeFleet` không export.

- [ ] **Step 3: Viết mã**

Trong `packages/core/src/navigation/route-features.ts`:

(a) Đổi import kiểu: `import type { DirectionsResponse, FleetPlanResponse } from '../types';`

(b) Đổi `RouteFeatureKind` và thêm kiểu feature đội xe:

```ts
/** Vai của từng feature trong source tuyến — web và RN cùng lọc theo `properties.kind`. */
export type RouteFeatureKind = 'alt' | 'active' | 'traveled' | 'puck' | 'fleet';

/** Tuyến một xe trong kế hoạch đội xe: màu và độ mờ nằm trong properties để layer vẽ data-driven. */
export interface FleetLineFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { kind: 'fleet'; index: number; color: string; opacity: number };
}

export type RouteFeature = RouteLineFeature | RoutePuckFeature | FleetLineFeature;
```

(c) Thêm cuối file:

```ts
/** Bảng Okabe–Ito: 5 màu phân biệt được với người mù màu, đúng trần 5 xe. Xe thứ 6+ xoay vòng. */
export const FLEET_COLORS: readonly string[] = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00'];
/** Độ mờ của xe không được chọn khi `active` là một chỉ số. */
export const FLEET_DIM_OPACITY = 0.35;

/** Giải mã tuyến từng xe, giữ đúng chỉ số: xe rỗi (không `routes`) → mảng rỗng. */
export function decodeFleet(plan: FleetPlanResponse): [number, number][][] {
  return plan.vehicles.map((v) => {
    const geometry = v.routes[0]?.geometry;
    return geometry ? decodePolyline6(geometry) : [];
  });
}

export interface FleetFeaturesOptions {
  colors?: readonly string[];
  /** Chỉ số xe được chọn: xe khác mờ đi. null/bỏ = mọi xe rõ. */
  active?: number | null;
}

/**
 * Mỗi xe một LineString `kind: 'fleet'` với `index`, `color`, `opacity`. Toạ độ DÙNG CHUNG mảng với
 * `coords` (không sao chép) — cùng nguyên tắc với routeFeatures. Xe rỗi bị bỏ nhưng `index` của các
 * xe còn lại giữ nguyên để bấm tuyến vẫn trả đúng chỉ số xe.
 */
export function fleetRouteFeatures(
  coords: readonly (readonly [number, number][])[],
  opts: FleetFeaturesOptions = {},
): RouteFeatureCollection {
  const colors = opts.colors && opts.colors.length > 0 ? opts.colors : FLEET_COLORS;
  const active = opts.active ?? null;
  const features: RouteFeature[] = [];
  for (const [index, c] of coords.entries()) {
    if (c.length < 2) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: c as [number, number][] },
      properties: {
        kind: 'fleet',
        index,
        color: colors[index % colors.length] ?? '#0072b2',
        opacity: active === null || active === index ? 1 : FLEET_DIM_OPACITY,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}
```

- [ ] **Step 4: Export sang web, UMD, RN**

- `packages/web/src/index.ts`: thêm `FLEET_COLORS,` vào khối `export { … } from '@mapslibvn/core'` (giữ alphabet: sau `createNavigator`).
- `packages/web/src/umd.ts`: thêm `FLEET_COLORS,` vào khối `export { … } from './index'` (sau `createSpeech`).
- `packages/react-native/src/index.ts`: thêm `FLEET_COLORS,` vào khối `export { … } from '@mapslibvn/core'` (sau `decodePolyline6`).

- [ ] **Step 5: Build core; nâng trần size-limit theo số đo**

Run: `pnpm --filter @mapslibvn/core build`
Expected: có thể ĐỎ vì barrel vượt 16 kB (trước Task 5 đo 15,45 kB). Đọc số đo size-limit in ra, sửa `packages/core/.size-limit.json` thành `"limit": "17 kB"` và ghi vào `name`: `"barrel dist/index.js (size-limit đo CẢ file, không tree-shake; 23/09/2026 nâng 16 → 17 kB khi thêm fleetPlan + fleetRouteFeatures, đo <số thật> kB)"`. Chạy lại build → xanh.

- [ ] **Step 6: Test, typecheck**

Run: `pnpm exec vitest run packages/core/src/navigation/route-features.test.ts && pnpm typecheck`
Expected: PASS; typecheck sạch (RN/web đang lọc `kind` bằng chuỗi nên không vỡ khi union rộng ra).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/navigation/route-features.ts packages/core/src/navigation/route-features.test.ts packages/core/.size-limit.json packages/web/src/index.ts packages/web/src/umd.ts packages/react-native/src/index.ts
git commit -m "feat(core): fleetRouteFeatures, decodeFleet, bảng màu FLEET_COLORS; nâng trần size-limit barrel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 12: Web — `map.routes.showFleet()`

**Files:**
- Modify: `packages/web/src/routes-layer.ts`
- Modify: `packages/web/src/routes-layer.test.ts`
- Modify: `packages/web/src/index.ts`, `packages/web/src/umd.ts` (export `FLEET_SOURCE_ID`)
- Modify: `packages/web/.size-limit.json` (nếu vượt)

- [ ] **Step 1: Test đỏ**

Thêm vào `packages/web/src/routes-layer.test.ts` (import thêm `FLEET_SOURCE_ID` từ `./routes-layer`, `import type { FleetPlanResponse } from '@mapslibvn/core';`, `import fleetFixture from '../../core/tests/fixtures/fleet-plan-q1.json';`):

```ts
const plan = fleetFixture as unknown as FleetPlanResponse;
const fleetData = (setData: ReturnType<typeof vi.fn>) =>
  setData.mock.calls.at(-1)?.[0] as {
    features: { properties: { kind: string; index: number; color: string; opacity: number } }[];
  };

describe('showFleet', () => {
  it('source riêng + hai layer data-driven trước symbol; mỗi xe một feature fleet; marker màu xe tại từng đơn', () => {
    const f = fakeGl();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    routes.showFleet(plan);
    expect(f.gl.addSource).toHaveBeenCalledWith(FLEET_SOURCE_ID, expect.objectContaining({ type: 'geojson' }));
    expect(f.layers.map((l) => l.id)).toEqual([ROUTE_LAYER_IDS.fleetCasing, ROUTE_LAYER_IDS.fleetLine]);
    expect(f.layers.every((l) => l.before === 'road-label')).toBe(true);
    const data = fleetData(f.setData);
    expect(data.features.map((x) => [x.properties.kind, x.properties.index, x.properties.opacity])).toEqual([
      ['fleet', 0, 1],
      ['fleet', 1, 1],
    ]);
    expect(data.features[0]?.properties.color).toBe('#0072b2');
    expect(data.features[1]?.properties.color).toBe('#d55e00');
    const soDon = plan.vehicles.reduce((s, v) => s + v.jobs.length, 0);
    expect(f.markers).toHaveLength(soDon);
    expect(f.markers[0]?.options.color).toBe('#0072b2');
    expect(f.markers[0]?.lngLat).toEqual(plan.vehicles[0]?.waypoints[1]?.snapped);
  });

  it('setActive mờ xe khác; bấm tuyến → onRouteClick(index xe); markers:false; show() xoá đội xe và ngược lại; clear xoá cả hai', () => {
    const f = fakeGl();
    const onRouteClick = vi.fn();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, onRouteClick);
    routes.showFleet(plan, { markers: false, colors: ['#111111', '#222222'] });
    expect(f.markers).toHaveLength(0);
    routes.setActive(1);
    let data = fleetData(f.setData);
    expect(data.features.map((x) => x.properties.opacity)).toEqual([0.35, 1]);
    expect(data.features[1]?.properties.color).toBe('#222222');
    f.fire(`click:${ROUTE_LAYER_IDS.fleetLine}`, { features: [{ properties: { kind: 'fleet', index: 1 } }] });
    expect(onRouteClick).toHaveBeenCalledWith(1);
    // setProgress không có nghĩa ở chế độ đội xe: không đổi dữ liệu.
    const truoc = f.setData.mock.calls.length;
    routes.setProgress(3, [106.7, 10.77]);
    expect(f.setData.mock.calls.length).toBe(truoc);
    // Chuyển sang một tuyến thường: source đội xe được xoá rỗng.
    routes.show(response);
    const fleetCalls = f.setData.mock.calls.filter((c) => (c[0] as { features: { properties: { kind: string } }[] }).features.every((x) => x.properties.kind !== 'fleet'));
    expect(fleetCalls.length).toBeGreaterThan(0);
    routes.showFleet(plan);
    routes.clear();
    data = fleetData(f.setData);
    expect(data.features).toEqual([]);
    expect(f.markers.every((m) => m.removed)).toBe(true);
  });

  it('style chưa phân giải → hoãn tới style.load rồi dựng lại source đội xe', () => {
    const f = fakeGl();
    const routes = createRoutesLayer(f.gl as never, f.ml as never, vi.fn());
    f.gl.addSource.mockImplementationOnce(() => {
      throw new Error('Style is not done loading.');
    });
    routes.showFleet(plan);
    expect(f.gl.getSource(FLEET_SOURCE_ID)).toBeUndefined();
    f.fire('style.load');
    expect(f.gl.getSource(FLEET_SOURCE_ID)).toBeDefined();
    expect(fleetData(f.setData).features).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm exec vitest run packages/web/src/routes-layer.test.ts`
Expected: FAIL — `showFleet` không tồn tại.

- [ ] **Step 3: Viết mã**

Trong `packages/web/src/routes-layer.ts`:

(a) Import: đổi khối import từ core thành

```ts
import {
  type DirectionsResponse,
  decodeFleet,
  decodeRoutes,
  EMPTY_ROUTE_FEATURES,
  FLEET_COLORS,
  type FleetPlanResponse,
  fleetRouteFeatures,
  type RouteProgressCut,
  routeFeatures,
} from '@mapslibvn/core';
```

(b) Hằng số:

```ts
export const ROUTE_SOURCE_ID = 'mapslibvn-route';
/** Source riêng cho kế hoạch đội xe: dữ liệu chỉ đổi khi showFleet/setActive, không theo định vị. */
export const FLEET_SOURCE_ID = 'mapslibvn-fleet';
export const ROUTE_LAYER_IDS = {
  alt: 'mapslibvn-route-alt',
  casing: 'mapslibvn-route-casing',
  line: 'mapslibvn-route-line',
  traveled: 'mapslibvn-route-traveled',
  fleetCasing: 'mapslibvn-fleet-casing',
  fleetLine: 'mapslibvn-fleet-line',
} as const;
```

(c) Interface `RoutesLayer` thêm sau `show`:

```ts
  /**
   * Vẽ cả đội: mỗi xe một màu (mặc định FLEET_COLORS), marker màu xe tại từng đơn. Bấm tuyến phát
   * `routeClick` với `index` = chỉ số xe; `setActive(i)` làm mờ xe khác. Loại trừ với `show()`.
   */
  showFleet(
    plan: FleetPlanResponse,
    opts?: { active?: number | null; colors?: readonly string[]; markers?: boolean },
  ): void;
```

(d) Trạng thái và hàm nội bộ — thêm sau `let daCanhBao = false;`:

```ts
  interface FleetState {
    plan: FleetPlanResponse;
    coords: [number, number][][];
    colors: readonly string[];
    active: number | null;
    markers: boolean;
  }
  let fleet: FleetState | null = null;
  let fleetClickBound = false;
  const ROUND: NonNullable<maplibregl.LineLayerSpecification['layout']> = {
    'line-join': 'round',
    'line-cap': 'round',
  };

  const ensureFleetLayers = (): void => {
    if (gl.getSource(FLEET_SOURCE_ID)) return;
    gl.addSource(FLEET_SOURCE_ID, { type: 'geojson', data: EMPTY_ROUTE_FEATURES as GeoJsonData });
    const before = firstSymbolLayerId();
    gl.addLayer(
      {
        id: ROUTE_LAYER_IDS.fleetCasing,
        type: 'line',
        source: FLEET_SOURCE_ID,
        layout: ROUND,
        paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': ['get', 'opacity'] },
      },
      before,
    );
    gl.addLayer(
      {
        id: ROUTE_LAYER_IDS.fleetLine,
        type: 'line',
        source: FLEET_SOURCE_ID,
        layout: ROUND,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 6,
          'line-opacity': ['get', 'opacity'],
        },
      },
      before,
    );
    if (!fleetClickBound) {
      fleetClickBound = true;
      gl.on('click', ROUTE_LAYER_IDS.fleetLine, (e) => {
        const index = e.features?.[0]?.properties?.index;
        if (typeof index === 'number') onRouteClick(index);
      });
    }
  };

  const setFleetData = (): void => {
    const source = gl.getSource(FLEET_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const data = fleet
      ? fleetRouteFeatures(fleet.coords, { colors: fleet.colors, active: fleet.active })
      : EMPTY_ROUTE_FEATURES;
    source.setData(data as GeoJsonData);
  };

  /** Cùng cách với `apply()`: thử thật, chỉ hoãn khi maplibre nói style chưa phân giải. */
  const applyFleet = (): void => {
    if (!fleet) return;
    try {
      ensureFleetLayers();
    } catch (error) {
      if (!(error instanceof Error) || !/not done loading/i.test(error.message)) throw error;
      return;
    }
    setFleetData();
  };

  const placeFleetMarkers = (): void => {
    clearMarkers();
    if (!fleet || !fleet.markers) return;
    for (const [i, v] of fleet.plan.vehicles.entries()) {
      const color = fleet.colors[i % fleet.colors.length] ?? '#0072b2';
      // waypoints = start, các đơn theo thứ tự ghé, end (nếu có): đơn nằm ở 1…jobs.length.
      for (let j = 1; j <= v.jobs.length; j++) {
        const w = v.waypoints[j];
        if (w) markers.push(new ml.Marker({ color }).setLngLat(w.snapped).addTo(gl));
      }
    }
  };
```

(`clearMarkers` và `markers` đã có sẵn trong file — hàm mới dùng lại; đặt khối trên SAU định nghĩa `clearMarkers`, tức ngay trước `gl.on('style.load', …)`.)

(e) Handler `style.load` mở rộng:

```ts
  gl.on('style.load', () => {
    if (response && !gl.getSource(ROUTE_SOURCE_ID)) {
      ensureLayers();
      setData();
    }
    if (fleet && !gl.getSource(FLEET_SOURCE_ID)) {
      ensureFleetLayers();
      setFleetData();
    }
  });
```

(f) Object trả về:

```ts
    show(next, opts = {}) {
      fleet = null;
      setFleetData();
      response = next;
      coords = decodeRoutes(next);
      active = opts.active ?? 0;
      showMarkers = opts.markers ?? true;
      progress = null;
      apply();
      placeMarkers();
    },
    showFleet(plan, opts = {}) {
      response = null;
      coords = [];
      progress = null;
      setData();
      fleet = {
        plan,
        coords: decodeFleet(plan),
        colors: opts.colors && opts.colors.length > 0 ? opts.colors : FLEET_COLORS,
        active: opts.active ?? null,
        markers: opts.markers ?? true,
      };
      applyFleet();
      placeFleetMarkers();
    },
    setActive(index) {
      if (fleet) {
        fleet.active = index;
        setFleetData();
        return;
      }
      active = index;
      progress = null;
      setData();
    },
    setProgress(shapeIndex, snapped) {
      if (fleet) return;
      progress = { shapeIndex, snapped };
      setData();
    },
    clear() {
      response = null;
      coords = [];
      progress = null;
      fleet = null;
      clearMarkers();
      const source = gl.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(EMPTY_ROUTE_FEATURES as GeoJsonData);
      setFleetData();
    },
```

Lưu ý `setData()` khi `response` null và source chưa có thì chỉ `return` (không cảnh báo vì `response` null) — đúng ý.

(g) `packages/web/src/index.ts` và `umd.ts`: thêm `FLEET_SOURCE_ID` vào khối `export { ROUTE_LAYER_IDS, ROUTE_SOURCE_ID } from './routes-layer'` (index) và khối export từ `./index` (umd).

- [ ] **Step 4: Test, build web, size-limit**

Run: `pnpm exec vitest run packages/web/src/routes-layer.test.ts && pnpm --filter @mapslibvn/web build`
Expected: PASS; build in size — nếu `dist/index.js` vượt 15 kB, sửa `packages/web/.size-limit.json` lên `16 kB` kèm ghi chú số đo trong commit.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add packages/web/src/routes-layer.ts packages/web/src/routes-layer.test.ts packages/web/src/index.ts packages/web/src/umd.ts packages/web/.size-limit.json
git commit -m "feat(web): routes.showFleet — vẽ K xe K màu, bấm tuyến chọn xe, marker theo xe

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: React Native — `routes.showFleet()`

**Files:**
- Modify: `packages/react-native/src/navigation/routes-store.ts`
- Modify: `packages/react-native/src/navigation/route-layers.tsx`
- Modify: `packages/react-native/src/context.ts:18-23`
- Modify: `packages/react-native/src/map.tsx:275-279`
- Modify: `packages/react-native/src/navigation/routes-store.test.ts`, `route-layers.test.tsx`

- [ ] **Step 1: Test đỏ — store**

Thêm vào `packages/react-native/src/navigation/routes-store.test.ts` (import `import fleetFixture from '../../../core/tests/fixtures/fleet-plan-q1.json';`, `import type { FleetPlanResponse } from '@mapslibvn/core';`):

```ts
const plan = fleetFixture as unknown as FleetPlanResponse;

describe('createRoutesStore — đội xe', () => {
  it('showFleet: fleetFeatures mỗi xe một feature, response null; setActive đổi opacity; show() xoá fleet; clear xoá hết', () => {
    const store = createRoutesStore();
    store.show(response);
    store.showFleet(plan, { colors: ['#111111', '#222222'] });
    let snap = store.getSnapshot();
    expect(snap.response).toBeNull();
    expect(snap.fleet?.plan).toBe(plan);
    expect(snap.liveFeatures.features).toEqual([]);
    expect(snap.fleetFeatures.features.map((f) => f.properties.kind)).toEqual(['fleet', 'fleet']);
    const truoc = snap.fleetFeatures;
    store.setActive(1);
    snap = store.getSnapshot();
    expect(snap.fleetFeatures).not.toBe(truoc);
    expect(snap.fleetFeatures.features.map((f) => (f.properties as { opacity: number }).opacity)).toEqual([0.35, 1]);
    store.setProgress({ shapeIndex: 5, snapped: [106.6985, 10.7791] });
    expect(store.getSnapshot().fleetFeatures).toBe(snap.fleetFeatures); // định vị không đụng đội xe
    store.show(response);
    expect(store.getSnapshot().fleet).toBeNull();
    expect(store.getSnapshot().fleetFeatures.features).toEqual([]);
    store.showFleet(plan);
    store.clear();
    expect(store.getSnapshot().fleet).toBeNull();
    expect(store.getSnapshot().fleetFeatures.features).toEqual([]);
  });
});
```

- [ ] **Step 2: Test đỏ — layer**

Thêm vào `packages/react-native/src/navigation/route-layers.test.tsx` (import `FLEET_SOURCE_ID` từ `./route-layers`, fixture và kiểu như trên):

```ts
const plan = fleetFixture as unknown as FleetPlanResponse;

describe('RouteLayers — đội xe', () => {
  it('showFleet → source đội xe với 2 layer line data-driven, marker màu xe tại từng đơn, bấm tuyến → onRouteClick(index)', () => {
    const store = createRoutesStore();
    store.showFleet(plan);
    const onRouteClick = vi.fn();
    render(
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId="road_one_way_arrow" onRouteClick={onRouteClick} />
      </MapContext.Provider>,
    );
    expect(screen.queryByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`)).toBeNull();
    const geo = JSON.parse(screen.getByTestId(`mlrn-source-${FLEET_SOURCE_ID}`).dataset.geojson ?? '{}') as {
      features: { properties: { kind: string; index: number; color: string } }[];
    };
    expect(geo.features.map((f) => f.properties.kind)).toEqual(['fleet', 'fleet']);
    expect(layer(ROUTE_LAYER_IDS.fleetLine).paint).toEqual({
      'line-color': ['get', 'color'],
      'line-width': 6,
      'line-opacity': ['get', 'opacity'],
    });
    expect(layer(ROUTE_LAYER_IDS.fleetCasing).beforeId).toBe('road_one_way_arrow');
    const soDon = plan.vehicles.reduce((s, v) => s + v.jobs.length, 0);
    expect(screen.getAllByTestId('mapslibvn-fleet-marker')).toHaveLength(soDon);
    getSourceProps(FLEET_SOURCE_ID)?.onPress?.({
      nativeEvent: { features: [{ properties: { kind: 'fleet', index: 1 } }] },
    });
    expect(onRouteClick).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 3: Chạy, thấy đỏ**

Run: `pnpm exec vitest run packages/react-native/src/navigation/routes-store.test.ts packages/react-native/src/navigation/route-layers.test.tsx`
Expected: FAIL — `showFleet` không tồn tại.

- [ ] **Step 4: Store**

Trong `packages/react-native/src/navigation/routes-store.ts`:

(a) Import thêm từ core: `decodeFleet, FLEET_COLORS, type FleetPlanResponse, fleetRouteFeatures`.

(b) Snapshot và interface:

```ts
export interface FleetSnapshot {
  plan: FleetPlanResponse;
  active: number | null;
  colors: readonly string[];
  /** Vẽ marker màu xe tại từng đơn (mặc định true). */
  markers: boolean;
}

export interface RoutesSnapshot {
  response: DirectionsResponse | null;
  active: number;
  progress: RouteProgressCut | null;
  puck: boolean;
  altFeatures: RouteFeatureCollection;
  liveFeatures: RouteFeatureCollection;
  /** Kế hoạch đội xe đang vẽ; loại trừ với `response`. */
  fleet: FleetSnapshot | null;
  /** Feature `fleet` — chỉ dựng lại khi showFleet/setActive, định vị không đụng tới. */
  fleetFeatures: RouteFeatureCollection;
}
```

`RoutesStore` thêm:

```ts
  showFleet(
    plan: FleetPlanResponse,
    opts?: { active?: number | null; colors?: readonly string[]; markers?: boolean },
  ): void;
```

(c) Trong `createRoutesStore`: thêm `let fleetCoords: [number, number][][] = [];`; snapshot khởi tạo thêm `fleet: null, fleetFeatures: EMPTY_ROUTE_FEATURES`. Hàm `set` nhận thêm cờ `rebuildFleet`:

```ts
  const set = (
    patch: Partial<Omit<RoutesSnapshot, 'altFeatures' | 'liveFeatures' | 'fleetFeatures'>>,
    rebuildAlt = false,
    rebuildFleet = false,
  ): void => {
    const next = { ...snapshot, ...patch } as RoutesSnapshot;
    next.altFeatures = !next.response
      ? EMPTY_ROUTE_FEATURES
      : rebuildAlt || next.active !== snapshot.active || !snapshot.response
        ? altRouteFeatures(coords, next.active)
        : snapshot.altFeatures;
    next.liveFeatures = next.response
      ? liveRouteFeatures(coords, { active: next.active, progress: next.progress, puck: next.puck })
      : EMPTY_ROUTE_FEATURES;
    next.fleetFeatures = !next.fleet
      ? EMPTY_ROUTE_FEATURES
      : rebuildFleet
        ? fleetRouteFeatures(fleetCoords, { colors: next.fleet.colors, active: next.fleet.active })
        : snapshot.fleetFeatures;
    snapshot = next;
    for (const fn of listeners) fn();
  };
```

Phương thức:

```ts
    show(response, opts = {}) {
      coords = decodeRoutes(response);
      fleetCoords = [];
      set({ response, active: opts.active ?? 0, progress: null, fleet: null }, true);
    },
    showFleet(plan, opts = {}) {
      coords = [];
      fleetCoords = decodeFleet(plan);
      set(
        {
          response: null,
          progress: null,
          fleet: {
            plan,
            active: opts.active ?? null,
            colors: opts.colors && opts.colors.length > 0 ? opts.colors : FLEET_COLORS,
            markers: opts.markers ?? true,
          },
        },
        false,
        true,
      );
    },
    setActive(index) {
      if (snapshot.fleet) {
        set({ fleet: { ...snapshot.fleet, active: index } }, false, true);
        return;
      }
      set({ active: index, progress: null });
    },
    setProgress(cut) {
      if (snapshot.fleet) return;
      set({ progress: cut });
    },
    setPuck(on) {
      if (on !== snapshot.puck) set({ puck: on });
    },
    clear() {
      coords = [];
      fleetCoords = [];
      set({ response: null, progress: null, fleet: null });
    },
```

- [ ] **Step 5: Layer**

Trong `packages/react-native/src/navigation/route-layers.tsx`:

(a) Hằng số: thêm `export const FLEET_SOURCE_ID = 'mapslibvn-fleet';` và hai id vào `ROUTE_LAYER_IDS`: `fleetCasing: 'mapslibvn-fleet-casing', fleetLine: 'mapslibvn-fleet-line',`.

(b) Đầu hàm `RouteLayers`, sau `const snap = useSyncExternalStore(...)`, thay `if (!snap.response) return null;` bằng:

```tsx
  const casingColor = routeStyle?.casingColor ?? '#ffffff';
  const before = beforeId ? { beforeId } : {};
  if (snap.fleet) {
    const fleet = snap.fleet;
    const onPressFleet = (e: NativeSyntheticEvent<PressEventWithFeatures>): void => {
      const hit = e.nativeEvent.features.find((f) => f.properties?.kind === 'fleet');
      const index: unknown = hit?.properties?.index;
      if (typeof index === 'number') onRouteClick?.(index);
    };
    return (
      <>
        <GeoJSONSource
          id={FLEET_SOURCE_ID}
          data={snap.fleetFeatures as GeoJSON.FeatureCollection}
          onPress={onPressFleet}
        >
          <Layer
            type="line"
            id={ROUTE_LAYER_IDS.fleetCasing}
            source={FLEET_SOURCE_ID}
            layout={ROUND}
            paint={{ 'line-color': casingColor, 'line-width': 9, 'line-opacity': ['get', 'opacity'] }}
            {...before}
          />
          <Layer
            type="line"
            id={ROUTE_LAYER_IDS.fleetLine}
            source={FLEET_SOURCE_ID}
            layout={ROUND}
            paint={{
              'line-color': ['get', 'color'],
              'line-width': 6,
              'line-opacity': ['get', 'opacity'],
            }}
            {...before}
          />
        </GeoJSONSource>
        {fleet.markers
          ? fleet.plan.vehicles.flatMap((v, i) => {
              const color = fleet.colors[i % fleet.colors.length] ?? '#0072b2';
              // waypoints = start, các đơn theo thứ tự ghé, end (nếu có): đơn nằm ở 1…jobs.length.
              return v.jobs.map((job, j) => {
                const w = v.waypoints[j + 1];
                return w ? (
                  <Marker
                    key={`${v.vehicle}-${job}`}
                    lng={w.snapped[0]}
                    lat={w.snapped[1]}
                    color={color}
                    testID="mapslibvn-fleet-marker"
                  />
                ) : null;
              });
            })
          : null}
      </>
    );
  }
  if (!snap.response) return null;
```

và xoá hai dòng khai báo `casingColor`/`before` cũ phía dưới (đã chuyển lên trên).

(c) `packages/react-native/src/context.ts` — `routes` trong `MapHandle`:

```ts
  routes: {
    show(response: DirectionsResponse, opts?: { active?: number }): void;
    /** Vẽ cả đội xe: mỗi xe một màu, bấm tuyến → onRouteClick(index xe). Loại trừ với show(). */
    showFleet(
      plan: FleetPlanResponse,
      opts?: { active?: number | null; colors?: readonly string[]; markers?: boolean },
    ): void;
    setActive(index: number): void;
    clear(): void;
  };
```

(import thêm `FleetPlanResponse` từ `@mapslibvn/core`.)

(d) `packages/react-native/src/map.tsx` khối `routes:` thêm `showFleet: (plan, opts) => store.showFleet(plan, opts ?? {}),`.

- [ ] **Step 6: Chạy test RN, typecheck, size-limit**

Run: `pnpm exec vitest run packages/react-native/src/navigation packages/react-native/src/map.test.tsx && pnpm --filter @mapslibvn/react-native build && pnpm typecheck && pnpm lint`
Expected: PASS; build dưới trần 32 kB (nếu vượt, nâng `.size-limit.json` của RN kèm số đo trong commit).

- [ ] **Step 7: Commit**

```bash
git add packages/react-native/src/navigation/routes-store.ts packages/react-native/src/navigation/routes-store.test.ts packages/react-native/src/navigation/route-layers.tsx packages/react-native/src/navigation/route-layers.test.tsx packages/react-native/src/context.ts packages/react-native/src/map.tsx packages/react-native/.size-limit.json
git commit -m "feat(react-native): routes.showFleet — source đội xe, layer data-driven, marker theo xe

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 14: Playground — mục "Chia đơn cho nhiều xe" trong tab Đội xe

**Files:**
- Modify: `apps/docs/public/playground-lib.js` (hằng số, `NavPoint.tw`, `plusHoursIso`, `fleetPlanRequest`, `fleetSnippet`)
- Modify: `apps/docs/scripts/playground-lib.test.mjs`
- Modify: `apps/docs/public/playground.html` (sau `<p class="pg-req" id="fl-opt-req"></p>`)
- Modify: `apps/docs/public/playground-fleet.js`
- Modify: `apps/docs/public/playground.css` (cuối phần "Tab Đội xe")
- Modify: `apps/docs/e2e/playground.spec.ts` (describe 'tab Đội xe')

- [ ] **Step 1: Test đỏ cho logic thuần**

Thêm vào `apps/docs/scripts/playground-lib.test.mjs` (mở rộng import từ `../public/playground-lib.js` thêm `FLEET_MAX_JOBS, FLEET_MAX_VEHICLES, fleetPlanRequest, plusHoursIso`):

```js
describe('fleetPlanRequest', () => {
  const base = {
    points: FLEET_SAMPLE.map((p) => ({ ...p })),
    vehicles: 2,
    capacity: null,
    demand: 1,
    serviceMin: 5,
    departure: '',
    shiftHours: 8,
    endMode: /** @type {const} */ ('depot'),
    mode: 'motorbike',
    lang: 'vi',
    today: '2026-09-24',
  };

  it('kho = điểm 1, đơn = điểm còn lại; xe cùng kho; service_s từ phút; không capacity/demand/time_window khi không nhập', () => {
    const r = fleetPlanRequest(base);
    if (!r.ok) throw new Error(r.error);
    expect(r.jobs).toHaveLength(5);
    expect(r.body.mode).toBe('motorbike');
    expect(r.body.vehicles).toEqual([
      { id: 'xe-1', start: [10.7725, 106.698] },
      { id: 'xe-2', start: [10.7725, 106.698] },
    ]);
    expect(r.body.jobs[0]).toEqual({ id: 'don-1', location: [10.7826, 106.6958], service_s: 300 });
  });

  it('sức chứa → capacity mỗi xe + demand mỗi đơn; open-end → end "open"; ca làm → time_window +07:00; khung giờ từng đơn', () => {
    const points = base.points.map((p, i) => (i === 2 ? { ...p, tw: '09:00-10:00' } : p));
    const r = fleetPlanRequest({ ...base, points, capacity: 5, demand: 2, departure: '08:00', shiftHours: 4, endMode: 'open' });
    if (!r.ok) throw new Error(r.error);
    expect(r.body.vehicles[0]).toEqual({
      id: 'xe-1',
      start: [10.7725, 106.698],
      end: 'open',
      capacity: 5,
      time_window: ['2026-09-24T08:00:00+07:00', '2026-09-24T12:00:00+07:00'],
    });
    expect(r.body.jobs[1]).toEqual({
      id: 'don-2',
      location: [10.7686, 106.7069],
      demand: 2,
      service_s: 300,
      time_windows: [['2026-09-24T09:00:00+07:00', '2026-09-24T10:00:00+07:00']],
    });
    expect(r.body.jobs[0]).not.toHaveProperty('time_windows');
  });

  it('chặn trước khi gọi: thiếu đơn, quá 30 đơn, thiếu xe cho số đơn, khung giờ mà không có giờ xuất phát, khung giờ sai dạng', () => {
    expect(fleetPlanRequest({ ...base, points: base.points.slice(0, 1) })).toMatchObject({ ok: false, error: /ít nhất 1 đơn/ });
    const nhieu = Array.from({ length: 32 }, (_, i) => ({ lat: 10.7 + i * 0.001, lng: 106.7, label: `p${i}` }));
    expect(fleetPlanRequest({ ...base, points: nhieu })).toMatchObject({ ok: false, error: new RegExp(`Tối đa ${FLEET_MAX_JOBS} đơn`) });
    const muoiHai = nhieu.slice(0, 12);
    expect(fleetPlanRequest({ ...base, points: muoiHai, vehicles: 1 })).toMatchObject({ ok: false, error: /cần ít nhất 2 xe/ });
    expect(fleetPlanRequest({ ...base, points: base.points.map((p, i) => (i === 1 ? { ...p, tw: '09:00-10:00' } : p)) })).toMatchObject({ ok: false, error: /giờ xuất phát/ });
    expect(fleetPlanRequest({ ...base, departure: '08:00', points: base.points.map((p, i) => (i === 1 ? { ...p, tw: '10:00-09:00' } : p)) })).toMatchObject({ ok: false, error: /điểm 2/ });
    expect(FLEET_MAX_VEHICLES).toBe(5);
  });
});

describe('plusHoursIso', () => {
  it('cộng giờ và in lại theo +07:00, kể cả tràn qua ngày', () => {
    expect(plusHoursIso('2026-09-24T08:00:00+07:00', 4)).toBe('2026-09-24T12:00:00+07:00');
    expect(plusHoursIso('2026-09-24T22:30:00+07:00', 3)).toBe('2026-09-25T01:30:00+07:00');
  });
});
```

Thêm vào ca `fleetSnippet` hiện có (hoặc ca mới) một khẳng định: `expect(fleetSnippet(state, {...})).toContain('client.fleetPlan(')` và `toContain('map.routes.showFleet(plan)')`.

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm exec vitest run apps/docs/scripts/playground-lib.test.mjs`
Expected: FAIL — `fleetPlanRequest` không export.

- [ ] **Step 3: `playground-lib.js`**

(a) Trong typedef `NavPoint` (dòng `@typedef {{ lat: number, lng: number, label: string }} NavPoint`) thêm trường `tw?: string` với chú thích `khung giờ "HH:MM-HH:MM", chỉ tab Đội xe dùng`.

(b) Sau `export const OPTIMIZED_MAX_STOPS = 10;` thêm:

```js
/** Trần chia đơn đội xe (`apps/api/src/routing/fleet.ts`, spec 23/09/2026). Đổi bên API phải đổi đây. */
export const FLEET_MAX_VEHICLES = 5;
export const FLEET_MAX_JOBS = 30;
export const FLEET_MAX_JOBS_PER_VEHICLE = OPTIMIZED_MAX_STOPS;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** @param {string} today YYYY-MM-DD (giờ VN) @param {string} hhmm */
const isoVn = (today, hhmm) => `${today}T${hhmm}:00+07:00`;

/**
 * Cộng giờ vào mốc ISO +07:00 và in lại theo +07:00 (ca làm tràn qua nửa đêm vẫn ra đúng ngày).
 * @param {string} iso @param {number} hours
 */
export function plusHoursIso(iso, hours) {
  const d = new Date(Date.parse(iso) + hours * 3_600_000 + 7 * 3_600_000);
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00+07:00`;
}

/**
 * @typedef {{ points: NavPoint[], vehicles: number, capacity: number | null, demand: number,
 *   serviceMin: number, departure: string, shiftHours: number, endMode: 'depot' | 'open',
 *   mode: string, lang: string, today: string }} FleetPlanInput
 */

/**
 * Body `POST /v1/fleet-plan` từ danh sách điểm của tab: điểm 1 là kho chung, điểm còn lại là đơn.
 * Khung giờ từng đơn đọc từ `point.tw`, chỉ gửi khi có giờ xuất phát (chế độ tuyệt đối đòi mọi xe có time_window).
 * @param {FleetPlanInput} input
 * @returns {{ ok: true, body: Record<string, unknown>, jobs: NavPoint[] } | { ok: false, error: string }}
 */
export function fleetPlanRequest(input) {
  const { points, today } = input;
  const depot = points[0];
  if (!depot || points.length < 2) return { ok: false, error: 'Cần điểm kho (số 1) và ít nhất 1 đơn.' };
  const jobs = points.slice(1);
  if (jobs.length > FLEET_MAX_JOBS) {
    return { ok: false, error: `Tối đa ${FLEET_MAX_JOBS} đơn — đang ${jobs.length}. Bớt điểm trong danh sách.` };
  }
  const vehicles = Math.min(FLEET_MAX_VEHICLES, Math.max(1, Math.round(input.vehicles)));
  const canXe = Math.ceil(jobs.length / FLEET_MAX_JOBS_PER_VEHICLE);
  if (vehicles < canXe) {
    return { ok: false, error: `${jobs.length} đơn cần ít nhất ${canXe} xe (mỗi xe tối đa ${FLEET_MAX_JOBS_PER_VEHICLE} đơn).` };
  }
  if (jobs.some((p) => p.tw) && !input.departure) {
    return { ok: false, error: 'Nhập giờ xuất phát để dùng khung giờ.' };
  }
  if (input.departure && !HHMM.test(input.departure)) {
    return { ok: false, error: 'Giờ xuất phát phải dạng HH:MM.' };
  }
  /** @type {[string, string] | null} */
  let timeWindow = null;
  if (input.departure) {
    const start = isoVn(today, input.departure);
    timeWindow = [start, plusHoursIso(start, Math.max(0.5, input.shiftHours || 8))];
  }
  /** @type {Record<string, unknown>[]} */
  const jobsBody = [];
  for (const [i, p] of jobs.entries()) {
    /** @type {Record<string, unknown>} */
    const job = { id: `don-${i + 1}`, location: [p.lat, p.lng] };
    if (input.capacity !== null) job.demand = input.demand;
    if (input.serviceMin > 0) job.service_s = Math.round(input.serviceMin * 60);
    if (p.tw) {
      const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(p.tw.trim());
      const a = m?.[1] ?? '';
      const b = m?.[2] ?? '';
      if (!m || !HHMM.test(a) || !HHMM.test(b) || a >= b) {
        return { ok: false, error: `Khung giờ của điểm ${i + 2} phải dạng 08:30-09:30 (bắt đầu trước kết thúc).` };
      }
      job.time_windows = [[isoVn(today, a), isoVn(today, b)]];
    }
    jobsBody.push(job);
  }
  const vehiclesBody = Array.from({ length: vehicles }, (_, i) => {
    /** @type {Record<string, unknown>} */
    const v = { id: `xe-${i + 1}`, start: [depot.lat, depot.lng] };
    if (input.endMode === 'open') v.end = 'open';
    if (input.capacity !== null) v.capacity = input.capacity;
    if (timeWindow) v.time_window = timeWindow;
    return v;
  });
  return {
    ok: true,
    jobs,
    body: { mode: input.mode, lang: input.lang, vehicles: vehiclesBody, jobs: jobsBody },
  };
}
```

(c) Trong `fleetSnippet`, sau dòng `'map.routes.show(trip); …'` thêm (trước `.join('\n')`):

```js
    '',
    '// Chia đơn cho cả đội: mỗi xe trong plan.vehicles là một DirectionsResponse + jobs/stops',
    'const plan = await client.fleetPlan({',
    `  mode: '${mode}',`,
    `  vehicles: [{ id: 'xe-1', start: ${ll(from)} }, { id: 'xe-2', start: ${ll(from)} }],`,
    `  jobs: [${rest.map((p, i) => `{ id: 'don-${i + 1}', location: ${ll(p)} }`).join(', ')}],`,
    '});',
    'console.log(plan.vehicles.map((v) => [v.vehicle, v.jobs])); // đơn nào giao xe nào, theo thứ tự ghé',
    'map.routes.showFleet(plan); // web và React Native: K xe K màu; bấm tuyến → routeClick(index xe)',
```

- [ ] **Step 4: Chạy test lib, xanh**

Run: `pnpm exec vitest run apps/docs/scripts/playground-lib.test.mjs`
Expected: PASS.

- [ ] **Step 5: HTML**

Trong `apps/docs/public/playground.html`, ngay sau `<p class="pg-req" id="fl-opt-req"></p>` (trước `<h2>Ma trận khoảng cách</h2>`) chèn:

```html
        <h2>Chia đơn cho nhiều xe</h2>
        <p class="pg-hint">
          Điểm 1 là kho chung, các điểm còn lại là đơn. API chia đơn cho từng xe, sắp thứ tự ghé và
          trả tuyến đầy đủ mỗi xe. Tối đa 5 xe, 30 đơn, 10 đơn mỗi xe; <strong>2 lần/phút/khoá</strong>.
        </p>
        <div class="fl-grid">
          <div class="pg-field">
            <label for="fl-veh">Số xe</label>
            <select id="fl-veh">
              <option value="1">1</option>
              <option value="2" selected>2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
          </div>
          <div class="pg-field">
            <label for="fl-end">Kết thúc</label>
            <select id="fl-end">
              <option value="depot">Về kho</option>
              <option value="open">Ở đơn cuối</option>
            </select>
          </div>
          <div class="pg-field">
            <label for="fl-cap">Sức chứa mỗi xe</label>
            <input id="fl-cap" type="number" min="0" step="1" placeholder="trống = không giới hạn" />
          </div>
          <div class="pg-field">
            <label for="fl-dem">Khối lượng mỗi đơn</label>
            <input id="fl-dem" type="number" min="0" step="1" value="1" />
          </div>
          <div class="pg-field">
            <label for="fl-svc">Dừng mỗi điểm (phút)</label>
            <input id="fl-svc" type="number" min="0" step="1" value="5" />
          </div>
          <div class="pg-field">
            <label for="fl-dep">Giờ xuất phát</label>
            <input id="fl-dep" type="time" />
          </div>
          <div class="pg-field">
            <label for="fl-shift">Ca làm (giờ)</label>
            <input id="fl-shift" type="number" min="1" max="24" step="1" value="8" />
          </div>
        </div>
        <p class="pg-hint">
          Khung giờ khách hẹn nhập ở ô cạnh từng điểm (ví dụ <code>08:30-09:30</code>); chỉ gửi khi có
          giờ xuất phát. Giờ đến trả về là ước tính theo ma trận, có thể lệch vài phần trăm so với tuyến vẽ.
        </p>
        <button id="fl-plan" type="button" class="pg-primary">Chia đơn — /v1/fleet-plan</button>
        <p class="pg-out" id="fl-plan-msg">Chưa gọi API.</p>
        <div id="fl-plan-list" class="fl-plan-list"></div>
        <p class="pg-out" id="fl-unassigned" hidden></p>
        <p class="pg-req" id="fl-plan-req"></p>
```

Đổi câu hint đầu tab: `API giới hạn <strong>6 lần/phút/khoá</strong>` → `API giới hạn <strong>6 lần/phút/khoá</strong> (ma trận, tối ưu) và <strong>2 lần/phút/khoá</strong> (chia đơn)`.

- [ ] **Step 6: CSS**

Cuối phần "Tab Đội xe" trong `apps/docs/public/playground.css` thêm:

```css
.fl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 10px;
}

.fl-tw {
  flex: none;
  width: 96px;
  padding: 2px 4px;
  font-size: 11px;
}

.fl-plan-list {
  margin: 8px 0;
}

.fl-veh {
  margin-bottom: 8px;
  padding: 6px 8px;
  border: 1px solid var(--pg-border);
  border-radius: 6px;
}

.fl-veh > button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.fl-swatch {
  display: inline-block;
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.fl-veh ol {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}

.fl-veh li {
  padding: 3px 0;
  border-top: 1px solid var(--pg-border);
  font-size: 13px;
}

.fl-veh small {
  display: block;
  color: var(--pg-muted);
  font-size: 11px;
}
```

- [ ] **Step 7: `playground-fleet.js`**

(a) Import thêm từ `/playground-lib.js`: `fleetPlanRequest`. Thêm biến trạng thái sau `let busy = false;`:

```js
  /** Kế hoạch đội xe vừa nhận. */
  /** @type {import('@mapslibvn/core').FleetPlanResponse | null} */
  let lastPlan = null;
  /** Chỉ số điểm → màu xe được giao, để tô marker sau khi chia đơn. */
  /** @type {Map<number, string>} */
  let assignment = new Map();
  const FLEET_COLORS_FALLBACK = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00'];
  /** @param {number} k */
  const colorOf = (k) => {
    /** @type {string[]} */
    const colors = deps.sdk?.FLEET_COLORS ?? FLEET_COLORS_FALLBACK;
    return colors[k % colors.length] ?? FLEET_COLORS_FALLBACK[0];
  };
  const todayVn = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
```

(b) `errorText`: đổi câu 429 thành
`'Quá nhịp cho khoá này (ma trận/tối ưu 6 lần, chia đơn 2 lần mỗi phút; khoá demo dùng chung) — đợi một phút rồi thử lại, hoặc dùng khoá riêng ở tab Bản đồ.'`

(c) `renderMarkers()`: sau `dot.title = point.label;` thêm

```js
      const mauXe = assignment.get(index);
      if (mauXe && index > 0) dot.style.background = mauXe;
```

(d) `renderPoints()`: trong `li.append(…)` chèn TRƯỚC ba nút icon một ô khung giờ cho điểm không phải kho:

```js
        const tw = document.createElement('input');
        tw.className = 'fl-tw';
        tw.placeholder = '08:30-09:30';
        tw.title = 'Khung giờ khách hẹn (chỉ dùng khi có giờ xuất phát)';
        tw.value = point.tw ?? '';
        tw.hidden = index === 0;
        tw.addEventListener('change', () => {
          points[index] = { ...point, tw: tw.value.trim() || undefined };
          resetResults();
        });
```

và đưa `tw` vào `li.append(num, name, tw, …)` (giữ ba nút sau nó). Lưu ý: `points[index] = {...}` với `tw: undefined` — JS thuần, không có exactOptionalPropertyTypes nên hợp lệ.

(e) `resetResults()`: thêm `lastPlan = null; assignment = new Map(); el('fl-plan-list').replaceChildren(); el('fl-unassigned').hidden = true; say('fl-plan-msg', 'Chưa gọi API.');`.

(f) Thêm sau `renderLegs` (phần "Chia đơn"):

```js
  /* ---------- Chia đơn cho nhiều xe ---------- */

  /** @param {string} v */
  const numberOrNull = (v) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v)) || 0));
  const input = () => /** @type {HTMLInputElement} */ (el('fl-dep')).value;

  async function runFleetPlan() {
    const client = deps.getClient();
    if (!client || busy) return;
    const plan = fleetPlanRequest({
      points,
      vehicles: Number(/** @type {HTMLSelectElement} */ (el('fl-veh')).value),
      capacity: numberOrNull(/** @type {HTMLInputElement} */ (el('fl-cap')).value),
      demand: Number(/** @type {HTMLInputElement} */ (el('fl-dem')).value) || 0,
      serviceMin: Number(/** @type {HTMLInputElement} */ (el('fl-svc')).value) || 0,
      departure: input(),
      shiftHours: Number(/** @type {HTMLInputElement} */ (el('fl-shift')).value) || 8,
      endMode: /** @type {'depot' | 'open'} */ (/** @type {HTMLSelectElement} */ (el('fl-end')).value),
      mode: mode(),
      lang: lang(),
      today: todayVn(),
    });
    if (!plan.ok) {
      say('fl-plan-msg', plan.error, 'error');
      return;
    }
    const api = deps.getState().api.replace(/\/+$/, '');
    el('fl-plan-req').textContent = `POST ${api}/v1/fleet-plan\n${JSON.stringify(plan.body, null, 2)}`;
    busy = true;
    say('fl-plan-msg', 'Đang chia đơn…');
    const t0 = performance.now();
    try {
      const res = await client.fleetPlan(plan.body);
      const ms = Math.round(performance.now() - t0);
      el('fl-json').textContent = JSON.stringify(res, null, 2);
      lastPlan = res;
      deps.getMap()?.routes.showFleet(res, { markers: false });
      assignment = new Map();
      res.vehicles.forEach((v, k) => {
        for (const id of v.jobs) {
          const i = Number(id.replace('don-', ''));
          if (i > 0) assignment.set(i, colorOf(k));
        }
      });
      renderMarkers();
      /** @type {[number, number, number, number][]} */
      const boxes = [];
      for (const v of res.vehicles) {
        const bbox = v.routes[0]?.bbox;
        if (bbox) boxes.push(bbox);
      }
      if (boxes.length > 0) {
        fitBox([
          Math.min(...boxes.map((b) => b[0])),
          Math.min(...boxes.map((b) => b[1])),
          Math.max(...boxes.map((b) => b[2])),
          Math.max(...boxes.map((b) => b[3])),
        ]);
      }
      renderPlan(res);
      say(
        'fl-plan-msg',
        `${res.summary.vehicles_used}/${res.vehicles.length} xe dùng · ${res.summary.jobs_assigned} đơn xếp được · ` +
          `${shortDistance(res.summary.distance_m)} · ${shortDuration(res.summary.duration_s)} · ${ms} ms`,
      );
    } catch (err) {
      el('fl-plan-list').replaceChildren();
      deps.getMap()?.routes.clear();
      say('fl-plan-msg', errorText(err), 'error');
    } finally {
      busy = false;
    }
  }

  /** "don-3" → điểm số 4 trong danh sách (đơn thứ i là points[i]). */
  /** @param {string} jobId */
  const pointIndexOf = (jobId) => Number(jobId.replace('don-', ''));

  /** @param {import('@mapslibvn/core').FleetPlanResponse} res */
  function renderPlan(res) {
    const blocks = res.vehicles.map((v, k) => {
      const block = document.createElement('div');
      block.className = 'fl-veh';
      const head = document.createElement('button');
      head.type = 'button';
      const swatch = document.createElement('span');
      swatch.className = 'fl-swatch';
      swatch.style.background = colorOf(k);
      const title = document.createElement('span');
      const route = v.routes[0];
      title.textContent =
        v.jobs.length === 0
          ? `Xe ${k + 1} · nghỉ`
          : `Xe ${k + 1} · ${v.jobs.length} đơn · ${shortDistance(route?.distance_m ?? 0)} · ${shortDuration(route?.duration_s ?? 0)}` +
            (v.departure_at ? ` · xuất phát ${v.departure_at.slice(11, 16)}` : '');
      head.append(swatch, title);
      head.addEventListener('click', () => deps.getMap()?.routes.setActive(k));
      const list = document.createElement('ol');
      for (const stop of v.stops) {
        const li = document.createElement('li');
        const i = pointIndexOf(stop.job);
        const label = points[i]?.label ?? stop.job;
        li.textContent = `→ ${i + 1} · ${label}`;
        const meta = document.createElement('small');
        meta.textContent =
          (stop.arrival_at ? `đến ${stop.arrival_at.slice(11, 16)}` : `đến sau ${shortDuration(stop.arrival_s)}`) +
          (stop.waiting_s > 0 ? ` · chờ ${shortDuration(stop.waiting_s)}` : '') +
          (stop.service_s > 0 ? ` · dừng ${shortDuration(stop.service_s)}` : '');
        li.append(meta);
        list.append(li);
      }
      block.append(head, list);
      return block;
    });
    el('fl-plan-list').replaceChildren(...blocks);
    const chua = el('fl-unassigned');
    if (res.unassigned.length > 0) {
      chua.hidden = false;
      chua.textContent = `Chưa xếp được: ${res.unassigned
        .map((u) => {
          const i = pointIndexOf(u.id);
          return `điểm ${i + 1} (${points[i]?.label ?? u.id})`;
        })
        .join(', ')} — thêm xe, nới sức chứa hoặc khung giờ.`;
    } else {
      chua.hidden = true;
    }
  }
```

(g) Sự kiện — thêm cạnh `el('fl-opt').addEventListener(...)`:

```js
  el('fl-plan').addEventListener('click', () => void runFleetPlan());
  for (const id of ['fl-veh', 'fl-cap', 'fl-dem', 'fl-svc', 'fl-dep', 'fl-shift', 'fl-end']) {
    el(id).addEventListener('change', () => {
      resetResults();
      renderSnippet();
    });
  }
```

(h) `clearRoute()` và `attach()` giữ nguyên — `resetResults()` đã xoá cả kế hoạch đội xe. `lastPlan` dùng để không báo lint "unused": trong `renderSnippet()` không cần; nếu biome báo biến không dùng, bỏ `lastPlan` (chỉ giữ `assignment`).

- [ ] **Step 8: E2E**

Trong `apps/docs/e2e/playground.spec.ts`, `test.describe('tab Đội xe')` → `beforeEach` thêm:

```ts
    await page.route('**/v1/fleet-plan', (route) =>
      route.fulfill({ contentType: 'application/json', body: fixture('fleet-plan-q1.json') }),
    );
```

và hai test mới trong describe:

```ts
  test('chia đơn cho 2 xe: body 2 xe 5 đơn, hai khối xe hai màu, layer đội xe trên bản đồ, marker đơn đổi màu', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (error) => jsErrors.push(error.message));
    await page.locator('#fl-sample').click();
    await page.locator('#fl-veh').selectOption('2');
    const request = page.waitForRequest((r) => r.url().includes('/v1/fleet-plan') && r.method() === 'POST');
    await page.locator('#fl-plan').click();
    const body = (await request).postDataJSON() as { vehicles: unknown[]; jobs: { service_s?: number }[]; mode: string };
    expect(body.vehicles).toHaveLength(2);
    expect(body.jobs).toHaveLength(5);
    expect(body.jobs[0]?.service_s).toBe(300);
    expect(body.mode).toBe('motorbike');
    await expect(page.locator('#fl-plan-msg')).toContainText('2/2 xe dùng');
    const khoi = page.locator('#fl-plan-list .fl-veh');
    await expect(khoi).toHaveCount(2);
    const mau = await khoi.locator('.fl-swatch').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.background));
    expect(new Set(mau).size).toBe(2);
    await expect(page.locator('#fl-plan-list li')).toHaveCount(5);
    await expect(page.locator('#fl-unassigned')).toBeHidden();
    const drawn = await page.evaluate(() =>
      Boolean(
        (window as unknown as { __map: { gl: { getSource(id: string): unknown } } }).__map.gl.getSource('mapslibvn-fleet'),
      ),
    );
    expect(drawn).toBe(true);
    await expect(page.locator('#fl-plan-req')).toContainText('POST http://localhost:8787/v1/fleet-plan');
    // Marker đơn (không phải kho) đã đổi màu theo xe được giao.
    const mauMarker = await page.locator('.fl-marker:not(.fl-marker-depot)').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.background));
    expect(mauMarker.every((m) => m !== '')).toBe(true);
    expect(jsErrors).toEqual([]);
  });

  test('khung giờ mà chưa có giờ xuất phát → chặn trước khi gọi API', async ({ page }) => {
    let calls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/v1/fleet-plan')) calls += 1;
    });
    await page.locator('#fl-sample').click();
    await page.locator('#fl-points li').nth(1).locator('.fl-tw').fill('09:00-10:00');
    await page.locator('#fl-points li').nth(1).locator('.fl-tw').press('Tab');
    await page.locator('#fl-plan').click();
    await expect(page.locator('#fl-plan-msg')).toContainText('giờ xuất phát');
    await expect(page.locator('#fl-plan-msg')).toHaveAttribute('data-state', 'error');
    expect(calls).toBe(0);
  });
```

- [ ] **Step 9: Chạy e2e docs**

Run: `pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs e2e -- e2e/playground.spec.ts`
Expected: mọi test tab Đội xe PASS (kể cả hai ca cũ). Lỗi thường gặp: `SDK.FLEET_COLORS` undefined → chưa build web UMD sau Task 11/12 (`pnpm --filter @mapslibvn/web build` rồi build docs lại — `prebuild` chép SDK).

- [ ] **Step 10: Lint, commit**

Run: `pnpm lint`

```bash
git add apps/docs/public/playground.html apps/docs/public/playground-fleet.js apps/docs/public/playground-lib.js apps/docs/public/playground.css apps/docs/scripts/playground-lib.test.mjs apps/docs/e2e/playground.spec.ts
git commit -m "feat(docs): playground tab Đội xe — chia đơn cho nhiều xe qua POST /v1/fleet-plan, K xe K màu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: `pnpm smoke:fleet` — bài E, E2, F trên production

**Files:**
- Modify: `scripts/lib/receipt-ack.mjs` (thêm `postAndAck`), `scripts/lib/receipt-ack.test.mjs`
- Create: `scripts/lib/smoke-fleet.mjs`, `scripts/lib/smoke-fleet.test.mjs`, `scripts/smoke-fleet.mjs`
- Modify: `package.json` (script `smoke:fleet`)

- [ ] **Step 1: Test đỏ cho `postAndAck` và thư viện**

Thêm vào `scripts/lib/receipt-ack.test.mjs` (theo mẫu test `getAndAck` sẵn có trong file):

```js
describe('postAndAck', () => {
  it('POST JSON kèm khoá, đo thời gian trước ACK, ACK receipt từ header', async () => {
    /** @type {{ url: string, init: RequestInit }[]} */
    const calls = [];
    const fetchImpl = /** @type {typeof fetch} */ (
      async (/** @type {string | URL | Request} */ url, /** @type {RequestInit | undefined} */ init) => {
        calls.push({ url: String(url), init: init ?? {} });
        if (String(url).endsWith('/ack')) return new Response('{}', { status: 200 });
        return new Response(JSON.stringify({ vehicles: [] }), {
          status: 200,
          headers: { 'x-mapslibvn-receipt-id': 'r1', 'x-mapslibvn-receipt-token': 't1' },
        });
      }
    );
    const r = await postAndAck('https://api.test/v1/fleet-plan', 'https://api.test', 'k', { a: 1 }, { fetchImpl });
    expect(r.status).toBe(200);
    expect(r.ackFailed).toBe(false);
    expect(r.body).toEqual({ vehicles: [] });
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe('{"a":1}');
    expect(calls[1]?.url).toBe('https://api.test/v1/quota/receipts/r1/ack');
  });
});
```

Tạo `scripts/lib/smoke-fleet.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { HCM_POINTS } from './smoke-matrix.mjs';
import { fleetBodyFor, fleetIssues, parseFleetSmokeArgs, planBaiFleet } from './smoke-fleet.mjs';

describe('planBaiFleet', () => {
  it('E: 5 xe cùng kho Chợ Bến Thành, 28 đơn là 28 điểm còn lại; E2: 2 xe, 8 đơn, sức chứa/khung giờ/dừng', () => {
    const { E, E2 } = planBaiFleet();
    expect(E.vehicles).toBe(5);
    expect(E.jobs).toHaveLength(28);
    expect(E.depot).toEqual(HCM_POINTS[1]);
    expect(E.jobs).not.toContainEqual(HCM_POINTS[1]);
    expect(E2.vehicles).toBe(2);
    expect(E2.jobs).toHaveLength(8);
    expect(E2.capacity).toBe(5);
    expect(E2.serviceS).toBe(300);
    expect(E2.windowJobs).toEqual([0, 3]);
  });
});

describe('fleetBodyFor', () => {
  it('E: không ràng buộc, kho dịch 0,0001° × k; E2: capacity, demand 1, service_s, ca 08:00–12:00 hôm nay, hai đơn có khung giờ', () => {
    const { E, E2 } = planBaiFleet();
    const e = fleetBodyFor(E, 2, '2026-09-24');
    expect(e.vehicles).toHaveLength(5);
    expect(e.vehicles[0]).toEqual({ id: 'xe-1', start: [10.7727, 106.698] });
    expect(e.jobs).toHaveLength(28);
    expect(e.jobs[0]).toEqual({ id: 'don-1', location: HCM_POINTS[0] });
    const e2 = fleetBodyFor(E2, 0, '2026-09-24');
    expect(e2.vehicles[0]).toEqual({
      id: 'xe-1',
      start: HCM_POINTS[1],
      capacity: 5,
      time_window: ['2026-09-24T08:00:00+07:00', '2026-09-24T12:00:00+07:00'],
    });
    expect(e2.jobs[0]).toMatchObject({ demand: 1, service_s: 300, time_windows: [['2026-09-24T09:00:00+07:00', '2026-09-24T11:00:00+07:00']] });
    expect(e2.jobs[1]).not.toHaveProperty('time_windows');
  });
});

describe('fleetIssues', () => {
  const ok = {
    vehicles: [
      { vehicle: 'xe-1', jobs: ['don-1', 'don-2'], stops: [{ job: 'don-1', arrival_s: 100 }, { job: 'don-2', arrival_s: 300 }], load: 2, routes: [{ legs: [{}, {}, {}] }], waypoints: [{}, {}, {}, {}] },
      { vehicle: 'xe-2', jobs: [], stops: [], load: 0, routes: [], waypoints: [] },
    ],
    unassigned: [],
    summary: { vehicles_used: 1, jobs_assigned: 2, jobs_unassigned: 0 },
  };
  it('hợp lệ → []', () => {
    expect(fleetIssues(ok, { vehicles: 2, jobs: 2, capacity: null, roundTrip: true })).toEqual([]);
  });
  it('bắt: thiếu xe, tổng đơn lệch, leg lệch, arrival không tăng, load vượt sức chứa', () => {
    expect(fleetIssues({ ...ok, vehicles: ok.vehicles.slice(0, 1) }, { vehicles: 2, jobs: 2, capacity: null, roundTrip: true })).toContain('vehicles = 1, cần 2');
    expect(fleetIssues(ok, { vehicles: 2, jobs: 3, capacity: null, roundTrip: true })).toContain('đơn xếp + unassigned = 2, cần 3');
    const legLech = { ...ok, vehicles: [{ ...ok.vehicles[0], routes: [{ legs: [{}, {}] }] }, ok.vehicles[1]] };
    expect(fleetIssues(legLech, { vehicles: 2, jobs: 2, capacity: null, roundTrip: true })).toContain('xe-1: legs = 2, cần 3');
    const nguoc = { ...ok, vehicles: [{ ...ok.vehicles[0], stops: [{ job: 'don-1', arrival_s: 300 }, { job: 'don-2', arrival_s: 100 }] }, ok.vehicles[1]] };
    expect(fleetIssues(nguoc, { vehicles: 2, jobs: 2, capacity: null, roundTrip: true })).toContain('xe-1: arrival_s không tăng dần');
    expect(fleetIssues(ok, { vehicles: 2, jobs: 2, capacity: 1, roundTrip: true })).toContain('xe-1: load 2 vượt sức chứa 1');
  });
});

describe('parseFleetSmokeArgs', () => {
  it('mặc định: production, 5 lượt cách 30 s, không ngưỡng, 0 vòng F, ratio 2, busy 2000; bỏ qua "--"', () => {
    expect(parseFleetSmokeArgs(['--', '--confirm-production'])).toEqual({
      base: 'https://api.ai-solutions.io.vn',
      confirmProduction: true,
      requests: 5,
      intervalMs: 30_000,
      p95Max: null,
      p95MaxE2: null,
      rounds: 0,
      ratioMax: 2,
      busyMax: 2000,
    });
    expect(parseFleetSmokeArgs(['--requests=3', '--rounds=2', '--p95-max=8000', '--p95-max-e2=5000']).p95MaxE2).toBe(5000);
    expect(() => parseFleetSmokeArgs(['--la'])).toThrow(/Cờ không hợp lệ/);
  });
});
```

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `pnpm exec vitest run scripts/lib/receipt-ack.test.mjs scripts/lib/smoke-fleet.test.mjs`
Expected: FAIL — `postAndAck`, `smoke-fleet.mjs` không tồn tại.

- [ ] **Step 3: `postAndAck`**

Thêm cuối `scripts/lib/receipt-ack.mjs`:

```js
/**
 * Gọi POST JSON rồi ACK ngay receipt kèm theo — cùng hợp đồng với getAndAck (thời gian đo TRƯỚC ACK).
 * @param {string} url @param {string} root @param {string} key @param {unknown} body
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ ms: number, status: number, body: unknown, code: string | null, ackFailed: boolean }>}
 */
export async function postAndAck(url, root, key, body, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const t0 = performance.now();
  const signal = AbortSignal.timeout(options.timeoutMs ?? 40_000);
  /** @type {Response} */
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'X-Api-Key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal,
    });
  } catch (error) {
    return {
      ms: performance.now() - t0,
      status: 0,
      body: null,
      code: signal.aborted ? 'timeout' : String(error),
      ackFailed: false,
    };
  }
  const ms = performance.now() - t0;
  const receipt = receiptFrom(response);
  /** @type {unknown} */
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const ackFailed = !(await ackReceipt(root, key, receipt, options));
  const error =
    parsed && typeof parsed === 'object' && 'error' in parsed
      ? /** @type {{ error?: { code?: string } }} */ (parsed).error
      : undefined;
  return { ms, status: response.status, body: parsed, code: error?.code ?? null, ackFailed };
}
```

- [ ] **Step 4: Thư viện `smoke-fleet.mjs`**

Tạo `scripts/lib/smoke-fleet.mjs`:

```js
// Phần thuần (test được) của scripts/smoke-fleet.mjs — spec 2026-09-23 mục 8.
import { DEFAULT_BASE, HCM_POINTS } from './smoke-matrix.mjs';

/**
 * @typedef {{ name: string, vehicles: number, depot: readonly [number, number],
 *   jobs: (readonly [number, number])[], mode: 'motorbike' | 'car' | 'walk',
 *   capacity: number | null, serviceS: number, shift: [string, string] | null,
 *   windowJobs: number[], roundTrip: boolean }} BaiFleet
 */

/**
 * E: cỡ gần tối đa — 5 xe cùng kho Chợ Bến Thành (HCM_POINTS[1]), 28 đơn là 28 điểm còn lại (bộ
 * điểm đã kiểm nối được ba mode). E2: có ràng buộc — 2 xe, 8 đơn, sức chứa 5 / khối lượng 1, dừng
 * 300 s, ca 08:00–12:00, đơn 0 và 3 có khung giờ 09:00–11:00. Đổi trần bên Worker thì sửa cả đây.
 */
export function planBaiFleet() {
  const depot = HCM_POINTS[1];
  if (!depot) throw new Error('HCM_POINTS thiếu kho');
  const rest = HCM_POINTS.filter((_, i) => i !== 1);
  /** @type {BaiFleet} */
  const E = {
    name: 'E doi xe 5 xe 28 don motorbike',
    vehicles: 5,
    depot,
    jobs: rest,
    mode: 'motorbike',
    capacity: null,
    serviceS: 0,
    shift: null,
    windowJobs: [],
    roundTrip: true,
  };
  /** @type {BaiFleet} */
  const E2 = {
    name: 'E2 doi xe 2 xe 8 don rang buoc',
    vehicles: 2,
    depot,
    jobs: rest.slice(1, 9),
    mode: 'motorbike',
    capacity: 5,
    serviceS: 300,
    shift: ['08:00', '12:00'],
    windowJobs: [0, 3],
    roundTrip: true,
  };
  return { E, E2 };
}

/**
 * Body `POST /v1/fleet-plan`; kho dịch 0,0001° × k để mỗi lượt có khoá cache khác.
 * @param {BaiFleet} bai @param {number} k @param {string} today YYYY-MM-DD giờ VN
 */
export function fleetBodyFor(bai, k, today) {
  const [lat, lng] = bai.depot;
  /** @type {[number, number]} */
  const depot = [Number((lat + 0.0001 * k).toFixed(4)), lng];
  const iso = (/** @type {string} */ hhmm) => `${today}T${hhmm}:00+07:00`;
  const vehicles = Array.from({ length: bai.vehicles }, (_, i) => {
    /** @type {Record<string, unknown>} */
    const v = { id: `xe-${i + 1}`, start: depot };
    if (!bai.roundTrip) v.end = 'open';
    if (bai.capacity !== null) v.capacity = bai.capacity;
    if (bai.shift) v.time_window = [iso(bai.shift[0]), iso(bai.shift[1])];
    return v;
  });
  const jobs = bai.jobs.map((location, i) => {
    /** @type {Record<string, unknown>} */
    const j = { id: `don-${i + 1}`, location };
    if (bai.capacity !== null) j.demand = 1;
    if (bai.serviceS > 0) j.service_s = bai.serviceS;
    if (bai.windowJobs.includes(i)) j.time_windows = [[iso('09:00'), iso('11:00')]];
    return j;
  });
  return { mode: bai.mode, vehicles, jobs };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Đủ xe; tổng đơn xếp + unassigned = số đơn; mỗi xe có đơn: legs = đơn (+1 nếu về kho), waypoints
 * = đơn + 1 (+1), stops = đơn, arrival_s tăng dần, load ≤ sức chứa.
 * @param {unknown} body
 * @param {{ vehicles: number, jobs: number, capacity: number | null, roundTrip: boolean }} bai
 * @returns {string[]}
 */
export function fleetIssues(body, bai) {
  if (!isRecord(body)) return ['body không phải object'];
  /** @type {string[]} */
  const issues = [];
  const vehicles = Array.isArray(body.vehicles) ? body.vehicles : [];
  if (vehicles.length !== bai.vehicles) issues.push(`vehicles = ${vehicles.length}, cần ${bai.vehicles}`);
  const unassigned = Array.isArray(body.unassigned) ? body.unassigned.length : 0;
  let assigned = 0;
  for (const v of vehicles) {
    if (!isRecord(v)) {
      issues.push('vehicle không phải object');
      continue;
    }
    const jobs = Array.isArray(v.jobs) ? v.jobs.length : 0;
    assigned += jobs;
    const id = String(v.vehicle);
    if (jobs === 0) continue;
    const route = Array.isArray(v.routes) ? v.routes[0] : undefined;
    const legs = isRecord(route) && Array.isArray(route.legs) ? route.legs.length : 0;
    const canLegs = jobs + (bai.roundTrip ? 1 : 0);
    if (legs !== canLegs) issues.push(`${id}: legs = ${legs}, cần ${canLegs}`);
    const waypoints = Array.isArray(v.waypoints) ? v.waypoints.length : 0;
    if (waypoints !== canLegs + 1) issues.push(`${id}: waypoints = ${waypoints}, cần ${canLegs + 1}`);
    const stops = Array.isArray(v.stops) ? v.stops : [];
    if (stops.length !== jobs) issues.push(`${id}: stops = ${stops.length}, cần ${jobs}`);
    const arrivals = stops.map((s) => (isRecord(s) && typeof s.arrival_s === 'number' ? s.arrival_s : Number.NaN));
    if (arrivals.some((a, i) => i > 0 && !(a >= (arrivals[i - 1] ?? 0)))) issues.push(`${id}: arrival_s không tăng dần`);
    if (bai.capacity !== null && typeof v.load === 'number' && v.load > bai.capacity) {
      issues.push(`${id}: load ${v.load} vượt sức chứa ${bai.capacity}`);
    }
  }
  if (assigned + unassigned !== bai.jobs) issues.push(`đơn xếp + unassigned = ${assigned + unassigned}, cần ${bai.jobs}`);
  return issues;
}

/** @param {string} value @param {string} name @param {number} min @param {number} max @param {boolean} integer */
function boundedNumber(value, name, min, max, integer) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) {
    throw new Error(`${name} phải ${integer ? 'là số nguyên ' : ''}từ ${min} đến ${max}`);
  }
  return parsed;
}

/** @param {string[]} argv */
export function parseFleetSmokeArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  let confirmProduction = false;
  for (const value of argv) {
    if (value === '--') continue; // pnpm 10 chuyển nguyên `--` vào argv
    if (value === '--confirm-production') {
      confirmProduction = true;
      continue;
    }
    const match = /^--(base|requests|interval-ms|p95-max|p95-max-e2|rounds|ratio-max|busy-max)=(.+)$/.exec(value);
    if (!match) throw new Error(`Cờ không hợp lệ hoặc thiếu giá trị: ${value}`);
    const name = match[1];
    const raw = match[2];
    if (!name || raw === undefined) throw new Error(`Cờ không hợp lệ: ${value}`);
    if (values[name] !== undefined) throw new Error(`--${name} không được lặp`);
    values[name] = raw;
  }
  return {
    base: values.base ?? DEFAULT_BASE,
    confirmProduction,
    requests: boundedNumber(values.requests ?? '5', '--requests', 1, 30, true),
    // 30 s/lượt: FLEET_RATE_LIMITER 2 request/phút/khoá — phép đo phải sống trong luật mình đặt.
    intervalMs: boundedNumber(values['interval-ms'] ?? '30000', '--interval-ms', 0, 120_000, true),
    p95Max: values['p95-max'] === undefined ? null : boundedNumber(values['p95-max'], '--p95-max', 1, 120_000, false),
    p95MaxE2: values['p95-max-e2'] === undefined ? null : boundedNumber(values['p95-max-e2'], '--p95-max-e2', 1, 120_000, false),
    rounds: boundedNumber(values.rounds ?? '0', '--rounds', 0, 10, true),
    ratioMax: boundedNumber(values['ratio-max'] ?? '2', '--ratio-max', 1, 10, false),
    busyMax: boundedNumber(values['busy-max'] ?? '2000', '--busy-max', 1, 120_000, false),
  };
}
```

- [ ] **Step 5: Script `smoke-fleet.mjs`**

Tạo `scripts/smoke-fleet.mjs`:

```js
#!/usr/bin/env node
// Smoke chia đơn đội xe trên production (spec 2026-09-23 mục 8): bài E (5 xe, 28 đơn) và E2 (2 xe,
// 8 đơn có sức chứa/khung giờ/dừng), N lượt cách 30 s (FLEET_RATE_LIMITER 2/phút); --rounds=K chạy
// bài F: K vòng, mỗi vòng 5 directions lúc rảnh → bắn 2 bài E SONG SONG + 5 directions xen kẽ → nghỉ hết phút.
//   pnpm smoke:fleet -- --confirm-production [--requests=5] [--rounds=3] [--p95-max=8000] [--p95-max-e2=5000] [--ratio-max=2] [--busy-max=2000]
// Mỗi phản hồi 2xx được ACK receipt NGAY (scripts/lib/receipt-ack.mjs) — REST trần khoá cả tenant 24 giờ.
// Khoá đọc từ MAPSLIBVN_API_KEY (khoá `server`). Gặp 429 là smoke sai nhịp — sửa smoke, không sửa trần.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getAndAck, postAndAck } from './lib/receipt-ack.mjs';
import { fleetBodyFor, fleetIssues, parseFleetSmokeArgs, planBaiFleet } from './lib/smoke-fleet.mjs';
import { directionsUrl } from './lib/smoke-matrix.mjs';
import { assertDirectionsTarget, percentile } from './smoke-directions.mjs';

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
const todayVn = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

/**
 * @typedef {{ name: string, ok: number, failed: number, p95_ms: number | null, ack_loi: number, codes: string, violations: string }} Row
 * @param {import('./lib/smoke-fleet.mjs').BaiFleet} bai
 * @param {{ key: string, root: string, requests: number, intervalMs: number, sent: { n: number } }} ctx
 * @returns {Promise<Row>}
 */
async function runBai(bai, ctx) {
  /** @type {number[]} */
  const durations = [];
  /** @type {Set<string>} */
  const codes = new Set();
  /** @type {string[]} */
  const violations = [];
  let ok = 0;
  let failed = 0;
  let ackFailed = 0;
  const kiem = { vehicles: bai.vehicles, jobs: bai.jobs.length, capacity: bai.capacity, roundTrip: bai.roundTrip };
  for (let k = 0; k < ctx.requests; k++) {
    if (ctx.sent.n > 0 && ctx.intervalMs > 0) await sleep(ctx.intervalMs);
    ctx.sent.n += 1;
    const r = await postAndAck(`${ctx.root}/v1/fleet-plan`, ctx.root, ctx.key, fleetBodyFor(bai, k, todayVn()));
    durations.push(r.ms);
    if (r.ackFailed) ackFailed += 1;
    if (r.status !== 200) {
      failed += 1;
      codes.add(r.code ?? String(r.status));
      continue;
    }
    const issues = fleetIssues(r.body, kiem);
    if (issues.length > 0) {
      failed += 1;
      codes.add('invalid_body');
      violations.push(...issues.slice(0, 3));
    } else ok += 1;
  }
  const p95 = percentile(durations, 95);
  return {
    name: bai.name,
    ok,
    failed,
    p95_ms: p95 === null ? null : Math.round(p95),
    ack_loi: ackFailed,
    codes: [...codes].join(','),
    violations: [...new Set(violations)].join('; '),
  };
}

/**
 * Một vòng bài F: 5 directions rảnh → 2 bài E song song + 5 directions xen kẽ → nghỉ tới đủ 60 s.
 * Tổng 12 request/phút/khoá, dưới burst 20 và đúng nhịp 2 fleet/phút.
 * @param {string} root @param {string} key @param {import('./lib/smoke-fleet.mjs').BaiFleet} E @param {number} round
 */
async function runRound(root, key, E, round) {
  const started = Date.now();
  const from = E.depot;
  /** @param {number} offset */
  const sampleDirections = async (offset) => {
    /** @type {number[]} */
    const ms = [];
    for (let i = 0; i < 5; i++) {
      const target = E.jobs[(i + offset) % E.jobs.length] ?? E.jobs[0];
      if (!target) throw new Error('bài E thiếu đơn');
      const r = await getAndAck(directionsUrl(root, from, target), root, key);
      if (r.status !== 200) throw new Error(`vòng ${round}: directions ${r.status} ${r.code ?? ''} — dừng, không đo tiếp`);
      ms.push(r.ms);
      await sleep(1_000);
    }
    return ms;
  };
  const idle = await sampleDirections(0);
  const fleetRuns = [1, 2].map((j) =>
    postAndAck(`${root}/v1/fleet-plan`, root, key, fleetBodyFor(E, 100 * round + j, todayVn())),
  );
  const busy = await sampleDirections(5);
  const fleetResults = await Promise.all(fleetRuns);
  const fleetFailed = fleetResults.filter((r) => r.status !== 200);
  if (fleetFailed.length > 0) {
    throw new Error(`vòng ${round}: ${fleetFailed.length} request đội xe lỗi (${fleetFailed.map((r) => r.code ?? r.status).join(',')})`);
  }
  const idleP95 = percentile(idle, 95) ?? 0;
  const busyP95 = percentile(busy, 95) ?? 0;
  const row = {
    round,
    idle_p95_ms: Math.round(idleP95),
    busy_p95_ms: Math.round(busyP95),
    ratio: Number((busyP95 / Math.max(1, idleP95)).toFixed(2)),
    fleet_p95_ms: Math.round(percentile(fleetResults.map((r) => r.ms), 95) ?? 0),
  };
  const elapsed = Date.now() - started;
  if (elapsed < 60_000) await sleep(60_000 - elapsed);
  return row;
}

async function main() {
  const args = parseFleetSmokeArgs(process.argv.slice(2));
  assertDirectionsTarget(args.base, args.confirmProduction ? ['--confirm-production'] : []);
  const key = process.env.MAPSLIBVN_API_KEY;
  if (!key) throw new Error('Thiếu MAPSLIBVN_API_KEY (khoá server) trong môi trường');
  const root = args.base.replace(/\/+$/, '');
  const { E, E2 } = planBaiFleet();
  const ctx = { key, root, requests: args.requests, intervalMs: args.intervalMs, sent: { n: 0 } };
  console.log(`E, E2: ${2 * args.requests} lượt cách ${args.intervalMs} ms; F: ${args.rounds} vòng × ~60 s`);
  const rows = [await runBai(E, ctx), await runBai(E2, ctx)];
  console.table(rows);
  for (const [i, row] of rows.entries()) {
    if (row.failed > 0) throw new Error(`${row.name}: ${row.failed} lượt lỗi (${row.codes}) ${row.violations}`);
    if (row.ack_loi > 0) {
      throw new Error(`${row.name}: ${row.ack_loi} receipt KHÔNG xác nhận được — dừng ngay, ba receipt treo là khoá cả tenant 24 giờ`);
    }
    const max = i === 0 ? args.p95Max : args.p95MaxE2;
    if (max !== null && row.p95_ms !== null && row.p95_ms > max) {
      throw new Error(`${row.name}: p95 ${row.p95_ms} ms vượt ${max} ms`);
    }
  }
  if (args.rounds > 0) {
    console.log('nghỉ 60 s trước bài F để bộ đếm nhịp sạch…');
    await sleep(60_000);
    /** @type {Awaited<ReturnType<typeof runRound>>[]} */
    const fRows = [];
    for (let round = 1; round <= args.rounds; round++) fRows.push(await runRound(root, key, E, round));
    console.table(fRows);
    const worst = Math.max(...fRows.map((r) => r.ratio));
    const busyWorst = Math.max(...fRows.map((r) => r.busy_p95_ms));
    if (busyWorst > args.busyMax) throw new Error(`bài F: p95 directions lúc bận ${busyWorst} ms, vượt ngưỡng tuyệt đối ${args.busyMax} ms`);
    if (worst > args.ratioMax) throw new Error(`bài F: p95 directions lúc bận gấp ${worst} lần lúc rảnh, vượt ${args.ratioMax}`);
  }
  console.log(`✓ smoke fleet ${args.base}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
```

Thêm vào `package.json` (sau `"smoke:matrix"`): `"smoke:fleet": "node scripts/smoke-fleet.mjs",`.

- [ ] **Step 6: Chạy test, typecheck script, lint**

Run: `pnpm exec vitest run scripts/lib/receipt-ack.test.mjs scripts/lib/smoke-fleet.test.mjs && pnpm exec tsc -p tsconfig.scripts.json && pnpm lint`
Expected: PASS; typecheck sạch.

- [ ] **Step 7: Thử khô trên wrangler dev (không cần production)**

Với `pnpm test:routing` đã dựng xong VROOM+Valhalla ở Task 10, mở `cd apps/api && pnpm exec wrangler dev --var ROUTING_BASE:http://127.0.0.1:8002 --var FLEET_BASE:http://127.0.0.1:3000/fleet` ở một shell, rồi:

Run: `MAPSLIBVN_API_KEY=mlv_live_routingtest0000000000000 pnpm smoke:fleet -- --base=http://127.0.0.1:8787 --requests=1 --interval-ms=0`
Expected: bài E và E2 đỏ ở `codes` với `no_route`/`invalid_request` (graph dev chỉ có Quận 1, 28 đơn trải khắp TP.HCM) — điều cần thấy là script chạy tới cùng, in bảng, thoát mã 1 với thông điệp đúng. (Phép đo thật ở Task 17 do PHONG chạy.)

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/receipt-ack.mjs scripts/lib/receipt-ack.test.mjs scripts/lib/smoke-fleet.mjs scripts/lib/smoke-fleet.test.mjs scripts/smoke-fleet.mjs package.json
git commit -m "feat(scripts): pnpm smoke:fleet — bài E/E2/F cho POST /v1/fleet-plan, postAndAck

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 16: Hạ tầng máy chủ — VROOM production, README, server-setup, notices; PHONG bật container và luật Tunnel; deploy API

**Files:**
- Create: `infra/server/vroom/config.yml`
- Modify: `infra/server/compose.yml` (sau service `valhalla`, trước `volumes:`)
- Modify: `scripts/server-setup.mjs` (sau khối graph, trước `console.log(\`✔ Máy chủ đã dựng`)
- Modify: `scripts/lib/server-env.mjs:100-108`, `scripts/lib/server-env.test.mjs` (ca `pullPlan`)
- Modify: `infra/server/README.md` (mục "Việc tay trên Cloudflare" thêm bước 8; mục "Vận hành" thêm ba dòng)
- Modify: `THIRD_PARTY_NOTICES.md:422`

- [ ] **Step 1: Cấu hình VROOM production**

Tạo `infra/server/vroom/config.yml` — giống `infra/dev/vroom/config.yml` (Task 1) nhưng `threads: 2` và đầu file ghi:

```yaml
# vroom-express production (spec 2026-09-23 mục 5.1). Bản dev ở infra/dev/vroom/config.yml (threads 1).
# Entrypoint image chép file này vào /vroom-express/config.yml và touch access.log cạnh nó — mount THƯ MỤC.
# access.log nằm trong thư mục repo trên máy chủ nhưng đã bị .gitignore (*.log) bỏ qua.
```

- [ ] **Step 2: Service `vroom` trong compose máy chủ**

Trong `infra/server/compose.yml`, sau khối `valhalla:` (trước `volumes:`) thêm:

```yaml
  vroom:
    # Bộ giải đội xe (spec 2026-09-23). Ghim digest manifest list v1.15.0 — amd64 (Ubuntu, Windows/WSL2)
    # và arm64 (MacBook), `docker buildx imagetools inspect` 23/09/2026. Lấy ma trận từ valhalla:8002
    # trong mạng compose; KHÔNG depends_on có điều kiện vì healthcheck Valhalla có start_period một giờ
    # và VROOM chỉ nối Valhalla khi có request.
    image: ghcr.io/vroom-project/vroom-docker:v1.15.0@sha256:247d5683d6745c755d718a156d16b16aac80baccc276a003a68b986c13883b08
    restart: unless-stopped
    environment:
      VROOM_ROUTER: valhalla
    volumes:
      - ./vroom:/conf
    healthcheck:
      # baseurl là /fleet/ nên HEALTHCHECK mặc định của image (/health) sẽ 404 — ghi đè ở đây.
      test: ["CMD-SHELL", "curl -fsS http://localhost:3000/fleet/health >/dev/null"]
      interval: 30s
      timeout: 5s
      retries: 3
    # KHÔNG có `ports:` — chỉ cloudflared nối tới vroom:3000 qua luật đường dẫn /fleet/ của hostname maps-route.
```

- [ ] **Step 3: `server-setup` dựng vroom; `pullPlan` kéo image vroom**

(a) `scripts/lib/server-env.mjs` `pullPlan`: đổi `services: skipPipeline ? ['postgres', 'cloudflared', 'valhalla'] : []` thành `services: skipPipeline ? ['postgres', 'cloudflared', 'valhalla', 'vroom'] : []` và sửa JSDoc "ba dịch vụ" → "bốn dịch vụ". Trong `scripts/lib/server-env.test.mjs`, ca kiểm `pullPlan` với `:local` đổi mảng kỳ vọng thành `['postgres', 'cloudflared', 'valhalla', 'vroom']`.

(b) `scripts/server-setup.mjs`: ngay trước dòng `console.log(\`` của khối `✔ Máy chủ đã dựng` thêm:

```js
// Bộ giải đội xe (spec 2026-09-23): không phụ thuộc graph, dựng luôn; Worker chỉ tới được sau khi
// PHONG thêm luật đường dẫn /fleet/ vào hostname maps-route (bước 9 checklist).
run('docker', [...compose, 'up', '-d', 'vroom']);
services.push('vroom');
```

và thêm vào checklist in ra, sau dòng 8:

```
  9. Đội xe (spec 2026-09-23): Tunnel "mapslibvn-db" → Public Hostname → Add: subdomain maps-route, domain <domain>,
     Path ^/fleet/, Service HTTP → URL vroom:3000 → kéo luật này LÊN TRÊN luật maps-route cũ. Cùng Access application
     "mapslibvn-route", không cần token mới. Kiểm: curl kèm header Access …/fleet/health → 200; FLEET_BASE production đã có trong wrangler.toml.
```

Run: `pnpm exec vitest run scripts/lib/server-env.test.mjs && pnpm exec tsc -p tsconfig.scripts.json`
Expected: PASS.

- [ ] **Step 4: README máy chủ và thông báo bên thứ ba**

(a) `infra/server/README.md`, mục "Việc tay trên Cloudflare (một lần)", sau bước 7 thêm:

```markdown
8. **Đội xe (spec 2026-09-23-toi-uu-doi-xe)** — mở VROOM ra Worker qua CÙNG hostname với Valhalla:
   1. Trên máy chủ: `docker compose -f infra/server/compose.yml --env-file infra/server/.env up -d vroom`; `… ps` thấy `vroom` `healthy` (curl `/fleet/health` bên trong container).
   2. Tunnel `mapslibvn-db` → Public Hostname → **Add**: subdomain `maps-route`, domain `<domain>`, **Path** `^/fleet/`, Service **HTTP**, URL `vroom:3000` → Save → kéo luật mới **lên trên** luật `maps-route` không có đường dẫn (cloudflared so từ trên xuống; để dưới thì `/fleet/` rơi vào Valhalla và trả 404).
   3. Không cần Access application hay service token mới: app `mapslibvn-route` khai theo domain nên phủ mọi đường dẫn; Worker dùng lại `ROUTING_ACCESS_CLIENT_ID/SECRET`. `FLEET_BASE` production (`https://maps-route.<domain>/fleet`) đã nằm trong `wrangler.toml`.
   4. Kiểm từ máy dev: `curl -H "CF-Access-Client-Id: $CF_ROUTING_ID" -H "CF-Access-Client-Secret: $CF_ROUTING_SECRET" https://maps-route.<domain>/fleet/health` → 200; không header → 403/302; `…/status` vẫn là JSON Valhalla. Sau deploy Worker: `curl https://api.<domain>/healthz/fleet` → `{"ok":true,"jobs_assigned":2,…}`.
   5. Windows/WSL2 (máy chủ chính sau khi phát hành app): bind mount `./vroom` chạy trên Docker Desktop; WSL2 mặc định cấp ~50 % RAM — đủ cho Valhalla + VROOM + Postgres, nhưng đo lại `pnpm smoke:fleet` trước khi giữ trần.
```

(b) Mục "Vận hành" thêm:

```markdown
- Không bao giờ thêm `ports:` cho `vroom`. Đường vào duy nhất là Tunnel (luật đường dẫn `/fleet/`) + Access.
- `vroom` không cần graph và khởi động độc lập; nó gọi `valhalla:8002` theo từng request. Valhalla đang build graph thì `/v1/fleet-plan` trả 503 như `/v1/directions`.
- Log: thêm `vroom` vào lệnh `logs -f …`; `infra/server/vroom/access.log` là log HTTP của vroom-express (xoay ở 20M).
```

(c) `THIRD_PARTY_NOTICES.md` dòng 422: sau `Valhalla (MIT — …, không liên kết mã),` thêm `VROOM và vroom-express (BSD-2-Clause — bộ giải đội xe, chạy như dịch vụ riêng trên máy chủ, không liên kết mã),`.

- [ ] **Step 5: Cổng xanh toàn bộ và commit**

Run: `pnpm --filter @mapslibvn/core build && pnpm test && pnpm typecheck && pnpm lint`
Expected: 0 đỏ.

```bash
git add infra/server/vroom/config.yml infra/server/compose.yml scripts/server-setup.mjs scripts/lib/server-env.mjs scripts/lib/server-env.test.mjs infra/server/README.md THIRD_PARTY_NOTICES.md
git commit -m "feat(infra): VROOM trên máy chủ — compose, cấu hình, server-setup, README, thông báo bên thứ ba

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: PHONG bật VROOM trên máy chủ chính (MacBook) và thêm luật Tunnel**

PHONG gõ (tiền tố `!`), trên MacBook — nơi `docker ps --filter name=mapslibvn-server` thấy 5 container `Up`:

```bash
! docker compose -f infra/server/compose.yml --env-file infra/server/.env up -d vroom
! docker compose -f infra/server/compose.yml --env-file infra/server/.env ps vroom
```

Kỳ vọng: `mapslibvn-server-vroom-1 … Up (healthy)` sau ~1 phút. Rồi PHONG làm bước 8.2 của README trên dashboard Cloudflare, và kiểm:

```bash
! curl -sS -o /dev/null -w "%{http_code}\n" -H "CF-Access-Client-Id: $CF_ROUTING_ID" -H "CF-Access-Client-Secret: $CF_ROUTING_SECRET" https://maps-route.ai-solutions.io.vn/fleet/health
! curl -sS -o /dev/null -w "%{http_code}\n" https://maps-route.ai-solutions.io.vn/fleet/health
```

Kỳ vọng: `200` rồi `403` (hoặc `302`). Không đúng → luật đường dẫn đứng dưới luật cũ hoặc regex sai; sửa trên dashboard rồi kiểm lại. **Chưa đạt thì KHÔNG push** (Worker deploy sẽ khiến thành phần `fleet` của cron khởi đầu ở trạng thái hỏng).

- [ ] **Step 7: PHONG duyệt push → CI deploy API → kiểm sống**

Sau khi PHONG nói "push": `git push origin main`. Theo dõi Actions `Deploy API`, `CI`, `Routing tests`, `API tests` xanh. Rồi PHONG kiểm:

```bash
! curl -sS https://api.ai-solutions.io.vn/healthz/fleet
! curl -sS -X POST https://api.ai-solutions.io.vn/v1/fleet-plan -H "X-Api-Key: $MAPSLIBVN_API_KEY" -H "content-type: application/json" \
  -d '{"vehicles":[{"id":"xe-1","start":[10.7725,106.698]},{"id":"xe-2","start":[10.7725,106.698]}],"jobs":[{"id":"don-1","location":[10.7826,106.6958]},{"id":"don-2","location":[10.7686,106.7069]},{"id":"don-3","location":[10.777,106.6953]}]}' \
  | head -c 600
```

Kỳ vọng: `{"ok":true,"jobs_assigned":2,…}` và JSON có `"vehicles":[…"vehicle":"xe-1"…`. **Cảnh báo:** lệnh curl thứ hai phát receipt cho tenant thương mại; khoá `server` của tenant production dùng cho smoke có receipt → sau khi curl, chạy ngay `pnpm smoke:fleet` (tự ACK) hoặc ACK tay theo `docs/evidence/routing/2026-09-22-matrix.md`; ba receipt treo là khoá tenant 24 giờ. Ưu tiên: bỏ curl thứ hai, dùng luôn Task 17.

---

### Task 17: Đo production, evidence, chốt trần và nhịp

**Files:**
- Create: `docs/evidence/routing/2026-09-<ngày>-fleet.md`
- Có thể sửa: `apps/api/src/routing/fleet.ts` (hằng số), `apps/api/wrangler.toml` (nhịp), `apps/docs/public/playground-lib.js`, `scripts/lib/smoke-fleet.mjs` — CHỈ khi hụt ngưỡng

- [ ] **Step 1: PHONG chạy smoke**

```bash
! pnpm smoke:fleet -- --confirm-production --requests=5 --rounds=3 --p95-max=8000 --p95-max-e2=5000 --busy-max=2000 --ratio-max=2
```

Dán nguyên hai bảng `console.table` và dòng kết luận vào chat. Ghi kèm máy chủ đang chạy production lúc đo (MacBook) và `VALHALLA_THREADS`.

- [ ] **Step 2: Viết evidence**

Tạo `docs/evidence/routing/2026-09-<ngày>-fleet.md` theo khuôn file `2026-09-22-matrix.md`:

```markdown
# Đo production chia đơn đội xe (spec 2026-09-23 mục 8)

Ngày: 2026-09-<ngày>. Base: `https://api.ai-solutions.io.vn`. **Máy chủ: MacBook (arm64, máy chủ chính từ 23/09)**,
Valhalla `3.8.3` 1 luồng, VROOM 1.15.0 `threads: 2`. Khoá `server` của tenant production.
Lệnh: `pnpm smoke:fleet -- --confirm-production --requests=5 --rounds=3 …`.

## Kiểm sống sau deploy (Task 16 bước 7)

<dán /healthz/fleet>

## Bài E (5 xe, 28 đơn) và E2 (2 xe, 8 đơn, ràng buộc)

<dán bảng>

## Bài F — directions trong lúc 2 request đội xe chạy song song

<dán bảng>

## Đối chiếu ngưỡng (spec mục 8.2)

| Ngưỡng | Đo được | Đạt? |
|---|---|---|
| p95 bài E < 8.000 ms | … | … |
| p95 bài E2 < 5.000 ms | … | … |
| busy_p95 < 2.000 ms tuyệt đối (vòng xấu nhất) | … | … |
| busy_p95 ≤ 2× idle_p95 | … | … |
| 0 lỗi 5xx, 0 lỗi 429, 0 ACK trượt | … | … |

## Kết luận và trần công bố

Trần công bố: … xe / … đơn / … đơn mỗi xe, nhịp … request/phút/khoá. (Số này là của MacBook; dời máy chủ sang Windows i5-1340P phải đo lại.)
```

- [ ] **Step 3: Nếu hụt — hạ theo thứ tự mục 8.3 của spec, cùng commit**

Thứ tự: (1) `FLEET_MAX_JOBS` 30 → 20 và `FLEET_MAX_VEHICLES` 5 → 3 (sửa `fleet.ts`, test hằng số, `playground-lib.js` FLEET_MAX_*, `planBaiFleet()` E 28 → 18 đơn, HTML hint, docs/site ở Task 18–19 dùng số mới); (2) `FLEET_RATE_LIMITER` `limit = 1`; (3) `threads: 1` trong `infra/server/vroom/config.yml` (PHONG `up -d vroom` lại). Đo lại sau mỗi bước, ghi vào evidence "Lần đo N".

- [ ] **Step 4: Commit evidence**

```bash
git add docs/evidence/routing/2026-09-<ngày>-fleet.md
git commit -m "docs(evidence): đo production chia đơn đội xe — bài E/E2/F, chốt trần và nhịp

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 18: Docs — Giao hàng & đội xe, REST API, SDK, Tính năng, Tự host, spec cũ

**Files:**
- Modify: `apps/docs/src/content/docs/doi-xe.md`
- Modify: `apps/docs/src/content/docs/api.md` (mục 3 quota, bảng cache, bảng lỗi, mục 4 thêm endpoint)
- Modify: `apps/docs/src/content/docs/sdk.md:191-212`
- Modify: `apps/docs/src/content/docs/tinh-nang.md:106-109`
- Modify: `apps/docs/src/content/docs/tu-host.md:15, 44-49`
- Modify: `docs/superpowers/specs/2026-09-22-ma-tran-toi-uu-thu-tu-design.md` (mục 12 bullet đầu)

Mọi con số trần/nhịp dưới đây là số **đã chốt ở Task 17**; nếu Task 17 hạ trần, thay số tương ứng (5 xe / 30 đơn / 10 đơn mỗi xe / 2 request/phút).

- [ ] **Step 1: `doi-xe.md`**

(a) Frontmatter `description`: `Chọn tài xế gần nhất bằng ma trận khoảng cách, sắp thứ tự giao cho một chuyến, chia đơn cho cả đội xe, vẽ tuyến và dẫn đường — trên web và React Native.`

(b) Đoạn mở đầu: `Hai endpoint` → `Ba endpoint`; bảng thêm hàng thứ ba:

```markdown
| Nhiều xe: đơn nào giao xe nào, ghé theo thứ tự nào, mấy giờ tới? | [`client.fleetPlan()`](/api/#post-v1fleet-plan) | Đơn chia cho từng xe, thứ tự ghé, giờ đến ước tính, đơn không xếp được, **kèm tuyến đầy đủ của từng xe** |
```

và câu `Mỗi request tính **một lượt** Chỉ đường, dù ma trận có 4 hay 50 cặp.` → `Mỗi request tính **một lượt** Chỉ đường, dù ma trận có 4 hay 50 cặp, hay đội xe có 1 hay 5 xe.` Câu Playground: `rồi bấm "Tối ưu", "Chia đơn" hoặc "Tính ma trận".`

(c) Chèn mục mới sau mục 2 (trước `## 3. React Native`) và đánh số lại các mục sau thành 4, 5, 6, 7:

```markdown
## 3. Chia đơn cho cả đội

Sáng có 12 đơn và 2 shipper cùng xuất phát từ kho. Gửi cả đội và cả lô đơn trong **một request**;
máy chủ tự chia đơn, sắp thứ tự ghé cho từng xe và trả **tuyến đầy đủ của từng xe**:

```ts
const depot: [number, number] = [10.7725, 106.698];
const plan = await client.fleetPlan({
  mode: 'motorbike',
  vehicles: [
    { id: 'xe-1', start: depot, capacity: 20, time_window: ['2026-09-24T08:00:00+07:00', '2026-09-24T12:00:00+07:00'] },
    { id: 'xe-2', start: depot, capacity: 20, time_window: ['2026-09-24T08:00:00+07:00', '2026-09-24T12:00:00+07:00'] },
  ],
  jobs: orders.map((o) => ({
    id: o.code,
    location: o.latLng, // [lat, lng]
    demand: o.parcels, // khối lượng, cùng đơn vị với capacity
    service_s: 300, // dừng 5 phút mỗi điểm
    ...(o.slot ? { time_windows: [o.slot] } : {}), // ['2026-09-24T09:00:00+07:00', '2026-09-24T10:00:00+07:00']
  })),
});

for (const v of plan.vehicles) {
  console.log(v.vehicle, v.jobs); // ['don-7', 'don-2', …] theo thứ tự ghé; [] = xe nghỉ
  for (const s of v.stops) console.log(s.job, s.arrival_at, s.waiting_s); // giờ đến ước tính, phút chờ
}
console.log(plan.unassigned); // [{ id: 'don-9' }] — hết chỗ, quá sức chứa hoặc khung giờ không thoả

map.routes.showFleet(plan); // K xe K màu
map.on('routeClick', ({ index }) => map.routes.setActive(index)); // bấm tuyến → làm mờ xe khác
map.fitBounds(hopBbox(plan.vehicles.map((v) => v.routes[0]?.bbox)), 60);
```

Mỗi `plan.vehicles[k]` **là** một `DirectionsResponse` cộng `vehicle`, `jobs`, `stops`, `load`, `finish_s`, nên
app tài xế dùng đúng mã của [Dẫn đường](/dan-duong/): `map.routes.show(plan.vehicles[k])` và
`map.navigation.start({ response: plan.vehicles[k] })`.

Ba điều cần biết trước khi tin con số:

- **Hai chế độ thời gian.** Không có khung giờ nào → chế độ tương đối: `stops[].arrival_s` là giây kể từ lúc
  xe rời `start`. Có khung giờ → **mọi xe** phải có `time_window` (giờ làm), mốc giờ viết ISO 8601 **kèm múi
  giờ** (`+07:00`), và response có thêm `departure_at`, `arrival_at`, `finish_at` cùng múi. `departure_at` là
  giờ xuất phát bộ giải chọn, có thể sau đầu ca để bớt chờ.
- **Giờ đến tính trên ma trận, tuyến vẽ tính bằng `/route`.** Hai con số có thể lệch vài phần trăm; `stops`
  là lịch, `routes[0].legs` là tuyến.
- **`end` bỏ trống = về lại `start`; `end: 'open'` = kết thúc ở đơn cuối.** Sức chứa là tất cả-hoặc-không
  (một xe có `capacity` thì mọi xe phải có); `demand` mặc định 0. `max_jobs` (mặc định 10) giới hạn số đơn
  mỗi xe; `priority` 0–100 quyết định đơn nào được ưu tiên khi không đủ chỗ.

Một đơn không tới được bằng mạng đường → `404 no_route` cho cả request, thông điệp gọi tên đơn. Soát hết
điểm hỏng trước bằng `client.matrix({ sources: [depot], targets: jobs })`: ô `null` là điểm cần sửa.
```

(d) Mục React Native (nay là 4): sau đoạn `routes`/`navigation`, thêm:

```markdown
Chia đơn cho cả đội cũng chỉ là hai dòng: `const plan = await map.places.fleetPlan({ … })` rồi
`map.routes.showFleet(plan)`; `onRouteClick={(index) => map.routes.setActive(index)}` trên `<MapsLibVNMap>`
để bấm tuyến chọn xe. Tài xế dẫn đường một xe bằng `session.start({ response: plan.vehicles[k] })`.
```

(e) Bảng Giới hạn (nay mục 5): thêm hàng sau "Tối ưu thứ tự" và sửa hàng Nhịp:

```markdown
| Đội xe | **1–5 xe, 1–30 đơn, tối đa 10 đơn mỗi xe**; 1–3 khung giờ mỗi đơn, dừng ≤ 2 giờ | Sức chứa tất cả-hoặc-không; có khung giờ thì mọi xe cần `time_window`; body ≤ 64 KB |
| Nhịp | **6 request/phút/khoá** cho ma trận + tối ưu; **2 request/phút/khoá** cho đội xe | Vượt → `429 rate_limit_exceeded`, header `retry-after` |
```

(f) Mục "Khi cần vượt trần" (nay 6): thay đoạn "**Chuyến có hơn 10 điểm dừng:**" bằng

```markdown
**Hơn 10 đơn, hoặc nhiều xe:** dùng chia đơn (mục 3) — tối đa 30 đơn và 5 xe một lượt, bộ giải nhìn toàn cục
nên tốt hơn tự chia theo khu vực. Hơn 30 đơn thì chia lô theo khu vực rồi gọi nhiều lượt cách nhau 30 giây
(nhịp 2 request/phút).
```

(g) Mục "Chưa có" (nay 7): thay danh sách bằng

```markdown
- Lấy hàng ở A giao ở B trong cùng chuyến (pickup & delivery ghép đôi) — mỗi đơn hiện là một điểm giao.
- Kỹ năng tài xế (đơn chỉ xe X mới chở được), nghỉ giữa ca, nhiều loại xe trong một request — một `mode` cho cả đội.
- Giao thông thời gian thực — thời gian tính trên hình học mạng đường và tốc độ theo loại đường.
- Theo dõi vị trí đội xe trên máy chủ — app của bạn tự gửi và lưu vị trí tài xế.
```

- [ ] **Step 2: `api.md`**

(a) Mục 3, sau đoạn `GET /v1/matrix và GET /v1/optimized-route tính vào cùng quota…` thêm:

```markdown
`POST /v1/fleet-plan` (chia đơn cho đội xe) cũng tính **một lượt Chỉ đường mỗi request** bất kể số xe và số đơn, và có **nhịp riêng 2 request/phút cho mỗi khoá** (áp cả khoá `server`): một request cỡ tối đa là một ma trận tới 1.600 cặp cộng năm tuyến trên cùng engine. Body sai (400) không tốn lượt.
```

(b) Bảng cache thêm hàng `| \`/v1/fleet-plan\` | 60 giây | 5 phút |` sau `/v1/optimized-route`; câu `x-mlv-cache` thêm `và \`/v1/fleet-plan\``; câu khoá cache: `Khoá cache của ba endpoint dẫn đường làm tròn toạ độ 4 chữ số (~11 m) với ma trận và tối ưu thứ tự, 5 chữ số với directions.` → `Khoá cache của bốn endpoint dẫn đường làm tròn toạ độ 4 chữ số (~11 m) với ma trận, tối ưu thứ tự và đội xe (đội xe băm cả body đã chuẩn hoá, mốc giờ đổi sang giây), 5 chữ số với directions.`

(c) Bảng lỗi, hàng `no_route`: thêm `\`POST /v1/fleet-plan\`: một điểm không tới được → lỗi cho cả request, thông điệp gọi tên đơn hoặc xe.`

(d) Sau mục `### GET /v1/optimized-route` (trước `## 5. Endpoint ghi`) thêm:

```markdown
### POST /v1/fleet-plan

Chia đơn cho **đội xe**: gửi K xe và N đơn, nhận đơn nào giao xe nào, thứ tự ghé, giờ đến ước tính, đơn không xếp được, và **tuyến đầy đủ của từng xe** dạng `DirectionsResponse`. Bộ giải nhận sức chứa, khối lượng, thời gian dừng, khung giờ khách hẹn, giờ làm của xe, kết thúc mở. Cần scope `places:read`, body JSON, tính **một lượt quota Chỉ đường**, nhịp **2 request/phút/khoá**. Hướng dẫn kèm ví dụ ở [Giao hàng & đội xe](/doi-xe/) mục 3; thử ở [Playground → Đội xe](/playground#doi-xe).

| Trường | Kiểu | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `mode` | `motorbike` \| `car` \| `walk` | không | `motorbike` | một phương tiện cho cả đội |
| `lang` | `vi` \| `en` | không | `vi` | ngôn ngữ câu chỉ dẫn |
| `vehicles[]` | 1–5 | có | — | |
| `vehicles[].id` | chuỗi 1–64 | có | — | duy nhất trong `vehicles` |
| `vehicles[].start` | `[lat, lng]` | có | — | |
| `vehicles[].end` | `[lat, lng]` \| `"open"` | không | = `start` | `"open"` = kết thúc ở đơn cuối |
| `vehicles[].capacity` | số nguyên 0–1.000.000 | không | — | tất cả xe hoặc không xe nào |
| `vehicles[].max_jobs` | 1–10 | không | 10 | |
| `vehicles[].time_window` | `[ISO, ISO]` | không | — | giờ làm; ISO 8601 kèm múi giờ; có khung giờ thì mọi xe phải có |
| `jobs[]` | 1–30 | có | — | không quá tổng `max_jobs` |
| `jobs[].id` | chuỗi 1–64 | có | — | duy nhất trong `jobs` |
| `jobs[].location` | `[lat, lng]` | có | — | |
| `jobs[].demand` | số nguyên 0–1.000.000 | không | 0 | `> 0` chỉ khi xe có `capacity` |
| `jobs[].service_s` | 0–7.200 | không | 0 | giây dừng tại điểm |
| `jobs[].priority` | 0–100 | không | 0 | ưu tiên khi không đủ chỗ |
| `jobs[].time_windows` | 1–3 `[ISO, ISO]` | không | — | mỗi khung ≤ 24 giờ; mọi mốc trong 48 giờ |

Mọi điểm trong Việt Nam; cặp điểm xa nhất không quá 200 km xe máy, 400 km ô tô, 50 km đi bộ (đường chim bay). Body tối đa 64 KB.

```bash
curl -X POST -H "X-Api-Key: mlv_live_…" -H "content-type: application/json" \
  https://api.ai-solutions.io.vn/v1/fleet-plan \
  -d '{"vehicles":[{"id":"xe-1","start":[10.7725,106.698]},{"id":"xe-2","start":[10.7725,106.698],"end":"open"}],
       "jobs":[{"id":"don-1","location":[10.7826,106.6958],"service_s":120},{"id":"don-2","location":[10.7686,106.7069]}]}'
```

```json
{
  "mode": "motorbike",
  "vehicles": [
    {
      "vehicle": "xe-1",
      "jobs": ["don-2", "don-1"],
      "stops": [
        { "job": "don-2", "arrival_s": 300, "waiting_s": 0, "service_s": 0 },
        { "job": "don-1", "arrival_s": 700, "waiting_s": 0, "service_s": 120 }
      ],
      "load": 0,
      "finish_s": 1000,
      "routes": [{ "mode": "motorbike", "distance_m": 6120, "duration_s": 1380, "legs": ["…3 leg…"], "…": "…" }],
      "waypoints": ["…4 waypoint…"],
      "attribution": "© OpenStreetMap contributors",
      "engine": { "name": "valhalla", "graph": "2026-09-17" }
    },
    { "vehicle": "xe-2", "jobs": [], "stops": [], "load": 0, "finish_s": 0, "routes": [], "waypoints": [], "attribution": "© OpenStreetMap contributors" }
  ],
  "unassigned": [],
  "summary": { "vehicles_used": 1, "jobs_assigned": 2, "jobs_unassigned": 0, "distance_m": 6120, "duration_s": 1380, "service_s": 120, "waiting_s": 0 },
  "attribution": "© OpenStreetMap contributors",
  "engine": { "name": "vroom+valhalla", "graph": "2026-09-17" }
}
```

Điểm cần chú ý:

- `vehicles` theo đúng thứ tự bạn gửi, kể cả xe không được giao đơn (`jobs: []`, `routes: []`). Mỗi xe có đơn là một `DirectionsResponse` đầy đủ: `routes[0].legs.length` = số đơn (+1 nếu về `end`), `waypoints` = start, đơn theo thứ tự ghé, end.
- **Chế độ thời gian.** Không có khung giờ → chỉ có `arrival_s`/`finish_s` (giây từ lúc rời start). Mọi xe có `time_window` → thêm `departure_at`, `stops[].arrival_at`, `finish_at` ISO 8601 theo múi giờ của `time_window[0]` của xe đó. Có khung giờ mà một xe thiếu `time_window` → 400.
- `stops` lấy từ lịch của bộ giải (ma trận); `routes[0]` lấy từ `/route`. Lệch vài phần trăm là bình thường.
- `unassigned` là đơn không xếp được (hết `max_jobs`, quá `capacity`, khung giờ không thoả); không kèm lý do.
- Một điểm không tới được → `404 no_route` cho cả request, thông điệp gọi tên đơn/xe. Quá nhịp → `429` với `retry-after: 60`. Bộ giải không phản hồi → `503 upstream_unavailable`.
- Chưa có: pickup & delivery ghép đôi, kỹ năng tài xế, nghỉ giữa ca, nhiều loại xe trong một request.
```

- [ ] **Step 3: `sdk.md`**

Bảng phương thức thêm sau `optimizedRoute`: `| \`fleetPlan(opts)\` | \`POST /v1/fleet-plan\` | \`FleetPlanResponse\` (mỗi \`vehicles[k]\` = \`DirectionsResponse\` + \`vehicle\`/\`jobs\`/\`stops\`) |`. Bảng `opts` thêm: `| \`fleetPlan\` | \`vehicles\` (1–5: \`id\`, \`start\` \`[lat, lng]\`, \`end\`, \`capacity\`, \`max_jobs\`, \`time_window\`), \`jobs\` (1–30: \`id\`, \`location\`, \`demand\`, \`service_s\`, \`priority\`, \`time_windows\`), \`mode\`, \`lang\` — body JSON, xem REST API |`. Câu `Với \`directions\`, \`matrix\` và \`optimizedRoute\`, tham số vào là \`[lat, lng]\`…` → `Với \`directions\`, \`matrix\`, \`optimizedRoute\` và \`fleetPlan\`, …`. Thêm câu: `Web và React Native: \`map.routes.showFleet(plan)\` vẽ mọi xe, mỗi xe một màu (\`FLEET_COLORS\`), bấm tuyến phát \`routeClick\` với chỉ số xe.`

- [ ] **Step 4: `tinh-nang.md`**

Thay đoạn `**Giao hàng và vận tải.** …` bằng:

```markdown
**Giao hàng và vận tải.** `GET /v1/matrix` trả bảng thời gian và quãng đường giữa N điểm đi và M điểm
đến (tối đa 50 cặp mỗi lượt) để chọn tài xế hay kho gần nhất; `GET /v1/optimized-route` sắp thứ tự
ghé tối ưu cho một chuyến tối đa 10 điểm dừng và trả luôn tuyến đầy đủ để vẽ; `POST /v1/fleet-plan`
**chia đơn cho cả đội** — tối đa 5 xe và 30 đơn một lượt, nhận sức chứa, khung giờ khách hẹn, thời gian
dừng, kết thúc mở — và trả tuyến đầy đủ của từng xe. Cả ba tính **một lượt** Chỉ đường mỗi request bất kể
cỡ; nhịp riêng 6 request/phút cho ma trận và tối ưu, 2 request/phút cho đội xe. Chưa có pickup & delivery
ghép đôi và kỹ năng tài xế. Ví dụ đầy đủ cho web và React Native ở [Giao hàng & đội xe](/doi-xe/); thử không
cần code ở [Playground → Đội xe](/playground#doi-xe).
```

- [ ] **Step 5: `tu-host.md`**

Bảng kiến trúc thêm hàng sau Valhalla: `| Bộ giải đội xe VROOM | container \`vroom\` trên cùng máy chủ, lấy ma trận từ Valhalla trong mạng compose; Worker gọi qua luật đường dẫn \`/fleet/\` của hostname Tunnel routing | tiền điện và máy |`. Đoạn "Compose có năm dịch vụ" → "sáu dịch vụ", thêm câu sau phần `valhalla`: `\`vroom\` (vroom-express, cổng nội bộ 3000, baseurl \`/fleet/\`) giải bài chia đơn đội xe cho \`/v1/fleet-plan\`; cấu hình ở \`infra/server/vroom/config.yml\`, không mở cổng, không cần graph riêng.` Mục việc tay Cloudflare thêm: `…, và một luật Public Hostname cùng hostname routing với **Path \`^/fleet/\`** trỏ \`vroom:3000\` (đặt trên luật không đường dẫn).`

- [ ] **Step 6: Spec 22/09 mục 12**

Bullet đầu `**Tầng 3 — tối ưu đội xe (VRP)**: …` thêm cuối: ` → **Đã làm**: spec \`2026-09-23-toi-uu-doi-xe-design.md\`, endpoint \`POST /v1/fleet-plan\`, container VROOM.`

- [ ] **Step 7: Build docs, e2e docs, commit**

Run: `pnpm --filter @mapslibvn/docs build && pnpm --filter @mapslibvn/docs e2e`
Expected: build xanh (link `/api/#post-v1fleet-plan` phải tồn tại — Starlight sinh id từ heading `POST /v1/fleet-plan` → `post-v1fleet-plan`; kiểm bằng `grep -o 'id="post-v1fleet-plan"' apps/docs/dist/api/index.html`); e2e docs xanh.

```bash
git add apps/docs/src/content/docs/doi-xe.md apps/docs/src/content/docs/api.md apps/docs/src/content/docs/sdk.md apps/docs/src/content/docs/tinh-nang.md apps/docs/src/content/docs/tu-host.md docs/superpowers/specs/2026-09-22-ma-tran-toi-uu-thu-tu-design.md
git commit -m "docs: chia đơn cho đội xe — hướng dẫn, POST /v1/fleet-plan, SDK fleetPlan/showFleet, tự host VROOM

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 19: Site — bảng đối đầu, `CHUA_CO`, trang Tính năng, thẻ trang chủ, trang so sánh

**Files:**
- Modify: `apps/site/src/lib/doi-dau.ts:19-24, 52-71, 130-137`
- Modify: `apps/site/src/lib/doi-dau.test.ts:44-78`
- Modify: `apps/site/src/pages/tinh-nang.astro:103-105`
- Modify: `apps/site/src/pages/index.astro:141-150`
- Modify: `apps/site/src/pages/so-sanh/google-maps-api.astro:35, 52-53, 101-114`
- Modify: `apps/site/src/pages/so-sanh/vietmap.astro:31`

- [ ] **Step 1: Test đỏ**

Trong `apps/site/src/lib/doi-dau.test.ts`:

(a) Ca `CHUA_CO không còn ma trận…` đổi thành:

```ts
  it('CHUA_CO không còn tối ưu đội xe nhiều xe (spec 23/09/2026); còn ba mục thật sự chưa có', () => {
    expect(CHUA_CO).toEqual(['giao thông thời gian thực', 'Street View', 'ảnh vệ tinh']);
  });
```

(b) Trong ca `Google: ma trận tách hai hàng…`: đổi hai dòng cuối về `doiXe` thành

```ts
    const doiXe = bang.find((h) => h.tieuChi === 'Chia đơn cho đội xe nhiều xe');
    expect(doiXe?.thang).toBe('hoa');
    expect(doiXe?.ta).toMatch(/5 xe/);
    expect(doiXe?.ta).toMatch(/30 đơn/);
    expect(doiXe?.ta).toMatch(/khung giờ/);
    expect(gioiHan?.ta).toMatch(/2 lượt mỗi phút/);
```

(c) Ca VIETMAP: `expect(hang?.ta).toMatch(/chưa có đội xe nhiều xe/)` → `expect(hang?.ta).toMatch(/chia đơn cho đội xe tới 5 xe/)` và `expect(hang?.ta).toMatch(/chưa theo dõi phương tiện/)`.

Run: `pnpm exec vitest run apps/site/src/lib/doi-dau.test.ts` → FAIL.

- [ ] **Step 2: `doi-dau.ts`**

(a) `CHUA_CO` còn `['giao thông thời gian thực', 'Street View', 'ảnh vệ tinh']` (cập nhật JSDoc: "Thêm tính năng thì xoá khỏi đây — 23/09/2026 xoá 'tối ưu đội xe nhiều xe' khi phát hành `/v1/fleet-plan`").

(b) Hàng "Cỡ và nhịp ma trận cho phép": `ta: 'Tối đa 50 cặp hoặc 10 điểm dừng mỗi lượt, 6 lượt mỗi phút; đội xe tối đa 5 xe / 30 đơn mỗi lượt, 2 lượt mỗi phút'` (giữ `ho`, `thang: 'ho'`; chú thích thêm `FLEET_MAX_*` / `FLEET_RATE_LIMITER`).

(c) Hàng "Tối ưu đội xe nhiều xe" thay bằng:

```ts
    {
      tieuChi: 'Chia đơn cho đội xe nhiều xe',
      // Số trần chép tay từ FLEET_MAX_VEHICLES / FLEET_MAX_JOBS (apps/api/src/routing/fleet.ts). Hoà,
      // không nhận thắng: Google nhận cỡ và ràng buộc rộng hơn hẳn (pickup-delivery, kỹ năng, nhiều loại xe).
      ta: 'Có: tối đa 5 xe và 30 đơn mỗi lượt, sức chứa, khung giờ khách hẹn, thời gian dừng, kết thúc mở; một lượt Chỉ đường',
      ho: 'Có (Route Optimization API), cỡ và ràng buộc rộng hơn',
      thang: 'hoa',
    },
```

(d) Hàng VIETMAP "Bài toán vận tải và theo dõi phương tiện": `ta: 'Có ma trận khoảng cách, tối ưu thứ tự và chia đơn cho đội xe tới 5 xe / 30 đơn mỗi lượt; chưa theo dõi phương tiện'` (giữ `thang: 'ho'`).

Run: `pnpm exec vitest run apps/site/src/lib/doi-dau.test.ts` → PASS (kể cả ca "không hàng nào nhận ta thắng ở thứ chưa làm").

- [ ] **Step 3: Trang Tính năng, trang chủ, hai trang so sánh**

(a) `apps/site/src/pages/tinh-nang.astro` mục `giao-hang`, `doan` thứ hai:

```ts
      'Tối ưu thứ tự điểm dừng sắp lại tối đa 10 điểm giao cho một chuyến và trả luôn tuyến đầy đủ để vẽ và dẫn đường. Chia đơn cho đội xe gửi tối đa 5 xe và 30 đơn một lượt — kèm sức chứa, khung giờ khách hẹn, thời gian dừng — và trả tuyến từng xe. Cả ba tính một lượt Chỉ đường, và thử được ngay trên Playground, tab Đội xe.',
```

(b) `apps/site/src/pages/index.astro` thẻ "Giao hàng & vận tải": câu mô tả → `Ma trận khoảng cách N×M, thứ tự ghé tối ưu cho một chuyến và chia đơn cho cả đội xe, mỗi request tính một lượt.`; chip → `['Ma trận ≤ 50 cặp', 'Đội xe ≤ 5 xe · 30 đơn', '1 lượt Chỉ đường']`.

(c) `apps/site/src/pages/so-sanh/google-maps-api.astro`: dòng 35 (`'Bạn cần chia đơn cho cả đội xe cùng lúc, có sức chứa và khung giờ giao.'`) đổi thành `'Đội xe của bạn lớn hơn 5 xe hay 30 đơn mỗi lượt, hoặc cần pickup & delivery ghép đôi và kỹ năng tài xế.'`; câu `dap` dòng 53 thay đoạn cuối `Chưa có bộ giải chia đơn cho nhiều xe cùng lúc như Route Optimization API của Google.` bằng `Chia đơn cho cả đội cũng có: tối đa 5 xe và 30 đơn mỗi lượt, nhận sức chứa, khung giờ khách hẹn và thời gian dừng; Route Optimization API của Google nhận cỡ lớn hơn và nhiều ràng buộc hơn.`; mục `#tt-doi-xe` (dòng ~110) sửa câu `chia đơn cho nhiều xe có sức chứa và khung giờ thì Google vẫn …` thành câu nói đúng: `chia đơn cho đội xe tới 5 xe / 30 đơn có sức chứa và khung giờ đã có; đội lớn hơn hay pickup & delivery ghép đôi thì Google vẫn là lựa chọn.` (đọc lại cả đoạn để câu liền mạch).

(d) `apps/site/src/pages/so-sanh/vietmap.astro` dòng 31: `'Bài toán của bạn là theo dõi phương tiện hoặc tối ưu đội xe nhiều xe.'` → `'Bài toán của bạn là theo dõi phương tiện, hoặc đội xe lớn hơn 5 xe / 30 đơn mỗi lượt.'`.

- [ ] **Step 4: Build site, test, e2e site**

Run: `pnpm exec vitest run apps/site/src && pnpm --filter @mapslibvn/site build && pnpm test:site-e2e`
Expected: xanh. E2E `trang.spec.ts` chỉ kiểm tiêu đề bảy ô (không đổi).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/doi-dau.ts apps/site/src/lib/doi-dau.test.ts apps/site/src/pages/tinh-nang.astro apps/site/src/pages/index.astro apps/site/src/pages/so-sanh/google-maps-api.astro apps/site/src/pages/so-sanh/vietmap.astro
git commit -m "site: chia đơn đội xe đã có — bỏ khỏi CHUA_CO, hàng đối đầu hoà với Google, trang Tính năng và trang chủ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 20: DEVLOG, trạng thái spec, push, deploy docs tay, publish npm 0.14.0, thử RN, trí nhớ

**Files:**
- Modify: `docs/DEVLOG.md` (thêm mục 34 cuối file)
- Modify: `docs/superpowers/specs/2026-09-23-toi-uu-doi-xe-design.md:4` (Trạng thái)
- Modify: `docs/superpowers/plans/2026-09-23-toi-uu-doi-xe.md` (tick hộp, ghi chỗ thực tế khác thiết kế)
- Memory: `/Users/dtphong/.claude/projects/-Users-dtphong-Desktop-software-business-mapsLibVN/memory/`

- [ ] **Step 1: DEVLOG mục 34**

Thêm cuối `docs/DEVLOG.md`:

```markdown
## 34. Tối ưu đội xe — `POST /v1/fleet-plan` trên VROOM — <ngày>/09/2026

Spec `2026-09-23-toi-uu-doi-xe-design.md`, plan `2026-09-23-toi-uu-doi-xe.md`. Container VROOM thứ sáu
trong compose máy chủ lấy ma trận từ Valhalla; Worker kiểm body, gọi VROOM chia đơn, rồi `/route` từng xe
song song để mỗi xe là một `DirectionsResponse`. Một request = một lượt `directions`, nhịp riêng
2/phút/khoá, trần <5 xe / 30 đơn / 10 đơn mỗi xe — ghi số đã chốt>.

**Quyết định PHONG 23/09:** đủ ràng buộc ngay bản đầu (sức chứa, khung giờ, thời gian dừng, open-end);
1 lượt/request; showFleet cho cả web và RN; làm thẳng trên main; máy chủ chính là MacBook, Ubuntu phụ,
sau phát hành app dời sang Windows i5-1340P 16 GB.

**Đường tới VROOM không cần hostname mới:** luật Public Hostname cùng `maps-route` với Path `^/fleet/`
→ `vroom:3000`, dùng lại Access application và service token của routing.

**Số đo production (<máy>):** <bảng E/E2/F rút gọn, tham chiếu evidence>.

**Chỗ thực tế khác thiết kế:** <liệt kê, ví dụ trần đã hạ, size-limit nâng, …>.

**Cổng xanh:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm test:routing` (<n> test), e2e docs, e2e site, CI.
```

- [ ] **Step 2: Trạng thái spec và plan**

Dòng 4 spec: `- Trạng thái: **Đã phát hành <ngày>/09/2026.** Trần chốt <…>; evidence \`docs/evidence/routing/2026-09-<ngày>-fleet.md\`; DEVLOG mục 34.` Tick mọi hộp trong plan đã làm; thêm mục "## Chỗ thực tế khác thiết kế" cuối plan nếu có.

- [ ] **Step 3: Commit, PHONG duyệt push, deploy docs tay đè**

```bash
git add docs/DEVLOG.md docs/superpowers/specs/2026-09-23-toi-uu-doi-xe-design.md docs/superpowers/plans/2026-09-23-toi-uu-doi-xe.md
git commit -m "docs: DEVLOG mục 34, spec tối ưu đội xe chuyển sang đã phát hành

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Chờ PHONG nói "push" → `git push origin main`. CI `Deploy Docs` chạy nhưng **xoá khoá demo** của playground (bài học đã ghi) → sau khi CI xong, PHONG deploy docs tay đè theo quy trình hiện có (`pnpm --filter @mapslibvn/docs build` với `PUBLIC_MAPSLIBVN_DEMO_KEY` trong `.env`, rồi lệnh deploy Pages đang dùng trong repo — xem `docs/evidence/` mục deploy docs tay hoặc memory `deploy-docs-ci-mat-khoa-demo`). Kiểm: mở `https://mapslibvn-docs.pages.dev/playground#doi-xe`, nạp mẫu, Chia đơn 2 xe → hai tuyến hai màu.

- [ ] **Step 4: Publish npm 0.14.0**

PHONG chạy `! pnpm sdk:publish` (script tự bump lockstep và đối chiếu registry; truyền OTP qua `NPM_CONFIG_OTP` như đã ghi). Kiểm: `npm view @mapslibvn/core version` → `0.14.0`; `npm view @mapslibvn/web version`, `@mapslibvn/react-native` cùng số. Cài thật vào thư mục tạm: `npm i @mapslibvn/core@0.14.0` rồi `node -e "console.log(typeof require('@mapslibvn/core').createClient({apiKey:'x',baseUrl:'https://a'}).fleetPlan)"` → `function`.

- [ ] **Step 5: PHONG thử `showFleet` trên máy thật (RN)**

`pnpm example:rn --pack-only` rồi build app mẫu lên iPhone/Android theo cách đã ghi ở memory (`luon-build-release-may-that`, `release-android-device-model-vs-serial`). Trong app mẫu thêm tạm một nút gọi `useMap().places.fleetPlan(...)` với 2 xe/5 đơn Quận 1 rồi `map.routes.showFleet(plan)`; kỳ vọng hai tuyến hai màu, marker màu xe, bấm tuyến → `onRouteClick` đúng chỉ số. Ghi kết quả định tính vào evidence (mục "Thử RN máy thật").

- [ ] **Step 6: Cập nhật trí nhớ dự án**

Tạo `memory/tran-doi-xe-fleet-plan.md` (type project): trần và nhịp đã chốt, máy đo, nơi evidence, ba chỗ dễ vấp (luật Tunnel phải đứng trên luật cũ; entrypoint VROOM ghi access.log vào thư mục repo; trần là số đo trên một máy). Thêm dòng vào `MEMORY.md`. Cập nhật `bo-tri-may-chu-macbook-chinh.md` nếu bố trí máy đổi trong lúc làm.

---

## Tự soát plan (làm khi viết, 23/09/2026)

**1. Phủ spec → task**

| Mục spec | Task |
|---|---|
| 2 Tiền đề (VROOM, Valhalla limits, Tunnel path) | 1 (dev), 16 (server), 4 (bảng lỗi) |
| 3 Kiến trúc, luồng dữ liệu | 6, 7, 8 |
| 4.1–4.2 Request và luật kiểm | 6 |
| 4.3 Hai chế độ thời gian | 3, 6, 7 |
| 4.4 Response | 5 (kiểu), 7 (assemble) |
| 4.5 Lỗi | 4, 7 (`noRouteMessage`), 8 (route) |
| 4.6 Cache | 6 (`fleetCacheUrl`), 8 |
| 4.7 Quota, nhịp | 2, 8 |
| 4.8 Health, cron, Admin | 8, 9 |
| 4.9 Hằng số | 6 |
| 4.10 Cấu trúc mã | 2–8 |
| 5.1 Compose server, config | 16 |
| 5.2 Compose dev, routing-test | 1, 10 |
| 5.3 Tunnel, FLEET_BASE, kiểm | 2, 16 |
| 5.4 server-setup, pullPlan, README, notices, tu-host | 16, 18 |
| 6.1 Core | 5, 11 |
| 6.2 Web | 12 |
| 6.3 RN | 13 |
| 7 Playground | 14 |
| 8 Smoke, ngưỡng, nếu hụt | 15, 17 |
| 9 Kiểm thử | 2–15 (từng task), 10 (tích hợp + fixture) |
| 10 Docs | 18 |
| 11 Site | 19 |
| 12 Thứ tự phát hành | 16 (bước 6–7), 17, 20 |
| 15 Nghiệm thu | 16 bước 7, 17, 14 (e2e), 20 bước 4–5 |
| 16 Việc tay PHONG | 16 bước 6–7, 17 bước 1, 20 bước 3–5 |

Không có mục spec nào thiếu task. Spec mục 6.2 nói `setActive(i)` làm mờ xe khác — Task 12/13 có. Spec mục 9 nói `routing-fixture-sync.test.ts` thêm ca — plan thay bằng capture fixture API qua Worker trong `routing-test.mjs --capture` (Task 1 bước 7e, Task 10): cùng mục đích "một nguồn cho core/web/RN/e2e", ít mã hơn; ghi vào "chỗ thực tế khác thiết kế" ở Task 20.

**2. Placeholder:** không còn TBD/TODO. `<ngày>`, `<số thật>`, `<máy>` là chỗ điền số đo lúc thực thi (evidence, DEVLOG, size-limit) — không thay thế được trước khi đo.

**3. Nhất quán kiểu và tên:** `FleetParams/FleetVehicleParams/FleetJobParams` (API) ↔ `FleetVehicle/FleetJob/FleetPlanOptions` (core) tách bạch; `FleetVehicleSkeleton`/`FleetSkeleton` chỉ trong API; `parseFleetBody`, `fleetVroomBody`, `fleetCacheUrl`, `translateFleet`, `fleetRouteBody`, `assembleFleetPlan`, `noRouteMessage` dùng đồng nhất ở Task 6, 7, 8; `callVroom`, `mapVroomError`, `fleetBase`, `FLEET_TIMEOUT_MS`, `FLEET_ROUTE_TIMEOUT_MS`, `FLEET_HEALTH_TIMEOUT_MS` (Task 4, 8); `apDungNhip` (Task 2, 8); `doDoiXe`, `BAI_TI_HON` (Task 8); `FLEET_COLORS`, `FLEET_DIM_OPACITY`, `decodeFleet`, `fleetRouteFeatures`, `FleetLineFeature` (Task 11 → 12, 13); `FLEET_SOURCE_ID`, `ROUTE_LAYER_IDS.fleetCasing/fleetLine`, `showFleet(plan, { active, colors, markers })` giống nhau ở web và RN (Task 12, 13); playground `fleetPlanRequest`, `plusHoursIso`, `FLEET_MAX_*` (Task 14); scripts `postAndAck`, `planBaiFleet`, `fleetBodyFor`, `fleetIssues`, `parseFleetSmokeArgs` (Task 15). Fixture: `two-vehicles.json` (tay, Task 7), `q1-fleet.json` (VROOM thô), `q1-fleet-request.json`, `fleet-plan-q1.json` (API, hai bản copy) — Task 10 tạo, Task 11–14 dùng.
