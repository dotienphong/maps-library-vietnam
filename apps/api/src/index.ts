import { ATTRIBUTION_LINKS, attributionHtml, attributionText } from '@mapslibvn/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { analyticsMiddleware } from './analytics';
import { getSql } from './db';
import type { AppEnv } from './env';
import { ApiError, errorResponse } from './errors';
import { autocomplete } from './routes/autocomplete';
import { edits } from './routes/edits';
import { geocodeRoute } from './routes/geocode';
import { nearby } from './routes/nearby';
import { places } from './routes/places';
import { r2 } from './routes/r2';
import { reverse } from './routes/reverse';
import { search } from './routes/search';
import { styles } from './routes/styles';
import { tiles } from './routes/tiles';

const app = new Hono<AppEnv>();
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowHeaders: ['X-Api-Key', 'Range', 'Content-Type'],
  }),
);
app.use('/v1/*', analyticsMiddleware());
app.onError((err, c) => errorResponse(c, err));
app.notFound((c) => errorResponse(c, new ApiError(404, 'not_found', 'Không có route này')));

app.get('/healthz', (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT }));
app.get('/healthz/db', async (c) => {
  const sql = getSql(c.env);
  try {
    const [row] = await sql<
      { ok: number; user: string; version: string }[]
    >`SELECT 1 AS ok, current_user AS "user", version() AS version`;
    return c.json({
      ok: row?.ok === 1,
      user: row?.user,
      version: row?.version.split(' ').slice(0, 2).join(' '),
    });
  } catch (err) {
    console.error('healthz/db', err);
    throw new ApiError(503, 'upstream_unavailable', 'Không nối được DB');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
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
app.route('/', edits);
app.route('/', styles);
app.route('/', tiles);
app.route('/', r2);

export default app;
