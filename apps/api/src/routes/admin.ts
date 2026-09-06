import { Hono } from 'hono';
import { requireAccess } from '../access';
import { invalidateCachedJson, placeCacheUrl } from '../cache';
import { getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';

const STATUSES = ['pending', 'approved', 'rejected', 'auto_approved'];

export const admin = new Hono<AppEnv>();
admin.use('/v1/admin/*', requireAccess());

admin.get('/v1/admin/edits', async (c) => {
  const status = c.req.query('status') ?? 'pending';
  if (!STATUSES.includes(status))
    throw new ApiError(400, 'invalid_request', `status phải là: ${STATUSES.join(', ')}`);
  const sql = getSql(c.env);
  try {
    const items = await sql`
      SELECT e.id::int AS id, e.poi_id, e.kind, e.changes, e.photo_url, e.note, e.status,
             e.reviewer, e.reviewed_at, e.created_at, e.tenant_id,
             p.name AS poi_name, p.status AS poi_status
      FROM poi_edit e LEFT JOIN poi p ON p.id = e.poi_id
      WHERE e.status = ${status}
      ORDER BY e.created_at DESC
      LIMIT 200`;
    return c.json({ items });
  } catch (error) {
    console.error('admin/edits', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
});

const editId = (raw: string | undefined): number => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0)
    throw new ApiError(400, 'invalid_request', 'id edit không hợp lệ');
  return id;
};

admin.post('/v1/admin/edits/:id/approve', async (c) => {
  const id = editId(c.req.param('id'));
  const reviewer = c.get('reviewer') ?? '';
  const sql = getSql(c.env);
  try {
    const [row] = await sql<{ poi_id: string | null }[]>`
      SELECT apply_poi_edit(${id}::bigint, ${reviewer}, 'approved') AS poi_id`;
    if (!row || row.poi_id === null)
      throw new ApiError(404, 'not_found', 'Edit không tồn tại hoặc không còn pending');
    await invalidateCachedJson(placeCacheUrl(row.poi_id));
    return c.json({ ok: true, poi_id: row.poi_id });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/approve', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không duyệt được edit');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
});

admin.post('/v1/admin/edits/:id/reject', async (c) => {
  const id = editId(c.req.param('id'));
  const reviewer = c.get('reviewer') ?? '';
  const sql = getSql(c.env);
  try {
    const [row] = await sql<{ ok: boolean }[]>`
      SELECT reject_poi_edit(${id}::bigint, ${reviewer}) AS ok`;
    if (!row?.ok) throw new ApiError(404, 'not_found', 'Edit không tồn tại hoặc không còn pending');
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/reject', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không từ chối được edit');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
});
