-- Gỡ nguồn Overture (13/09/2026, plan docs/superpowers/plans/2026-09-13-go-bo-overture.md).
-- Dòng poi có primary_source='overture' do pipeline publish rebuild ngay sau migration (records → conflate → publish --force).
-- Phải DELETE dòng source='overture' trước khi ADD CONSTRAINT mới, nếu không ADD sẽ lỗi
-- (production 13/09: category_map 380, poi_source_link 1.186.791, address_anchor 780.316 dòng).
DROP TABLE IF EXISTS src_overture_place;
DELETE FROM category_map WHERE source = 'overture';
DELETE FROM poi_source_link WHERE source = 'overture';
DELETE FROM address_anchor WHERE source = 'overture';
ALTER TABLE category_map DROP CONSTRAINT IF EXISTS category_map_source_check;
ALTER TABLE category_map ADD CONSTRAINT category_map_source_check CHECK (source IN ('osm', 'fsq'));
ALTER TABLE poi_source_link DROP CONSTRAINT IF EXISTS poi_source_link_source_check;
ALTER TABLE poi_source_link ADD CONSTRAINT poi_source_link_source_check CHECK (source IN ('osm', 'fsq'));
ALTER TABLE address_anchor DROP CONSTRAINT IF EXISTS address_anchor_source_check;
ALTER TABLE address_anchor ADD CONSTRAINT address_anchor_source_check CHECK (source IN ('osm', 'fsq', 'user'));
