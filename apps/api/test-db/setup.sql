-- Dữ liệu tổng hợp cho integration test Places API. Cả hai fixture nghiệm thu M3
-- nằm ngoài bbox fixture Quận 1 nên seed trực tiếp, không đi qua pipeline.

INSERT INTO category (code, group_code, name_vi, name_en, icon, rank) VALUES
  ('primary_school', 'education', 'Trường tiểu học', 'Primary school', 'school', 4),
  ('cafe', 'food_drink', 'Quán cà phê', 'Cafe', 'cafe', 3)
ON CONFLICT (code) DO NOTHING;

DELETE FROM admin_area WHERE osm_relation_id IN (880000000001, 880000000002, 880000000003, 880000000004)
  OR osm_relation_id BETWEEN 880000000101 AND 880000000110;
INSERT INTO admin_area (level, name, name_norm, osm_relation_id, geom) VALUES
  (4, 'Thành phố Hồ Chí Minh', 'ho chi minh', 880000000001,
    ST_Multi(ST_MakeEnvelope(106.30, 10.30, 107.10, 11.20, 4326))),
  (8, 'Phường Diên Hồng', 'dien hong', 880000000002,
    ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.6631, 10.7647), 4326), 0.01))),
  (8, 'Phường Linh Xuân', 'linh xuan', 880000000003,
    ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.77325, 10.85594), 4326), 0.01))),
  (8, 'Phường Hòa Hưng', 'hoa hung', 880000000004,
    ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.6710, 10.7750), 4326), 0.008)));
INSERT INTO admin_area (level,name,name_norm,osm_relation_id,geom)
SELECT 8,'Phường Đích '||lpad(n::text,2,'0'),'dich '||lpad(n::text,2,'0'),880000000100+n,
  ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(106.652+n*0.002,10.752+n*0.002),4326),0.001))
FROM generate_series(1,10) n;
UPDATE admin_area child SET parent_id=province.id
FROM admin_area province
WHERE province.osm_relation_id=880000000001
  AND (child.osm_relation_id IN (880000000002,880000000003,880000000004)
    OR child.osm_relation_id BETWEEN 880000000101 AND 880000000110);

DELETE FROM admin_alias WHERE old_area_id IN (890000000001,890000000002);
DELETE FROM admin_area_old WHERE id IN (890000000001,890000000002);
INSERT INTO admin_area_old
  (id,level,name,name_norm,parent_norm,province_norm,osm_relation_id,snapshot,valid_until,geom)
VALUES
  (890000000001,6,'Quận 10','10',NULL,'ho chi minh',890000000001,
    '2025-01-02','2025-06-30',ST_Multi(ST_MakeEnvelope(106.65,10.75,106.68,10.79,4326))),
  (890000000002,8,'Phường 6','6','10','ho chi minh',890000000002,
    '2025-01-02','2025-06-30',ST_Multi(ST_MakeEnvelope(106.65,10.75,106.68,10.79,4326)));
