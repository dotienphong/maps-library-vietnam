import { ATTRIBUTION_LINKS, attributionHtml, attributionText } from '@mapslibvn/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireBillingAccess } from './access';
import { analyticsMiddleware } from './analytics';
import { endSql, getSql } from './db';
import type { AppEnv } from './env';
import { ApiError, errorResponse } from './errors';
import { admin } from './routes/admin';
import { autocomplete } from './routes/autocomplete';
import { billingAdmin } from './routes/billing-admin';
import { directions } from './routes/directions';
import { edits } from './routes/edits';
import { geocodeRoute } from './routes/geocode';
import { nearby } from './routes/nearby';
import { places } from './routes/places';
import { quotaReceipts } from './routes/quota-receipts';
import { r2 } from './routes/r2';
import { reverse } from './routes/reverse';
import { search } from './routes/search';
import { styles } from './routes/styles';
import { tiles } from './routes/tiles';

export { QuotaObject } from './billing/quota-object';

const app = new Hono<AppEnv>();
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
app.notFound((c) => errorResponse(c, new ApiError(404, 'not_found', 'Không có route này')));

app.get('/healthz', (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT }));
app.use('/v1/admin/billing/*', requireBillingAccess());
app.route('/', billingAdmin());
app.get('/healthz/db', async (c) => {
  const sql = getSql(c.env);
  try {
    // current_setting(…, true) trả NULL thay vì ném khi GUC chưa có: API deploy được trước khi
    // migration 0007 áp lên máy chủ mà /healthz/db không rơi xuống 503.
    const [row] = await sql<
      { ok: number; user: string; version: string; wst: string | null }[]
    >`SELECT 1 AS ok, current_user AS "user", version() AS version,
        current_setting('pg_trgm.word_similarity_threshold', true) AS wst`;
    // Phiên bản schema để phát hiện lệch giữa Worker đã deploy và DB. 06/09/2026: Worker mang code
    // đọc admin_area_old/admin_alias.old_area_id được deploy trước migration 0008, làm
    // /v1/autocomplete mặc định 503 suốt nhiều giờ mà /healthz/db vẫn 200. Postgres phân giải quan
    // hệ ngay lúc parse nên không lồng được vào câu trên: phải truy vấn riêng và nuốt lỗi.
    let schemaMigration: string | null = null;
    try {
      const [migration] = await sql<{ name: string | null }[]>`
        SELECT max(name) AS name FROM schema_migrations`;
      schemaMigration = migration?.name ?? null;
    } catch {
      schemaMigration = null;
    }
    return c.json({
      ok: row?.ok === 1,
      user: row?.user,
      version: row?.version.split(' ').slice(0, 2).join(' '),
      word_similarity_threshold: row?.wst == null ? null : Number(row.wst),
      schema_migration: schemaMigration,
    });
  } catch (err) {
    console.error('healthz/db', err);
    throw new ApiError(503, 'upstream_unavailable', 'Không nối được DB');
  } finally {
    endSql(c.executionCtx, sql);
  }
});
app.get('/v1/attribution', (c) =>
  c.json({ text: attributionText(), html: attributionHtml(), links: ATTRIBUTION_LINKS }, 200, {
    'cache-control': 'public, max-age=86400',
  }),
);
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

export default app;
