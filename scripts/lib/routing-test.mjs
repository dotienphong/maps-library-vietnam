// Phần thuần (test được) của scripts/routing-test.mjs — spec dẫn đường A mục 7.3.
export const TEST_KEY = 'mlv_live_routingtest0000000000000';
export const DEFAULT_API_PORT = 8798;

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {{ compose: boolean, valhallaBase: string, apiPort: number, capture: boolean, down: boolean }}
 */
export function parseRoutingTestArgs(argv, env) {
  const compose = !argv.includes('--no-compose');
  let valhallaBase = env.VALHALLA_BASE?.replace(/\/+$/, '') ?? '';
  if (!compose && !valhallaBase) {
    throw new Error('--no-compose cần VALHALLA_BASE trỏ tới Valhalla đang chạy');
  }
  if (compose) valhallaBase = `http://127.0.0.1:${env.VALHALLA_PORT ?? '8002'}`;
  return {
    compose,
    valhallaBase,
    apiPort: DEFAULT_API_PORT,
    capture: argv.includes('--capture'),
    down: argv.includes('--down'),
  };
}

/**
 * Entry KV `apikey:<sha256>` cho wrangler dev local: auth đọc KV trước nên không cần Postgres.
 * @param {string} keyHash
 */
export function testAuthInfo(keyHash) {
  return {
    keyHash,
    keyPrefix: TEST_KEY.slice(0, 17),
    tenantId: '00000000-0000-4000-8000-0000000000ee',
    plan: 'internal',
    kind: 'server',
    scopes: ['places:read'],
    allowedOrigins: [],
    quotaPlacesPerDay: null,
    quotaDirectionsPerDay: null,
  };
}

/**
 * Chờ URL trả 2xx.
 * @param {string} url
 * @param {number} timeoutMs
 * @param {{ fetchImpl?: typeof fetch, intervalMs?: number, onTick?: (ms: number) => void }} [options]
 */
export async function waitForOk(url, timeoutMs, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const interval = options.intervalMs ?? 5_000;
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return;
    } catch {
      // chưa lên
    }
    const elapsed = Date.now() - started;
    if (elapsed > timeoutMs) {
      throw new Error(`${url} không lên trong ${Math.round(timeoutMs / 1000)} giây`);
    }
    options.onTick?.(elapsed);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
