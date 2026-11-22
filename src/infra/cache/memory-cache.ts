import type { DeploymentTopology } from '../config.ts';
import type { CacheHealthResult, CacheProvider } from './types.ts';

interface MemoryEntry {
  serialized: string;
  expiresAt: number | null;
}

/**
 * Local development / explicitly single-instance in-memory cache and sliding-window rate-limit store.
 * Blocked automatically in multi-instance production environments by createCacheProvider().
 */
export class MemoryCacheProvider implements CacheProvider {
  public readonly providerName = 'memory' as const;
  public readonly distributed = false;
  private readonly topology: DeploymentTopology;
  private readonly kv = new Map<string, MemoryEntry>();
  private readonly rateHits = new Map<string, number[]>();

  constructor(topology: DeploymentTopology = 'single-instance') {
    this.topology = topology;
  }

  async get<T = string>(key: string): Promise<T | null> {
    const entry = this.kv.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.kv.delete(key);
      return null;
    }
    try {
      return JSON.parse(entry.serialized) as T;
    } catch {
      return entry.serialized as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const expiresAt =
      typeof ttlSeconds === 'number' && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.kv.set(key, {
      serialized: JSON.stringify(value),
      expiresAt,
    });
    if (this.kv.size > 10_000) {
      const now = Date.now();
      for (const [k, v] of this.kv.entries()) {
        if (v.expiresAt !== null && now > v.expiresAt) {
          this.kv.delete(k);
        }
      }
    }
  }

  async del(key: string): Promise<boolean> {
    return this.kv.delete(key);
  }

  recordAndCount(key: string, nowMs: number, windowMs: number): number {
    const cutoff = nowMs - windowMs;
    const recent = (this.rateHits.get(key) || []).filter((ts) => ts > cutoff);
    recent.push(nowMs);
    this.rateHits.set(key, recent);

    if (this.rateHits.size > 5000) {
      for (const [k, arr] of this.rateHits.entries()) {
        const filtered = arr.filter((ts) => ts > cutoff);
        if (filtered.length === 0) this.rateHits.delete(k);
        else this.rateHits.set(k, filtered);
      }
    }
    return recent.length;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async healthCheck(): Promise<CacheHealthResult> {
    return {
      healthy: true,
      provider: 'memory',
      distributed: false,
      topology: this.topology,
      latencyMs: 0,
      details:
        'Local in-memory cache and rate limiter active (local development / single-instance mode). Set REDIS_URL for distributed multi-instance deployments.',
    };
  }

  async close(): Promise<void> {
    this.kv.clear();
    this.rateHits.clear();
  }
}
