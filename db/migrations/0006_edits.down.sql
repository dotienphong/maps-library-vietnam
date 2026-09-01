DROP FUNCTION IF EXISTS reject_poi_edit(bigint, text);
DROP FUNCTION IF EXISTS apply_poi_edit(bigint, text, text);
DROP FUNCTION IF EXISTS stage_poi_create(bigint);
DROP INDEX IF EXISTS poi_edit_new_poi_idx;
DROP INDEX IF EXISTS poi_edit_key_day_idx;
DROP INDEX IF EXISTS poi_edit_user_day_idx;
ALTER TABLE poi_edit DROP COLUMN IF EXISTS new_poi_id;
ALTER TABLE poi_edit DROP COLUMN IF EXISTS api_key;