INSERT INTO admin_alias(alias_norm,level,admin_area_id,valid_until,share,source,old_area_id)
SELECT 'quan 10 ho chi minh',6,id,'2025-06-30'::date,1,'overlay',890000000001
FROM admin_area WHERE osm_relation_id=880000000002
UNION ALL
SELECT 'quan 10',6,id,'2025-06-30'::date,1,'overlay',890000000001
FROM admin_area WHERE osm_relation_id=880000000002
UNION ALL
SELECT 'quan 10 ho chi minh',6,id,'2025-06-30'::date,1,'overlay',890000000001
FROM admin_area WHERE osm_relation_id=880000000004
UNION ALL
SELECT 'quan 10',6,id,'2025-06-30'::date,1,'overlay',890000000001
FROM admin_area WHERE osm_relation_id=880000000004
UNION ALL
SELECT 'phuong 6 quan 10 ho chi minh',8,id,'2025-06-30'::date,1,'overlay',890000000002
FROM admin_area WHERE osm_relation_id=880000000002
UNION ALL
SELECT 'phuong 6 quan 10 ho chi minh',8,id,'2025-06-30'::date,1,'overlay',890000000002
FROM admin_area WHERE osm_relation_id=880000000004
UNION ALL
SELECT 'phuong 6 quan 10',8,id,'2025-06-30'::date,1,'overlay',890000000002
FROM admin_area WHERE osm_relation_id=880000000002
UNION ALL
SELECT 'phuong 6 quan 10',8,id,'2025-06-30'::date,1,'overlay',890000000002
FROM admin_area WHERE osm_relation_id=880000000004
UNION ALL
SELECT 'phuong 6 ho chi minh',8,id,'2025-06-30'::date,1,'overlay',890000000002
FROM admin_area WHERE osm_relation_id=880000000002
UNION ALL
SELECT 'phuong 6 ho chi minh',8,id,'2025-06-30'::date,1,'overlay',890000000002
FROM admin_area WHERE osm_relation_id=880000000004
UNION ALL
SELECT 'phuong 6',8,id,'2025-06-30'::date,1,'overlay',890000000002
FROM admin_area WHERE osm_relation_id=880000000002
UNION ALL
SELECT 'phuong 6',8,id,'2025-06-30'::date,1,'overlay',890000000002
FROM admin_area WHERE osm_relation_id=880000000004;
INSERT INTO admin_alias(alias_norm,level,admin_area_id,valid_until,share,source,old_area_id)
SELECT key.alias_norm,key.level,a.id,'2025-06-30'::date,0.1,'overlay',key.old_area_id
FROM admin_area a
CROSS JOIN (VALUES
  ('quan 10 ho chi minh',6,890000000001::bigint),
  ('quan 10',6,890000000001::bigint),
  ('phuong 6 quan 10 ho chi minh',8,890000000002::bigint),
  ('phuong 6 quan 10',8,890000000002::bigint),
  ('phuong 6 ho chi minh',8,890000000002::bigint),
  ('phuong 6',8,890000000002::bigint)
) key(alias_norm,level,old_area_id)
WHERE a.osm_relation_id BETWEEN 880000000101 AND 880000000110;

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
    ST_SetSRID(ST_MakePoint(106.6635, 10.7647), 4326), 'osm', 'm3test-92', 0.9),
  ('86', 'nguyen lam', NULL, 'ho chi minh',
    ST_SetSRID(ST_MakePoint(106.9000, 10.9000), 4326), 'user', 'm3test-86-null-outside', 0.95);

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

-- R5: fixture nguồn biệt lập. Hai cụm tên dùng để kiểm cache theo cả hai thứ tự;
-- cụm reverse đặt nguồn bị tắt gần điểm hỏi hơn để bắt lỗi chỉ lọc sau LIMIT 1.
DELETE FROM poi WHERE id LIKE 'R5SOURCE%';
INSERT INTO poi (id, name, name_norm, category, geom, ward, province, address_text,
                 quality_score, popularity, status, primary_source, primary_source_id, created_by)
