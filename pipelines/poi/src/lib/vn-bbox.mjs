/** Bbox lọc sơ bộ Overture/FSQ: đất liền + Phú Quốc + Côn Đảo. Hoàng Sa/Trường Sa (lon > 111) cố ý nằm ngoài —
 *  POI thương mại ở hai quần đảo không nhận từ nguồn nước ngoài; tên đảo lấy từ OSM đã patch (spec 4.3). */
export const VN_BBOX = /** @type {[number, number, number, number]} */ ([102.1, 8.1, 109.6, 23.5]);
export const Q1_BBOX = /** @type {[number, number, number, number]} */ ([
  106.68, 10.76, 106.72, 10.8,
]);

/** Điều kiện SQL DuckDB cho cột bbox struct của Overture. @param {[number, number, number, number]} b */
export const overtureBboxWhere = (b) =>
  `bbox.xmin >= ${b[0]} AND bbox.xmax <= ${b[2]} AND bbox.ymin >= ${b[1]} AND bbox.ymax <= ${b[3]}`;
/** Điều kiện SQL cho cột lon/lat. @param {[number, number, number, number]} b */
export const lonLatWhere = (b, lon = 'longitude', lat = 'latitude') =>
  `${lon} BETWEEN ${b[0]} AND ${b[2]} AND ${lat} BETWEEN ${b[1]} AND ${b[3]}`;
