# M1a — Nền tảng & môi trường: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng monorepo MapsLibVN với quy trình ghi chép (DEVLOG), khoá GitHub vào account cá nhân, môi trường dev một lệnh (`pnpm run setup`) chạy giống nhau trên macOS/Windows/Linux, image Docker chứa toàn bộ công cụ pipeline, Dev Container và CI xanh.

**Architecture:** pnpm workspace + Turborepo; script tiện ích viết bằng Node thuần trong `scripts/` (không bash trong `package.json`); Postgres/PostGIS chạy Docker Compose (`infra/dev`); mọi công cụ geo (Java/Planetiler, tippecanoe, osmium, pyosmium, DuckDB, rclone) nằm trong một image (`pipelines/Dockerfile`) dùng chung cho máy dev, máy chủ và CI.

**Tech Stack:** Node 22, pnpm 9.15, Turborepo 2, Biome 1.9, TypeScript 5.6, Vitest 2, `postgres` (porsager), Docker Compose v2, Ubuntu 24.04, GitHub Actions, GHCR.

**Spec:** `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md` — mục 3.1, 3.2, 3.4, 11.1 (một phần), 0.1–0.2 của roadmap.

---

## Cấu trúc file tạo trong plan này

```
package.json · pnpm-workspace.yaml · pnpm-lock.yaml · turbo.json · biome.json
tsconfig.base.json · tsconfig.scripts.json · vitest.config.ts
.gitignore · .gitattributes · .editorconfig · .nvmrc · .dockerignore · .env.example · README.md
docs/DEVLOG.md
.githooks/pre-push
scripts/check-git-identity.mjs · scripts/lib/git-identity.mjs · scripts/lib/git-identity.test.mjs
scripts/db-migrate.mjs · scripts/lib/migrations.mjs · scripts/lib/migrations.test.mjs
scripts/setup.mjs · scripts/lib/setup-checks.mjs · scripts/lib/setup-checks.test.mjs · scripts/lib/run.mjs
scripts/image.mjs
db/migrations/0001_extensions.sql
infra/dev/compose.yml
pipelines/Dockerfile
.devcontainer/devcontainer.json · .devcontainer/compose.devcontainer.yml
.github/workflows/ci.yml
```

Mỗi file một trách nhiệm: `scripts/lib/*` là hàm thuần (test được, không side effect); `scripts/*.mjs` là CLI mỏng gọi hàm thuần + lệnh hệ thống.

---

### Task 1: Khung monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `tsconfig.base.json`, `tsconfig.scripts.json`, `vitest.config.ts`, `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, `README.md`

- [x] **Step 1: Kiểm tra công cụ trên máy**

Run: `node --version && corepack --version`
Expected: `v22.x.x` và một số phiên bản corepack. Nếu Node < 22: cài `fnm` (`brew install fnm`) rồi `fnm install 22 && fnm use 22`.

Run: `corepack enable && corepack prepare pnpm@9.15.0 --activate && pnpm --version`
Expected: `9.15.0`

- [x] **Step 2: Tạo `package.json` gốc**

```json
{
  "name": "mapslibvn",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "setup": "node scripts/setup.mjs",
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "tsc -p tsconfig.scripts.json && turbo run typecheck --continue",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:up": "docker compose --env-file .env -f infra/dev/compose.yml up -d postgres",
    "db:down": "docker compose --env-file .env -f infra/dev/compose.yml down",
    "db:migrate": "node scripts/db-migrate.mjs",
    "image:build": "node scripts/image.mjs build",
    "image:smoke": "node scripts/image.mjs smoke",
    "check:git": "node scripts/check-git-identity.mjs"
  },
  "devDependencies": {
    "@biomejs/biome": "1.9.4",
    "@types/node": "^22.10.0",
    "dotenv": "^16.4.5",
    "postgres": "^3.4.5",
    "turbo": "^2.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [x] **Step 3: Tạo `pnpm-workspace.yaml`, `turbo.json`, `biome.json`**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "pipelines/*"
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": {
    "formatter": { "quoteStyle": "single", "semicolons": "always", "trailingCommas": "all" }
  },
  "files": {
    "ignore": ["**/dist/**", "**/node_modules/**", "**/.astro/**", "**/fixtures/**", "**/*.json", "**/.wrangler/**"]
  }
}
```

