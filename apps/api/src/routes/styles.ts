import { Hono } from 'hono';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { getManifest } from '../manifest';
import { isTheme, renderStyle } from '../style';

export const styles = new Hono<{ Bindings: Env }>();

styles.get('/v1/styles/:file', async (c) => {
  const theme = c.req.param('file').replace(/\.json$/, '');
  if (!isTheme(theme)) throw new ApiError(404, 'not_found', `Không có theme "${theme}"`);
  const manifest = await getManifest(c.env);
  return c.body(renderStyle(theme, manifest, c.env.TILES_BASE), 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  });
});
