import crypto from 'crypto';
import Redis from 'ioredis';
import { InfraConfigurationError, type CacheConfig } from '../config.ts';
import { logger } from '../logger.ts';
import type { CacheHealthResult, CacheProvider } from './types.ts';

/**
 * Atomic Lua sliding-window rate limiter script.
 * Executes inside Redis atomically across all horizontally scaled application replicas.
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local member = ARGV[3]
local cutoff = now - window
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
redis.call('ZADD', key, now, member)
local count = redis.call('ZCARD', key)
redis.call('PEXPIRE', key, window + 1000)
return count
`;

export class RedisCacheProvider implements CacheProvider {
  public readonly providerName = 'redis' as const;
  public readonly distributed = true;
  private readonly config: CacheConfig;
  private readonly client: Redis;
  private readonly cacheLog = logger.child({ module: 'cache', provider: 'redis' });

  constructor(config: CacheConfig, injectedClient?: Redis) {
    if (!config.redisUrl && !injectedClient) {
      throw new InfraConfigurationError(
        'REDIS_URL_REQUIRED',
        'CACHE_PROVIDER=redis requires REDIS_URL to be configured.'
      );
    }

    this.config = config;
    this.client =
      injectedClient ||
      new Redis(config.redisUrl!, {
        keyPrefix: config.redisKeyPrefix,
        lazyConnect: true,
        connectTimeout: config.redisConnectTimeoutMs,
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
        tls: config.redisUrl!.startsWith('rediss://') ? {} : undefined,
      });

    if (!injectedClient) {
      this.client.on('error', (err) => {
        this.cacheLog.error('redis_client_error', { error: err });
      });
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
  }

  async get<T = string>(key: string): Promise<T | null> {
    await this.ensureConnected();
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.ensureConnected();
    const serialized = JSON.stringify(value);
    if (typeof ttlSeconds === 'number' && ttlSeconds > 0) {
      await this.client.set(key, serialized, 'EX', Math.ceil(ttlSeconds));
    } else {
      await this.client.set(key, serialized);
    }
  }

  async del(key: string): Promise<boolean> {
    await this.ensureConnected();
    const deleted = await this.client.del(key);
    return deleted > 0;
  }

  async recordAndCount(key: string, nowMs: number, windowMs: number): Promise<number> {
    await this.ensureConnected();
    const member = `${nowMs}:${crypto.randomBytes(6).toString('hex')}`;
    const result = await this.client.eval(
      SLIDING_WINDOW_LUA,
      1,
      `rl:${key}`,
      String(nowMs),
      String(windowMs),
      member
    );
    return Number(result) || 1;
  }

  async ping(): Promise<boolean> {
    try {
      await this.ensureConnected();
      const res = await this.client.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<CacheHealthResult> {
    const started = Date.now();
    try {
      await this.ensureConnected();
      const pong = await this.client.ping();
      return {
        healthy: pong === 'PONG',
        provider: 'redis',
        distributed: true,
        topology: this.config.topology,
        latencyMs: Date.now() - started,
        details: 'Distributed Redis cache and sliding-window rate limiter connected.',
      };
    } catch (err: any) {
      return {
        healthy: false,
        provider: 'redis',
        distributed: true,
        topology: this.config.topology,
        latencyMs: Date.now() - started,
        details: err?.message || 'Redis connectivity check failed.',
      };
    }
  }

  async close(): Promise<void> {
    try {
      if (this.client.status !== 'end' && this.client.status !== 'wait') {
        await this.client.quit();
      } else {
        this.client.disconnect();
      }
      this.cacheLog.info('redis_client_closed');
    } catch (err) {
      this.cacheLog.warn('redis_client_close_error', { error: err });
    }
  }
}