- [x] **Step 4: Tạo tsconfig và vitest config**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`tsconfig.scripts.json` (kiểm kiểu cho script Node thuần):
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "declaration": false,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"]
  },
  "include": ["scripts/**/*.mjs"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.mjs', 'packages/*/src/**/*.test.ts', 'pipelines/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/**'],
  },
});
```

- [x] **Step 5: Tạo file dotfile**

`.gitignore`:
```
node_modules/
dist/
.turbo/
.wrangler/
.astro/
coverage/
work/
out/
.env
.env.*.local
*.log
.DS_Store
```

`.gitattributes`:
```
* text=auto eol=lf
*.pmtiles binary
*.pbf binary
*.png binary
*.parquet binary
*.zip binary
```

`.editorconfig`:
```
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

`.nvmrc`:
```
22
```

- [x] **Step 6: Tạo `README.md`**

```markdown
# MapsLibVN

Nền tảng bản đồ nhúng cho web và mobile, dựng trên MapLibre GL và dữ liệu mở (OpenStreetMap, Overture, Foursquare OS). Việt Nam trước.

## Bắt đầu (máy mới)

Cài Docker Desktop và Node 22 (khuyên dùng `fnm`), rồi:

    corepack enable
    pnpm install
    pnpm run setup  # tạo .env, dựng Postgres, chạy migration, kiểm tra git identity
    pnpm dev

## Tài liệu

- Spec: `docs/superpowers/specs/2026-08-26-mapslibvn-maps-sdk-design.md`
- Roadmap & plan: `docs/superpowers/plans/`
- Nhật ký & "đang ở đâu": `docs/DEVLOG.md` — **đọc trước khi làm bất cứ việc gì**

## Quy tắc GitHub

Chỉ dùng remote `git@github.com-dotienphong:dotienphong/maps-library-vietnam.git` (account cá nhân). Hook `pre-push` sẽ chặn nếu sai.
```

- [x] **Step 7: Cài dependency và kiểm tra lint/typecheck**

Run: `pnpm install`
Expected: tạo `pnpm-lock.yaml`, `node_modules/`, không lỗi.

Run: `pnpm lint`
Expected: `Checked N files in …ms. No fixes applied.` (nếu Biome báo format, chạy `pnpm lint:fix` rồi chạy lại).

Run: `pnpm typecheck`
Expected: `tsc` không lỗi (chưa có file trong `scripts/` là bình thường); turbo báo không có task `typecheck` — exit 0.

Run: `pnpm test`
Expected: Vitest báo `No test files found` với exit code **1** — đây là hành vi mặc định khi chưa có test; Task 2 sẽ thêm test đầu tiên. Không sửa gì ở bước này.

- [x] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: khung monorepo pnpm + turbo + biome + vitest"
```

---

### Task 2: DEVLOG và hook khoá GitHub account cá nhân

**Files:**
- Create: `docs/DEVLOG.md`, `.githooks/pre-push`, `scripts/lib/git-identity.mjs`, `scripts/lib/git-identity.test.mjs`, `scripts/check-git-identity.mjs`

- [x] **Step 1: Tạo `docs/DEVLOG.md`**

```markdown
# DEVLOG — MapsLibVN

Đọc file này trước khi làm bất cứ việc gì. Cập nhật ở bước cuối của MỌI task (cùng commit với code).

## 1. Trạng thái hiện tại

- Mốc: M1a — Nền tảng & môi trường
- Plan: `docs/superpowers/plans/2026-08-26-m1a-nen-tang-moi-truong.md`
- Task đang làm: Task 2 (DEVLOG + hook GitHub)
- Commit cuối: (điền sau commit)
- Môi trường đã dựng: máy dev macOS (chưa có Postgres dev, chưa có image, chưa có remote GitHub)

## 2. Bước kế tiếp

M1a Task 3 — thêm remote GitHub `git@github.com-dotienphong:dotienphong/maps-library-vietnam.git` và push `main` (PHONG tạo repo private trước).

## 3. Quyết định phát sinh

| Ngày | Quyết định | Lý do | Commit |
|---|---|---|---|
| 2026-08-26 | Lint/format dùng Biome thay ESLint+Prettier | một công cụ, nhanh, không cấu hình rườm rà | (Task 1) |

## 4. Nhật ký

- 2026-08-26 · M1a T1 · khung monorepo · (commit)
```

- [x] **Step 2: Viết test cho hàm kiểm tra danh tính git**

`scripts/lib/git-identity.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { checkGitIdentity } from './git-identity.mjs';

const GOOD_REMOTE = 'git@github.com-dotienphong:dotienphong/maps-library-vietnam.git';
const GOOD_EMAIL = 'dotienphong1993@gmail.com';

describe('checkGitIdentity', () => {
  it('chấp nhận remote alias cá nhân và email cá nhân', () => {
    const r = checkGitIdentity({ remoteUrl: GOOD_REMOTE, email: GOOD_EMAIL });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('chấp nhận remote không có đuôi .git', () => {
    const r = checkGitIdentity({ remoteUrl: GOOD_REMOTE.replace(/\.git$/, ''), email: GOOD_EMAIL });
    expect(r.errors).toEqual([]);
  });

  it('từ chối host github.com trơn (sẽ dùng key/account mặc định)', () => {
    const r = checkGitIdentity({ remoteUrl: 'git@github.com:dotienphong/maps-library-vietnam.git', email: GOOD_EMAIL });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/Remote origin sai/);
  });

  it('từ chối remote HTTPS', () => {
    const r = checkGitIdentity({ remoteUrl: 'https://github.com/dotienphong/maps-library-vietnam.git', email: GOOD_EMAIL });
    expect(r.errors).toHaveLength(1);
  });

  it('từ chối email chứa bark', () => {
    const r = checkGitIdentity({ remoteUrl: GOOD_REMOTE, email: 'phong.dotien.ext@bark.com' });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/account công ty/);
  });

  it('thiếu remote chỉ là cảnh báo, thiếu email là lỗi', () => {
    const r = checkGitIdentity({ remoteUrl: '', email: '' });
    expect(r.warnings).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
  });
});
```

- [x] **Step 3: Chạy test để thấy thất bại**

Run: `pnpm test`
Expected: FAIL — `Failed to load url ./git-identity.mjs` (file chưa tồn tại).

- [x] **Step 4: Viết hàm thuần**

`scripts/lib/git-identity.mjs`:
```js
export const ALLOWED_REMOTE = /^git@github\.com-dotienphong:dotienphong\/maps-library-vietnam(\.git)?$/;
export const FORBIDDEN_EMAIL = /bark/i;
export const REQUIRED_REMOTE = 'git@github.com-dotienphong:dotienphong/maps-library-vietnam.git';

/**
 * Kiểm tra remote và author có đúng account cá nhân dotienphong không.
 * @param {{ remoteUrl: string, email: string }} input
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkGitIdentity({ remoteUrl, email }) {
  const errors = [];
  const warnings = [];
  const remote = (remoteUrl ?? '').trim();
  const mail = (email ?? '').trim();

  if (!remote) {
    warnings.push(`Chưa có remote origin. Thêm bằng: git remote add origin ${REQUIRED_REMOTE}`);
  } else if (!ALLOWED_REMOTE.test(remote)) {
    errors.push(`Remote origin sai: "${remote}". Bắt buộc: ${REQUIRED_REMOTE}`);
  }

  if (!mail) {
    errors.push('Chưa cấu hình user.email. Dùng: git config user.email dotienphong1993@gmail.com');
  } else if (FORBIDDEN_EMAIL.test(mail)) {
    errors.push(`user.email "${mail}" thuộc account công ty — CẤM dùng cho MapsLibVN`);
  }

  return { errors, warnings };
}
```

- [x] **Step 5: Chạy test để thấy xanh**

Run: `pnpm test`
Expected: `6 passed`.

- [x] **Step 6: Viết CLI và hook**

`scripts/check-git-identity.mjs`:
```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { checkGitIdentity } from './lib/git-identity.mjs';

/** @param {string[]} args */
function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const argv = process.argv.slice(2);
const remoteFlag = argv.indexOf('--remote-url');
const remoteUrl = remoteFlag >= 0 ? (argv[remoteFlag + 1] ?? '') : git(['remote', 'get-url', 'origin']);
const email = git(['config', 'user.email']);

const { errors, warnings } = checkGitIdentity({ remoteUrl, email });
for (const w of warnings) console.warn(`[git-identity] CẢNH BÁO: ${w}`);
for (const e of errors) console.error(`[git-identity] LỖI: ${e}`);
if (errors.length > 0) process.exit(1);
console.log('[git-identity] OK — remote và author thuộc account cá nhân dotienphong');
```

`.githooks/pre-push`:
```sh
#!/bin/sh
# Chặn push nếu URL remote hoặc user.email không thuộc account cá nhân dotienphong.
# git truyền: $1 = tên remote, $2 = URL remote
ROOT="$(git rev-parse --show-toplevel)"
node "$ROOT/scripts/check-git-identity.mjs" --remote-url "$2" || {
  echo "pre-push: BỊ CHẶN — xem lỗi ở trên. Cấm dùng account bark cho MapsLibVN." >&2
  exit 1
}
```

Run: `chmod +x .githooks/pre-push && git config core.hooksPath .githooks`
Expected: không in gì.

- [x] **Step 7: Kiểm tra CLI và hook bằng tay**

Run: `pnpm check:git`
Expected: một dòng `CẢNH BÁO: Chưa có remote origin…` rồi `[git-identity] OK …` (chưa có remote ở task này là đúng).

Run: `node scripts/check-git-identity.mjs --remote-url git@github.com:dotienphong/maps-library-vietnam.git; echo "exit=$?"`
Expected: `LỖI: Remote origin sai…` và `exit=1`.

Run: `pnpm lint && pnpm typecheck`
Expected: không lỗi (nếu Biome yêu cầu format, chạy `pnpm lint:fix`).

- [x] **Step 8: Cập nhật DEVLOG và commit**

Sửa `docs/DEVLOG.md`: mục 1 "Task đang làm: Task 3", mục 4 thêm dòng `2026-08-26 · M1a T2 · DEVLOG + hook pre-push khoá account cá nhân · (commit)`.

```bash
git add -A
git commit -m "chore: DEVLOG + hook pre-push chặn remote/author không phải account dotienphong"
```

---

### Task 3: Remote GitHub (account cá nhân) và push đầu tiên

**Files:** không tạo file; cấu hình git.

- [x] **Step 1: Việc tay của PHONG — tạo repo**

Đăng nhập GitHub bằng account **dotienphong** (không phải account bark) → New repository → tên `MapsLibVN`, **Private**, không tick README/.gitignore/license → Create.

- [x] **Step 2: Kiểm tra SSH alias đúng account**

Run: `ssh -T git@github.com-dotienphong`
Expected: `Hi dotienphong! You've successfully authenticated, but GitHub does not provide shell access.`
Nếu ra tên khác hoặc lỗi key: dừng, báo PHONG kiểm tra `~/.ssh/config` (Host `github.com-dotienphong`, IdentityFile `~/.ssh/id_ed25519_dotienphong`).

- [x] **Step 3: Thêm remote và kiểm tra**

Run: `git remote add origin git@github.com-dotienphong:dotienphong/maps-library-vietnam.git && pnpm check:git`
Expected: `[git-identity] OK …` không cảnh báo.

- [x] **Step 4: Push (hook pre-push sẽ chạy)**

Run: `git push -u origin main`
Expected: dòng `[git-identity] OK …` từ hook, rồi `branch 'main' set up to track 'origin/main'`.

Run: `git ls-remote --heads origin`
Expected: một dòng `… refs/heads/main`.

- [x] **Step 5: Cập nhật DEVLOG và commit**

Sửa `docs/DEVLOG.md`: mục 1 "Môi trường đã dựng: … remote GitHub OK", "Task đang làm: Task 4"; mục 4 thêm `2026-08-26 · M1a T3 · remote GitHub cá nhân + push đầu tiên`.

```bash
git add docs/DEVLOG.md
git commit -m "docs(devlog): remote GitHub cá nhân đã push"
git push
```

---

### Task 4: Postgres dev bằng Docker Compose + bộ chạy migration

**Files:**
- Create: `infra/dev/compose.yml`, `.env.example`, `db/migrations/0001_extensions.sql`, `scripts/lib/migrations.mjs`, `scripts/lib/migrations.test.mjs`, `scripts/db-migrate.mjs`

- [x] **Step 1: Viết test cho hàm thuần của migration**

`scripts/lib/migrations.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { databaseUrlFromEnv, pendingMigrations } from './migrations.mjs';

describe('pendingMigrations', () => {
  it('trả về file .sql chưa áp dụng, theo thứ tự tên', () => {
    const files = ['0003_c.sql', '0001_a.sql', 'README.md', '0002_b.sql', 'notes.txt'];
    expect(pendingMigrations(['0001_a.sql'], files)).toEqual(['0002_b.sql', '0003_c.sql']);
  });

  it('trả về mảng rỗng khi mọi migration đã áp dụng', () => {
    expect(pendingMigrations(['0001_a.sql'], ['0001_a.sql'])).toEqual([]);
  });

  it('bỏ qua file không đúng mẫu NNNN_ten.sql', () => {
    expect(pendingMigrations([], ['x.sql', '01_short.sql', '0001_ok.sql'])).toEqual(['0001_ok.sql']);
  });
});

describe('databaseUrlFromEnv', () => {
  it('ưu tiên DATABASE_URL', () => {
    expect(databaseUrlFromEnv({ DATABASE_URL: 'postgres://u:p@h:1/d' })).toBe('postgres://u:p@h:1/d');
  });

  it('ghép từ các biến POSTGRES_* với mặc định', () => {
    expect(databaseUrlFromEnv({ POSTGRES_PASSWORD: 'secret' })).toBe(
      'postgres://mapslibvn:secret@localhost:5432/mapslibvn',
    );
  });
});
```

- [x] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm test`
Expected: FAIL — không tìm thấy `./migrations.mjs`.

- [x] **Step 3: Viết hàm thuần**

`scripts/lib/migrations.mjs`:
```js
const MIGRATION_FILE = /^\d{4}_.+\.sql$/;

/**
 * @param {string[]} applied tên migration đã áp dụng
 * @param {string[]} files tên file trong db/migrations
 * @returns {string[]} migration cần chạy, theo thứ tự
 */
export function pendingMigrations(applied, files) {
  const done = new Set(applied);
  return [...files].filter((f) => MIGRATION_FILE.test(f) && !done.has(f)).sort();
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function databaseUrlFromEnv(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const user = env.POSTGRES_USER ?? 'mapslibvn';
  const pass = env.POSTGRES_PASSWORD ?? 'mapslibvn';
  const host = env.POSTGRES_HOST ?? 'localhost';
  const port = env.POSTGRES_PORT ?? '5432';
  const db = env.POSTGRES_DB ?? 'mapslibvn';
  return `postgres://${user}:${pass}@${host}:${port}/${db}`;
}
```

- [x] **Step 4: Chạy test để thấy xanh**

Run: `pnpm test`
Expected: `11 passed` (6 của Task 2 + 5 mới).

- [x] **Step 5: Tạo compose, `.env.example`, migration đầu tiên**

`infra/dev/compose.yml`:
```yaml
name: mapslibvn-dev

services:
  postgres:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-mapslibvn}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-mapslibvn}
      POSTGRES_DB: ${POSTGRES_DB:-mapslibvn}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-mapslibvn} -d ${POSTGRES_DB:-mapslibvn}"]
      interval: 5s
      timeout: 3s
      retries: 20

  # Chạy pipeline/tools trong image chung. Chỉ bật khi cần: --profile pipeline
  pipeline:
    profiles: ["pipeline"]
    image: ${PIPELINE_IMAGE:-mapslibvn/pipeline:local}
    build:
      context: ../..
      dockerfile: pipelines/Dockerfile
    env_file:
      - ../../.env
    environment:
      MAPSLIBVN_IN_CONTAINER: "1"
      POSTGRES_HOST: postgres
    volumes:
      - pipeline-work:/app/work
      - pipeline-out:/app/out
    depends_on:
      postgres:
        condition: service_healthy
    command: ["sleep", "infinity"]

