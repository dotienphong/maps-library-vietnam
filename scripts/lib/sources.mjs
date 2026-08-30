export const GEOFABRIK_PBF = 'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf';
const OVERTURE_LIST =
  'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/';
// FSQ: S3 công khai đã đóng (2026) — dò qua API cây thư mục của dataset gated trên Hugging Face.
const FSQ_TREE = 'https://huggingface.co/api/datasets/foursquare/fsq-os-places/tree/main/release';

/**
 * CommonPrefixes của ListObjectsV2 (delimiter=/), bỏ Prefix gốc.
 * @param {string} xml
 * @param {string} base
 */
export function parseS3Prefixes(xml, base) {
  return [...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)]
    .map((match) => match[1] ?? '')
    .filter((prefix) => prefix !== base && prefix.startsWith(base));
}

/** @param {string[]} prefixes */
export function latestOvertureRelease(prefixes) {
  const versions = prefixes
    .map((prefix) => /release\/(\d{4}-\d{2}-\d{2}\.\d+)\//.exec(prefix)?.[1])
    .filter((version) => version !== undefined);
  return [...versions].sort().at(-1) ?? null;
}

/** @param {{ path: string, type: string }[]} entries kết quả JSON của HF tree API */
export function latestFsqRelease(entries) {
  const dates = entries
    .filter((entry) => entry.type === 'directory')
    .map((entry) => /dt=(\d{4}-\d{2}-\d{2})$/.exec(entry.path)?.[1])
    .filter((date) => date !== undefined);
  return [...dates].sort().at(-1) ?? null;
}

/**
 * Dò phiên bản 3 nguồn (spec 5.9 bước 1).
 * @param {typeof fetch} fetchFn
 * @param {string | undefined} hfToken
 */
export async function detectSources(fetchFn = fetch, hfToken = process.env.HF_TOKEN) {
  if (!hfToken) throw new Error('Thiếu HF_TOKEN để dò phiên bản Foursquare (dataset gated)');

  const [head, md5Text, overtureXml, fsqTree] = await Promise.all([
    fetchFn(GEOFABRIK_PBF, { method: 'HEAD' }),
    fetchFn(`${GEOFABRIK_PBF}.md5`).then((response) => response.text()),
    fetchFn(OVERTURE_LIST).then((response) => response.text()),
    fetchFn(FSQ_TREE, { headers: { Authorization: `Bearer ${hfToken}` } }).then((response) => {
      if (!response.ok) {
        throw new Error(
          `HF tree API: HTTP ${response.status} — token hết hạn hoặc chưa chấp nhận điều khoản dataset`,
        );
      }
      return response.json();
    }),
  ]);
  const overture = latestOvertureRelease(parseS3Prefixes(overtureXml, 'release/'));
  const fsq = latestFsqRelease(/** @type {{ path: string, type: string }[]} */ (fsqTree));
  if (!overture || !fsq) {
    throw new Error(`Không dò được phiên bản: overture=${overture} fsq=${fsq}`);
  }

  return {
    osm: {
      lastModified: head.headers.get('last-modified') ?? '',
      md5: md5Text.split(/\s+/)[0] ?? '',
    },
    overture: { release: overture },
    fsq: { release: fsq },
  };
}
