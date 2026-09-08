#!/usr/bin/env node
// Dùng: manifest.mjs get | set --vn <release> [--poi <release>] [--poi-osm <release>]
//   [--poi-profile <profile=release>] | rollback
import { execFileSync } from 'node:child_process';
import { requireEnv } from './lib/env.mjs';
import { nextManifest, parseListedKeys, readOptionalJson } from './lib/manifest-state.mjs';

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
  const next = nextManifest(current, rest, new Date().toISOString());
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
  throw new Error(
    'Dùng: manifest.mjs get | set --vn <release> [--poi <release>] [--poi-osm <release>] [--poi-profile <profile=release>] | rollback',
  );
}