volumes:
  pgdata:
  pipeline-work:
  pipeline-out:
```

`.env.example`:
```
# ---- Postgres dev (Docker) — giá trị mặc định an toàn, chỉ dùng trên máy dev ----
POSTGRES_USER=mapslibvn
POSTGRES_PASSWORD=mapslibvn
POSTGRES_DB=mapslibvn
POSTGRES_HOST=localhost
POSTGRES_PORT=5432

# ---- Cloudflare — điền ở M1b Task 6 (xem plan m1b). Để trống cho đến lúc đó. ----
TILES_BASE=https://tiles.example.com
API_BASE=http://localhost:8787
R2_BUCKET=mapslibvn-tiles
CLOUDFLARE_ACCOUNT_ID=
KV_NAMESPACE_ID_META=
RCLONE_CONFIG_R2_TYPE=s3
RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_ACCESS_KEY_ID=
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=
RCLONE_CONFIG_R2_ENDPOINT=
RCLONE_CONFIG_R2_ACL=private
```

`db/migrations/0001_extensions.sql`:
```sql
-- Extension nền cho kho POI và geocoding (spec 5.2)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

- [x] **Step 6: Viết CLI migrate**

`scripts/db-migrate.mjs`:
```js
#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseUrlFromEnv, pendingMigrations } from './lib/migrations.mjs';

const dir = resolve('db/migrations');
const sql = postgres(databaseUrlFromEnv(process.env), { max: 1, onnotice: () => {} });

try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const applied = (await sql`SELECT name FROM schema_migrations`).map((r) => String(r.name));
  const pending = pendingMigrations(applied, readdirSync(dir));
  if (pending.length === 0) console.log('[db:migrate] Không có migration mới.');
  for (const name of pending) {
    const body = readFileSync(resolve(dir, name), 'utf8');
    console.log(`[db:migrate] Áp dụng ${name} …`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });
  }
  console.log(`[db:migrate] Xong — áp dụng ${pending.length} migration.`);
} finally {
  await sql.end();
}
```

