export const GEOFABRIK_PBF = 'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf';
// FSQ: S3 công khai đã đóng (2026) — dò qua API cây thư mục của dataset gated trên Hugging Face.
const FSQ_TREE = 'https://huggingface.co/api/datasets/foursquare/fsq-os-places/tree/main/release';

/**
 * Retry lỗi mạng/5xx tạm thời ở biên nguồn dữ liệu; 4xx trả ngay để caller báo lỗi xác thực rõ ràng.
 * @param {typeof fetch} fetchFn
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} attempts
 * @param {(ms: number) => Promise<void>} sleepFn
 */
export async function fetchWithRetry(
  fetchFn,
  url,
  init = {},
  attempts = 3,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  /** @type {unknown} */
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchFn(url, init);
      if (response.ok || response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status} từ ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await sleepFn(1000 * 2 ** attempt);
  }
  throw lastError;
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
 * Dò phiên bản 2 nguồn (spec 5.9 bước 1): OSM (Geofabrik) và Foursquare OS Places (Hugging Face).
 * @param {typeof fetch} fetchFn
 * @param {string | undefined} hfToken
 */
export async function detectSources(fetchFn = fetch, hfToken = process.env.HF_TOKEN) {
  if (!hfToken) throw new Error('Thiếu HF_TOKEN để dò phiên bản Foursquare (dataset gated)');

  const [md5Response, fsqTree] = await Promise.all([
    fetchWithRetry(fetchFn, `${GEOFABRIK_PBF}.md5`),
    fetchWithRetry(fetchFn, FSQ_TREE, { headers: { Authorization: `Bearer ${hfToken}` } }).then(
      (response) => {
        if (!response.ok) {
          throw new Error(
            `HF tree API: HTTP ${response.status} — token hết hạn hoặc chưa chấp nhận điều khoản dataset`,
          );
        }
        return response.json();
      },
    ),
  ]);
  if (!md5Response.ok) throw new Error(`MD5 Geofabrik: HTTP ${md5Response.status}`);
  const md5Text = await md5Response.text();
  const fsq = latestFsqRelease(/** @type {{ path: string, type: string }[]} */ (fsqTree));
  if (!fsq) throw new Error(`Không dò được phiên bản: fsq=${fsq}`);

  return {
    osm: {
      lastModified:
        md5Response.headers.get('last-modified') ?? md5Response.headers.get('x-derived-from') ?? '',
      md5: md5Text.split(/\s+/)[0] ?? '',
    },
    fsq: { release: fsq },
  };
}
