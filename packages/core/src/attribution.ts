export interface AttributionLink {
  text: string;
  href: string;
  license?: string;
}

/** Dòng bản quyền của chính MapsLibVN — phần duy nhất không nguồn dữ liệu nào khai báo hộ. */
const MAPSLIBVN_LINK: AttributionLink = {
  text: '© MapsLibVN',
  href: 'https://github.com/dotienphong/maps-library-vietnam',
};

export const ATTRIBUTION_LINKS: readonly AttributionLink[] = [
  MAPSLIBVN_LINK,
  {
    text: '© OpenStreetMap contributors',
    href: 'https://www.openstreetmap.org/copyright',
    license: 'ODbL',
  },
  { text: '© OpenMapTiles', href: 'https://openmaptiles.org/' },
  {
    text: 'Places: Overture Maps Foundation',
    href: 'https://overturemaps.org/',
    license: 'CDLA-Permissive 2.0',
  },
  {
    text: 'Foursquare OS Places',
    href: 'https://opensource.foursquare.com/os-places/',
    license: 'Apache-2.0',
  },
];

const withLicense = (link: AttributionLink, text: string) =>
  link.license ? `${text} (${link.license})` : text;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Ghép ba mục đầu bằng " · ", hai nguồn Places ngăn bằng ", ". */
function join(parts: string[]): string {
  const [mapsLibVN, osm, openMapTiles, overture, foursquare] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  return `${mapsLibVN} · ${osm} · ${openMapTiles} · ${overture}, ${foursquare}`;
}

export function attributionText(): string {
  return join(ATTRIBUTION_LINKS.map((link) => withLicense(link, link.text)));
}

const linkHtml = (link: AttributionLink) =>
  withLicense(
    link,
    `<a href="${link.href}" target="_blank" rel="noopener">${escapeHtml(link.text)}</a>`,
  );

export function attributionHtml(): string {
  return join(ATTRIBUTION_LINKS.map(linkHtml));
}

/**
 * Chỉ dòng bản quyền MapsLibVN, không kèm nguồn dữ liệu.
 *
 * Dùng khi bản đồ chạy trên style `light`/`dark` của MapsLibVN: mỗi source trong style đã tự khai
 * báo `attribution` của nó, nên nếu thêm cả chuỗi đầy đủ thì MapLibre hiển thị nguồn hai lần.
 * Với style URL tuỳ biến vẫn phải dùng {@link attributionHtml} vì không biết style đó khai gì.
 */
export function mapsLibVNAttributionHtml(): string {
  return linkHtml(MAPSLIBVN_LINK);
}
