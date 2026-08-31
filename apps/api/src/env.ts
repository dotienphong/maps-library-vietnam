import type { AuthInfo } from './auth';

export interface Env {
  META: KVNamespace;
  TILES: R2Bucket;
  DB: Hyperdrive;
  TILES_BASE: string;
  ENVIRONMENT: string;
  /** '1' = bật đếm quota KV cho tenant free/paid (spec 6.4). Mặc định '0'. */
  QUOTA_ENABLED?: string;
  /** Workers Analytics Engine — optional, code phải hoạt động khi vắng binding. */
  ANALYTICS?: AnalyticsEngineDataset;
}

/** Kiểu Hono chung cho app: Variables.auth do requireAuth() gán. */
export type AppEnv = { Bindings: Env; Variables: { auth?: AuthInfo } };
