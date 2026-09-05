DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM admin_alias
    GROUP BY alias_norm, level
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '0008 down từ chối: admin_alias đang có quan hệ một-nhiều';
  END IF;
END $$;

ALTER TABLE admin_alias DROP CONSTRAINT admin_alias_pkey;
DROP INDEX IF EXISTS admin_alias_admin_area_idx;
DROP INDEX IF EXISTS admin_alias_old_area_idx;
DROP INDEX IF EXISTS admin_alias_trgm_idx;
DROP INDEX IF EXISTS admin_alias_prefix_idx;
DROP INDEX IF EXISTS admin_area_name_trgm_idx;
DROP INDEX IF EXISTS admin_area_name_prefix_idx;
ALTER TABLE admin_alias DROP COLUMN old_area_id, DROP COLUMN source, DROP COLUMN share;
ALTER TABLE admin_alias ADD PRIMARY KEY (alias_norm, level);
DROP TABLE admin_area_old;
