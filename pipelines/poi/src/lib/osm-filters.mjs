// Dùng chung cho ingest/osm.mjs (osmium tags-filter trên PBF) và scripts/make-quan-dao-osm.mjs (Overpass).
/** Khoá tag coi là "địa điểm" + đối tượng có số nhà (cho address_anchor ở Task 8). */
export const OSM_POI_FILTERS = [
  'nwr/amenity',
  'nwr/shop',
  'nwr/tourism',
  'nwr/leisure',
  'nwr/office',
  'nwr/craft',
  'nwr/healthcare',
  'nwr/historic',
  'nwr/public_transport',
  'nwr/aeroway=aerodrome,terminal',
  'nwr/railway=station,halt',
  'nwr/addr:housenumber',
  // Khoá mở rộng 26/09/2026 (plan 2026-09-26 Task 4): chỉ đúng các giá trị có trong
  // category_map_osm.csv; đối tượng chỉ mang khoá này mà không có tên bị bỏ ngay ở rows().
  'nwr/natural=peak,volcano,water,beach,cave_entrance,bay,cape,spring,hot_spring,wetland',
  'nwr/waterway=waterfall',
  'nwr/place=island,islet,square,hamlet,village,isolated_dwelling,neighbourhood,quarter,locality',
  'nwr/landuse=residential,industrial,commercial,retail,cemetery,religious',
  'nwr/man_made=lighthouse',
  'nwr/barrier=toll_booth,border_control',
  'nwr/highway=services,rest_area',
  'nwr/junction=yes,roundabout',
];
