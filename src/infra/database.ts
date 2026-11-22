import { Pool, type PoolConfig } from 'pg';
import { resolveInfraConfig, type DatabaseConfig } from './config.ts';
import { logger } from './logger.ts';

export interface DatabaseHealthResult {
  connected: boolean;
  latencyMs: number;
  connectionMode: 'connection_string' | 'unix_socket' | 'tcp_params';
  sslMode: DatabaseConfig['sslMode'];
  poolMax: number;
  error?: string;
}

export interface DatabaseProvider {
  getPool(): Pool;
  healthCheck(): Promise<DatabaseHealthResult>;
  close(): Promise<void>;
  getDiagnostics(): {
    connectionMode: 'connection_string' | 'unix_socket' | 'tcp_params';
    sslMode: DatabaseConfig['sslMode'];
    poolMax: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
  };
}

/**
 * Builds a cloud-agnostic node-postgres PoolConfig compatible with:
 * - Standard 12-factor DATABASE_URL (AWS RDS, Neon, Supabase, Render, self-hosted)
 * - Unix domain sockets (Google Cloud SQL Auth Proxy / local Postgres sockets)
 * - Discrete host/port/user/password/database env vars (SQL_* or PG*)
 */
export function buildPostgresPoolConfig(cfg: DatabaseConfig): {
  poolConfig: PoolConfig;
  connectionMode: 'connection_string' | 'unix_socket' | 'tcp_params';
} {
  const ssl =
    cfg.sslMode === 'disable'
      ? false
      : cfg.sslMode === 'no-verify'
      ? { rejectUnauthorized: false }
      : {
          rejectUnauthorized: true,
          ...(cfg.sslCaCert ? { ca: cfg.sslCaCert } : {}),
        };

  const base: PoolConfig = {
    max: cfg.poolMax,
    idleTimeoutMillis: cfg.idleTimeoutMillis,
    connectionTimeoutMillis: cfg.connectionTimeoutMillis,
    ssl,
  };

  if (cfg.connectionString) {
    return {
      connectionMode: 'connection_string',
      poolConfig: {
        ...base,
        connectionString: cfg.connectionString,
      },
    };
  }

  if (cfg.socketPath) {
    return {
      connectionMode: 'unix_socket',
      poolConfig: {
        ...base,
        host: cfg.socketPath,
        user: cfg.user,
        password: cfg.password,
        database: cfg.database,
        ssl: false,
      },
    };
  }

  return {
    connectionMode: 'tcp_params',
    poolConfig: {
      ...base,
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
    },
  };
}

declare global {
  var _ouroDatabaseProvider: DatabaseProvider | undefined;
}

export function createDatabaseProvider(customConfig?: DatabaseConfig): DatabaseProvider {
  const cfg = customConfig || resolveInfraConfig().database;
  const { poolConfig, connectionMode } = buildPostgresPoolConfig(cfg);
  const dbLog = logger.child({ module: 'database' });

  let pool: Pool | null = null;

  const getPool = (): Pool => {
    if (!pool) {
      pool = new Pool(poolConfig);
      pool.on('error', (err) => {
        dbLog.error('postgres_pool_idle_error', { error: err });
      });
    }
    return pool;
  };

  return {
    getPool,
    async healthCheck(): Promise<DatabaseHealthResult> {
      const started = Date.now();
      try {
        await getPool().query('SELECT 1');
        return {
          connected: true,
          latencyMs: Date.now() - started,
          connectionMode,
          sslMode: cfg.sslMode,
          poolMax: cfg.poolMax,
        };
      } catch (err: any) {
        return {
          connected: false,
          latencyMs: Date.now() - started,
          connectionMode,
          sslMode: cfg.sslMode,
          poolMax: cfg.poolMax,
          error: err?.message || 'Database connectivity check failed',
        };
      }
    },
    async close(): Promise<void> {
      if (pool) {
        const closing = pool;
        pool = null;
        await closing.end();
        dbLog.info('postgres_pool_closed');
      }
    },
    getDiagnostics() {
      return {
        connectionMode,
        sslMode: cfg.sslMode,
        poolMax: cfg.poolMax,
        idleTimeoutMillis: cfg.idleTimeoutMillis,
        connectionTimeoutMillis: cfg.connectionTimeoutMillis,
      };
    },
  };
}

export function getDatabaseProvider(): DatabaseProvider {
  if (!global._ouroDatabaseProvider) {
    global._ouroDatabaseProvider = createDatabaseProvider();
  }
  return global._ouroDatabaseProvider;
}
