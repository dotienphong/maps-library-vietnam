import { ATTRIBUTION_LINKS, attributionHtml, attributionText } from '@mapslibvn/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { ApiError, errorResponse } from './errors';
import { r2 } from './routes/r2';
import { styles } from './routes/styles';
import { tiles } from './routes/tiles';

const app = new Hono<{ Bindings: Env }>();
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowHeaders: ['X-Api-Key', 'Range', 'Content-Type'],
  }),
);
app.onError((err, c) => errorResponse(c, err));
app.notFound((c) => errorResponse(c, new ApiError(404, 'not_found', 'Không có route này')));

app.get('/healthz', (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT }));
app.get('/v1/attribution', (c) =>
  c.json({ text: attributionText(), html: attributionHtml(), links: ATTRIBUTION_LINKS }, 200, {
    'cache-control': 'public, max-age=86400',
  }),
);
app.route('/', styles);
app.route('/', tiles);
app.route('/', r2);

export default app;
