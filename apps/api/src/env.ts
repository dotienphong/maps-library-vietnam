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
  /**
   * '1' = mở cổng khách hàng tự phục vụ (`/console`, `/v1/console/*`). Mặc định đóng; bật cuối
   * pha 2 sau khi nghiệm thu (spec thương mại tự phục vụ mục 16, 19). Giá trị đặt trong
   * wrangler.toml, KHÔNG truyền --var: --var bị lần deploy sau xoá sạch.
   */
  SELF_SERVE?: string;
  /**
   * Khoá Resend để gửi thư. Vắng ở production → route gửi thư trả 503 `email_not_configured`;
   * vắng ngoài production → dùng bản ghi log, không chặn phát triển.
   */
  RESEND_API_KEY?: string;
  /** Địa chỉ người gửi, phải thuộc tên miền đã xác thực ở Resend. */
  EMAIL_FROM?: string;
  /** Địa chỉ nhận thư trả lời, cũng là email hỗ trợ hiện trên website. */
  SUPPORT_EMAIL?: string;
  /**
   * Pepper băm token phiên và mã đăng nhập của khách. Đặt bằng
   * `wrangler secret put SESSION_PEPPER --env production`. Vắng ở production → nhóm route console
   * trả 503 chứ không băm yếu, cùng cách IP_HASH_PEPPER đã làm cho /v1/edits.
   */
  SESSION_PEPPER?: string;
  /**
   * Secret Turnstile. Vắng ở production → form xin mã bị TỪ CHỐI; vắng ngoài production → bỏ qua
   * bước kiểm kèm cảnh báo trong log.
   */
  TURNSTILE_SECRET?: string;
  /** Site key Turnstile — công khai, nằm trong HTML của trang, nên để `[vars]` chứ không secret. */
  TURNSTILE_SITE_KEY?: string;
  /**
   * OAuth client kiểu Web ở Google Cloud. Vắng một trong hai → nút "Đăng nhập bằng Google" không
   * hiện và route trả 503 `google_not_configured`; đường mã một lần vẫn dùng được bình thường.
   */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * Ba khoá PayOS, đặt bằng `wrangler secret put PAYOS_CLIENT_ID --env production` (tương tự hai
   * khoá kia). Vắng bất kỳ khoá nào → tạo đơn trả 503 `payment_provider_not_configured` và webhook
   * trả 503: KHÔNG có nhánh "tạm tin khi thiếu khoá". Harness nạp ba giá trị GIẢ và trỏ PAYOS_BASE
   * về máy chủ giả trong scripts/lib/payos-fake.mjs — PayOS không có sandbox thật.
   */
  PAYOS_CLIENT_ID?: string;
  PAYOS_API_KEY?: string;
  PAYOS_CHECKSUM_KEY?: string;
  /** Gốc API PayOS. Bỏ trống = https://api-merchant.payos.vn; harness trỏ về bản giả. */
  PAYOS_BASE?: string;
  /** Gốc trang thanh toán, để dựng lại checkoutUrl từ paymentLinkId. Bỏ trống = https://pay.payos.vn. */
  PAYOS_CHECKOUT_BASE?: string;
  /** Webhook sai chữ ký: tối đa 20 dòng ghi/phút mỗi IP để DB không bị lũ rác. */
  PAYOS_WEBHOOK_RATE_LIMITER?: RateLimit;
  /**
   * Gốc URL cổng khách hàng để dựng link trong thư gửi từ cron (ở đó không có request nào để lấy
   * origin). Production: https://api.ai-solutions.io.vn. Vắng → thư không có nút mở console.
   */
  CONSOLE_ORIGIN?: string;
  /** Mỗi email một mã mỗi phút. Binding Rate Limiting chỉ có chu kỳ 10 hoặc 60 giây. */
  OTP_EMAIL_RATE_LIMITER?: RateLimit;
  /** Mỗi IP ba lượt xin mã mỗi phút. */
  OTP_IP_RATE_LIMITER?: RateLimit;
  /**
   * 'debug' = trả mã đăng nhập ở header `X-Debug-Otp` để e2e chạy được mà không cần hộp thư.
   * KHÔNG có tác dụng ở production dù đặt nhầm — điều kiện kiểm là kép.
   */
  OTP_DELIVERY?: string;
  /**
   * '1' = thêm một vòng gọi `ping()` không chạm storage vào mỗi request thương mại, để tách
   * chi phí mạng khỏi chi phí ghi bền vững. CHỈ bật trong lượt đo: nó cộng đúng một vòng mạng.
   */
  QUOTA_PROBE?: string;
  /** Trần request đồng thời mỗi tenant. Bỏ trống = mốc đã đo (50 Places / 16 directions). */
  MAX_INFLIGHT_PLACES?: string;
  MAX_INFLIGHT_DIRECTIONS?: string;
  /** Workers Analytics Engine — optional, code phải hoạt động khi vắng binding. */
  ANALYTICS?: AnalyticsEngineDataset;
  /**
   * Tài khoản Cloudflare, dùng dựng URL Analytics Engine SQL API. Không phải bí mật (nó nằm trong
   * URL của mọi lời gọi API), nên để ở `[vars]` chứ không phải secret.
   */
  CF_ACCOUNT_ID?: string;
  /**
   * Token CHỈ có quyền `Account Analytics: Read`, đặt bằng
   * `wrangler secret put CF_ANALYTICS_TOKEN --env production`.
   *
   * Cố ý KHÔNG dùng lại `CLOUDFLARE_API_TOKEN` của máy dev dù nó cũng đọc được Analytics: token đó
   * deploy được Worker, đọc được R2 và KV. Nhét nó vào Worker là biến một lỗ hổng trong Worker
   * thành quyền điều khiển cả tài khoản. Vắng biến này → `/v1/admin/metrics` trả 503
   * `analytics_not_configured`, KHÔNG phải 500.
   */
  CF_ANALYTICS_TOKEN?: string;
  /**
   * SPA tĩnh của trang Admin. Worker dùng binding này để trả index.html cho các đường dẫn con
   * (/admin/edits…) — không có file thật nào ở đó, mà router chạy phía trình duyệt.
   */
  ASSETS?: Fetcher;
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
  /**
   * '1' = bật bậc nhanh cho nhánh POI (name_tsv + cắt popularity, plan 2026-09-18). Mặc định TẮT.
   * Bật/tắt KHÔNG cần sửa mã: `wrangler deploy --env production --var AUTOCOMPLETE_FAST:1`.
   */
  AUTOCOMPLETE_FAST?: string;
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
    /** Khách đã đăng nhập ở cổng tự phục vụ, do requireCustomer() gán. */
    customer?: {
      accountId: string;
      email: string;
      name: string | null;
      tenantId: string | null;
      tenantName: string | null;
      tokenHash: string;
    };
  };
};