- [x] **Step 7: Chạy Postgres và migrate**

Run: `cp .env.example .env && pnpm db:up`
Expected: `Container mapslibvn-dev-postgres-1 Started` (lần đầu tải image ~ 1–2 phút).

Run: `until docker compose --env-file .env -f infra/dev/compose.yml exec postgres pg_isready -U mapslibvn >/dev/null 2>&1; do sleep 1; done; echo ready`
Expected: `ready` trong < 30 giây.

Run: `pnpm db:migrate`
Expected: `[db:migrate] Áp dụng 0001_extensions.sql …` rồi `Xong — áp dụng 1 migration.`

Run: `pnpm db:migrate`
Expected: `[db:migrate] Không có migration mới.` rồi `Xong — áp dụng 0 migration.`

Run: `docker compose --env-file .env -f infra/dev/compose.yml exec postgres psql -U mapslibvn -d mapslibvn -c "SELECT extname FROM pg_extension ORDER BY 1"`
Expected: có `pg_trgm`, `postgis`, `unaccent`.

- [x] **Step 8: Lint, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tất cả xanh.

Sửa `docs/DEVLOG.md`: mục 1 "Môi trường đã dựng: … Postgres dev (Docker) + migration 0001"; "Task đang làm: Task 5"; mục 4 thêm dòng T4.

```bash
git add -A
git commit -m "feat(infra): Postgres/PostGIS dev bằng compose + bộ chạy migration"
git push
```

---

### Task 5: `pnpm run setup` — dựng môi trường một lệnh

**Files:**
- Create: `scripts/lib/setup-checks.mjs`, `scripts/lib/setup-checks.test.mjs`, `scripts/lib/setup-command.test.mjs`, `scripts/lib/run.mjs`, `scripts/setup.mjs`