VALUES
  ('R5SOURCEOSM000000000000001', 'R5 Profile Alpha OSM', 'r5 profile alpha osm', 'cafe',
   ST_SetSRID(ST_MakePoint(107.00020, 11.00000), 4326), 'R5 Ward', 'R5 Province', 'R5 OSM',
   90, 0.9, 'active', 'osm', 'r5-osm', 'pipeline'),
  ('R5SOURCEOVERTURE0000000001', 'R5 Profile Alpha Overture', 'r5 profile alpha overture', 'cafe',
   ST_SetSRID(ST_MakePoint(107.00005, 11.00000), 4326), 'R5 Ward', 'R5 Province', 'R5 Overture',
   90, 0.8, 'active', 'overture', 'r5-overture', 'pipeline'),
  ('R5SOURCEFSQ000000000000001', 'R5 Profile Alpha Foursquare', 'r5 profile alpha foursquare', 'cafe',
   ST_SetSRID(ST_MakePoint(107.00030, 11.00000), 4326), 'R5 Ward', 'R5 Province', 'R5 FSQ',
   90, 0.7, 'active', 'fsq', 'r5-fsq', 'pipeline'),
  ('R5SOURCEUSER00000000000001', 'R5 Profile Alpha User', 'r5 profile alpha user', 'cafe',
   ST_SetSRID(ST_MakePoint(107.00040, 11.00000), 4326), 'R5 Ward', 'R5 Province', 'R5 User',
   90, 0.6, 'active', NULL, NULL, 'user'),
  ('R5SOURCEOSM000000000000002', 'R5 Profile Beta OSM', 'r5 profile beta osm', 'cafe',
   ST_SetSRID(ST_MakePoint(107.00020, 11.00010), 4326), 'R5 Ward', 'R5 Province', 'R5 OSM',
   90, 0.9, 'active', 'osm', 'r5-osm-beta', 'pipeline'),
  ('R5SOURCEOVERTURE0000000002', 'R5 Profile Beta Overture', 'r5 profile beta overture', 'cafe',
   ST_SetSRID(ST_MakePoint(107.00005, 11.00010), 4326), 'R5 Ward', 'R5 Province', 'R5 Overture',
   90, 0.8, 'active', 'overture', 'r5-overture-beta', 'pipeline'),
  ('R5SOURCEFSQ000000000000002', 'R5 Profile Beta Foursquare', 'r5 profile beta foursquare', 'cafe',
   ST_SetSRID(ST_MakePoint(107.00030, 11.00010), 4326), 'R5 Ward', 'R5 Province', 'R5 FSQ',
   90, 0.7, 'active', 'fsq', 'r5-fsq-beta', 'pipeline'),
  ('R5SOURCEUSER00000000000002', 'R5 Profile Beta User', 'r5 profile beta user', 'cafe',
   ST_SetSRID(ST_MakePoint(107.00040, 11.00010), 4326), 'R5 Ward', 'R5 Province', 'R5 User',
   90, 0.6, 'active', NULL, NULL, 'user');

INSERT INTO poi (id, name, name_norm, category, geom, ward, province, quality_score, popularity,
                 status, primary_source, primary_source_id, created_by, name_tsv, name_key)
VALUES
  ('R5SOURCEOVERTUREALIAS001', 'R5 Alias Quy Nhơn Commercial', 'r5 alias quy nhon commercial',
   'cafe', ST_SetSRID(ST_MakePoint(107.001, 11.001), 4326), 'R5 Ward', 'R5 Province', 90, 0.8,
   'active', 'overture', 'r5-alias-commercial', 'pipeline', NULL, NULL),
  ('R5SOURCEUSERALIAS0000001', 'R5 Alias Quy Nhơn User', 'r5 alias quy nhon user',
   'cafe', ST_SetSRID(ST_MakePoint(107.002, 11.001), 4326), 'R5 Ward', 'R5 Province', 90, 0.7,
   'active', NULL, NULL, 'user', NULL, NULL),
  ('R5SOURCEOVERTURETOKEN001', 'R5 Token Commercial', 'zzqq vvxx commercial',
   'cafe', ST_SetSRID(ST_MakePoint(107.001, 11.002), 4326), 'R5 Ward', 'R5 Province', 90, 0.8,
   'active', 'overture', 'r5-token-commercial', 'pipeline', to_tsvector('simple', 'r5 token branch'), NULL),
  ('R5SOURCEUSERTOKEN0000001', 'R5 Token User', 'zzqq vvxx user',
   'cafe', ST_SetSRID(ST_MakePoint(107.002, 11.002), 4326), 'R5 Ward', 'R5 Province', 90, 0.7,
   'active', NULL, NULL, 'user', to_tsvector('simple', 'r5 token branch'), NULL),
  ('R5SOURCEOVERTUREKEY00001', 'R5 Key Commercial', 'wwqq zzxx commercial',
   'cafe', ST_SetSRID(ST_MakePoint(107.001, 11.003), 4326), 'R5 Ward', 'R5 Province', 90, 0.8,
   'active', 'overture', 'r5-key-commercial', 'pipeline', NULL, 'r5canbien'),
  ('R5SOURCEUSERKEY000000001', 'R5 Key User', 'wwqq zzxx user',
   'cafe', ST_SetSRID(ST_MakePoint(107.002, 11.003), 4326), 'R5 Ward', 'R5 Province', 90, 0.7,
   'active', NULL, NULL, 'user', NULL, 'r5canbien'),
  ('R5SOURCEOVERTURETELEX001', 'Thư Viện Quốc Gia Commercial', 'thu vien quoc gia commercial',
   'cafe', ST_SetSRID(ST_MakePoint(107.001, 11.004), 4326), 'R5 Ward', 'R5 Province', 90, 0.8,
   'active', 'overture', 'r5-telex-commercial', 'pipeline', NULL, NULL),
  ('R5SOURCEUSERTELEX0000001', 'Thư Viện Quốc Gia User', 'thu vien quoc gia user',
   'cafe', ST_SetSRID(ST_MakePoint(107.002, 11.004), 4326), 'R5 Ward', 'R5 Province', 90, 0.7,
   'active', NULL, NULL, 'user', NULL, NULL);

INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-0000000000aa', 'M3 itest', 'internal')
ON CONFLICT (id) DO NOTHING;
INSERT INTO api_key (key_hash, key_prefix, tenant_id, label, kind, scopes)
VALUES (encode(sha256(convert_to('mlv_live_test00000000000000000000', 'UTF8')), 'hex'), 'mlv_live_test0000', '00000000-0000-4000-8000-0000000000aa',
        'itest server', 'server', '{places:read}')
ON CONFLICT (key_hash) DO NOTHING;

-- M4: khoá itest nội bộ thêm edits:write; tenant free để test luồng pending/duyệt.
UPDATE api_key SET scopes = '{places:read,edits:write}'
WHERE key_hash = encode(sha256(convert_to('mlv_live_test00000000000000000000', 'UTF8')), 'hex');

INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-0000000000cc', 'M4 itest free', 'free')
ON CONFLICT (id) DO NOTHING;
INSERT INTO api_key (key_hash, key_prefix, tenant_id, label, kind, scopes)
VALUES (encode(sha256(convert_to('mlv_live_edit00000000000000000000', 'UTF8')), 'hex'), 'mlv_live_edit0000', '00000000-0000-4000-8000-0000000000cc',
        'itest edits free', 'server', '{places:read,edits:write}')
ON CONFLICT (key_hash) DO NOTHING;

-- Tenant free thứ hai: đồng thuận chỉ tính phiếu từ TENANT KHÁC (audit 09/09/2026).
INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-0000000000dd', 'M4 itest free 2', 'free')
ON CONFLICT (id) DO NOTHING;
INSERT INTO api_key (key_hash, key_prefix, tenant_id, label, kind, scopes)
VALUES (encode(sha256(convert_to('mlv_live_edit20000000000000000000', 'UTF8')), 'hex'), 'mlv_live_edit2000',
        '00000000-0000-4000-8000-0000000000dd', 'itest edits free 2', 'server', '{places:read,edits:write}')
ON CONFLICT (key_hash) DO NOTHING;

-- POI quality thấp (< 60) cho test luật đồng thuận: update hours KHÔNG auto theo luật quality.
INSERT INTO poi (id, name, name_norm, category, geom, ward, province,
                 quality_score, popularity, status, primary_source, primary_source_id, created_by) VALUES
  ('01M4TEST0000000000000CON01', 'Quán Consensus', 'quan consensus', 'cafe',
    ST_SetSRID(ST_MakePoint(106.695, 10.775), 4326), 'Bến Thành', 'Thành phố Hồ Chí Minh',
    40, 0.1, 'active', 'osm', 'm4test-con1', 'pipeline')
ON CONFLICT (id) DO NOTHING;

