export interface AttributionLink {
  text: string;
  href: string;
  license?: string;
}

export const ATTRIBUTION_LINKS: readonly AttributionLink[] = [
  {
    text: '© MapsLibVN',
    href: 'https://mapslibvn-site.pages.dev/',
  },
  {
    text: '© OpenStreetMap contributors',
    href: 'https://www.openstreetmap.org/copyright',
    license: 'ODbL',
  },
  { text: '© OpenMapTiles', href: 'https://openmaptiles.org/' },
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

/** Ghép bốn mục bằng " · ". */
function join(parts: string[]): string {
  const [mapsLibVN, osm, openMapTiles, foursquare] = parts as [string, string, string, string];
  return `${mapsLibVN} · ${osm} · ${openMapTiles} · ${foursquare}`;
}

export function attributionText(): string {
  return join(ATTRIBUTION_LINKS.map((link) => withLicense(link, link.text)));
}

export function attributionHtml(): string {
  return join(
    ATTRIBUTION_LINKS.map((link) =>
      withLicense(
        link,
        `<a href="${link.href}" target="_blank" rel="noopener">${escapeHtml(link.text)}</a>`,
      ),
    ),
  );
}