- [x] **Step 1: Viết test cho hàm kiểm tra phiên bản**

`scripts/lib/setup-checks.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { checkNodeVersion, isPostgresReady, parseDockerVersion, waitPlan } from './setup-checks.mjs';

describe('checkNodeVersion', () => {
  it('chấp nhận v22 trở lên', () => {
    expect(checkNodeVersion('v22.11.0')).toEqual({ ok: true, major: 22 });
    expect(checkNodeVersion('v24.1.0').ok).toBe(true);
  });
  it('từ chối v20', () => {
    expect(checkNodeVersion('v20.18.0')).toEqual({ ok: false, major: 20 });
  });
});

describe('parseDockerVersion', () => {
  it('đọc "Docker version 27.3.1, build ce12230"', () => {
    expect(parseDockerVersion('Docker version 27.3.1, build ce12230')).toEqual({ major: 27, minor: 3 });
  });
  it('trả null khi không phải output docker', () => {
    expect(parseDockerVersion('command not found')).toBeNull();
  });
});

describe('waitPlan', () => {
  it('tạo lịch thử lại mỗi 2s trong tối đa 60s', () => {
    const plan = waitPlan(60_000, 2_000);
    expect(plan.attempts).toBe(30);
    expect(plan.intervalMs).toBe(2_000);
  });
});

describe('isPostgresReady', () => {
  it('chỉ sẵn sàng khi PID 1 là postgres và pg_isready chấp nhận kết nối', () => {
    expect(isPostgresReady('postgres', '/var/run/postgresql:5432 - accepting connections')).toBe(true);
  });
  it('từ chối server tạm khi entrypoint vẫn là PID 1', () => {
    expect(isPostgresReady('docker-entrypoint.sh', '/var/run/postgresql:5432 - accepting connections')).toBe(false);
  });
});
```

- [x] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm test`
Expected: FAIL — không tìm thấy `./setup-checks.mjs`.

- [x] **Step 3: Viết hàm thuần và helper chạy lệnh**

`scripts/lib/setup-checks.mjs`:
```js
/** @param {string} versionString ví dụ "v22.11.0" */
export function checkNodeVersion(versionString, min = 22) {
  const major = Number(versionString.replace(/^v/, '').split('.')[0]);
  return { ok: Number.isFinite(major) && major >= min, major };
}

/** @param {string} output output của `docker --version` */
export function parseDockerVersion(output) {
  const m = /Docker version (\d+)\.(\d+)/.exec(output);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

/** @param {number} totalMs @param {number} intervalMs */
export function waitPlan(totalMs, intervalMs) {
  return { attempts: Math.ceil(totalMs / intervalMs), intervalMs };
}

export function isPostgresReady(pidOneCommand, pgIsReadyOutput) {
  return pidOneCommand.trim() === 'postgres' && pgIsReadyOutput.includes('accepting connections');
}
```

`scripts/lib/run.mjs`:
```js
import { execFileSync, spawnSync } from 'node:child_process';

/**
 * Chạy lệnh, in output ra màn hình, ném lỗi nếu exit != 0.
 * @param {string} cmd @param {string[]} args @param {import('node:child_process').SpawnSyncOptions} [opts]
 */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} thoát mã ${r.status}`);
}

/**
 * Chạy lệnh và trả stdout (chuỗi rỗng nếu lỗi).
 * @param {string} cmd @param {string[]} args
 */
export function capture(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [x] **Step 4: Chạy test để thấy xanh**

Run: `pnpm test`
Expected: `20 passed` (gồm regression guard cho xung đột `pnpm setup` built-in và PostGIS init restart).

- [x] **Step 5: Viết `scripts/setup.mjs`**

```js
#!/usr/bin/env node
// Dựng môi trường dev một lệnh. Chạy giống nhau trên macOS / Windows (PowerShell hoặc WSL) / Linux.
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkNodeVersion,
  isPostgresReady,
  parseDockerVersion,
  waitPlan,
} from './lib/setup-checks.mjs';
import { capture, run, sleep } from './lib/run.mjs';

const t0 = Date.now();
const compose = ['compose', '--env-file', '.env', '-f', 'infra/dev/compose.yml'];
const step = (/** @type {string} */ msg) => console.log(`\n▶ ${msg}`);

step('Kiểm tra Node');
const node = checkNodeVersion(process.version);
if (!node.ok) {
  console.error(`Cần Node ≥ 22, đang có ${process.version}. Cài fnm: https://github.com/Schniz/fnm rồi "fnm install 22".`);
  process.exit(1);
}
console.log(`Node ${process.version} OK`);

step('Kiểm tra Docker');
const dockerVersion = parseDockerVersion(capture('docker', ['--version']));
if (!dockerVersion) {
  console.error('Không thấy Docker. Cài Docker Desktop (macOS/Windows, bật WSL2 trên Windows) hoặc Docker Engine (Linux).');
  process.exit(1);
}
if (!capture('docker', ['info', '--format', '{{.ServerVersion}}'])) {
  console.error('Docker daemon chưa chạy. Mở Docker Desktop rồi chạy lại "pnpm run setup".');
  process.exit(1);
}
console.log(`Docker ${dockerVersion.major}.${dockerVersion.minor} OK`);

step('Tạo .env nếu chưa có');
if (!existsSync(resolve('.env'))) {
  copyFileSync(resolve('.env.example'), resolve('.env'));
  console.log('Đã tạo .env từ .env.example (giá trị dev mặc định).');
} else {
  console.log('.env đã tồn tại — giữ nguyên.');
}

step('Khởi động Postgres/PostGIS (Docker)');
run('docker', [...compose, 'up', '-d', 'postgres']);

step('Chờ Postgres sẵn sàng');
const plan = waitPlan(90_000, 2_000);
let ready = false;
for (let i = 0; i < plan.attempts && !ready; i++) {
  const pidOneCommand = capture('docker', [...compose, 'exec', '-T', 'postgres', 'cat', '/proc/1/comm']);
  const pgIsReadyOutput = capture('docker', [...compose, 'exec', '-T', 'postgres', 'pg_isready', '-U', 'mapslibvn']);
  ready = isPostgresReady(pidOneCommand, pgIsReadyOutput);
  if (!ready) await sleep(plan.intervalMs);
}
if (!ready) {
  console.error('Postgres không sẵn sàng sau 90 giây. Xem log: docker compose -f infra/dev/compose.yml logs postgres');
  process.exit(1);
}
console.log('Postgres OK');

