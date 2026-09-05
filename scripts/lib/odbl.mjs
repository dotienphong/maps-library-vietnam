// Bảng Derivative Database của OSM (spec 12.2) và cách xuất chúng theo ODbL.
/** @typedef {{ name: string, columns: string[] }} OdblTable */

/** @type {OdblTable[]} */
export const ODBL_TABLES = [
  {
    name: 'src_osm_place',
    columns: [
      'osm_type',
      'osm_id',
      'name',
      'names',
      'tags',
      'ST_AsText(geom) AS geom_wkt',
      'release',
    ],
  },
  {
    name: 'admin_area',
    columns: [
      'id',
      'level',
      'name',
      'name_norm',
      'parent_id',
      'osm_relation_id',
      'ST_AsText(geom) AS geom_wkt',
    ],
  },
  {
    name: 'admin_area_old',
    columns: [
      'id',
      'level',
      'name',
      'name_norm',
      'parent_norm',
      'province_norm',
      'osm_relation_id',
      'snapshot',
      'valid_until',
      'ST_AsText(geom) AS geom_wkt',
    ],
  },
  {
    name: 'admin_alias',
    columns: [
      'alias_norm',
      'level',
      'admin_area_id',
      'valid_until',
      'share',
      'source',
      'old_area_id',
    ],
  },
  {
    name: 'street',
    columns: [
      'id',
      'osm_way_ids',
      'name',
      'name_norm',
      'ward_norm',
      'province_norm',
      'ST_AsText(geom) AS geom_wkt',
    ],
  },
  {
    name: 'alley',
    columns: [
      'id',
      'osm_way_id',
      'number',
      'parent_street_id',
      'name',
      'ST_AsText(geom) AS geom_wkt',
      'ST_AsText(entrance) AS entrance_wkt',
    ],
  },
];

/** @param {OdblTable | undefined} table */
export function copySql(table) {
  if (!table) throw new Error('copySql: table undefined');
  return `COPY (SELECT ${table.columns.join(', ')} FROM ${table.name}) TO STDOUT WITH (FORMAT csv, HEADER true)`;
}

/** @param {Date} now @param {string} base */
export function exportDirFor(now, base) {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `${base}/${d}`;
}

/**
 * @param {{ date: string, osmRelease: string, counts: Record<string, number> }} info
 */
export function readmeFor({ date, osmRelease, counts }) {
  const rows = ODBL_TABLES.map((t) => `| ${t.name} | ${counts[t.name] ?? 0} |`).join('\n');
  return `# MapsLibVN — bản xuất dữ liệu dẫn xuất OpenStreetMap

Ngày xuất: ${date} · OSM release: ${osmRelease}

Các bảng trong thư mục này là **Derivative Database** của OpenStreetMap và được cung cấp theo
**Open Database License (ODbL) 1.0** — https://opendatacommons.org/licenses/odbl/1-0/
Ghi nguồn bắt buộc: **© OpenStreetMap contributors** — https://www.openstreetmap.org/copyright

Định dạng: CSV nén gzip, dòng đầu là tên cột; geometry ở dạng WKT (EPSG:4326).
\`manifest.json\` ghi số dòng và SHA-256 từng file.

| Bảng | Số dòng |
|---|---|
${rows}

Không nằm trong bản xuất này (không phải dẫn xuất OSM hoặc là dữ liệu riêng): \`poi\`,
\`poi_source_link\`, \`address_anchor\`, \`src_overture_place\` (CDLA-Permissive 2.0),
\`src_fsq_place\` (Apache-2.0), \`poi_edit\`.
`;
}
