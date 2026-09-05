import { describe, expect, it } from 'vitest';
import { ODBL_TABLES, copySql, exportDirFor, readmeFor } from './odbl.mjs';

describe('ODBL_TABLES', () => {
  it('đúng 6 bảng ODbL, geometry xuất WKT', () => {
    expect(ODBL_TABLES.map((t) => t.name)).toEqual([
      'src_osm_place',
      'admin_area',
      'admin_area_old',
      'admin_alias',
      'street',
      'alley',
    ]);
    expect(copySql(ODBL_TABLES[0])).toBe(
      'COPY (SELECT osm_type, osm_id, name, names, tags, ST_AsText(geom) AS geom_wkt, release FROM src_osm_place) TO STDOUT WITH (FORMAT csv, HEADER true)',
    );
    expect(copySql(ODBL_TABLES[2])).toContain('ST_AsText(geom) AS geom_wkt');
    expect(copySql(ODBL_TABLES[3])).toContain('share, source, old_area_id');
    expect(copySql(ODBL_TABLES[5])).toContain('ST_AsText(entrance) AS entrance_wkt');
  });

  it('copySql từ chối bảng không tồn tại', () => {
    expect(() => copySql(undefined)).toThrow(/table/);
  });
});

describe('exportDirFor', () => {
  it('thư mục theo ngày UTC yyyymmdd dưới base', () => {
    expect(exportDirFor(new Date('2026-09-07T01:00:00Z'), 'out/odbl')).toBe('out/odbl/20260907');
  });
});

describe('readmeFor', () => {
  it('ghi ODbL, attribution, ngày, số dòng mỗi bảng', () => {
    const md = readmeFor({
      date: '2026-09-07',
      osmRelease: '2026-08-27',
      counts: {
        src_osm_place: 228000,
        admin_area: 3400,
        admin_alias: 120,
        street: 91000,
        alley: 30000,
      },
    });
    expect(md).toContain('Open Database License (ODbL) 1.0');
    expect(md).toContain('© OpenStreetMap contributors');
    expect(md).toContain('| street | 91000 |');
    expect(md).toContain('OSM release: 2026-08-27');
  });

  it('bảng thiếu số dòng ghi 0', () => {
    expect(readmeFor({ date: '2026-09-07', osmRelease: 'không rõ', counts: {} })).toContain(
      '| alley | 0 |',
    );
  });
});