-- Hạng mục 3 (spec 05/09 mục 6, 8). Ba lớp dòng:
--  (a) t3-poi-null: cột dẫn xuất NULL — mô phỏng dữ liệu chưa backfill; phải KHÔNG gây 5xx và vẫn
--      tìm được ở bậc 1 qua nhánh qAlias.
--  (b) t3-street-alt (Nam Kỳ Khởi Nghĩa): có name_alt, chưa backfill — itest gọi backfill rồi kiểm
--      matched_alt.
--  (c) t3-poi-key / t3-street-tsv: name_norm VÔ NGHĨA nên bậc 1 chắc chắn rỗng, còn name_key/
--      name_tsv ĐẶT TAY đúng giá trị đích — đây là cách duy nhất chứng minh cơ chế bậc 3 / bậc 2
--      chạy thật, vì word_similarity của pg_trgm khoan dung tới mức gần như mọi truy vấn nhiều từ
--      đều trúng ngay bậc 1. Backfill trong itest chạy KHÔNG --all nên các dòng đặt tay giữ nguyên.
INSERT INTO poi (id, name, name_norm, category, geom, ward, province, status, created_by,
                 primary_source, primary_source_id, quality_score, popularity)
VALUES
  ('t3-poi-null', 'Quán Qui Nhơn Chưa Backfill', 'quan qui nhon chua backfill', 'cafe',
    ST_SetSRID(ST_MakePoint(106.700, 10.776), 4326), 'Phường Sài Gòn', 'Thành phố Hồ Chí Minh',
    'active', 'pipeline', 'osm', 't3-1', 70, 0.5),
  ('t3-poi-key', 'Hẻm Vô Nghĩa Bậc Ba', 'zqxv kkkq', 'cafe',
    ST_SetSRID(ST_MakePoint(106.701, 10.777), 4326), 'Phường Sài Gòn', 'Thành phố Hồ Chí Minh',
    'active', 'pipeline', 'osm', 't3-2', 70, 0.5)
ON CONFLICT (id) DO NOTHING;
-- viKey('chan bien') = 'canbien' (ch→c ở đầu từ, 'bien' giữ nguyên).
UPDATE poi SET name_key = 'canbien' WHERE id = 't3-poi-key';

-- (d) t3-poi-alt: name_norm VÔ NGHĨA nên không nhánh nào của bậc 1 khớp được, chỉ còn đường qua
-- name_alt_norm. Đây là ca duy nhất chứng minh nhánh name_alt_norm của /v1/search: route search
-- dựng SQL ngay trong handler nên không có hàm thuần để test bằng fakeSql.
INSERT INTO poi (id, name, name_norm, name_alt, category, geom, ward, province, status, created_by,
                 primary_source, primary_source_id, quality_score, popularity)
VALUES
  ('t3-poi-alt', 'Quán Tên Chính Vô Nghĩa', 'zzzk vvvq', ARRAY['Chợ Cũ Sài Gòn'], 'cafe',
    ST_SetSRID(ST_MakePoint(106.702, 10.778), 4326), 'Phường Sài Gòn', 'Thành phố Hồ Chí Minh',
    'active', 'pipeline', 'osm', 't3-3', 70, 0.5)
ON CONFLICT (id) DO NOTHING;

DELETE FROM street WHERE osm_way_ids && '{930001,930002}';
INSERT INTO street (osm_way_ids, name, name_norm, name_alt, province_norm, geom) VALUES
  ('{930001}', 'Nam Kỳ Khởi Nghĩa', 'nam ky khoi nghia', '{"Công Lý"}', 'ho chi minh',
    ST_Multi(ST_GeomFromText('LINESTRING(106.690 10.780,106.695 10.790)', 4326))),
  ('{930002}', 'Đường Vô Nghĩa Bậc Hai', 'wwqq zzxx', '{}', 'ho chi minh',
    ST_Multi(ST_GeomFromText('LINESTRING(106.680 10.780,106.685 10.790)', 4326)));
-- Bậc 2 khớp qua name_tsv đặt tay; name_norm vô nghĩa để bậc 1 rỗng.
UPDATE street SET name_tsv = to_tsvector('simple', 'khoi nghia bac hai') WHERE name_norm = 'wwqq zzxx';
