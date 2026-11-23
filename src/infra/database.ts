import { Pool, type PoolConfig } from 'pg';
import {
  InfraConfigurationError,
  resolveInfraConfig,
  type DatabaseConfig,
} from './config.ts';
import { logger } from './logger.ts';

export interface DatabaseHealthResult {
  connected: boolean;
  latencyMs: number;
  connectionMode: 'connection_string' | 'unix_socket' | 'tcp_params';
  sslMode: DatabaseConfig['sslMode'];
  poolMax: number;
  errorCode?: string;
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
 * Classifies PostgreSQL connection errors into safe, actionable operator diagnostics
 * without leaking credentials, passwords, or connection strings.
 */
export function formatActionableDatabaseError(err: unknown): { code: string; message: string } {
  const anyErr = err as { code?: string; message?: string } | null;
  const rawCode = String(anyErr?.code || '').trim();
  const rawMessage = String(anyErr?.message || 'Unknown database error');
  // Strip any embedded credentials from connection URLs if present in driver error strings
  const sanitized = rawMessage.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgres://<redacted>');

  if (rawCode === 'ECONNREFUSED') {
    return {
      code: 'DB_CONNECTION_REFUSED',
      message: 'PostgreSQL refused the connection. Verify the database server is running and SQL_HOST/SQL_PORT or DATABASE_URL are reachable.',
    };
  }
  if (rawCode === 'ENOTFOUND' || rawCode === 'EAI_AGAIN') {
    return {
      code: 'DB_HOST_NOT_FOUND',
      message: 'PostgreSQL host could not be resolved. Verify DNS/VPC settings and SQL_HOST or DATABASE_URL.',
    };
  }
  if (rawCode === 'ETIMEDOUT' || /timeout/i.test(sanitized)) {
    return {
      code: 'DB_CONNECTION_TIMEOUT',
      message: 'PostgreSQL connection timed out. Check network firewall rules, Cloud SQL Auth Proxy, or DB_CONNECT_TIMEOUT_MS.',
    };
  }
  if (rawCode === '28P01' || rawCode === '28000') {
    return {
      code: 'DB_AUTH_FAILED',
      message: 'PostgreSQL authentication failed. Verify database user and password credentials in Secret Manager or environment.',
    };
  }
  if (rawCode === '3D000') {
    return {
      code: 'DB_NOT_FOUND',
      message: 'Target PostgreSQL database does not exist. Verify SQL_DB_NAME or DATABASE_URL database path.',
    };
  }
  if (/ssl|certificate|self signed/i.test(sanitized)) {
    return {
      code: 'DB_TLS_ERROR',
      message: 'PostgreSQL TLS handshake failed. Verify DB_SSL (disable | require | no-verify) and DB_SSL_CA_CERT.',
    };
  }
  return {
    code: rawCode || 'DB_CONNECTIVITY_ERROR',
    message: sanitized,
  };
}

/**
 * Validates pool limits, timeouts, and connectivity target before creating a pg.Pool.
 */
export function validateDatabasePoolConfig(cfg: DatabaseConfig): void {
  if (!cfg.connectionString && !cfg.socketPath && !cfg.host) {
    throw new InfraConfigurationError(
      'DB_TARGET_MISSING',
      'Database connectivity target is missing. Configure DATABASE_URL, DB_SOCKET_PATH, or SQL_HOST.'
    );
  }
  if (!Number.isInteger(cfg.poolMax) || cfg.poolMax < 1 || cfg.poolMax > 100) {
    throw new InfraConfigurationError(
      'INVALID_DB_POOL_MAX',
      `DB_POOL_MAX must be an integer between 1 and 100 (received ${cfg.poolMax}).`
    );
  }
  if (!Number.isInteger(cfg.idleTimeoutMillis) || cfg.idleTimeoutMillis < 1000 || cfg.idleTimeoutMillis > 600_000) {
    throw new InfraConfigurationError(
      'INVALID_DB_IDLE_TIMEOUT',
      `DB_IDLE_TIMEOUT_MS must be an integer between 1000 and 600000 ms (received ${cfg.idleTimeoutMillis}).`
    );
  }
  if (
    !Number.isInteger(cfg.connectionTimeoutMillis) ||
    cfg.connectionTimeoutMillis < 500 ||
    cfg.connectionTimeoutMillis > 120_000
  ) {
    throw new InfraConfigurationError(
      'INVALID_DB_CONNECT_TIMEOUT',
      `DB_CONNECT_TIMEOUT_MS must be an integer between 500 and 120000 ms (received ${cfg.connectionTimeoutMillis}).`
    );
  }
  if (!cfg.connectionString && !cfg.socketPath && (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535)) {
    throw new InfraConfigurationError(
      'INVALID_DB_PORT',
      `SQL_PORT must be an integer between 1 and 65535 (received ${cfg.port}).`
    );
  }
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
  validateDatabasePoolConfig(cfg);

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
        const formatted = formatActionableDatabaseError(err);
        dbLog.error('postgres_pool_idle_error', {
          code: formatted.code,
          message: formatted.message,
        });
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
      } catch (err: unknown) {
        const formatted = formatActionableDatabaseError(err);
        return {
          connected: false,
          latencyMs: Date.now() - started,
          connectionMode,
          sslMode: cfg.sslMode,
          poolMax: cfg.poolMax,
          errorCode: formatted.code,
          error: formatted.message,
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

export async function resetDatabaseProviderForTests(): Promise<void> {
  if (global._ouroDatabaseProvider) {
    await global._ouroDatabaseProvider.close();
    global._ouroDatabaseProvider = undefined;
  }
}
