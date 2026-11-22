import type { CacheProviderName, DeploymentTopology } from '../config.ts';

export interface RateLimitStore {
  recordAndCount(key: string, nowMs: number, windowMs: number): Promise<number> | number;
}

export interface CacheHealthResult {
  healthy: boolean;
  provider: CacheProviderName;
  distributed: boolean;
  topology: DeploymentTopology;
  latencyMs?: number;
  details: string;
}

export interface CacheProvider extends RateLimitStore {
  readonly providerName: CacheProviderName;
  readonly distributed: boolean;
  get<T = string>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<boolean>;
  ping(): Promise<boolean>;
  healthCheck(): Promise<CacheHealthResult>;
  close(): Promise<void>;
}
