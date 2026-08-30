import postgres from 'postgres';
import type { Env } from './env';

/** Client Postgres qua Hyperdrive (pool nằm phía Cloudflare). Gọi sql.end() cuối request. */
export function getSql(env: Env) {
  return postgres(env.DB.connectionString, {
    max: 5,
    fetch_types: false,
    prepare: false,
    connect_timeout: 5,
  });
}
