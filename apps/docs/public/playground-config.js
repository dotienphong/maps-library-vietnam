const LOCAL_API_BASE = 'http://localhost:8787';
const PRODUCTION_API_BASE = 'https://api.ai-solutions.io.vn';

export function resolveApiBase(search = location.search, hostname = location.hostname) {
  const override = new URLSearchParams(search).get('api');
  if (override) return override;

  return hostname === 'localhost' || hostname === '127.0.0.1'
    ? LOCAL_API_BASE
    : PRODUCTION_API_BASE;
}
