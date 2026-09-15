import type { AuthInfo } from './auth';
import type { QuotaObject } from './billing/quota-object';

export interface Env {
  META: KVNamespace;
  QUOTA: DurableObjectNamespace<QuotaObject>;
  TILES: R2Bucket;
  DB: Hyperdrive;
  /** Chống burst theo key tại edge: 60 request/phút/colo. */
  PLACES_RATE_LIMITER?: RateLimit;
  TILES_BASE: string;
  ENVIRONMENT: string;
  /** '1' = bật đếm quota KV cho tenant free/paid (spec 6.4). Mặc định '0'. */
  QUOTA_ENABLED?: string;
  /** Cổng độc lập để commercial fail closed trong lúc rollout/rollback. */
  COMMERCIAL_ADMISSION?: string;
  /** Trần request đồng thời mỗi tenant. Bỏ trống = mốc đã đo (50 Places / 16 directions). */
  MAX_INFLIGHT_PLACES?: string;
  MAX_INFLIGHT_DIRECTIONS?: string;
  /** Workers Analytics Engine — optional, code phải hoạt động khi vắng binding. */
  ANALYTICS?: AnalyticsEngineDataset;
  /** Cloudflare Access cho /admin + /v1/admin (M4). Không phải secret. */
  ACCESS_TEAM_DOMAIN?: string; // vd: myteam.cloudflareaccess.com
  ACCESS_AUD?: string; // AUD tag của Access application
  /** Danh sách email được quản trị billing, phân cách bằng dấu phẩy. Rỗng = deny. */
  BILLING_ADMIN_EMAILS?: string;
  /**
   * Quyền RIÊNG cho sao lưu/phục hồi sổ quota. Tách khỏi `BILLING_ADMIN_EMAILS` vì hai việc khác
   * hẳn nhau: cấp gói là nghiệp vụ hằng ngày, còn ghi đè sổ là thao tác xoá được lịch sử tiêu
   * thụ của cả một thuê bao. Rỗng = deny.
   */
  BILLING_BACKUP_EMAILS?: string;
  /** Origin chính xác của UI billing nếu route mutation được gọi từ browser. */
  BILLING_ADMIN_ORIGIN?: string;
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
  Variables: {
    auth?: AuthInfo;
    reviewer?: string;
    stageHit?: number;
    /** Tham số đã parse ở preflight quota, dùng lại trong handler — spec 14.4 cấm parse hai lần.
     * Mỗi route tự biết kiểu thật của mình; middleware chỉ mang hộ qua context. */
    params?: unknown;
    /** Thời gian từng vòng gọi Durable Object, gom lại để phát ra `Server-Timing` (xem timing.ts). */
    quotaTimings?: { name: string; ms: number }[];
  };
};
