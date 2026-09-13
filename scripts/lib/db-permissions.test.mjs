import { describe, expect, it } from 'vitest';
import { PERMISSIONS_SQL } from './db-permissions.mjs';

describe('PERMISSIONS_SQL', () => {
  it('khôi phục owner và grants bị loại khỏi backup', () => {
    expect(PERMISSIONS_SQL).toContain('ALTER TABLE poi OWNER TO pipeline');
    expect(PERMISSIONS_SQL).toContain('ALTER TABLE address_anchor OWNER TO pipeline');
    expect(PERMISSIONS_SQL).toContain('ALTER TABLE admin_area_old OWNER TO pipeline');
    expect(PERMISSIONS_SQL).toContain('ALTER SEQUENCE admin_area_old_id_seq OWNER TO pipeline');
    expect(PERMISSIONS_SQL).toContain('ALTER TABLE vn_boundary OWNER TO pipeline');
    expect(PERMISSIONS_SQL).toContain('GRANT SELECT ON category, category_map, poi');
    expect(PERMISSIONS_SQL).toContain('GRANT INSERT ON poi_edit TO api');
    expect(PERMISSIONS_SQL).toContain('GRANT SELECT, UPDATE ON poi_edit TO pipeline');
    expect(PERMISSIONS_SQL).toContain('GRANT SELECT ON tenant, api_key TO api, pipeline');
    expect(PERMISSIONS_SQL).toContain('GRANT SELECT ON admin_area, admin_area_old, admin_alias');
  });

  it('reconcile cả bảng thô osm_road_raw/osm_admin_raw — bỏ sót gây "must be owner" sau restore (13/09/2026)', () => {
    // raw-tables.mjs tạo lại hai bảng này ở mỗi lần geocode (DROP bản cũ rồi RENAME bản _new vào);
    // nếu chủ sở hữu trôi về superuser sau một lần restore, DROP bản cũ thất bại và toàn bộ
    // data:update --poi dừng giữa chừng, sau khi publish() đã ghi đè poi production.
    expect(PERMISSIONS_SQL).toContain('ALTER TABLE osm_road_raw OWNER TO pipeline');
    expect(PERMISSIONS_SQL).toContain('ALTER TABLE osm_admin_raw OWNER TO pipeline');
  });

  it('giữ hàm áp dụng edit (0006) thuộc pipeline và chỉ api được EXECUTE', () => {
    expect(PERMISSIONS_SQL).toContain(
      'ALTER FUNCTION apply_poi_edit(bigint, text, text) OWNER TO pipeline',
    );
    expect(PERMISSIONS_SQL).toContain('ALTER FUNCTION stage_poi_create(bigint) OWNER TO pipeline');
    expect(PERMISSIONS_SQL).toContain(
      'ALTER FUNCTION reject_poi_edit(bigint, text) OWNER TO pipeline',
    );
    expect(PERMISSIONS_SQL).toContain('FROM PUBLIC');
    expect(PERMISSIONS_SQL).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO api;/);
  });
});