step('Chạy migration');
run(process.execPath, ['scripts/db-migrate.mjs']);

step('Cấu hình hook git và kiểm tra danh tính GitHub');
run('git', ['config', 'core.hooksPath', '.githooks']);
run(process.execPath, ['scripts/check-git-identity.mjs']);

const seconds = Math.round((Date.now() - t0) / 1000);
console.log(`
✔ Môi trường sẵn sàng sau ${seconds}s.

Tiếp theo:
  pnpm dev          # chạy các app (khi đã có)
  pnpm test         # chạy test
  docs/DEVLOG.md    # xem đang ở đâu, bước kế tiếp là gì
`);
```

- [x] **Step 6: Chạy `pnpm run setup` trên trạng thái hiện tại (đã có Postgres)**

Run: `pnpm run setup`
Expected: các bước ▶ lần lượt OK, `Không có migration mới.`, `[git-identity] OK`, dòng `✔ Môi trường sẵn sàng sau Ns` với N < 30.

- [x] **Step 7: Chạy `pnpm run setup` từ trạng thái sạch**

Run: `pnpm db:down -v 2>/dev/null || docker compose --env-file .env -f infra/dev/compose.yml down -v; rm .env; pnpm run setup`
Expected: `Đã tạo .env từ .env.example`, Postgres khởi động lại, `Áp dụng 0001_extensions.sql`, `✔ Môi trường sẵn sàng`.

- [x] **Step 8: Lint, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: xanh.

Sửa `docs/DEVLOG.md`: "Task đang làm: Task 6"; mục 4 thêm dòng T5 kèm số giây đo được.

```bash
git add -A
git commit -m "feat(scripts): pnpm run setup — dựng môi trường dev một lệnh"
git push
```

---

### Task 6: Image Docker chứa toàn bộ công cụ pipeline

**Files:**
- Create: `pipelines/Dockerfile`, `.dockerignore`, `scripts/image.mjs`

- [x] **Step 1: Tạo `.dockerignore`**

```
node_modules
**/node_modules
.git
.turbo
dist
**/dist
work
out
.env
.wrangler
apps
packages
```

- [x] **Step 2: Tạo `pipelines/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
# Image chung cho pipeline dữ liệu MapsLibVN: dùng trên máy dev, máy chủ nội bộ và GitHub Actions.
FROM ubuntu:24.04 AS tools
ARG DEBIAN_FRONTEND=noninteractive
ARG TIPPECANOE_VERSION=2.62.5
ARG DUCKDB_VERSION=1.5.5
ARG PYOSMIUM_VERSION=4.0.2
ARG PNPM_VERSION=9.15.0
# Pin sau lần build đầu: đổi thành .../releases/download/vX.Y.Z/planetiler.jar và ghi vào docs/DEVLOG.md
ARG PLANETILER_URL=https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip git build-essential libsqlite3-dev zlib1g-dev \
      openjdk-21-jre-headless osmium-tool rclone python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

# tippecanoe (BSD-2) — build từ source theo tag
RUN git clone --depth 1 --branch "${TIPPECANOE_VERSION}" https://github.com/felt/tippecanoe.git /tmp/tippecanoe \
    && make -C /tmp/tippecanoe -j"$(nproc)" \
    && make -C /tmp/tippecanoe install \
    && rm -rf /tmp/tippecanoe

# DuckDB CLI (MIT) — chọn theo kiến trúc
RUN ARCH="$(dpkg --print-architecture)"; \
    case "$ARCH" in amd64) D=amd64 ;; arm64) D=aarch64 ;; *) echo "Kiến trúc không hỗ trợ: $ARCH" >&2; exit 1 ;; esac; \
    curl -fsSL -o /tmp/duckdb.zip "https://github.com/duckdb/duckdb/releases/download/v${DUCKDB_VERSION}/duckdb_cli-linux-${D}.zip" \
    && unzip -q /tmp/duckdb.zip -d /usr/local/bin && chmod +x /usr/local/bin/duckdb && rm /tmp/duckdb.zip

# Planetiler (Apache-2.0)
RUN mkdir -p /opt/planetiler \
    && curl -fsSL -o /opt/planetiler/planetiler.jar "${PLANETILER_URL}" \
    && printf '#!/bin/sh\nexec java ${JAVA_OPTS:--Xmx4g} -jar /opt/planetiler/planetiler.jar "$@"\n' > /usr/local/bin/planetiler \
    && chmod +x /usr/local/bin/planetiler

# pyosmium (BSD) trong venv riêng
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir "osmium==${PYOSMIUM_VERSION}" "pytest==8.3.3"
ENV PATH="/opt/venv/bin:${PATH}"

# Node 22 + pnpm
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

FROM tools AS app
WORKDIR /app
ENV MAPSLIBVN_IN_CONTAINER=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --filter .
COPY scripts ./scripts
COPY pipelines ./pipelines
CMD ["node", "--version"]
```

Nếu `git clone --branch 2.62.5` báo tag không tồn tại: chạy `git ls-remote --tags https://github.com/felt/tippecanoe.git | tail -5`, chọn tag mới nhất, sửa `ARG TIPPECANOE_VERSION`, ghi "Quyết định phát sinh" trong DEVLOG. Tương tự với `PYOSMIUM_VERSION` (`pip index versions osmium`) và `DUCKDB_VERSION` (trang releases DuckDB).

- [x] **Step 3: Viết `scripts/image.mjs`**

