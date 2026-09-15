import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { invalidateCachedJson, placeCacheUrl } from '../cache';
import { getSql } from '../db';
import { endUserHash, ipHash, requirePepper } from '../edits/hash';
import { EDITS_PER_KEY_PER_DAY, EDITS_PER_USER_PER_DAY, decideStatus } from '../edits/rules';
import { ulid } from '../edits/ulid';
import { validateEditBody } from '../edits/validate';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { secondsUntilVnDayReset, vnDay, vnDayStartUtc } from '../quota';

export const edits = new Hono<AppEnv>();

edits.post('/v1/edits', requireAuth('edits:write'), async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'invalid_request', 'Body phải là JSON');
  }
  const edit = validateEditBody(raw);
  const auth = c.get('auth');
  if (!auth) throw new ApiError(401, 'missing_key', 'Thiếu auth'); // không xảy ra sau requireAuth
  const pepper = requirePepper(c.env);
  const userHash = await endUserHash(auth.tenantId, edit.endUserToken, pepper);
  const ipH = await ipHash(c.req.header('CF-Connecting-IP') ?? '', vnDay(), pepper);

  const sql = getSql(c.env);
  // Phải dùng sql.json(): truyền chuỗi đã JSON.stringify kèm cast ::jsonb khiến porsager
  // stringify lần nữa và ghi ra jsonb *string*, làm apply_poi_edit vỡ ở jsonb_object_keys.
  const changesParam = sql.json(edit.changes);
  try {
    // 1) POI đích phải tồn tại và ở trạng thái phù hợp (kind ≠ create).
    let quality: number | null = null;
    if (edit.kind !== 'create') {
      const [poi] = await sql<{ status: string; quality_score: number | null }[]>`
        SELECT status, quality_score FROM poi WHERE id = ${edit.poiId}`;
      if (!poi) throw new ApiError(404, 'not_found', 'Không có POI này');
      if ((edit.kind === 'update' || edit.kind === 'close') && poi.status !== 'active')
        throw new ApiError(400, 'invalid_request', 'POI không ở trạng thái active');
      if (edit.kind === 'reopen' && poi.status !== 'closed')
        throw new ApiError(400, 'invalid_request', 'POI không ở trạng thái closed');
      quality = poi.quality_score;
    }
    if (typeof edit.changes.category === 'string') {
      const [cat] = await sql<{ ok: number }[]>`
        SELECT 1 AS ok FROM category WHERE code = ${edit.changes.category}`;
      if (!cat) throw new ApiError(400, 'invalid_request', 'category không tồn tại');
    }

    // 2) Giới hạn 20/ngày/end-user + 500/ngày/key (spec 6.5) — đếm SQL theo ngày VN.
    const dayStart = vnDayStartUtc();
    const [counts] = await sql<{ by_user: number; by_key: number }[]>`
      SELECT count(*) FILTER (WHERE end_user_hash = ${userHash})::int AS by_user,
             count(*) FILTER (WHERE api_key = ${auth.keyHash})::int   AS by_key
      FROM poi_edit
      WHERE tenant_id = ${auth.tenantId} AND created_at >= ${dayStart}`;
    if (
      (counts?.by_user ?? 0) >= EDITS_PER_USER_PER_DAY ||
      (counts?.by_key ?? 0) >= EDITS_PER_KEY_PER_DAY
    ) {
      throw new ApiError(
        429,
        'quota_exceeded',
        'Vượt giới hạn edit theo ngày',
        secondsUntilVnDayReset(),
      );
    }

    // 3) Phiếu trùng trong 30 ngày (spec 6.5) — đẳng thức jsonb. Audit 09/09/2026: `end_user_token`
    // do client tự đặt nên hai "người dùng" cùng tenant có thể là một kẻ với hai token; đồng thuận
    // chỉ tính phiếu từ TENANT KHÁC (khoá khác, khách khác) — điều kẻ cầm một khoá không giả được.
    let consensusUsers = 1;
    if (edit.kind !== 'create' && edit.kind !== 'report') {
      const [dup] = await sql<{ n: number }[]>`
        SELECT count(DISTINCT end_user_hash)::int AS n FROM poi_edit
        WHERE poi_id = ${edit.poiId} AND kind = ${edit.kind} AND status = 'pending'
          AND changes = ${changesParam}
          AND tenant_id <> ${auth.tenantId} AND created_at > now() - interval '30 days'`;
      consensusUsers = 1 + (dup?.n ?? 0);
    }

    const newPoiId = edit.kind === 'create' ? ulid() : null;
    // id::int — bigserial về dạng string qua porsager; ::int để edit_id là số trong JSON.
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO poi_edit (poi_id, tenant_id, end_user_hash, kind, changes, photo_url, note,
                            status, ip_hash, api_key, new_poi_id)
      VALUES (${edit.poiId}, ${auth.tenantId}, ${userHash}, ${edit.kind}, ${changesParam},
              ${edit.photoUrl}, ${edit.note}, 'pending', ${ipH}, ${auth.keyHash}, ${newPoiId})
      RETURNING id::int AS id`;
    if (!row) throw new ApiError(503, 'upstream_unavailable', 'Không ghi được edit');
    if (edit.kind === 'create') await sql`SELECT stage_poi_create(${row.id}::bigint)`;

    const changedFields = Object.keys(edit.changes).filter((f) => !f.endsWith('_norm'));
    const status = decideStatus({
      plan: auth.plan,
      kind: edit.kind,
      changedFields,
      qualityScore: quality,
      consensusUsers,
    });
    let poiId = edit.poiId ?? newPoiId;
    if (status === 'auto_approved') {
      const reason =
        auth.plan === 'internal'
          ? 'auto:internal'
          : consensusUsers > 1
            ? 'auto:consensus'
            : 'auto:rule';
      const [applied] = await sql<{ poi_id: string | null }[]>`
        SELECT apply_poi_edit(${row.id}::bigint, ${reason}, 'auto_approved') AS poi_id`;
      poiId = applied?.poi_id ?? poiId;
      if (poiId) await invalidateCachedJson(placeCacheUrl(poiId));
    }
    return c.json({ edit_id: row.id, status, poi_id: poiId });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('edits', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không ghi được edit');
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
});
