-- Dữ liệu tổng hợp cho integration test Places API. Cả hai fixture nghiệm thu M3
-- nằm ngoài bbox fixture Quận 1 nên seed trực tiếp, không đi qua pipeline.

INSERT INTO category (code, group_code, name_vi, name_en, icon, rank) VALUES
  ('primary_school', 'education', 'Trường tiểu học', 'Primary school', 'school', 4),
  ('cafe', 'food_drink', 'Quán cà phê', 'Cafe', 'cafe', 3)
ON CONFLICT (code) DO NOTHING;

DELETE FROM admin_area WHERE osm_relation_id IN (880000000001, 880000000002, 880000000003);
INSERT INTO admin_area (level, name, name_norm, osm_relation_id, geom) VALUES
  (4, 'Thành phố Hồ Chí Minh', 'ho chi minh', 880000000001,
    ST_Multi(ST_MakeEnvelope(106.30, 10.30, 107.10, 11.20, 4326))),
  (8, 'Phường Diên Hồng', 'dien hong', 880000000002,
    ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.6631, 10.7647), 4326), 0.01))),
  (8, 'Phường Linh Xuân', 'linh xuan', 880000000003,
    ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.77325, 10.85594), 4326), 0.01)));

DELETE FROM street WHERE osm_way_ids && ARRAY[880000000011, 880000000012]::bigint[];
INSERT INTO street (osm_way_ids, name, name_norm, ward_norm, province_norm, geom) VALUES
  ('{880000000011}', 'Nguyễn Lâm', 'nguyen lam', '{dien hong}', 'ho chi minh',
    ST_Multi(ST_GeomFromText('LINESTRING(106.6626 10.7647, 106.6636 10.7647)', 4326))),
  ('{880000000012}', 'Nguyễn Lâm', 'nguyen lam', '{}', 'ha noi',
    ST_Multi(ST_GeomFromText('LINESTRING(105.8400 21.0000, 105.8410 21.0000)', 4326)));

DELETE FROM alley WHERE osm_way_id = 880000000021;
INSERT INTO alley (osm_way_id, number, parent_street_id, name, geom, entrance)
SELECT 880000000021, '112', s.id, 'Hẻm 112 Nguyễn Lâm',
  ST_GeomFromText('LINESTRING(106.6630 10.7647, 106.6630 10.7657)', 4326),
  ST_SetSRID(ST_MakePoint(106.6630, 10.7647), 4326)
FROM street s WHERE s.name_norm = 'nguyen lam' AND s.province_norm = 'ho chi minh';

DELETE FROM address_anchor WHERE source_id LIKE 'm3test-%';
INSERT INTO address_anchor
  (housenumber, street_norm, ward_norm, province_norm, geom, source, source_id, confidence) VALUES
  ('86', 'nguyen lam', 'dien hong', 'ho chi minh',
    ST_SetSRID(ST_MakePoint(106.6629, 10.7647), 4326), 'osm', 'm3test-86', 0.9),
  ('90', 'nguyen lam', 'dien hong', 'ho chi minh',
    ST_SetSRID(ST_MakePoint(106.6633, 10.7647), 4326), 'osm', 'm3test-90', 0.9),
  ('92', 'nguyen lam', 'dien hong', 'ho chi minh',
    ST_SetSRID(ST_MakePoint(106.6635, 10.7647), 4326), 'osm', 'm3test-92', 0.9);

DELETE FROM poi WHERE id LIKE '01M3TEST%';
INSERT INTO poi (id, name, name_norm, category, geom, ward, province, address_text,
                 quality_score, popularity, status, primary_source, primary_source_id, created_by) VALUES
  ('01M3TEST0000000000000SCH01', 'Trường Tiểu học Hoàng Diệu', 'truong tieu hoc hoang dieu',
    'primary_school', ST_SetSRID(ST_MakePoint(106.77325, 10.85594), 4326),
    'Linh Xuân', 'Thành phố Hồ Chí Minh', 'Trường Tiểu học Hoàng Diệu, Linh Xuân, TP.HCM',
    80, 0.9, 'active', 'osm', 'm3test-sch1', 'pipeline'),
  ('01M3TEST0000000000000SCH02', 'Trường Tiểu học Hoàng Diệu 2', 'truong tieu hoc hoang dieu 2',
    'primary_school', ST_SetSRID(ST_MakePoint(106.79000, 10.87000), 4326),
    'Linh Trung', 'Thành phố Hồ Chí Minh', NULL, 60, 0.4, 'active', 'osm', 'm3test-sch2', 'pipeline'),
  ('01M3TEST0000000000000SCH03', 'Trường Tiểu học Hoàng Diệu 3', 'truong tieu hoc hoang dieu 3',
    'primary_school', ST_SetSRID(ST_MakePoint(106.80000, 10.88000), 4326),
    'Bình Chiểu', 'Thành phố Hồ Chí Minh', NULL, 60, 0.2, 'active', 'osm', 'm3test-sch3', 'pipeline'),
  ('01M3TEST0000000000000CAF01', 'Highlands Coffee Test', 'highlands coffee test',
    'cafe', ST_SetSRID(ST_MakePoint(106.70000, 10.77200), 4326),
    'Bến Thành', 'Thành phố Hồ Chí Minh', '1 Test, Bến Thành', 70, 0.8, 'active',
    'osm', 'm3test-caf1', 'pipeline');

DELETE FROM poi_source_link WHERE source_id LIKE 'm3test-%';
INSERT INTO poi_source_link (poi_id, source, source_id, confidence, role) VALUES
  ('01M3TEST0000000000000SCH01', 'osm', 'm3test-sch1', 1, 'primary');

INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-0000000000aa', 'M3 itest', 'internal')
ON CONFLICT (id) DO NOTHING;
INSERT INTO api_key (key, tenant_id, label, kind, scopes)
VALUES ('mlv_live_test00000000000000000000', '00000000-0000-4000-8000-0000000000aa',
        'itest server', 'server', '{places:read}')
ON CONFLICT (key) DO NOTHING;

-- M4: khoá itest nội bộ thêm edits:write; tenant free để test luồng pending/duyệt.
UPDATE api_key SET scopes = '{places:read,edits:write}'
WHERE key = 'mlv_live_test00000000000000000000';

INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-0000000000cc', 'M4 itest free', 'free')
ON CONFLICT (id) DO NOTHING;
INSERT INTO api_key (key, tenant_id, label, kind, scopes)
VALUES ('mlv_live_edit00000000000000000000', '00000000-0000-4000-8000-0000000000cc',
        'itest edits free', 'server', '{places:read,edits:write}')
ON CONFLICT (key) DO NOTHING;

-- POI quality thấp (< 60) cho test luật đồng thuận: update hours KHÔNG auto theo luật quality.
INSERT INTO poi (id, name, name_norm, category, geom, ward, province,
                 quality_score, popularity, status, primary_source, primary_source_id, created_by) VALUES
  ('01M4TEST0000000000000CON01', 'Quán Consensus', 'quan consensus', 'cafe',
    ST_SetSRID(ST_MakePoint(106.695, 10.775), 4326), 'Bến Thành', 'Thành phố Hồ Chí Minh',
    40, 0.1, 'active', 'osm', 'm4test-con1', 'pipeline')
ON CONFLICT (id) DO NOTHING;
