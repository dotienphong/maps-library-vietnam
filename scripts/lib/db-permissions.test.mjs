import { describe, expect, it } from 'vitest';
import { PERMISSIONS_SQL } from './db-permissions.mjs';

describe('PERMISSIONS_SQL', () => {
  it('khôi phục owner và grants bị loại khỏi backup', () => {
    expect(PERMISSIONS_SQL).toContain('ALTER TABLE poi OWNER TO pipeline');
    expect(PERMISSIONS_SQL).toContain('ALTER TABLE address_anchor OWNER TO pipeline');
    expect(PERMISSIONS_SQL).toContain('ALTER TABLE vn_boundary OWNER TO pipeline');
    expect(PERMISSIONS_SQL).toContain('GRANT SELECT ON category, category_map, poi');
    expect(PERMISSIONS_SQL).toContain('GRANT INSERT ON poi_edit TO api');
    expect(PERMISSIONS_SQL).toContain('GRANT SELECT, UPDATE ON poi_edit TO pipeline');
    expect(PERMISSIONS_SQL).toContain('GRANT SELECT ON tenant, api_key TO api, pipeline');
  });
});