```js
#!/usr/bin/env node
// pnpm image:build | pnpm image:smoke — build và kiểm tra image pipeline
import { run } from './lib/run.mjs';

const IMAGE = process.env.PIPELINE_IMAGE ?? 'mapslibvn/pipeline:local';
const SMOKE = [
  'planetiler --help | head -1',
  'tippecanoe -v 2>&1 | head -1',
  'duckdb --version',
  'osmium --version | head -1',
  'python -c "import osmium; print(\'pyosmium\', osmium.__version__)"',
  'rclone version | head -1',
  'node --version',
  'pnpm --version',
].join(' && ');

const cmd = process.argv[2];
if (cmd === 'build') {
  run('docker', ['build', '-f', 'pipelines/Dockerfile', '-t', IMAGE, '.']);
} else if (cmd === 'smoke') {
  run('docker', ['run', '--rm', IMAGE, 'sh', '-c', SMOKE]);
  console.log(`\n✔ Image ${IMAGE} có đủ công cụ.`);
} else {
  console.error('Dùng: node scripts/image.mjs build|smoke');
  process.exit(2);
}
```

- [x] **Step 4: Build và smoke trên máy (arm64 nếu là Apple Silicon)**

Run: `pnpm image:build`
Expected: kết thúc `naming to docker.io/mapslibvn/pipeline:local` — lần đầu 6–12 phút (tippecanoe biên dịch).

Run: `pnpm image:smoke`
Expected: 8 dòng phiên bản (Planetiler usage, `tippecanoe v2.62.5`, `v1.5.3 …`, `osmium version 1.16.0`, `pyosmium 4.0.2`, `rclone v1.6x`, `v22.x`, `9.15.0`) rồi `✔ Image … có đủ công cụ.`

- [x] **Step 5: Ghi phiên bản Planetiler thực tế và pin**

Run: `docker run --rm mapslibvn/pipeline:local sh -c "unzip -p /opt/planetiler/planetiler.jar META-INF/MANIFEST.MF | grep -i -E 'version|Implementation' | head -5"`
Expected: có dòng phiên bản (ví dụ `Implementation-Version: 0.9.x`). Sửa `ARG PLANETILER_URL` thành `https://github.com/onthegomap/planetiler/releases/download/v<phiên bản>/planetiler.jar`, ghi dòng "Quyết định phát sinh: pin Planetiler v…" vào DEVLOG.

Thực tế: manifest chỉ ghi Java 21, không có `Implementation-Version`; metadata
`META-INF/maven/com.onthegomap.planetiler/planetiler-dist/pom.properties` xác nhận
`version=0.10.2`. URL đã pin `v0.10.2`; jar tải bằng 8 HTTP range có cache và kiểm
tra tổng kích thước 93.278.824 byte cùng SHA-256 vì đường truyền GitHub một kết
nối quá chậm.
DuckDB dùng CLI release thực tế `v1.5.3`; asset arm64 có hậu tố `arm64`, không
phải `aarch64`.

Run: `pnpm image:build && pnpm image:smoke`
Expected: build dùng cache, smoke xanh.

- [x] **Step 6: Kiểm tra service `pipeline` trong compose chạy được**

Run: `docker compose --env-file .env -f infra/dev/compose.yml --profile pipeline run --rm pipeline node --version`
Expected: `v22.x.x`.

- [x] **Step 7: Lint, DEVLOG, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: xanh.

Sửa `docs/DEVLOG.md`: "Môi trường đã dựng: … image pipeline local"; "Task đang làm: Task 7"; mục 3 thêm dòng pin phiên bản tool; mục 4 thêm dòng T6.

```bash
git add -A
git commit -m "feat(pipelines): image Docker chung (Planetiler, tippecanoe, osmium, pyosmium, DuckDB, rclone, Node)"
git push
```

---

### Task 7: Dev Container

**Files:**
- Create: `.devcontainer/devcontainer.json`, `.devcontainer/compose.devcontainer.yml`

- [x] **Step 1: Tạo compose bổ sung cho devcontainer**

`.devcontainer/compose.devcontainer.yml`:
```yaml
services:
  dev:
    build:
      context: ..
      dockerfile: pipelines/Dockerfile
      target: tools
    volumes:
      - ..:/workspace:cached
      # node_modules riêng cho Linux trong container, không đụng node_modules của máy host
      - dev-node-modules-root:/workspace/node_modules
      - dev-node-modules-api:/workspace/apps/api/node_modules
      - dev-node-modules-docs:/workspace/apps/docs/node_modules
      - dev-node-modules-core:/workspace/packages/core/node_modules
      - dev-node-modules-web:/workspace/packages/web/node_modules
      - dev-node-modules-style:/workspace/packages/style/node_modules
      - dev-node-modules-tiles:/workspace/pipelines/tiles/node_modules
    working_dir: /workspace
    environment:
      POSTGRES_HOST: postgres
      MAPSLIBVN_IN_CONTAINER: "1"
    depends_on:
      postgres:
        condition: service_healthy
    command: ["sleep", "infinity"]

volumes:
  dev-node-modules-root:
  dev-node-modules-api:
  dev-node-modules-docs:
  dev-node-modules-core:
  dev-node-modules-web:
  dev-node-modules-style:
  dev-node-modules-tiles:
```

- [x] **Step 2: Tạo `devcontainer.json`**

```json
{
  "name": "MapsLibVN",
  "dockerComposeFile": ["../infra/dev/compose.yml", "compose.devcontainer.yml"],
  "service": "dev",
  "workspaceFolder": "/workspace",
  "shutdownAction": "stopCompose",
  "postCreateCommand": "corepack enable && pnpm install && cp -n .env.example .env; node scripts/db-migrate.mjs",
  "customizations": {
    "vscode": {
      "extensions": ["biomejs.biome", "vitest.explorer", "ms-azuretools.vscode-docker"]
    }
  }
}
```

Ghi chú cho người dùng (đưa vào README mục "Dev Container"): trên Windows/macOS nên dùng lệnh VS Code **"Dev Containers: Clone Repository in Container Volume…"** để tránh I/O chậm qua bind mount; cách "Reopen in Container" vẫn hoạt động nhờ các volume `node_modules` riêng.

- [x] **Step 3: Kiểm tra bằng CLI devcontainer (không cần mở VS Code)**

Run: `pnpm dlx @devcontainers/cli@latest up --workspace-folder .`
Expected: kết thúc bằng JSON có `"outcome":"success"` (lần đầu build image ~ vài phút, dùng cache từ Task 6).

Run: `pnpm dlx @devcontainers/cli@latest exec --workspace-folder . pnpm test`
Expected: `20 passed` chạy **trong** container.

