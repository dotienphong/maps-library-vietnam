import { randomInt } from 'node:crypto';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** @param {number} length */
export function generatePassword(length) {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE62[randomInt(BASE62.length)];
  return out;
}

/** 25% RAM, bội số 256MB, trong [512MB, 8192MB]. @param {number} totalMemBytes */
export function sharedBuffersFor(totalMemBytes) {
  const quarterMb = Math.floor(totalMemBytes / 4 / 2 ** 20);
  const rounded = Math.floor(quarterMb / 256) * 256;
  return `${Math.min(8192, Math.max(512, rounded))}MB`;
}

/**
 * Cảnh báo khi `PG_SHARED_BUFFERS` trong `.env` quá lớn so với RAM của MÁY ĐANG CHẠY.
 *
 * Vì sao cần: `sharedBuffersFor()` tính theo RAM của máy chạy `pnpm server:setup`, nhưng `.env` sinh
 * ra thường được mang sang máy chủ khác. Ngày 22/09/2026 phát hiện production chạy
 * `PG_SHARED_BUFFERS=4096MB` (25 % của MacBook 16 GB) trên máy chủ Ubuntu **3,7 GB** — Postgres xin
 * 4 GB trên máy 3,7 GB nên hệ thống swap 81 %, và mọi thứ chậm đi: p95 `/v1/directions` gấp 3–5 lần
 * mốc cũ, ma trận 50 cặp mất 3,6–4,5 s. Mất nhiều giờ mới truy ra vì triệu chứng nằm ở Valhalla.
 *
 * Trả `null` khi an toàn hoặc khi không đọc được số — cảnh báo là để người vận hành thấy, không
 * được chặn khởi động vì một chuỗi lạ.
 *
 * @param {string} sharedBuffers giá trị dạng "4096MB"
 * @param {number} totalMemBytes RAM của máy hiện tại
 * @returns {string | null}
 */
export function canhBaoSharedBuffers(sharedBuffers, totalMemBytes) {
  const match = /^(\d+)MB$/.exec((sharedBuffers ?? '').trim());
  if (!match || !(totalMemBytes > 0)) return null;
  const mb = Number(match[1]);
  const totalMb = totalMemBytes / 2 ** 20;
  if (mb <= totalMb * 0.3) return null;
  const gb = (totalMb / 1024).toFixed(1).replace('.', ',');
  return (
    `PG_SHARED_BUFFERS=${sharedBuffers} nhưng máy này chỉ có ${gb} GB RAM ` +
    `(${Math.round(totalMb)} MB). Postgres sẽ xin nhiều bộ nhớ hơn mức máy chịu được và hệ thống ` +
    'rơi vào swap — mọi dịch vụ chậm đi, kể cả Valhalla vì mất page cache cho graph. ' +
    'File .env nhiều khả năng được sinh trên máy khác. Sửa xuống ≤ 30 % RAM rồi ' +
    'khởi động lại postgres.'
  );
}

/**
 * @param {{ superPassword: string, apiPassword: string, pipelinePassword: string, sharedBuffers: string,
 *   tunnelToken: string, pipelineImage: string, backupPassphrase: string }} v
 */
export function renderServerEnv(v) {
  return [
    '# Bí mật máy chủ MapsLibVN — KHÔNG commit. Sinh bởi pnpm server:setup.',
    `POSTGRES_SUPER_PASSWORD=${v.superPassword}`,
    `API_PASSWORD=${v.apiPassword}`,
    `PIPELINE_PASSWORD=${v.pipelinePassword}`,
    `PG_SHARED_BUFFERS=${v.sharedBuffers}`,
    '# Token Tunnel: Cloudflare Zero Trust → Networks → Tunnels → tạo tunnel "mapslibvn-db" → copy token',
    `TUNNEL_TOKEN=${v.tunnelToken}`,
    `PIPELINE_IMAGE=${v.pipelineImage}`,
    '# Backup DB (audit 09/09/2026): dump mã hoá AES-256 bằng passphrase này rồi mới lên R2. Mất passphrase = mất backup — lưu vào password manager.',
    `BACKUP_PASSPHRASE=${v.backupPassphrase}`,
    '# Bucket RIÊNG cho backup, KHÔNG gắn custom domain. Token S3 bên dưới phải có quyền trên cả hai bucket.',
    'BACKUP_BUCKET=mapslibvn-backups',
    '# Các biến Cloudflare/R2 cho backup và data:update — chép từ .env máy dev (xem .env.example gốc repo).',
    '# CLOUDFLARE_API_TOKEN ở đây dùng token RIÊNG cho pipeline (Workers KV Edit + Workers R2 Edit), không dùng token deploy.',
    'TILES_BASE=',
    'R2_BUCKET=mapslibvn-tiles',
    'KV_NAMESPACE_ID_META=',
    'CLOUDFLARE_ACCOUNT_ID=',
    'CLOUDFLARE_API_TOKEN=',
    'RCLONE_CONFIG_R2_TYPE=s3',
    'RCLONE_CONFIG_R2_PROVIDER=Cloudflare',
    'RCLONE_CONFIG_R2_ACL=private',
    'RCLONE_CONFIG_R2_ACCESS_KEY_ID=',
    'RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=',
    'RCLONE_CONFIG_R2_ENDPOINT=',
    'RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true',
    '# Token Hugging Face (Read) cho dataset gated foursquare/fsq-os-places — ingest FSQ',
    'HF_TOKEN=',
    '',
  ].join('\n');
}

/**
 * Dịch vụ cần `docker compose pull` khi cập nhật máy chủ.
 *
 * Image pipeline dựng tại máy mang tag `:local` (xem `pnpm image:build`) và không nằm trên
 * registry nào, nên `docker compose pull` cho nó luôn trả `pull access denied` và làm hỏng cả
 * `pnpm server:update` trước khi kịp áp migration — đúng lỗi gặp ngày 05/09/2026. Khi đó chỉ pull
 * ba dịch vụ dùng image công khai; image pipeline phải tự dựng lại bằng `pnpm image:build`.
 *
 * @param {string | undefined} pipelineImage giá trị PIPELINE_IMAGE trong infra/server/.env
 * @returns {{ services: string[], skipPipeline: boolean }} `services` rỗng = pull mọi dịch vụ
 */
export function pullPlan(pipelineImage) {
  const skipPipeline = /:local$/.test((pipelineImage ?? '').trim());
  return {
    services: skipPipeline ? ['postgres', 'cloudflared', 'valhalla'] : [],
    skipPipeline,
  };
}

/** @param {string} text @returns {Record<string, string>} */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
