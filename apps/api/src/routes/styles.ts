import { POI_SOURCE_PROFILES, profileForSources } from '@mapslibvn/core';
import { Hono } from 'hono';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { getManifest } from '../manifest';
import { parseSources } from '../params';
import { isTheme, renderStyle } from '../style';

export const styles = new Hono<{ Bindings: Env }>();

styles.get('/v1/styles/:file', async (c) => {
  const theme = c.req.param('file').replace(/\.json$/, '');
  if (!isTheme(theme)) throw new ApiError(404, 'not_found', `Không có theme "${theme}"`);
  const sources = parseSources(c.req.query('sources'));
  const profile = profileForSources(sources);
  if (!profile) {
    const available = Object.values(POI_SOURCE_PROFILES)
      .map((list) => list.join(','))
      .join(' | ');
    throw new ApiError(
      400,
      'invalid_request',
      `Chưa có bộ tiles cho sources=${sources.join(',')}; hiện hỗ trợ: ${available}`,
    );
  }
  const manifest = await getManifest(c.env);
  const rendered = renderStyle(theme, manifest, c.env.TILES_BASE, profile);
  return c.body(rendered.body, 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'x-poi-profile': rendered.profileHeader,
  });
});