Run: `docker compose -p mapslibvn-dev down` (tắt sau khi kiểm) — hoặc để chạy nếu muốn dùng tiếp.

Kết quả thực tế 2026-08-27: `up` trả `"outcome":"success"`; 20/20 test đạt
trong Linux container. Vì đường dẫn của nhiều file Compose được resolve theo file
đầu tiên (`infra/dev/compose.yml`), override dùng `../..` thay cho `..`. Lệnh dọn
đã chạy với cả hai file Compose:
`docker compose -p mapslibvn-dev -f infra/dev/compose.yml -f .devcontainer/compose.devcontainer.yml down`.

- [x] **Step 4: Bổ sung README và commit**

Thêm vào `README.md` sau mục "Bắt đầu":
```markdown
## Dev Container (tuỳ chọn, khuyên dùng khi đổi máy)

VS Code/Cursor → "Dev Containers: Clone Repository in Container Volume…" → dán URL repo. Môi trường (Node, Java, tippecanoe, DuckDB, Postgres) giống hệt trên mọi HĐH.
```

Sửa `docs/DEVLOG.md`: "Task đang làm: Task 8"; mục 4 thêm dòng T7.

```bash
git add -A
git commit -m "feat(devcontainer): môi trường VS Code đồng nhất trên mọi HĐH"
git push
```

---

### Task 8: CI trên GitHub Actions (account cá nhân)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Tạo workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test

  image:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: pipelines/Dockerfile
          push: ${{ github.ref == 'refs/heads/main' }}
          load: ${{ github.ref != 'refs/heads/main' }}
          tags: |
            ghcr.io/dotienphong/mapslibvn-pipeline:latest
            ghcr.io/dotienphong/mapslibvn-pipeline:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Smoke image
        env:
          PIPELINE_IMAGE: ghcr.io/dotienphong/mapslibvn-pipeline:${{ github.sha }}
        run: |
          if [ "${{ github.ref }}" = "refs/heads/main" ]; then docker pull "$PIPELINE_IMAGE"; fi
          docker run --rm "$PIPELINE_IMAGE" sh -c 'planetiler --help | head -1 && tippecanoe -v 2>&1 | head -1 && duckdb --version && osmium --version | head -1 && python -c "import osmium; print(osmium.__version__)" && rclone version | head -1 && node --version && pnpm --version'
```

- [ ] **Step 2: Commit, push, xem run**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint/typecheck/test + build image pipeline lên GHCR"
git push
```

Xem trạng thái **chỉ bằng PAT cá nhân** (không dùng `gh` mặc định):
Run: `GH_TOKEN="$(cat ~/.config/gh-dotienphong.token)" gh run list -R dotienphong/maps-library-vietnam --limit 3`
Expected: run mới nhất `completed success` sau ~10 phút (job `image` lâu nhất). Nếu PAT hết hạn hoặc thiếu quyền `actions:read` cho repo mới, xem trên web `https://github.com/dotienphong/maps-library-vietnam/actions` bằng account dotienphong.

- [ ] **Step 3: Nếu job đỏ**

Đọc log, sửa, commit lại. Lỗi thường gặp: Biome format (chạy `pnpm lint:fix`), tag tippecanoe không tồn tại (xem Task 6 Step 2), GHCR permission (repo Settings → Actions → General → Workflow permissions: Read and write).

- [ ] **Step 4: DEVLOG và commit**

Sửa `docs/DEVLOG.md`: "Task đang làm: Task 9"; "Môi trường đã dựng: … CI GitHub xanh, image trên GHCR"; mục 4 thêm dòng T8 với URL run.

```bash
git add docs/DEVLOG.md
git commit -m "docs(devlog): CI xanh lần đầu"
git push
```

---

### Task 9: Nghiệm thu M1a

**Files:**
- Modify: `docs/DEVLOG.md`, `docs/superpowers/plans/2026-08-26-m1a-nen-tang-moi-truong.md` (tick checkbox)

- [ ] **Step 1: Thử từ clone sạch, đo thời gian**

Run:
```bash
cd "$(mktemp -d)" && git clone git@github.com-dotienphong:dotienphong/maps-library-vietnam.git && cd maps-library-vietnam \
  && corepack enable && time (pnpm install && pnpm run setup)
```
Expected: `✔ Môi trường sẵn sàng`, `real` < 15 phút (thường 2–4 phút khi image Postgres đã có trên máy). Lưu ý: clone này dùng cùng Docker daemon nên Postgres `mapslibvn-dev` đã chạy sẽ được dùng lại — đúng mong đợi.

Dọn: `cd - && rm -rf "$OLDPWD"`.

- [ ] **Step 2: Kiểm tra hook vẫn chặn account sai**

Run: `git -c user.email=someone@bark.com push --dry-run origin main; echo "exit=$?"`
Expected: `LỖI: user.email "someone@bark.com" thuộc account công ty`, `pre-push: BỊ CHẶN`, `exit=1`.

- [ ] **Step 3: Checklist nghiệm thu (ghi kết quả thật vào DEVLOG mục 4)**

- `pnpm install && pnpm lint && pnpm typecheck && pnpm test` xanh trên máy dev.
- `pnpm run setup` từ clone sạch: … giây.
- `pnpm image:smoke` xanh trên arm64 (Mac) — CI xanh trên amd64.
- Hook chặn email bark: đã kiểm.
- Windows: **chưa kiểm** (chờ PHONG có máy) — ghi rõ "PENDING Windows" trong DEVLOG mục 1.

- [ ] **Step 4: Cập nhật DEVLOG chuyển mốc**

`docs/DEVLOG.md` mục 1: "Mốc: M1b — Tiles, style, Worker, Web SDK"; "Plan: `docs/superpowers/plans/2026-08-26-m1b-tiles-style-web-sdk.md`"; "Task đang làm: Task 1". Mục 2: "M1b Task 1 — `@mapslibvn/core` (attribution + client khung)". Mục 4: dòng nghiệm thu M1a.

```bash
git add -A
git commit -m "docs: nghiệm thu M1a, chuyển sang M1b"
git push
```
