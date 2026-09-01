-- M4 đóng góp: cột audit/đếm cho poi_edit + hàm áp dụng edit.
-- Nguyên tắc quyền (spec 9): user api KHÔNG có UPDATE/INSERT trên poi — mọi ghi đi qua
-- hàm SECURITY DEFINER owner pipeline dưới đây.
ALTER TABLE poi_edit ADD COLUMN IF NOT EXISTS api_key text;      -- key gửi edit: audit + đếm 500/ngày/key
ALTER TABLE poi_edit ADD COLUMN IF NOT EXISTS new_poi_id text;   -- ULID cho kind='create' (poi_id có FK nên gán sau stage)

CREATE INDEX IF NOT EXISTS poi_edit_user_day_idx ON poi_edit (tenant_id, end_user_hash, created_at);
CREATE INDEX IF NOT EXISTS poi_edit_key_day_idx  ON poi_edit (api_key, created_at);
CREATE INDEX IF NOT EXISTS poi_edit_new_poi_idx  ON poi_edit (new_poi_id);

-- kind='create': tạo POI status='pending' ngay khi nhận edit (spec 6.5). Trả poi_id, NULL nếu đã stage/không hợp lệ.
CREATE OR REPLACE FUNCTION stage_poi_create(p_edit_id bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e poi_edit%ROWTYPE;
BEGIN
  SELECT * INTO e FROM poi_edit WHERE id = p_edit_id FOR UPDATE;
  IF NOT FOUND OR e.kind <> 'create' OR e.new_poi_id IS NULL OR e.poi_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO poi (id, name, name_norm, category, geom, housenumber, street, ward, province,
                   address_text, contact, hours, quality_score, popularity, status, locked_fields, created_by)
  VALUES (e.new_poi_id, e.changes->>'name', e.changes->>'name_norm', e.changes->>'category',
          ST_SetSRID(ST_MakePoint((e.changes->>'lng')::float8, (e.changes->>'lat')::float8), 4326),
          e.changes->>'housenumber', e.changes->>'street', e.changes->>'ward', e.changes->>'province',
          e.changes->>'address_text', e.changes->'contact', e.changes->'hours',
          60, 0.2, 'pending', '{}', 'user');
  UPDATE poi_edit SET poi_id = e.new_poi_id WHERE id = p_edit_id;
  RETURN e.new_poi_id;
END $$;

-- Áp dụng edit pending (duyệt tay hoặc auto): cập nhật poi, khoá trường đã đổi,
-- tạo address_anchor khi có số nhà (spec 5.7, confidence 0,95), duyệt luôn phiếu trùng.
-- Trả poi_id; NULL nếu edit không tồn tại hoặc không còn pending.
CREATE OR REPLACE FUNCTION apply_poi_edit(p_edit_id bigint, p_reviewer text, p_status text DEFAULT 'approved')
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e poi_edit%ROWTYPE;
  locked text[];
BEGIN
  IF p_status NOT IN ('approved', 'auto_approved') THEN
    RAISE EXCEPTION 'p_status không hợp lệ: %', p_status;
  END IF;
  SELECT * INTO e FROM poi_edit WHERE id = p_edit_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Cột poi bị đổi → khoá (lat/lng gộp thành geom; *_norm của địa chỉ không phải cột poi).
  SELECT COALESCE(array_agg(DISTINCT CASE WHEN k IN ('lat', 'lng') THEN 'geom' ELSE k END), '{}')
    INTO locked
    FROM jsonb_object_keys(COALESCE(e.changes, '{}'::jsonb)) AS k
   WHERE k NOT IN ('street_norm', 'ward_norm', 'province_norm');

  IF e.kind = 'create' THEN
    IF e.poi_id IS NULL THEN
      PERFORM stage_poi_create(p_edit_id);
      SELECT * INTO e FROM poi_edit WHERE id = p_edit_id;
    END IF;
    UPDATE poi SET status = 'active', locked_fields = locked, updated_at = now() WHERE id = e.poi_id;
  ELSIF e.kind IN ('update', 'close', 'reopen') THEN
    UPDATE poi SET
      name          = COALESCE(e.changes->>'name', name),
      name_norm     = COALESCE(e.changes->>'name_norm', name_norm),
      category      = COALESCE(e.changes->>'category', category),
      geom          = CASE WHEN e.changes ? 'lat'
                           THEN ST_SetSRID(ST_MakePoint((e.changes->>'lng')::float8, (e.changes->>'lat')::float8), 4326)
                           ELSE geom END,
      housenumber   = COALESCE(e.changes->>'housenumber', housenumber),
      street        = COALESCE(e.changes->>'street', street),
      ward          = COALESCE(e.changes->>'ward', ward),
      province      = COALESCE(e.changes->>'province', province),
      address_text  = COALESCE(e.changes->>'address_text', address_text),
      contact       = COALESCE(e.changes->'contact', contact),
      hours         = COALESCE(e.changes->'hours', hours),
      status        = CASE e.kind WHEN 'close' THEN 'closed' WHEN 'reopen' THEN 'active' ELSE status END,
      locked_fields = (SELECT COALESCE(array_agg(DISTINCT f), '{}')
                       FROM unnest(locked_fields || locked
                                   || CASE WHEN e.kind IN ('close', 'reopen') THEN '{status}'::text[] ELSE '{}'::text[] END) AS f),
      updated_at    = now()
    WHERE id = e.poi_id;
  END IF;
  -- kind='report': không đổi poi, chỉ ghi nhận trạng thái duyệt bên dưới.

  IF e.changes ? 'housenumber' AND e.changes ? 'street_norm' THEN
    DELETE FROM address_anchor WHERE source = 'user' AND source_id = 'edit-' || p_edit_id;
    INSERT INTO address_anchor (housenumber, street_norm, ward_norm, province_norm, geom, source, source_id, confidence)
    SELECT e.changes->>'housenumber', e.changes->>'street_norm', e.changes->>'ward_norm', e.changes->>'province_norm',
           p.geom, 'user', 'edit-' || p_edit_id, 0.95
    FROM poi p WHERE p.id = e.poi_id;
  END IF;

  UPDATE poi_edit SET status = p_status, reviewer = p_reviewer, reviewed_at = now() WHERE id = p_edit_id;
  -- Phiếu trùng (spec 6.5): các edit pending giống hệt được duyệt cùng lúc.
  UPDATE poi_edit SET status = 'auto_approved', reviewer = 'auto:consensus', reviewed_at = now()
   WHERE id <> p_edit_id AND status = 'pending' AND poi_id = e.poi_id
     AND kind = e.kind AND changes = e.changes;
  RETURN e.poi_id;
END $$;

-- Từ chối edit pending; kind='create' thì POI pending kèm theo → 'rejected'. Trả false nếu không còn pending.
CREATE OR REPLACE FUNCTION reject_poi_edit(p_edit_id bigint, p_reviewer text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e poi_edit%ROWTYPE;
BEGIN
  SELECT * INTO e FROM poi_edit WHERE id = p_edit_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF e.kind = 'create' AND e.poi_id IS NOT NULL THEN
    UPDATE poi SET status = 'rejected', updated_at = now() WHERE id = e.poi_id AND status = 'pending';
  END IF;
  UPDATE poi_edit SET status = 'rejected', reviewer = p_reviewer, reviewed_at = now() WHERE id = p_edit_id;
  RETURN true;
END $$;

ALTER FUNCTION stage_poi_create(bigint) OWNER TO pipeline;
ALTER FUNCTION apply_poi_edit(bigint, text, text) OWNER TO pipeline;
ALTER FUNCTION reject_poi_edit(bigint, text) OWNER TO pipeline;
-- Hàm SECURITY DEFINER mặc định EXECUTE cho PUBLIC — thu hồi rồi cấp đích danh.
REVOKE ALL ON FUNCTION stage_poi_create(bigint), apply_poi_edit(bigint, text, text),
  reject_poi_edit(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION stage_poi_create(bigint), apply_poi_edit(bigint, text, text),
  reject_poi_edit(bigint, text) TO api;
