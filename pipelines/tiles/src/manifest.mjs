#!/usr/bin/env node
// Dùng: manifest.mjs get | set --vn <release> [--poi <release>] | rollback
import { execFileSync } from 'node:child_process';
import { requireEnv } from './lib/env.mjs';
import { parseListedKeys, readOptionalJson } from './lib/manifest-state.mjs';

const namespaceId = requireEnv('KV_NAMESPACE_ID_META');
requireEnv('CLOUDFLARE_ACCOUNT_ID');
requireEnv('CLOUDFLARE_API_TOKEN');

/** @param {string[]} args */
const kv = (args) =>
  execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'kv', 'key', ...args, `--namespace-id=${namespaceId}`, '--remote'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();

const listedKeys = parseListedKeys(kv(['list', '--prefix=release:']));
/** @param {string} key */
const get = (key) =>
  readOptionalJson(key, listedKeys, (existingKey) => kv(['get', existingKey, '--text']));
/** @param {string} key @param {unknown} value */
const put = (key, value) => {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error(`Không thể mã hoá JSON cho key ${key}`);
  return kv(['put', key, json]);
};

const [command, ...rest] = process.argv.slice(2);
const current = get('release:current') ?? { vn: null, poi: null };
const history = get('release:history') ?? [];

if (command === 'get') {
  console.log(JSON.stringify({ current, history }, null, 2));
} else if (command === 'set') {
  const vnIndex = rest.indexOf('--vn');
  const poiIndex = rest.indexOf('--poi');
  if (vnIndex < 0 && poiIndex < 0) {
    throw new Error('set cần ít nhất --vn <release> hoặc --poi <release>');
  }
  const next = {
    vn: vnIndex >= 0 ? rest[vnIndex + 1] : current.vn,
    poi: poiIndex >= 0 ? rest[poiIndex + 1] : current.poi,
    updatedAt: new Date().toISOString(),
  };
  if ((vnIndex >= 0 && !next.vn) || (poiIndex >= 0 && !next.poi)) {
    throw new Error('Thiếu tên release sau --vn hoặc --poi');
  }
  put('release:history', [current, ...history].slice(0, 3));
  put('release:current', next);
  console.log('✓ manifest', JSON.stringify(next));
} else if (command === 'rollback') {
  const [previous, ...older] = history;
  if (!previous) throw new Error('Không có bản trước để rollback');
  put('release:current', {
    ...previous,
    updatedAt: new Date().toISOString(),
  });
  put('release:history', older);
  console.log('✓ rollback về', JSON.stringify(previous));
} else {
  throw new Error('Dùng: manifest.mjs get | set --vn <release> [--poi <release>] | rollback');
}
