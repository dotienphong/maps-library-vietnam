import type { AuthInfo } from './auth';

export interface Env {
  META: KVNamespace;
  TILES: R2Bucket;
  DB: Hyperdrive;
  /** Chống burst theo key tại edge: 60 request/phút/colo. */
  PLACES_RATE_LIMITER?: RateLimit;
  TILES_BASE: string;
  ENVIRONMENT: string;
  /** '1' = bật đếm quota KV cho tenant free/paid (spec 6.4). Mặc định '0'. */
  QUOTA_ENABLED?: string;
  /** Workers Analytics Engine — optional, code phải hoạt động khi vắng binding. */
  ANALYTICS?: AnalyticsEngineDataset;
  /** Cloudflare Access cho /admin + /v1/admin (M4). Không phải secret. */
  ACCESS_TEAM_DOMAIN?: string; // vd: myteam.cloudflareaccess.com
  ACCESS_AUD?: string; // AUD tag của Access application
  /** Override URL JWKS cho test/E2E (Access giả lập). */
  ACCESS_CERTS_URL?: string;
  /** Secret băm `ip_hash`/`end_user_hash` (checklist C4). Đặt bằng `wrangler secret put`. */
  IP_HASH_PEPPER?: string;
  /** '1' = bật bậc 3b gập telex/VNI (spec 5.6). Mặc định TẮT; bật sau khi có số liệu stage_hit. */
  AUTOCOMPLETE_TELEX?: string;
  /** Gốc Valhalla (spec dẫn đường A): dev `http://127.0.0.1:8002`, production hostname Tunnel. Vắng → 503. */
  ROUTING_BASE?: string;
  /** Service token Cloudflare Access cho hostname routing; production đặt bằng `wrangler secret put`. */
  ROUTING_ACCESS_CLIENT_ID?: string;
  ROUTING_ACCESS_CLIENT_SECRET?: string;
  /** Burst riêng cho /v1/directions: 20 request/phút/colo theo khoá+IP (Valhalla đắt hơn Postgres). */
  DIRECTIONS_RATE_LIMITER?: RateLimit;
  /**
   * Trần tổng theo KHOÁ (mọi IP cộng lại) cho khoá web/mobile ở /v1/directions: 100 request/phút/colo.
   * Khoá web/mobile nằm công khai trong HTML/app (vd khoá demo docs của tenant internal) — không có trần
   * này thì ai lấy được khoá là dùng Valhalla không giới hạn. Dùng Rate Limiting thay KV vì Workers Free
   * chỉ cho 1.000 ghi KV/ngày (quyết định PHONG 10/09/2026).
   */
  DIRECTIONS_KEY_RATE_LIMITER?: RateLimit;
}

/** Kiểu Hono chung cho app: Variables.auth do requireAuth() gán, reviewer do requireAccess(). */
export type AppEnv = {
  Bindings: Env;
  /** `stageHit`: bậc cao nhất đã cho ra kết quả autocomplete (0 = rỗng) — spec 5.7, ghi vào analytics. */
  Variables: { auth?: AuthInfo; reviewer?: string; stageHit?: number };
};
