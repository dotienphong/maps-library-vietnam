import { ATTRIBUTION_LINKS, attributionHtml, attributionText } from '@mapslibvn/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireBillingAccess } from './access';
import { analyticsMiddleware } from './analytics';
import { chayCron } from './commerce/cron';
import { dbHealth } from './db-health';
import type { AppEnv, Env } from './env';
import { ApiError, errorResponse } from './errors';
import { admin, requireSameSiteGhi } from './routes/admin';
import { adminQuotaSummary } from './routes/admin-quota-summary';
import { autocomplete } from './routes/autocomplete';
import { billingAdmin } from './routes/billing-admin';
import { catalogRoute } from './routes/catalog';
import { consoleRoutes } from './routes/console';
import { consoleAuth } from './routes/console-auth';
import { consoleOrders } from './routes/console-orders';
import { directions } from './routes/directions';
import { edits } from './routes/edits';
import { geocodeRoute } from './routes/geocode';
import { nearby } from './routes/nearby';
import { payWebhook } from './routes/pay-webhook';
import { places } from './routes/places';
import { quotaReceipts } from './routes/quota-receipts';
import { r2 } from './routes/r2';
import { reverse } from './routes/reverse';
import { search } from './routes/search';
import { styles } from './routes/styles';
import { tiles } from './routes/tiles';

export { QuotaObject } from './billing/quota-object';

/**
 * Xuất có tên để test dựng request thẳng vào router (`app.request`) — default export là object
 * `{ fetch, scheduled }` nên không còn phương thức đó.
 */
export const app = new Hono<AppEnv>();
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowHeaders: ['X-Api-Key', 'Range', 'Content-Type'],
    exposeHeaders: [
      'X-MapsLibVN-Receipt-Id',
      'X-MapsLibVN-Receipt-Token',
      'X-MapsLibVN-Receipt-Expires-At',
      'X-MapsLibVN-Receipt-Version',
      'Retry-After',
      'Server-Timing',
    ],
  }),
);
app.use('/v1/*', analyticsMiddleware());
app.onError((err, c) => errorResponse(c, err));
/**
 * SPA fallback cho trang Admin: /admin/edits và các đường dẫn con khác không có file tĩnh tương
 * ứng, router chạy phía trình duyệt. Giới hạn trong tiền tố /admin nên một /v1/* gõ sai vẫn nhận
 * lỗi JSON đúng nghĩa thay vì một trang HTML.
 *
 * CHỈ áp cho đường dẫn điều hướng, KHÔNG áp cho file có phần mở rộng. Bản đầu nuốt cả yêu cầu
 * `.js`: trình duyệt giữ index.html cũ, xin một chunk mang hash cũ, Worker trả HTML, trình duyệt
 * từ chối vì sai MIME và maplibre không bao giờ nạp được — bản đồ trắng mà không có lỗi nào để
 * hiện. Sự cố 16/09/2026. Trả 404 thật thì lỗi lộ ra ngay và trang tự tải lại được.
 */
const LA_TEP_TINH = /\.[a-z0-9]+$/i;

/**
 * Hai SPA dùng chung một luật fallback và cùng một thư mục assets: cổng khách hàng build vào
 * `apps/admin/dist/console`, vì binding `[assets]` chỉ nhận đúng một thư mục.
 */
for (const goc of ['admin', 'console'] as const) {
  app.get(`/${goc}/*`, async (c) => {
    const url = new URL(c.req.url);
    const doanCuoi = url.pathname.split('/').pop() ?? '';
    if (!c.env.ASSETS || LA_TEP_TINH.test(doanCuoi)) {
      throw new ApiError(404, 'not_found', 'Không có tệp này');
    }
    url.pathname = `/${goc}/index.html`;
    return c.env.ASSETS.fetch(new Request(url, { headers: c.req.raw.headers }));
  });
}

app.notFound((c) => errorResponse(c, new ApiError(404, 'not_found', 'Không có route này')));

app.get('/healthz', (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT }));
// Cổng chống CSRF phải đứng trước requireBillingAccess: một POST cross-site không được đi xa tới
// mức chạm vào danh sách email, và người gửi phải nhận đúng 403 cross_site_request. Nhóm này mount
// ở đây chứ không trong app `admin`, nên phải gắn lại cổng bằng tay — xem test/billing-csrf.test.ts.
app.use('/v1/admin/billing/*', requireSameSiteGhi());
app.use('/v1/admin/billing/*', requireBillingAccess());
app.route('/', billingAdmin());
// Mức tiêu thụ của khách là cùng loại dữ liệu mà nhóm billing đang bảo vệ, nên route này chịu
// đúng cổng đó. Đặt NGOÀI tiền tố `/v1/admin/billing/` vì trong đó có middleware coi đoạn đầu là
// `:tenantId` và sẽ trả 404 cho một đường dẫn tĩnh — đúng lý do `plan-catalog` cũng đứng ngoài.
app.use('/v1/admin/quota-summary', requireSameSiteGhi());
app.use('/v1/admin/quota-summary', requireBillingAccess());
app.route('/', adminQuotaSummary);
app.get('/healthz/db', async (c) => c.json(await dbHealth(c.env, c.executionCtx)));
app.get('/v1/attribution', (c) =>
  c.json({ text: attributionText(), html: attributionHtml(), links: ATTRIBUTION_LINKS }, 200, {
    'cache-control': 'public, max-age=86400',
  }),
);
app.route('/', catalogRoute);

// Nhóm cổng khách hàng. Khai cổng chống CSRF đúng MỘT chỗ cho cả tiền tố, để thêm route mới vào
// `console-auth.ts` hay `console.ts` sau này không thể quên gắn. Cookie phiên là SameSite=Lax nên
// cổng này cộng với nó là đủ, không cần token CSRF riêng.
app.use('/v1/console/*', requireSameSiteGhi());
app.route('/', consoleAuth);
app.route('/', consoleRoutes);
app.route('/', consoleOrders);

// Webhook PayOS đứng NGOÀI mọi cổng Access/CSRF/cookie: server-to-server, và chữ ký HMAC là cổng
// duy nhất. Vì vậy nó phải nằm ngoài tiền tố `/v1/console/*` ở trên — một cổng chống CSRF ở đây
// sẽ chặn đúng thứ cần cho qua, còn chữ ký thì đã chặn đúng thứ cần chặn.
app.route('/', payWebhook);
app.route('/', autocomplete);
app.route('/', search);
app.route('/', nearby);
app.route('/', places);
app.route('/', geocodeRoute);
app.route('/', reverse);
app.route('/', directions);
app.route('/', quotaReceipts);
app.route('/', edits);
app.route('/', admin);
app.route('/', styles);
app.route('/', tiles);
app.route('/', r2);

/**
 * Worker xuất một object thay vì mỗi `app`: `fetch` cho HTTP, `scheduled` cho cron (spec 9.4).
 * `SELF.fetch` của cloudflare:test và `wrangler dev` đều nhận dạng này.
 *
 * `scheduled` KHÔNG await chayCron mà đẩy vào `waitUntil`: Cloudflare giới hạn thời gian của
 * handler, còn từng việc bên trong đã tự bọc lỗi nên không có gì ném ra tới đây.
 */
export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      chayCron(env, ctx, controller.cron).then((baoCao) => {
        console.log(`[cron] ${controller.cron}: ${JSON.stringify(baoCao)}`);
      }),
    );
  },
};
