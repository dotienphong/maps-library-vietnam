const REQUIRED_STYLE_OBJECTS = Object.freeze([
  'assets/sprites/osm-liberty.json',
  'assets/sprites/osm-liberty.png',
  'assets/sprites/osm-liberty@2x.json',
  'assets/sprites/osm-liberty@2x.png',
]);

const OPTIONAL_STYLE_OBJECTS = Object.freeze([
  'assets/fonts/Noto Sans Regular/0-255.pbf',
  'assets/fonts/Noto Sans Regular/256-511.pbf',
  'assets/fonts/Noto Sans Regular/768-1023.pbf',
  'assets/fonts/Noto Sans Regular/7680-7935.pbf',
]);

export const LOCAL_STYLE_OBJECTS = Object.freeze([
  ...REQUIRED_STYLE_OBJECTS,
  ...OPTIONAL_STYLE_OBJECTS,
]);

/** @param {(key: string) => boolean} exists */
export function selectExistingLocalStyleObjects(exists) {
  return [...REQUIRED_STYLE_OBJECTS, ...OPTIONAL_STYLE_OBJECTS.filter(exists)];
}
