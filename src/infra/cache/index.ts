import {
  InfraConfigurationError,
  resolveInfraConfig,
  type CacheConfig,
  type InfraConfig,
} from '../config.ts';
import { logger } from '../logger.ts';
import { MemoryCacheProvider } from './memory-cache.ts';
import { RedisCacheProvider } from './redis-cache.ts';
import type { CacheProvider } from './types.ts';

export * from './types.ts';
export { MemoryCacheProvider } from './memory-cache.ts';
export { RedisCacheProvider } from './redis-cache.ts';

declare global {
  var _ouroCacheProvider: CacheProvider | undefined;
}

/**
 * Enforces cloud-safe cache/rate-limiter selection:
 * - Local development works without Redis using MemoryCacheProvider.
 * - Multi-instance production NEVER silently falls back to in-memory rate limiting;
 *   it throws a clear InfraConfigurationError unless REDIS_URL is configured (or
 *   the deployment is explicitly declared single-instance).
 */
export function assertCacheConfigSafe(
  cacheCfg: CacheConfig,
  isProduction: boolean
): void {
  if (cacheCfg.provider === 'redis' && !cacheCfg.redisUrl) {
    throw new InfraConfigurationError(
      'REDIS_URL_REQUIRED',
      'CACHE_PROVIDER is set to "redis" but REDIS_URL is empty. Refusing to silently fall back to in-memory rate limiting.'
    );
  }

  if (isProduction && cacheCfg.provider === 'memory') {
    if (cacheCfg.topology === 'multi-instance') {
      throw new InfraConfigurationError(
        'DISTRIBUTED_CACHE_REQUIRED_IN_MULTI_INSTANCE_PROD',
        'In-memory rate limiting is forbidden in multi-instance production deployments. Configure REDIS_URL (CACHE_PROVIDER=redis) or explicitly set DEPLOYMENT_TOPOLOGY=single-instance for single-node deployments.'
      );
    }

    if (!cacheCfg.allowInMemoryInProd) {
      throw new InfraConfigurationError(
        'IN_MEMORY_CACHE_EXPLICIT_OPT_IN_REQUIRED',
        'Production single-instance in-memory cache requires ALLOW_IN_MEMORY_CACHE_IN_PROD=true (recommended: configure REDIS_URL instead).'
      );
    }
  }
}

export function createCacheProvider(customInfra?: Pick<InfraConfig, 'cache' | 'isProduction'>): CacheProvider {
  const infra = customInfra || resolveInfraConfig();
  assertCacheConfigSafe(infra.cache, infra.isProduction);

  if (infra.cache.provider === 'redis') {
    return new RedisCacheProvider(infra.cache);
  }

  if (infra.isProduction) {
    logger.warn('production_single_instance_memory_cache_active', {
      topology: infra.cache.topology,
      note: 'Explicitly opted into single-instance in-memory cache in production. Configure REDIS_URL before scaling horizontally.',
    });
  }

  return new MemoryCacheProvider(infra.cache.topology);
}

export function getCacheProvider(): CacheProvider {
  if (!global._ouroCacheProvider) {
    global._ouroCacheProvider = createCacheProvider();
  }
  return global._ouroCacheProvider;
}

export async function resetCacheProviderForTests(): Promise<void> {
  if (global._ouroCacheProvider) {
    await global._ouroCacheProvider.close();
    global._ouroCacheProvider = undefined;
  }
}
